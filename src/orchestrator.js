// orchestrator.js
// N adet yapay zeka katilimcisini orkestra eden cekirdek.
//
// Katilimci (participant): { name, provider, model }
//   provider: { kind: "anthropic"|"openai", baseUrl, apiKey, tokenParam }
//
// Akis:
//   1) Ilk tur  : tum katilimcilara paralel prompt
//   2) Tartisma : N tur; her katilimci DIGER hepsinin cevabini gorup kendini gelistirir
//   3) Sentez   : hakem (judge) tum cevaplari tek ortak yanitta birlestirir
//
// Bagimsiz (split) mod: sadece 1. tur, sentez/tartisma yok.

const { t } = require("./i18n");

// --- Adaptorler ----------------------------------------------------------

async function callAnthropic({ baseUrl, apiKey, model, system, user, maxTokens, signal }) {
  const res = await fetch(`${baseUrl}/messages`, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens || 2048,
      system: system || undefined,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`(${res.status}) ${await res.text()}`);
  const data = await res.json();
  const text = (data.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n")
    .trim();
  return {
    text,
    usage: {
      input: data.usage?.input_tokens || 0,
      output: data.usage?.output_tokens || 0,
    },
  };
}

async function callOpenAICompat({ baseUrl, apiKey, model, system, user, maxTokens, tokenParam, signal }) {
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: user });

  const body = { model, messages };
  body[tokenParam || "max_tokens"] = maxTokens || 2048;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`(${res.status}) ${await res.text()}`);
  const data = await res.json();
  return {
    text: (data.choices?.[0]?.message?.content || "").trim(),
    usage: {
      input: data.usage?.prompt_tokens || 0,
      output: data.usage?.completion_tokens || 0,
    },
  };
}

function callModel(provider, { model, system, user, maxTokens, signal }) {
  const common = {
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model,
    system,
    user,
    maxTokens,
    signal,
  };
  if (provider.kind === "anthropic") return callAnthropic(common);
  return callOpenAICompat({ ...common, tokenParam: provider.tokenParam });
}

const ZERO = { input: 0, output: 0 };

// Hatayi cevap metni olarak yakala (bir katilimci patlasa da digerleri devam etsin)
async function safeCall(participant, opts) {
  const pid = participant.providerId;
  try {
    const r = await callModel(participant.provider, opts);
    return { name: participant.name, providerId: pid, text: r.text, usage: r.usage || ZERO, ok: true };
  } catch (e) {
    return { name: participant.name, providerId: pid, text: `⚠️ ${e.message}`, usage: ZERO, ok: false };
  }
}

// Cevap dizisindeki token'lari hem toplama hem model-bazli ekle
function addUsage(acc, answers) {
  acc.byModel = acc.byModel || {};
  for (const a of answers) {
    const i = a.usage?.input || 0;
    const o = a.usage?.output || 0;
    acc.input += i;
    acc.output += o;
    const k = a.name;
    if (!acc.byModel[k]) acc.byModel[k] = { input: 0, output: 0, providerId: a.providerId };
    acc.byModel[k].input += i;
    acc.byModel[k].output += o;
  }
}
function addOne(acc, name, providerId, usage) {
  const i = usage?.input || 0;
  const o = usage?.output || 0;
  acc.input += i;
  acc.output += o;
  acc.byModel = acc.byModel || {};
  if (!acc.byModel[name]) acc.byModel[name] = { input: 0, output: 0, providerId };
  acc.byModel[name].input += i;
  acc.byModel[name].output += o;
}

// --- Prompt sablonlari ---------------------------------------------------

// Not: Modellere verilen yonergeler dil-bagimsiz olsun diye Ingilizce; cikti
// her zaman "kullanicinin sorusunun dilinde" istenir.

function critiquePrompt({ originalPrompt, ownAnswer, others }) {
  const block = others.map((o) => `## Answer from "${o.name}"\n${o.text}`).join("\n\n");
  return `Below is a user's question, your previous answer, and the answers other AI models gave to the same question.

# User's question
${originalPrompt}

# Your previous answer
${ownAnswer}

# Other models' answers
${block}

Your task:
1) Critically evaluate the other answers: where are they right, where are they incomplete or wrong?
2) Taking their good ideas into account, revise and improve YOUR OWN answer.
3) Output only your final, improved answer. No meta-commentary; write the final answer you would give the user.
4) Answer in the same language as the user's question.`;
}

