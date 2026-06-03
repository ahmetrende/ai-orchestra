<p align="center">
  <img src="assets/hero.png" alt="AI Orchestra" width="100%" />
</p>

<h1 align="center">AI Orchestra</h1>

<p align="center">
  Ask one question to multiple AIs. They debate each other — you get one unified answer.
</p>

---

## What it does

AI Orchestra is a macOS desktop app. You type one question. It sends that question to
several AI models at the same time (Claude, ChatGPT, Gemini, and any OpenAI-compatible
model you add). The models then **review each other's answers**, and a final model merges
everything into **one clear answer**.

## Features

- **Orchestra mode** — models answer, critique each other for 1–5 rounds, then a judge writes one final answer.
- **Split mode** — see each model's answer side by side, no debate.
- **Many providers** — Claude, ChatGPT, Gemini built in. Add any OpenAI-compatible API (xAI, DeepSeek, OpenRouter, local Ollama, …) with just a base URL.
- **Model picker** — choose models from a dropdown (cheap → expensive), or type a model id by hand.
- **Token usage** — see input/output tokens per model and per run.
- **History** — every conversation is saved, auto-named, and searchable. Continue old chats (each chat keeps its own memory).
- **Two languages** — English and Turkish. Follows your system language, remembers your choice.
- **Daily model refresh** — the live model list updates once a day (and on demand).
- **Private by design** — API keys are stored encrypted in the macOS Keychain. Nothing is sent anywhere except the AI providers you choose.

## Screenshots

<p align="center">
  <img src="assets/screenshot-orchestra.png" alt="Models answering and debating" width="49%" />
  <img src="assets/screenshot-answer.png" alt="Unified answer with judge and token usage" width="49%" />
</p>

<p align="center">
  <em>Left: each model answers, then critiques the others. Right: the judge merges everything into one answer, with per-model token usage.</em>
</p>

## How it works

```
Your question
     │
     ├──► Claude  ─┐
     ├──► ChatGPT ─┤  1) all answer in parallel
     └──► Gemini  ─┘
                   │
                   ▼  2) each model reads the others and improves its answer (N rounds)
                   │
                   ▼  3) a judge model merges everything
                   │
              One unified answer
```

## Getting started

You need API keys for the providers you want to use
([Anthropic](https://console.anthropic.com), [OpenAI](https://platform.openai.com),
[Google AI Studio](https://aistudio.google.com)).

```bash
git clone https://github.com/ahmetrende/ai-orchestra.git
cd ai-orchestra
npm install
npm start
```

On first launch, open **Settings (⚙)** and paste your API keys. Then type a question and hit **Send**.

## Build a macOS app

```bash
npm run dist        # creates a .dmg in dist/
```

Or build an unsigned `.app` for local use:

```bash
npx electron-builder --mac --arm64
```

## Where your data lives

Everything stays on your Mac, in `~/.ai-orchestra/`:

- `config.json` — settings and API keys (keys are Keychain-encrypted)
- `history.json` — your conversations
- `models-cache.json` — the cached model list

This folder is kept even if you delete and reinstall the app.

## Tech

Electron · vanilla JS (no build step) · `marked` + `highlight.js` for Markdown/code rendering.

## License

MIT

---

Made by [Ahmet Rende](https://www.linkedin.com/in/ahmetrende/) · [GitHub](https://github.com/ahmetrende)
