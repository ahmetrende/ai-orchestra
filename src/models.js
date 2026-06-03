// models.js
// Provider (saglayici) presetleri + model kataloglari.
// Fiyatlar 1M token basina USD (input / output), Mayis 2026. Siralama input'a gore.
//
// kind: "anthropic" -> Anthropic mesaj formati
//       "openai"    -> OpenAI-uyumlu /chat/completions (Gemini, Grok, DeepSeek,
//                      Ollama, OpenRouter... hepsi bu formati konusur)
// tokenParam: cikti token limiti icin gonderilecek alan adi.

const PROVIDER_PRESETS = [
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    tokenParam: "max_tokens",
    builtin: true,
  },
  {
    id: "openai",
    name: "OpenAI (ChatGPT)",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    tokenParam: "max_completion_tokens",
    builtin: true,
  },
  {
    id: "gemini",
    name: "Google Gemini",
    kind: "openai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    tokenParam: "max_tokens",
    builtin: true,
  },
];

// Ozel saglayici eklerken kullanilacak sablon (Ollama vb. icin oneriler UI'da)
const CUSTOM_PROVIDER_TEMPLATE = {
  kind: "openai",
  tokenParam: "max_tokens",
  builtin: false,
};

const CATALOGS = {
  anthropic: [
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", in: 1.0, out: 5.0 },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", in: 3.0, out: 15.0 },
    { id: "claude-opus-4-6", label: "Claude Opus 4.6", in: 5.0, out: 25.0 },
    { id: "claude-opus-4-7", label: "Claude Opus 4.7", in: 5.0, out: 25.0 },
    { id: "claude-opus-4-8", label: "Claude Opus 4.8", in: 5.0, out: 25.0 },
  ],
  openai: [
    { id: "gpt-5.4-nano", label: "GPT-5.4 Nano", in: 0.2, out: 1.25 },
    { id: "gpt-4.1-mini", label: "GPT-4.1 mini", in: 0.4, out: 1.6 },
    { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", in: 0.75, out: 4.5 },
    { id: "gpt-5.2-codex", label: "GPT-5.2 Codex", in: 1.75, out: 14.0 },
    { id: "gpt-4o", label: "GPT-4o", in: 2.5, out: 10.0 },
    { id: "gpt-5.4", label: "GPT-5.4", in: 2.5, out: 15.0 },
    { id: "gpt-5.5", label: "GPT-5.5", in: 5.0, out: 30.0 },
  ],
  gemini: [
    { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite", in: 0.1, out: 0.4 },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", in: 0.3, out: 2.5 },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", in: 1.25, out: 10.0 },
    { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", in: 1.5, out: 9.0 },
    { id: "gemini-3.1-pro", label: "Gemini 3.1 Pro", in: 2.0, out: 12.0 },
  ],
};

function sortByPrice(list) {
  return [...list].sort((a, b) => {
    const ai = a.in ?? Infinity;
    const bi = b.in ?? Infinity;
    if (ai !== bi) return ai - bi;
    return (a.out ?? Infinity) - (b.out ?? Infinity);
  });
}

// Tarihli snapshot ekini at: claude-haiku-4-5-20251001 -> claude-haiku-4-5,
// gpt-4o-2024-08-06 -> gpt-4o
function baseId(id) {
  return String(id)
    .replace(/-\d{4}-\d{2}-\d{2}$/, "")
    .replace(/-\d{8}$/, "")
    .replace(/-\d{4}$/, ""); // gpt-4-0613 gibi eski ekler
}

// Canli /v1/models ID'lerini katalog fiyatlariyla birlestir.
// - Canli liste varsa SADECE aktif modeller gosterilir.
// - Takma adi (tarihsiz hali) listede olan tarihli snapshot'lar gizlenir;
//   takma adi olmayanlarin sadece en yenisi tutulur.
// - Fiyat once birebir, sonra taban ada (baseId) gore eslestirilir.
// - Canli liste yoksa gomulu katalog yedek olarak kullanilir.
// Tutarli ve sade liste: SADECE katalogda olan (fiyati bilinen) ve canlida
// aktif modeller. Tarihli snapshot'lar ve katalog disi/gurultulu modeller
// gosterilmez; listede olmayan bir model gerekiyorsa UI'dan "elle gir" kullanilir.
function mergeWithCatalog(catalog, liveIds) {
  catalog = catalog || [];
  if (!liveIds || !liveIds.length) return sortByPrice(catalog);
  const live = new Set(liveIds);
  const liveBases = new Set([...live].map(baseId));
  const result = catalog.filter((m) => live.has(m.id) || liveBases.has(m.id));
  return sortByPrice(result);
}

// Sohbet disi modelleri (embedding/tts/whisper...) ele
function isChatModel(id) {
  const x = String(id).toLowerCase();
  const bad = [
    "embedding", "tts", "whisper", "dall", "image", "audio", "realtime",
    "moderation", "transcribe", "search", "babbage", "davinci", "ada",
    "curie", "instruct", "aqa", "veo", "imagen", "sora", "deep-research",
    "computer-use",
  ];
  return !bad.some((b) => x.includes(b));
}

// Katalogu fiyata gore sirali ver
function catalogFor(providerId) {
  return sortByPrice(CATALOGS[providerId] || []);
}

module.exports = {
  PROVIDER_PRESETS,
  CUSTOM_PROVIDER_TEMPLATE,
  CATALOGS,
  sortByPrice,
  mergeWithCatalog,
  isChatModel,
  catalogFor,
};
