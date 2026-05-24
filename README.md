# MediAssist AI 🩺

AI-powered health assistant built with Groq LLaMA 3.3-70b. Features a ChatGPT-style streaming chat interface with a medical-focused AI that helps users understand symptoms, conditions, and wellness topics.

## Features
- ⚡ Ultra-fast AI responses via Groq's LPU
- 💬 Real-time streaming chat interface
- 🌙 Premium dark mode with glassmorphism design
- 📱 Fully responsive (mobile + desktop)
- 🩺 Health-focused AI system prompt
- ⚠️ Built-in medical disclaimers

## Setup

1. Clone this repo
2. Run `npm install`
3. Copy `.env.example` to `.env` and add your [Groq API key](https://console.groq.com)
4. Run `npm start`
5. Open `http://localhost:3000`

## Tech Stack
- **Backend**: Node.js + Express
- **AI**: Groq API (LLaMA 3.3-70b-versatile)
- **Frontend**: Vanilla HTML/CSS/JS
- **Streaming**: Server-Sent Events (SSE)