function synthesisPrompt({ originalPrompt, answers }) {
  const block = answers.map((a) => `## Answer from "${a.name}"\n${a.text}`).join("\n\n");
  return `You are an impartial judge and editor. ${answers.length} different AI models answered the same user question. Your job is to weigh these answers and produce ONE coherent, most-accurate unified answer.

# User's question
${originalPrompt}

# Model answers
${block}

Your task:
- Combine the correct and valuable points from the answers.
- If there are contradictions, choose the most accurate/reliable one.
- Write a single clear answer; do not narrate "model X said...". Produce the final answer addressed directly to the user.
- Answer in the same language as the user's question.`;
}

// --- Orkestra modu -------------------------------------------------------
// config: { participants:[{name,provider,model}], judge:{provider,model}, rounds, prompt }

async function orchestrate(config, onEvent = () => {}) {
  const { participants, judge, rounds = 1, prompt, lang = "en", signal } = config;
  const log = (type, p = {}) => onEvent({ type, ...p });

  const acc = { input: 0, output: 0, byModel: {} };
  const roundsLog = []; // gecmis kaydi icin tum turlar

  // 1) Ilk tur
  log("status", { message: t(lang, "status.firstRound", { n: participants.length }) });
  let answers = await Promise.all(
    participants.map((p) => safeCall(p, { model: p.model, user: prompt, signal }))
  );
  addUsage(acc, answers);
  const label0 = t(lang, "round.initial");
  log("round", { round: 0, label: label0, answers });
  roundsLog.push({ label: label0, answers });

  // 2) Tartisma turlari
  const total = Math.max(0, Math.min(5, Number(rounds) || 0));
  for (let r = 1; r <= total; r++) {
    log("status", { message: t(lang, "status.debate", { r }) });
    const prev = answers;
    answers = await Promise.all(
      participants.map((p, i) => {
        const others = prev.filter((_, j) => j !== i);
        return safeCall(p, {
          model: p.model,
          signal,
          user: critiquePrompt({
            originalPrompt: prompt,
            ownAnswer: prev[i].text,
            others,
          }),
        });
      })
    );
    addUsage(acc, answers);
    const labelR = t(lang, "round.debate", { r });
    log("round", { round: r, label: labelR, answers });
    roundsLog.push({ label: labelR, answers });
  }

  // 3) Sentez
  log("status", { message: t(lang, "status.synthesis") });
  const judgeRes = await callModel(judge.provider, {
    model: judge.model,
    user: synthesisPrompt({ originalPrompt: prompt, answers }),
    maxTokens: 3000,
    signal,
  });
  addOne(acc, judge.name, judge.providerId, judgeRes.usage);

  const judgeInfo = { name: judge.name, providerId: judge.providerId, model: judge.model };
  log("usage", { input: acc.input, output: acc.output, total: acc.input + acc.output, byModel: acc.byModel });
  log("final", { answer: judgeRes.text, judge: judgeInfo });
  return { finalAnswer: judgeRes.text, answers, roundsLog, usage: acc, judge: judgeInfo };
}

// --- Bagimsiz (split) mod ------------------------------------------------

async function independent(config, onEvent = () => {}) {
  const { participants, prompt, lang = "en", signal } = config;
  const log = (type, p = {}) => onEvent({ type, ...p });

  log("status", { message: t(lang, "status.splitAsking", { n: participants.length }) });
  const answers = await Promise.all(
    participants.map((p) => safeCall(p, { model: p.model, user: prompt, signal }))
  );
  const acc = { input: 0, output: 0, byModel: {} };
  addUsage(acc, answers);
  log("split", { answers });
  log("usage", { input: acc.input, output: acc.output, total: acc.input + acc.output, byModel: acc.byModel });
  log("status", { message: t(lang, "status.done") });
  return { answers, usage: acc };
}

module.exports = { orchestrate, independent, callModel };
