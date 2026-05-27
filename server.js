import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import admin from 'firebase-admin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// ── Firebase Admin SDK ───────────────────────────────────────────────────────
if (process.env.FIREBASE_PROJECT_ID) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
  console.log('  ✅ Firebase Admin initialized');
} else {
  console.warn('  ⚠️  Firebase not configured — auth will be disabled');
}

// ── Health-focused system prompt ─────────────────────────────────────────────
const SYSTEM_PROMPT = `You are MediAssist AI — a knowledgeable, empathetic health assistant.

ROLE:
• Help users understand symptoms, conditions, treatments, and wellness topics.
• Provide clear, evidence-based health information in accessible language.
• Suggest when professional medical attention may be needed.
• Offer general wellness tips: nutrition, exercise, mental health, sleep.

GUIDELINES:
• Always begin serious symptom discussions by noting you are an AI, not a doctor.
• If symptoms sound urgent (chest pain, difficulty breathing, stroke signs, severe bleeding), IMMEDIATELY advise calling emergency services.
• Use structured formatting: headings, bullet points, numbered steps when helpful.
• Be warm, reassuring, and non-judgmental.
• When uncertain, say so honestly rather than guessing.
• Never prescribe specific medications or dosages — suggest consulting a healthcare provider.
• Respect user privacy — never ask for unnecessary personal information.

DISCLAIMER (include naturally when relevant):
"I'm an AI health assistant and cannot replace professional medical advice. Always consult a qualified healthcare provider for diagnosis and treatment."`;

// ── Auth Middleware ───────────────────────────────────────────────────────────
async function verifyAuth(req, res, next) {
  // Skip auth if Firebase is not configured
  if (!process.env.FIREBASE_PROJECT_ID) {
    req.user = { uid: 'anonymous', name: 'User' };
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required. Please sign in.' });
  }

  try {
    const token = authHeader.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = { uid: decoded.uid, name: decoded.name || 'User', email: decoded.email };
    next();
  } catch (err) {
    console.error('Auth error:', err.message);
    return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  }
}

// ── Simple rate limiting ─────────────────────────────────────────────────────
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60_000;
const RATE_LIMIT_MAX = 20;

function rateLimit(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const record = rateLimitMap.get(ip) || { count: 0, start: now };

  if (now - record.start > RATE_LIMIT_WINDOW) {
    record.count = 1;
    record.start = now;
  } else {
    record.count++;
  }

  rateLimitMap.set(ip, record);

  if (record.count > RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
  }
  next();
}

// ── Web Search (DuckDuckGo) ──────────────────────────────────────────────────
async function searchWeb(query) {
  try {
    const encoded = encodeURIComponent(query);
    const response = await fetch(`https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`);
    const data = await response.json();

    const results = [];

    // Abstract/summary
    if (data.Abstract) {
      results.push({ title: data.Heading || 'Summary', snippet: data.Abstract, source: data.AbstractURL });
    }

    // Related topics
    if (data.RelatedTopics) {
      for (const topic of data.RelatedTopics.slice(0, 5)) {
        if (topic.Text) {
          results.push({ title: topic.Text.slice(0, 80), snippet: topic.Text, source: topic.FirstURL });
        }
      }
    }

    // If DuckDuckGo instant answer is empty, try the HTML search
    if (results.length === 0) {
      const htmlResp = await fetch(`https://html.duckduckgo.com/html/?q=${encoded}`, {
        headers: { 'User-Agent': 'MediAssist AI Bot/1.0' },
      });
      const html = await htmlResp.text();

      // Extract result snippets from HTML
      const snippetRegex = /<a rel="nofollow" class="result__snippet"[^>]*>(.*?)<\/a>/g;
      const titleRegex = /<a rel="nofollow" class="result__a"[^>]*>(.*?)<\/a>/g;
      let match;
      let i = 0;

      while ((match = snippetRegex.exec(html)) !== null && i < 5) {
        const titleMatch = titleRegex.exec(html);
        results.push({
          title: titleMatch ? titleMatch[1].replace(/<[^>]*>/g, '') : `Result ${i + 1}`,
          snippet: match[1].replace(/<[^>]*>/g, ''),
          source: '',
        });
        i++;
      }
    }

    return results;
  } catch (err) {
    console.error('Search error:', err.message);
    return [];
  }
}

