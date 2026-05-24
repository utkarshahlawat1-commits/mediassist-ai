import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// ── Groq client (OpenAI-compatible) ─────────────────────────────────────────
const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

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

// ── Simple rate limiting ─────────────────────────────────────────────────────
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60_000; // 1 minute
const RATE_LIMIT_MAX = 20;        // 20 requests per minute per IP

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

// ── Chat endpoint with streaming ─────────────────────────────────────────────
app.post('/api/chat', rateLimit, async (req, res) => {
  try {
    // Check API key first
    if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY === 'your_groq_api_key_here') {
      return res.status(500).json({ error: 'GROQ_API_KEY is not configured on the server.' });
    }

    const { messages } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages array is required.' });
    }

    // Validate and sanitize messages
    const sanitized = messages.slice(-20).map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content).slice(0, 4000),
    }));

    const stream = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...sanitized],
      temperature: 0.6,
      max_tokens: 2048,
      stream: true,
    });

    // Set up streaming headers only after successful API call
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    for await (const chunk of stream) {
      const content = chunk.choices?.[0]?.delta?.content;
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('Groq API error:', err.message, err.status, err.code);

    // If headers haven't been sent yet, send JSON error
    if (!res.headersSent) {
      const status = err.status || 500;
      return res.status(status).json({
        error: status === 429
          ? 'Rate limit reached. Please wait a moment and try again.'
          : `Error: ${err.message || 'Something went wrong. Please try again.'}`,
      });
    }

    // If already streaming, send error event
    res.write(`data: ${JSON.stringify({ error: 'Stream interrupted. Please try again.' })}\n\n`);
    res.end();
  }
});

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  const keySet = !!process.env.GROQ_API_KEY && process.env.GROQ_API_KEY !== 'your_groq_api_key_here';
  res.json({ status: 'ok', model: 'llama-3.3-70b-versatile', apiKeyConfigured: keySet });
});

// ── SPA fallback ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  🩺 MediAssist AI is running at http://localhost:${PORT}\n`);
  if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY === 'your_groq_api_key_here') {
    console.warn('  ⚠️  GROQ_API_KEY is not set! Copy .env.example to .env and add your key.');
    console.warn('  📝 Get a free key at https://console.groq.com\n');
  }
});
