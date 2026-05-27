// ── State ─────────────────────────────────────────────────────────────────────
let currentUser = null;
let db = null;
let conversationHistory = [];
let currentConversationId = null;
let isStreaming = false;
let authIdToken = null;

// ── DOM Elements ──────────────────────────────────────────────────────────────
const loginScreen = document.getElementById('loginScreen');
const appContainer = document.getElementById('appContainer');
const googleSignInBtn = document.getElementById('googleSignInBtn');
const messagesContainer = document.getElementById('messagesContainer');
const messagesEl = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const welcome = document.getElementById('welcome');
const newChatBtn = document.getElementById('newChatBtn');
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebarOverlay');
const menuBtn = document.getElementById('menuBtn');
const signOutBtn = document.getElementById('signOutBtn');
const userAvatar = document.getElementById('userAvatar');
const userName = document.getElementById('userName');
const historyList = document.getElementById('historyList');
const searchCheckbox = document.getElementById('searchCheckbox');

// ── Firebase Init ─────────────────────────────────────────────────────────────
async function initFirebase() {
  try {
    const resp = await fetch('/api/firebase-config');
    const config = await resp.json();

    if (!config.apiKey) {
      console.warn('Firebase not configured — running without auth');
      showApp({ uid: 'anonymous', displayName: 'User', photoURL: '' });
      return;
    }

    firebase.initializeApp(config);
    db = firebase.firestore();

    // Auth state listener
    firebase.auth().onAuthStateChanged(async (user) => {
      if (user) {
        currentUser = user;
        authIdToken = await user.getIdToken();

        // Refresh token periodically
        setInterval(async () => {
          if (currentUser) {
            authIdToken = await currentUser.getIdToken(true);
          }
        }, 10 * 60 * 1000); // every 10 min

        showApp(user);
        loadConversations();
      } else {
        currentUser = null;
        authIdToken = null;
        showLogin();
      }
    });
  } catch (err) {
    console.error('Firebase init error:', err);
    // Fallback: run without auth
    showApp({ uid: 'anonymous', displayName: 'User', photoURL: '' });
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────────
function signInWithGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  firebase.auth().signInWithPopup(provider).catch(err => {
    console.error('Sign-in error:', err);
    alert('Sign-in failed. Please try again.');
  });
}

function signOut() {
  firebase.auth().signOut();
}

// ── UI State ──────────────────────────────────────────────────────────────────
function showLogin() {
  loginScreen.style.display = 'flex';
  appContainer.style.display = 'none';
}

function showApp(user) {
  loginScreen.style.display = 'none';
  appContainer.style.display = 'flex';
  userAvatar.src = user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || 'U')}&background=0d9488&color=fff&size=64`;
  userName.textContent = user.displayName || 'User';
}

// ── Conversation Management (Firestore) ──────────────────────────────────────
async function loadConversations() {
  if (!db || !currentUser) return;

  try {
    const snapshot = await db
      .collection('users').doc(currentUser.uid)
      .collection('conversations')
      .orderBy('updatedAt', 'desc')
      .limit(30)
      .get();

    historyList.innerHTML = '';
    snapshot.forEach(doc => {
      const data = doc.data();
      addHistoryItem(doc.id, data.title || 'New conversation', doc.id === currentConversationId);
    });
  } catch (err) {
    console.error('Load conversations error:', err);
  }
}

function addHistoryItem(id, title, isActive = false) {
  const item = document.createElement('div');
  item.className = `history-item${isActive ? ' active' : ''}`;
  item.dataset.id = id;
  item.innerHTML = `
    <svg class="history-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
    <span class="history-title">${escapeHtml(title)}</span>
    <button class="history-delete" title="Delete conversation" onclick="event.stopPropagation(); deleteConversation('${id}')">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  `;
  item.addEventListener('click', () => loadConversation(id));
  historyList.appendChild(item);
}

async function loadConversation(convId) {
  if (!db || !currentUser || convId === currentConversationId) return;

  currentConversationId = convId;
  conversationHistory = [];

  // Clear messages
  messagesEl.innerHTML = '';
  if (welcome) welcome.style.display = 'none';

  // Highlight active
  document.querySelectorAll('.history-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === convId);
  });

  try {
    const snapshot = await db
      .collection('users').doc(currentUser.uid)
      .collection('conversations').doc(convId)
      .collection('messages')
      .orderBy('createdAt', 'asc')
      .get();

    snapshot.forEach(doc => {
      const msg = doc.data();
      conversationHistory.push({ role: msg.role, content: msg.content });
      appendMessage(msg.role, msg.content);
    });

    scrollToBottom();
  } catch (err) {
    console.error('Load conversation error:', err);
  }

  closeSidebar();
}

async function saveMessage(role, content) {
  if (!db || !currentUser) return;

  try {
    const convRef = db.collection('users').doc(currentUser.uid).collection('conversations');

    // Create conversation if new
    if (!currentConversationId) {
      const title = content.slice(0, 50) + (content.length > 50 ? '...' : '');
      const doc = await convRef.add({
        title,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      currentConversationId = doc.id;
      addHistoryItem(doc.id, title, true);
    } else {
      // Update timestamp
      await convRef.doc(currentConversationId).update({
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    }

    // Save message
    await convRef.doc(currentConversationId).collection('messages').add({
      role,
      content,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error('Save message error:', err);
  }
}

async function deleteConversation(convId) {
  if (!db || !currentUser) return;

  try {
    // Delete messages subcollection
    const msgSnapshot = await db
      .collection('users').doc(currentUser.uid)
      .collection('conversations').doc(convId)
      .collection('messages')
      .get();

    const batch = db.batch();
    msgSnapshot.forEach(doc => batch.delete(doc.ref));
    batch.delete(
      db.collection('users').doc(currentUser.uid)
        .collection('conversations').doc(convId)
    );
    await batch.commit();

    // If we deleted the current conversation, reset
    if (convId === currentConversationId) {
      resetChat();
    }

    // Remove from UI
    const el = historyList.querySelector(`[data-id="${convId}"]`);
    if (el) el.remove();
  } catch (err) {
    console.error('Delete conversation error:', err);
  }
}

// ── Initialize ────────────────────────────────────────────────────────────────
function init() {
  messageInput.addEventListener('input', handleInputChange);
  messageInput.addEventListener('keydown', handleKeyDown);
  sendBtn.addEventListener('click', sendMessage);
  newChatBtn.addEventListener('click', resetChat);
  menuBtn.addEventListener('click', toggleSidebar);
  sidebarOverlay.addEventListener('click', closeSidebar);
  googleSignInBtn.addEventListener('click', signInWithGoogle);
  signOutBtn.addEventListener('click', signOut);

  // Suggestion chips
  document.querySelectorAll('.suggestion-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const prompt = chip.dataset.prompt;
      messageInput.value = prompt;
      handleInputChange();
      sendMessage();
    });
  });

  initFirebase();
}

// ── Input Handling ────────────────────────────────────────────────────────────
function handleInputChange() {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 160) + 'px';
  sendBtn.disabled = !messageInput.value.trim() || isStreaming;
}

function handleKeyDown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) sendMessage();
  }
}

// ── Send Message ──────────────────────────────────────────────────────────────
async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || isStreaming) return;

  if (welcome) welcome.style.display = 'none';

  appendMessage('user', text);
  conversationHistory.push({ role: 'user', content: text });
  saveMessage('user', text);

  messageInput.value = '';
  messageInput.style.height = 'auto';
  sendBtn.disabled = true;

  const typingEl = showTypingIndicator();
  isStreaming = true;

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (authIdToken) {
      headers['Authorization'] = `Bearer ${authIdToken}`;
    }

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        messages: conversationHistory,
        searchEnabled: searchCheckbox.checked,
      }),
    });

    typingEl.remove();

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `Server error (${response.status})`);
    }

    const aiMsg = appendMessage('assistant', '');
    const bubble = aiMsg.querySelector('.message-bubble');
    let fullText = '';

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          if (parsed.error) throw new Error(parsed.error);
          if (parsed.content) {
            fullText += parsed.content;
            bubble.innerHTML = renderMarkdown(fullText);
            scrollToBottom();
          }
        } catch (parseErr) {
          // Skip malformed chunks
        }
      }
    }

    conversationHistory.push({ role: 'assistant', content: fullText });
    saveMessage('assistant', fullText);
  } catch (err) {
    typingEl?.remove();
    appendMessage('assistant', err.message || 'Something went wrong. Please try again.', true);
  } finally {
    isStreaming = false;
    handleInputChange();
    messageInput.focus();
  }
}

// ── Append Message to DOM ─────────────────────────────────────────────────────
function appendMessage(role, content, isError = false) {
  const msgEl = document.createElement('div');
  msgEl.className = `message ${role}`;

  const avatarHtml = role === 'assistant'
    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`
    : currentUser?.photoURL
      ? `<img src="${currentUser.photoURL}" alt="" style="width:100%;height:100%;border-radius:inherit;object-fit:cover;" />`
      : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

  const renderedContent = role === 'assistant' && content
    ? renderMarkdown(content)
    : escapeHtml(content);

  msgEl.innerHTML = `
    <div class="message-avatar">${avatarHtml}</div>
    <div class="message-content">
      <div class="message-bubble${isError ? ' error-bubble' : ''}">${renderedContent}</div>
    </div>
  `;

  messagesEl.appendChild(msgEl);
  scrollToBottom();
  return msgEl;
}