// ── Search endpoint ──────────────────────────────────────────────────────────
app.post('/api/search', verifyAuth, rateLimit, async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'Query is required.' });

  const results = await searchWeb(query);
  res.json({ results });
});

// ── Chat endpoint with streaming + web search ────────────────────────────────
app.post('/api/chat', verifyAuth, rateLimit, async (req, res) => {
  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey || apiKey === 'your_groq_api_key_here') {
      return res.status(500).json({ error: 'GROQ_API_KEY is not configured on the server.' });
    }

    const { messages, searchEnabled } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages array is required.' });
    }

    // Validate and sanitize messages
    const sanitized = messages.slice(-20).map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content).slice(0, 4000),
    }));

    // Get the latest user message for search
    const lastUserMsg = sanitized.filter(m => m.role === 'user').pop();

    // Build system prompt with optional search context
    let systemPrompt = SYSTEM_PROMPT;

    if (searchEnabled && lastUserMsg) {
      const searchResults = await searchWeb(lastUserMsg.content);
      if (searchResults.length > 0) {
        const searchContext = searchResults
          .map((r, i) => `[${i + 1}] ${r.title}: ${r.snippet}`)
          .join('\n');
        systemPrompt += `\n\nWEB SEARCH RESULTS (use these for up-to-date information):\n${searchContext}\n\nIncorporate relevant search results into your response when helpful. Cite sources when possible.`;
      }
    }

    // Call Groq API
    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'system', content: systemPrompt }, ...sanitized],
        temperature: 0.6,
        max_tokens: 2048,
        stream: true,
      }),
    });

    if (!groqResponse.ok) {
      const errBody = await groqResponse.text();
      console.error('Groq API HTTP error:', groqResponse.status, errBody);
      return res.status(groqResponse.status).json({
        error: groqResponse.status === 429
          ? 'Rate limit reached. Please wait a moment and try again.'
          : `Groq API error (${groqResponse.status}): ${errBody.slice(0, 200)}`,
      });
    }

    // Stream headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const reader = groqResponse.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value, { stream: true });
      const lines = text.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            res.write(`data: ${JSON.stringify({ content })}\n\n`);
          }
        } catch {
          // Skip malformed chunks
        }
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('Chat error:', err.message, err.code, err.cause);

    if (!res.headersSent) {
      return res.status(500).json({
        error: `Error: ${err.message || 'Something went wrong. Please try again.'}`,
      });
    }

    res.write(`data: ${JSON.stringify({ error: 'Stream interrupted. Please try again.' })}\n\n`);
    res.end();
  }
});

// ── Firebase config endpoint (public, safe to expose) ────────────────────────
app.get('/api/firebase-config', (req, res) => {
  res.json({
    apiKey: process.env.FIREBASE_WEB_API_KEY || '',
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
    appId: process.env.FIREBASE_APP_ID || '',
  });
});

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  const keySet = !!process.env.GROQ_API_KEY && process.env.GROQ_API_KEY !== 'your_groq_api_key_here';
  const firebaseSet = !!process.env.FIREBASE_PROJECT_ID;
  res.json({ status: 'ok', model: 'llama-3.3-70b-versatile', apiKeyConfigured: keySet, firebaseConfigured: firebaseSet });
});

// ── SPA fallback ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  🩺 MediAssist AI is running at http://localhost:${PORT}\n`);
  if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY === 'your_groq_api_key_here') {
    console.warn('  ⚠️  GROQ_API_KEY is not set!');
  }
  if (!process.env.FIREBASE_PROJECT_ID) {
    console.warn('  ⚠️  Firebase is not configured — auth disabled');
  }
});
