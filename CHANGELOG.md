# Changelog

## v1.1.0 — 2026-06-05

### Added
- Error logging. Crashes, failed runs, and renderer errors are written to
  `~/.ai-orchestra/error.log`. Open it from **Help → Open Logs Folder** or the
  **About** dialog.
- App version and release date shown in the bottom-left corner (e.g. `v1.1.0 (2026-06-05)`).

### Fixed
- **"AI Orchestra is damaged" on download.** The released app now carries a valid
  ad-hoc signature, so it no longer reports as damaged on other Macs. First launch
  still needs `xattr -dr com.apple.quarantine "/Applications/AI Orchestra.app"`
  (the app is not notarized).
- Custom app icon now also shows in dev (`npm start`), not just in packaged builds.

## v1.0.0 — 2026-06-02

First public release.

- Orchestra mode: multiple AIs answer, critique each other for 1–5 rounds, then a judge merges one answer.
- Split mode: see each model's answer side by side.
- Providers: Claude, ChatGPT, Gemini built in, plus any OpenAI-compatible API (xAI, DeepSeek, Ollama, …).
- Conversation history with auto-naming, search, and continue-with-memory.
- Per-model token usage, English/Turkish, light/dark/system themes.
- In-app find (Cmd+F), Markdown export, daily model refresh, check for updates.