// ── Typing Indicator ──────────────────────────────────────────────────────────
function showTypingIndicator() {
  const msgEl = document.createElement('div');
  msgEl.className = 'message assistant';
  msgEl.innerHTML = `
    <div class="message-avatar">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
    </div>
    <div class="message-content">
      <div class="message-bubble">
        <div class="typing-indicator">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div>
      </div>
    </div>
  `;
  messagesEl.appendChild(msgEl);
  scrollToBottom();
  return msgEl;
}

// ── Markdown Renderer ─────────────────────────────────────────────────────────
function renderMarkdown(text) {
  let html = escapeHtml(text);

  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => `<pre><code>${code.trim()}</code></pre>`);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/^---$/gm, '<hr>');
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
  html = html.replace(/^[•\-\*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');

  if (!html.startsWith('<h') && !html.startsWith('<ul') && !html.startsWith('<ol') && !html.startsWith('<pre') && !html.startsWith('<blockquote')) {
    html = `<p>${html}</p>`;
  }

  html = html.replace(/<p><\/p>/g, '');
  html = html.replace(/<p>(<h[1-3]>)/g, '$1');
  html = html.replace(/(<\/h[1-3]>)<\/p>/g, '$1');
  html = html.replace(/<p>(<ul>)/g, '$1');
  html = html.replace(/(<\/ul>)<\/p>/g, '$1');
  html = html.replace(/<p>(<pre>)/g, '$1');
  html = html.replace(/(<\/pre>)<\/p>/g, '$1');
  html = html.replace(/<p>(<blockquote>)/g, '$1');
  html = html.replace(/(<\/blockquote>)<\/p>/g, '$1');
  html = html.replace(/<p>(<hr>)<\/p>/g, '$1');
  html = html.replace(/<p><br>/g, '<p>');

  return html;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escapeHtml(text) {
  const el = document.createElement('div');
  el.textContent = text;
  return el.innerHTML;
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  });
}

function resetChat() {
  conversationHistory = [];
  currentConversationId = null;
  messagesEl.innerHTML = '';

  // Re-clone welcome
  const welcomeTemplate = document.getElementById('welcome');
  if (welcomeTemplate) {
    messagesEl.appendChild(welcomeTemplate);
    welcomeTemplate.style.display = '';
    // Re-bind suggestion chips
    welcomeTemplate.querySelectorAll('.suggestion-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const prompt = chip.dataset.prompt;
        messageInput.value = prompt;
        handleInputChange();
        sendMessage();
      });
    });
  } else {
    location.reload();
  }

  // Remove active state from history
  document.querySelectorAll('.history-item').forEach(el => el.classList.remove('active'));
  closeSidebar();
  messageInput.focus();
}

function toggleSidebar() {
  sidebar.classList.toggle('open');
  sidebarOverlay.classList.toggle('active');
}

function closeSidebar() {
  sidebar.classList.remove('open');
  sidebarOverlay.classList.remove('active');
}

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
