// renderer.js
const $ = (id) => document.getElementById(id);

// Sonuc / composer
const promptInput = $("promptInput");
const sendBtn = $("sendBtn");
const roundsSelect = $("roundsSelect");
const roundsWrap = $("roundsWrap");
const modeNote = $("modeNote");
const statusLine = $("statusLine");
const emptyState = $("emptyState");
const finalCard = $("finalCard");
const finalText = $("finalText");
const processPanel = $("processPanel");
const processLog = $("processLog");
const copyBtn = $("copyBtn");
const splitGrid = $("splitGrid");
const activeModels = $("activeModels");
const activeModelsWrap = $("activeModelsWrap");
const warnBanner = $("warnBanner");
const usageBar = $("usageBar");
const promptView = $("promptView");
const promptViewWrap = $("promptViewWrap");
const convLog = $("convLog");
const resultArea = $("resultArea");
const cancelBtn = $("cancelBtn");
const findBar = $("findBar");
const findInput = $("findInput");
const findCount = $("findCount");
const findPrev = $("findPrev");
const findNext = $("findNext");
const findClose = $("findClose");
const histList = $("histList");
const histSearch = $("histSearch");
const newChatBtn = $("newChatBtn");
const pCount = $("pCount");
const costHint = $("costHint");
const participantsBtn = $("participantsBtn");

// Katilimcilar modal
const participantsModal = $("participantsModal");
const participantList = $("participantList");
const addParticipant = $("addParticipant");
const judgeProvider = $("judgeProvider");
const judgeModelWrap = $("judgeModelWrap");
const saveParticipants = $("saveParticipants");
const closeParticipants = $("closeParticipants");

// Saglayicilar modal
const settingsBtn = $("settingsBtn");
const settingsModal = $("settingsModal");
const providerList = $("providerList");
const cpName = $("cpName");
const cpUrl = $("cpUrl");
const cpKey = $("cpKey");
const cpAdd = $("cpAdd");
const refreshModelsBtn = $("refreshModelsBtn");
const refreshStatus = $("refreshStatus");
const saveSettings = $("saveSettings");
const cancelSettings = $("cancelSettings");

const langSelect = $("langSelect");
const themeSelect = $("themeSelect");
const judgeLine = $("judgeLine");

// --- Durum ---
let config = null;            // {providers, participants, judge, rounds, lang?}
let modelsByProvider = {};    // {providerId: [{id,label,in,out}]}
let presets = [];
let mode = "orchestra";
let running = false;
let lang = "en";
let activeHistId = null;      // sol panelde secili gecmis kaydi
let modelsFetchedAt = null;   // canli model listesinin son guncellenme zamani

// --- i18n ---
const t = (key, params) => I18N.t(lang, key, params);

// --- Tema (system | dark | light) ---
const mql = window.matchMedia("(prefers-color-scheme: light)");
function applyTheme() {
  const pref = (config && config.theme) || "system";
  const effective = pref === "system" ? (mql.matches ? "light" : "dark") : pref;
  document.documentElement.setAttribute("data-theme", effective);
  if (themeSelect) themeSelect.value = pref;
}
mql.addEventListener("change", () => {
  if (!config || (config.theme || "system") === "system") applyTheme();
});

function applyI18n() {
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPh);
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
  if (langSelect) langSelect.value = lang;
}

// --- Yardimcilar ---
const providerById = (id) => (config.providers || []).find((p) => p.id === id);
const modelsFor = (id) => modelsByProvider[id] || [];

function priceLabel(m) {
  if (m.in == null || m.out == null) return `${m.label} · ${t("priceUnknown")}`;
  return `${m.label} · $${m.in}/$${m.out}`;
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

const fmtNum = (n) => Number(n || 0).toLocaleString(lang === "tr" ? "tr-TR" : "en-US");

// Arama eslesmesini <mark> ile vurgula (HTML-guvenli)
function highlight(text, q) {
  const esc = escapeHtml(text);
  if (!q) return esc;
  const eq = escapeHtml(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    return esc.replace(new RegExp(eq, "gi"), (m) => `<mark>${m}</mark>`);
  } catch {
    return esc;
  }
}

// Saglayici resmi logolari (yerel, ucevrimdisi)
const LOGO = {
  openai: "vendor/logos/openai.svg",
  anthropic: "vendor/logos/anthropic.svg",
  gemini: "vendor/logos/gemini.svg",
};
function makeLogo(providerId, name) {
  const path = LOGO[providerId];
  if (path) {
    const chip = document.createElement("span");
    chip.className = "logo-chip";
    const img = document.createElement("img");
    img.src = path;
    img.alt = "";
    img.className = "logo-img";
    chip.appendChild(img);
    return chip;
  }
  // ozel saglayici: ilk harf rozeti
  const fb = document.createElement("span");
  fb.className = "logo-chip fallback";
  fb.textContent = (name || "?").trim().charAt(0).toUpperCase();
  return fb;
}

// Markdown -> guvenli HTML + kod bloklarinda syntax highlight (tum diller)
function renderMarkdown(el, text) {
  try {
    const html = window.marked.parse(text || "", { gfm: true, breaks: true });
    el.innerHTML = window.DOMPurify.sanitize(html);
    el.querySelectorAll("pre code").forEach((block) => {
      const cls = [...block.classList].find((c) => c.startsWith("language-"));
      const name = cls ? cls.slice(9) : null;
      if (name && window.hljs.getLanguage(name)) {
        window.hljs.highlightElement(block); // bilinen dil: tam dogruluk
      } else {
        const r = window.hljs.highlightAuto(block.textContent); // bilinmeyen/etiketsiz: otomatik algila
        block.innerHTML = r.value;
        block.classList.add("hljs");
      }
    });
  } catch {
    el.textContent = text || "";
  }
}

// model listesi <select> doldur; "Onerilen (fiyatli)" / "Diger" gruplu.
// Secili yoksa fiyati bilinen en ucuz secilir.
function fillModelSelect(sel, providerId, selectedId) {
  const list = modelsFor(providerId);
  sel.innerHTML = "";
  if (!list.length) {
    const o = document.createElement("option");
    o.value = selectedId || "";
    o.textContent = selectedId || t("needRefresh");
    sel.appendChild(o);
    return;
  }
  let merged = list;
  if (selectedId && !list.some((m) => m.id === selectedId)) {
    merged = [...list, { id: selectedId, label: selectedId, in: null, out: null }];
  }
  const priced = merged.filter((m) => m.in != null);
  const other = merged.filter((m) => m.in == null);
  const cheapestId = priced[0]?.id; // sortByPrice'tan zaten sirali

  const addOpt = (parent, m) => {
    const o = document.createElement("option");
    o.value = m.id;
    o.textContent = priceLabel(m) + (m.id === cheapestId ? `  (${t("cheapest")})` : "");
    parent.appendChild(o);
  };

  if (priced.length && other.length) {
    const g1 = document.createElement("optgroup");
    g1.label = t("group.known");
    priced.forEach((m) => addOpt(g1, m));
    sel.appendChild(g1);
    const g2 = document.createElement("optgroup");
    g2.label = t("group.other");
    other.forEach((m) => addOpt(g2, m));
    sel.appendChild(g2);
  } else {
    merged.forEach((m) => addOpt(sel, m));
  }

  sel.value = selectedId && merged.some((m) => m.id === selectedId)
    ? selectedId
    : (priced[0] || merged[0]).id;
}

// Hakem (sentez) etiketini doldur: ikon + marka + model
function renderJudge(el, judge) {
  el.innerHTML = "";
  if (!judge || !judge.name) { el.style.display = "none"; return; }
  el.style.display = "";
  el.append(document.createTextNode(t("mergedBy") + ": "));
  el.append(makeLogo(judge.providerId, judge.name));
  const b = document.createElement("b");
  b.textContent = judge.name;
  el.append(b);
}

// Token ozeti: toplam + AI bazli kirilim
function renderUsage(el, usage) {
  if (!usage || (!usage.input && !usage.output)) { el.classList.add("hidden"); return; }
  el.innerHTML = "";
  const tot = document.createElement("span");
  tot.className = "usage-total";
  tot.textContent = t("usage.total", {
    total: fmtNum(usage.input + usage.output),
    in: fmtNum(usage.input),
    out: fmtNum(usage.output),
  });
  el.append(tot);
  const bm = usage.byModel || {};
  for (const [name, u] of Object.entries(bm)) {
    const s = document.createElement("span");
    s.className = "usage-by";
    s.textContent = ` · ${name}: ${fmtNum((u.input || 0) + (u.output || 0))}`;
    el.append(s);
  }
  el.classList.remove("hidden");
}

// Model secici + "elle gir" kacis yolu. onPick(id) her secimde cagrilir.
function modelControl(providerId, currentId, onPick) {
  const wrap = document.createElement("span");
  wrap.className = "model-control";
  const sel = document.createElement("select");
  const inp = document.createElement("input");
  inp.type = "text";
  inp.className = "model-manual";
  inp.placeholder = t("manualPh");
  inp.style.display = "none";

  function build(curr) {
    fillModelSelect(sel, providerId, curr);
    const opt = document.createElement("option");
    opt.value = "__manual__";
    opt.textContent = t("manualOpt");
    sel.appendChild(opt);
  }
  build(currentId);

  sel.addEventListener("change", () => {
    if (sel.value === "__manual__") {
      inp.value = "";
      inp.style.display = "";
      sel.style.display = "none";
      inp.focus();
    } else {
      onPick(sel.value);
    }
  });
  const commit = () => {
    const v = inp.value.trim();
    inp.style.display = "none";
    sel.style.display = "";
    if (v) {
      build(v);
      sel.value = v;
      onPick(v);
    } else {
      sel.value = currentId;
    }
  };
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") { inp.value = ""; commit(); }
  });
  inp.addEventListener("blur", commit);

  wrap.append(sel, inp);
  return wrap;
}

function providerOptions(sel, selectedId) {
  sel.innerHTML = "";
  config.providers.forEach((p) => {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.name + (p.apiKey || p.kind === "openai" ? "" : ` ${t("noKey")}`);
    sel.appendChild(o);
  });
  if (selectedId) sel.value = selectedId;
}

// --- Maliyet / sayac ipucu ---
function enabledParticipants() {
  return (config.participants || []).filter((p) => p.enabled);
}
function updateBar() {
  const n = enabledParticipants().length;
  pCount.textContent = n;
  const r = Number(roundsSelect.value);
  const calls = mode === "split" ? n : n + n * r + 1;
  costHint.textContent = n ? t("calls", { n: calls }) : t("noParticipant");
}

// API anahtari girilmis (kullanima hazir) modelleri bos ekranda goster
const isLocalUrl = (url) => /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(url || "");
function renderActiveModels() {
  if (!activeModels) return;
  const usable = (config.participants || []).filter((p) => {
    if (!p.enabled) return false;
    const prov = providerById(p.providerId);
    return prov && (prov.apiKey || isLocalUrl(prov.baseUrl));
  });
  activeModels.innerHTML = "";
  if (!usable.length) {
    activeModelsWrap.classList.add("hidden");
    return;
  }
  usable.forEach((p) => {
    const prov = providerById(p.providerId);
    const chip = document.createElement("div");
    chip.className = "active-chip";
    chip.append(makeLogo(p.providerId, prov?.name));

    const nm = document.createElement("span");
    nm.textContent = prov?.name || "";
    chip.append(nm);

    // model secimi (elle giris dahil) dogrudan bu cipten
    const ctl = modelControl(p.providerId, p.model, async (id) => {
      p.model = id;
      await window.api.saveConfig(config);
    });
    ctl.classList.add("chip-ctl");
    chip.append(ctl);

    activeModels.appendChild(chip);
  });
  activeModelsWrap.classList.remove("hidden");
}

// =====================================================================
//  Katilimcilar modal
// =====================================================================

function renderParticipants() {
  participantList.innerHTML = "";
  (config.participants || []).forEach((part, idx) => {
    const row = document.createElement("div");
    row.className = "p-row";

    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.checked = !!part.enabled;
    chk.title = t("toggleTitle");
    chk.addEventListener("change", () => { part.enabled = chk.checked; updateBar(); });

    const provSel = document.createElement("select");
    provSel.className = "prov-sel";
    providerOptions(provSel, part.providerId);

    let modelCtl = modelControl(part.providerId, part.model, (id) => { part.model = id; });

    let logo = makeLogo(part.providerId, providerById(part.providerId)?.name);

    provSel.addEventListener("change", () => {
      part.providerId = provSel.value;
      part.model = (modelsFor(provSel.value)[0] || {}).id || "";
      const freshCtl = modelControl(part.providerId, part.model, (id) => { part.model = id; });
      modelCtl.replaceWith(freshCtl);
      modelCtl = freshCtl;
      const fresh = makeLogo(part.providerId, providerById(part.providerId)?.name);
      logo.replaceWith(fresh);
      logo = fresh;
    });

    const rm = document.createElement("button");
    rm.className = "remove-x";
    rm.textContent = "×";
    rm.title = t("removeTitle");
    rm.addEventListener("click", () => {
      config.participants.splice(idx, 1);
      renderParticipants();
      updateBar();
    });

    row.append(chk, logo, provSel, modelCtl, rm);
    participantList.appendChild(row);
  });

  // hakem
  providerOptions(judgeProvider, config.judge?.providerId);
  rebuildJudgeModel();
}

function rebuildJudgeModel() {
  judgeModelWrap.innerHTML = "";
  const ctl = modelControl(config.judge?.providerId, config.judge?.model, (id) => {
    config.judge = config.judge || {};
    config.judge.model = id;
  });
  judgeModelWrap.appendChild(ctl);
}

addParticipant.addEventListener("click", () => {
  const first = config.providers[0];
  config.participants.push({
    providerId: first.id,
    model: (modelsFor(first.id)[0] || {}).id || "",
    enabled: true,
  });
  renderParticipants();
  updateBar();
});

judgeProvider.addEventListener("change", () => {
  config.judge.providerId = judgeProvider.value;
  config.judge.model = (modelsFor(judgeProvider.value)[0] || {}).id || "";
  rebuildJudgeModel();
});

participantsBtn.addEventListener("click", () => {
  renderParticipants();
  participantsModal.classList.remove("hidden");
});
closeParticipants.addEventListener("click", () => participantsModal.classList.add("hidden"));
saveParticipants.addEventListener("click", async () => {
  config.judge = { providerId: judgeProvider.value, model: (config.judge && config.judge.model) || "" };
  await window.api.saveConfig(config);
  participantsModal.classList.add("hidden");
  updateBar();
  renderActiveModels();
});

// =====================================================================
//  Saglayicilar modal
// =====================================================================

function renderProviders() {
  providerList.innerHTML = "";
  config.providers.forEach((p, idx) => {
    const row = document.createElement("div");
    row.className = "prov-row";

    const logo = makeLogo(p.id, p.name);

    const name = document.createElement("div");
    name.className = "prov-name";
    name.innerHTML = `${escapeHtml(p.name)} <span class="prov-tag">${p.builtin ? t("tag.preset") : t("tag.custom")}</span>`;

    const key = document.createElement("input");
    key.type = "password";
    key.placeholder = p.kind === "openai" && !p.builtin ? t("apiKeyOllama") : t("apiKey");
    key.value = p.apiKey || "";
    key.addEventListener("input", () => { p.apiKey = key.value.trim(); });

    row.append(logo, name, key);

    if (!p.builtin) {
      const rm = document.createElement("button");
      rm.className = "remove-x";
      rm.textContent = "×";
      rm.title = t("removeProvider");
      rm.addEventListener("click", () => {
        config.providers.splice(idx, 1);
        // bu saglayiciyi kullanan katilimcilari da temizle
        config.participants = config.participants.filter((x) => x.providerId !== p.id);
        renderProviders();
      });
      row.append(rm);
    }
    providerList.appendChild(row);
  });
}

cpAdd.addEventListener("click", () => {
  const name = cpName.value.trim();
  const url = cpUrl.value.trim().replace(/\/+$/, "");
  if (!name || !url) { refreshStatus.textContent = t("needNameUrl"); return; }
  const id = "custom-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + config.providers.length;
  config.providers.push({
    id, name, kind: "openai", baseUrl: url,
    tokenParam: "max_tokens", builtin: false, apiKey: cpKey.value.trim(),
  });
  modelsByProvider[id] = [];
  cpName.value = cpUrl.value = cpKey.value = "";
  renderProviders();
  updateModeAvailability();
  refreshStatus.textContent = t("providerAdded", { name });
});

function lastUpdatedText() {
  if (!modelsFetchedAt) return "";
  const loc = lang === "tr" ? "tr-TR" : "en-US";
  const when = new Date(modelsFetchedAt).toLocaleString(loc, {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
  return t("lastUpdated", { when });
}

refreshModelsBtn.addEventListener("click", async () => {
  refreshStatus.textContent = t("refreshing");
  await window.api.saveConfig(config); // anahtarlar kayitli olsun ki main cekebilsin
  try {
    const res = await window.api.refreshModels();
    Object.assign(modelsByProvider, res.byProviderId);
    if (res.fetchedAt) modelsFetchedAt = res.fetchedAt;
    const counts = Object.entries(res.byProviderId)
      .map(([k, v]) => `${providerById(k)?.name || k}: ${v.length}`)
      .join(" · ");
    const parts = [];
    if (counts) parts.push(t("updated") + counts);
    if (res.errors?.length) parts.push(t("someFailed") + res.errors.join(" · "));
    refreshStatus.textContent = parts.join("  —  ");
  } catch (e) {
    refreshStatus.textContent = t("errorPrefix") + e.message;
  }
});

// --- Hakkinda (About) ---
const aboutBtn = $("aboutBtn");
const aboutModal = $("aboutModal");
const closeAbout = $("closeAbout");
const aboutVersion = $("aboutVersion");
const checkUpdateBtn = $("checkUpdateBtn");
const updateStatus = $("updateStatus");

async function openAbout() {
  try {
    const v = await window.api.appVersion();
    aboutVersion.textContent = "v" + v;
  } catch { aboutVersion.textContent = ""; }
  updateStatus.textContent = "";
  aboutModal.classList.remove("hidden");
}
aboutBtn.addEventListener("click", openAbout);

async function runUpdateCheck() {
  updateStatus.textContent = t("checking");
  const res = await window.api.checkUpdates();
  updateStatus.innerHTML = "";
  if (!res.ok) {
    updateStatus.textContent = t("checkFail") + (res.error ? ` (${res.error})` : "");
    return;
  }
  if (res.hasUpdate) {
    updateStatus.appendChild(document.createTextNode(t("updateAvail", { v: res.latest }) + " — "));
    const dl = document.createElement("span");
    dl.className = "dl";
    dl.textContent = t("download");
    dl.addEventListener("click", () => window.api.openExternal(res.url));
    updateStatus.appendChild(dl);
  } else {
    updateStatus.textContent = t("upToDate");
  }
}
checkUpdateBtn.addEventListener("click", runUpdateCheck);
aboutModal.addEventListener("click", (e) => { if (e.target === aboutModal) aboutModal.classList.add("hidden"); });

// --- Konusmayi Markdown disa aktar (#13) ---
function conversationToMarkdown(entry) {
  let s = `# ${entry.title}\n\n`;
  (entry.turns || []).forEach((tn) => {
    s += `## ${t("question")}\n\n${tn.prompt}\n\n`;
    const r = tn.result || {};
    if (tn.effectiveMode !== "split" && r.finalAnswer != null) {
      s += `### ${t("final.badge")}\n\n${r.finalAnswer}\n\n`;
      if (r.judge) s += `_${t("mergedBy")}: ${r.judge.name}_\n\n`;
    } else {
      (r.answers || []).forEach((a) => { s += `### ${a.name}\n\n${a.text}\n\n`; });
    }
    s += `---\n\n`;
  });
  return s;
}
async function exportConversation() {
  if (!activeHistId) { setStatus(t("openParticipantFirst")); return; }
  const entry = await window.api.historyGet(activeHistId);
  if (!entry) return;
  const md = conversationToMarkdown(entry);
  const name = (entry.title || "conversation").replace(/[^\w-]+/g, "_").slice(0, 40) + ".md";
  await window.api.exportMarkdown(md, name);
}

// --- Chat ici arama / Cmd+F (#12) ---
let findHits = [], findIdx = -1;
function clearFind() {
  resultArea.querySelectorAll(".find-hit").forEach((el) => {
    const p = el.parentNode;
    p.replaceChild(document.createTextNode(el.textContent), el);
    p.normalize();
  });
  findHits = []; findIdx = -1; findCount.textContent = "";
}
function doFind() {
  clearFind();
  const q = findInput.value;
  if (!q) return;
  const ql = q.toLowerCase();
  const walker = document.createTreeWalker(resultArea, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.nodeValue && n.nodeValue.toLowerCase().includes(ql)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT,
  });
  const targets = [];
  let node;
  while ((node = walker.nextNode())) targets.push(node);
  targets.forEach((n) => {
    const text = n.nodeValue, low = text.toLowerCase(), frag = document.createDocumentFragment();
    let i = 0, idx;
    while ((idx = low.indexOf(ql, i)) !== -1) {
      if (idx > i) frag.appendChild(document.createTextNode(text.slice(i, idx)));
      const span = document.createElement("span");
      span.className = "find-hit";
      span.textContent = text.slice(idx, idx + q.length);
      frag.appendChild(span); findHits.push(span);
      i = idx + q.length;
    }
    if (i < text.length) frag.appendChild(document.createTextNode(text.slice(i)));
    n.parentNode.replaceChild(frag, n);
  });
  if (findHits.length) { findIdx = 0; markCurrent(); }
  else findCount.textContent = "0/0";
}
function markCurrent() {
  findHits.forEach((h) => h.classList.remove("find-current"));
  const h = findHits[findIdx];
  if (h) { h.classList.add("find-current"); h.scrollIntoView({ block: "center", behavior: "smooth" }); }
  findCount.textContent = findHits.length ? `${findIdx + 1}/${findHits.length}` : "0/0";
}
function findStep(d) {
  if (!findHits.length) return;
  findIdx = (findIdx + d + findHits.length) % findHits.length;
  markCurrent();
}
function openFind() {
  findBar.classList.remove("hidden");
  findInput.focus(); findInput.select();
  if (findInput.value) doFind();
}
function closeFind() { findBar.classList.add("hidden"); clearFind(); }

let findTimer = null;
findInput.addEventListener("input", () => { clearTimeout(findTimer); findTimer = setTimeout(doFind, 150); });
findInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); findStep(e.shiftKey ? -1 : 1); }
  if (e.key === "Escape") closeFind();
});
findNext.addEventListener("click", () => findStep(1));
findPrev.addEventListener("click", () => findStep(-1));
findClose.addEventListener("click", closeFind);
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "f") { e.preventDefault(); openFind(); }
  else if (e.key === "Escape" && !findBar.classList.contains("hidden")) closeFind();
});

// --- Durdur (#14) ---
cancelBtn.addEventListener("click", () => window.api.cancelRun());

// --- Native menu olaylari (#9) ---
window.api.onMenu((action) => {
  if (action === "about") openAbout();
  else if (action === "check-updates") { openAbout(); runUpdateCheck(); }
  else if (action === "new-chat") newChatBtn.click();
  else if (action === "export") exportConversation();
  else if (action === "find") openFind();
});
closeAbout.addEventListener("click", () => aboutModal.classList.add("hidden"));
aboutModal.addEventListener("click", (e) => {
  if (e.target === aboutModal) aboutModal.classList.add("hidden");
});
document.querySelectorAll(".about-link").forEach((b) => {
  b.addEventListener("click", () => window.api.openExternal(b.dataset.url));
});

// Tema degisimi: secimi kalici yap
themeSelect.addEventListener("change", async () => {
  config.theme = themeSelect.value;
  await window.api.saveConfig(config);
  applyTheme();
});

// Dil degisimi: secimi kalici yap
langSelect.addEventListener("change", async () => {
  lang = I18N.normalize(langSelect.value);
  config.lang = lang;
  await window.api.saveConfig(config);
  applyI18n();
  updateBar();
  renderProviders();
  renderActiveModels();
  updateModeAvailability();
  loadHistoryList();
});

settingsBtn.addEventListener("click", () => {
  renderProviders();
  refreshStatus.textContent = lastUpdatedText();
  settingsModal.classList.remove("hidden");
});
cancelSettings.addEventListener("click", () => settingsModal.classList.add("hidden"));
saveSettings.addEventListener("click", async () => {
  await window.api.saveConfig(config);
  settingsModal.classList.add("hidden");
  renderActiveModels();
  updateModeAvailability();
  setStatus(t("settingsSaved"));
  setTimeout(() => setStatus(""), 1500);
});

// =====================================================================
//  Mod + composer
// =====================================================================

function setMode(m) {
  mode = m;
  document.querySelectorAll(".mode-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.mode === m)
  );
  roundsWrap.style.display = m === "orchestra" ? "" : "none";
  if (activeHistId) openHistory(activeHistId); // acik konusma korunur
  else resetResults();
  updateBar();
}

document.querySelectorAll(".mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.disabled) return;
    setMode(btn.dataset.mode);
  });
});
roundsSelect.addEventListener("change", updateBar);

// Tartisma icin >=2 farkli yapay zeka anahtari sart; degilse Orkestra'yi kilitle
function usableProviderCount() {
  return (config.providers || []).filter((p) => p.apiKey || isLocalUrl(p.baseUrl)).length;
}
function updateModeAvailability() {
  const ok = usableProviderCount() >= 2;
  const orch = document.querySelector('.mode-btn[data-mode="orchestra"]');
  orch.disabled = !ok;
  orch.classList.toggle("disabled", !ok);
  modeNote.classList.toggle("hidden", ok);
  if (!ok) {
    modeNote.textContent = t("orchestra.needTwo");
    if (mode === "orchestra") setMode("split");
  }
}

function resetResults() {
  convLog.innerHTML = "";
  finalCard.classList.add("hidden");
  processPanel.classList.add("hidden");
  splitGrid.classList.add("hidden");
  splitGrid.innerHTML = "";
  promptViewWrap.classList.add("hidden");
  warnBanner.classList.add("hidden");
  warnBanner.innerHTML = "";
  usageBar.classList.add("hidden");
  usageBar.textContent = "";
  emptyState.classList.remove("hidden");
  renderActiveModels();
}

// =====================================================================
//  Gecmis (history)
// =====================================================================

function fmtHistDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const loc = lang === "tr" ? "tr-TR" : "en-US";
  return sameDay
    ? d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(loc, { day: "numeric", month: "short" });
}

async function loadHistoryList() {
  const q = (histSearch.value || "").trim();
  const items = q
    ? await window.api.historySearch(q)
    : await window.api.historyList();
  histList.innerHTML = "";
  if (!items.length) {
    const e = document.createElement("div");
    e.className = "hist-empty";
    e.textContent = q ? t("noResults") : t("historyEmpty");
    histList.appendChild(e);
    return;
  }
  items.forEach((it) => {
    const row = document.createElement("div");
    row.className = "hist-item" + (it.id === activeHistId ? " active" : "");
    const nm = document.createElement("div");
    nm.className = "hist-name";
    nm.innerHTML = highlight(it.title, q); // arama eslesmesini vurgula (#11)
    nm.title = it.title;
    const dt = document.createElement("div");
    dt.className = "hist-date";
    dt.textContent = (it.mode === "split" ? t("mode.split") : t("mode.orchestra")) + " · " + fmtHistDate(it.ts);
    const del = document.createElement("button");
    del.className = "hist-del";
    del.textContent = "×";
    del.title = t("removeTitle");
    del.addEventListener("click", async (e) => {
      e.stopPropagation();
      await window.api.historyDelete(it.id);
      if (activeHistId === it.id) {
        activeHistId = null;
        resetResults();
      }
      loadHistoryList();
    });
    row.append(nm, dt, del);
    row.addEventListener("click", () => openHistory(it.id));
    histList.appendChild(row);
  });
}

async function openHistory(id) {
  if (running) return;
  const entry = await window.api.historyGet(id);
  if (!entry) return;
  activeHistId = id;
  renderEntry(entry);
  loadHistoryList();
}

// Canli (tek sorgu) alanlarini temizle/gizle
function hideLive() {
  warnBanner.classList.add("hidden");
  warnBanner.innerHTML = "";
  usageBar.classList.add("hidden");
  usageBar.textContent = "";
  promptViewWrap.classList.add("hidden");
  processLog.innerHTML = "";
  processPanel.classList.add("hidden");
  finalCard.classList.add("hidden");
  splitGrid.classList.add("hidden");
  splitGrid.innerHTML = "";
}

// Tek bir konusma turunu DOM blogu olarak uret
function turnBlock(turn) {
  const wrap = document.createElement("div");
  wrap.className = "turn";

  // soru
  const pv = document.createElement("div");
  pv.className = "prompt-view";
  const lbl = document.createElement("div");
  lbl.className = "pv-label";
  lbl.textContent = t("question");
  const pvt = document.createElement("div");
  pvt.className = "pv-text";
  pvt.textContent = turn.prompt;
  pv.append(lbl, pvt);
  wrap.appendChild(pv);

  const r = turn.result || {};
  if (turn.effectiveMode !== "split" && r.finalAnswer != null) {
    if ((r.roundsLog || []).length) {
      const det = document.createElement("details");
      det.className = "process-panel";
      const sum = document.createElement("summary");
      sum.textContent = t("process.summary");
      det.appendChild(sum);
      const logDiv = document.createElement("div");
      logDiv.className = "process-log";
      r.roundsLog.forEach((rd) => addRoundBlock(rd, logDiv));
      det.appendChild(logDiv);
      wrap.appendChild(det);
    }
    const card = document.createElement("div");
    card.className = "final-card";
    const head = document.createElement("div");
    head.className = "final-head";
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = t("final.badge");
    const cp = document.createElement("button");
    cp.className = "text-btn";
    cp.textContent = t("copy");
    cp.addEventListener("click", async () => {
      await navigator.clipboard.writeText(r.finalAnswer);
      cp.textContent = t("copied");
      setTimeout(() => (cp.textContent = t("copy")), 1500);
    });
    head.append(badge, cp);
    const body = document.createElement("div");
    body.className = "final-text";
    renderMarkdown(body, r.finalAnswer);
    card.append(head, body);
    if (r.judge) {
      const jl = document.createElement("div");
      jl.className = "judge-line";
      renderJudge(jl, r.judge);
      card.append(jl);
    }
    wrap.appendChild(card);
  } else {
    const grid = document.createElement("div");
    grid.className = "dyn-grid";
    buildColumns(grid, r.answers || []);
    wrap.appendChild(grid);
  }

  if (r.usage && (r.usage.input || r.usage.output)) {
    const ub = document.createElement("div");
    ub.className = "usage-bar";
    renderUsage(ub, r.usage);
    wrap.appendChild(ub);
  }
  return wrap;
}

function renderEntry(entry) {
  emptyState.classList.add("hidden");
  hideLive();
  setStatus("");
  convLog.innerHTML = "";
  (entry.turns || []).forEach((tn) => convLog.appendChild(turnBlock(tn)));
}

newChatBtn.addEventListener("click", () => {
  if (running) return;
  activeHistId = null;
  histSearch.value = "";
  resetResults();
  loadHistoryList();
  promptInput.focus();
});

// Arama: yazarken filtrele (debounce)
let histSearchTimer = null;
histSearch.addEventListener("input", () => {
  clearTimeout(histSearchTimer);
  histSearchTimer = setTimeout(loadHistoryList, 200);
});

promptInput.addEventListener("input", () => {
  promptInput.style.height = "auto";
  promptInput.style.height = Math.min(promptInput.scrollHeight, 180) + "px";
});
promptInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); run(); }
});
sendBtn.addEventListener("click", run);

function setStatus(msg, isError = false) {
  statusLine.textContent = msg || "";
  statusLine.classList.toggle("error", isError);
}

// --- Dinamik kolonlar ---
function buildColumns(container, answers) {
  container.innerHTML = "";
  answers.forEach((a) => {
    const col = document.createElement("div");
    col.className = "dyn-col" + (a.ok === false ? " err" : "");
    const head = document.createElement("div");
    head.className = "split-head";
    const left = document.createElement("div");
    left.className = "head-left";
    const nm = document.createElement("span");
    nm.className = "model-name";
    nm.textContent = a.name;
    left.append(makeLogo(a.providerId, a.name), nm);
    const cp = document.createElement("button");
    cp.className = "text-btn";
    cp.textContent = t("copy");
    cp.addEventListener("click", async () => {
      await navigator.clipboard.writeText(a.text);
      cp.textContent = t("copied");
      setTimeout(() => (cp.textContent = t("copy")), 1500);
    });
    head.append(left, cp);
    col.append(head);

    if (a.usage && (a.usage.input || a.usage.output)) {
      const tok = document.createElement("div");
      tok.className = "tok-chip";
      tok.textContent = t("usage.col", {
        in: fmtNum(a.usage.input),
        out: fmtNum(a.usage.output),
      });
      col.append(tok);
    }

    const body = document.createElement("div");
    body.className = "final-text";
    renderMarkdown(body, a.text);
    col.append(body);
    container.appendChild(col);
  });
}

function addRoundBlock({ label, answers }, container = processLog) {
  const block = document.createElement("div");
  block.className = "round-block";
  const title = document.createElement("div");
  title.className = "round-title";
  title.textContent = label;
  const grid = document.createElement("div");
  grid.className = "dyn-grid";
  buildColumns(grid, answers);
  block.append(title, grid);
  container.appendChild(block);
}

async function run() {
  if (running) return;
  const prompt = promptInput.value.trim();
  if (!prompt) return;
  const parts = enabledParticipants();
  if (!parts.length) { setStatus(t("openParticipantFirst"), true); return; }

  const continuing = !!activeHistId; // gecmis bir konusma acikken yazildi -> devam
  running = true;
  sendBtn.disabled = true;
  sendBtn.classList.add("hidden");
  cancelBtn.classList.remove("hidden");
  promptInput.value = "";          // gonderince kutuyu temizle
  promptInput.style.height = "auto";
  if (!continuing) convLog.innerHTML = ""; // yeni konusma: eski akisi temizle
  promptView.textContent = prompt; // soruyu sonuc alaninda goster
  promptViewWrap.classList.remove("hidden");
  emptyState.classList.add("hidden");
  finalCard.classList.add("hidden");
  splitGrid.classList.add("hidden");
  splitGrid.innerHTML = "";
  warnBanner.classList.add("hidden");
  warnBanner.innerHTML = "";
  usageBar.classList.add("hidden");
  usageBar.textContent = "";
  processLog.innerHTML = "";
  finalText.textContent = "";
  if (judgeLine) { judgeLine.innerHTML = ""; }
  if (mode === "orchestra") processPanel.classList.remove("hidden");
  else processPanel.classList.add("hidden");
  setStatus(t("starting"));

  try {
    const res = await window.api.run({
      mode,
      prompt,
      lang,
      conversationId: continuing ? activeHistId : null,
      rounds: Number(roundsSelect.value),
      participants: parts.map((p) => ({ providerId: p.providerId, model: p.model })),
      judge: config.judge,
    });
    if (!res.ok) setStatus(res.error || t("unknownError"), true);
  } catch (err) {
    setStatus(err.message || String(err), true);
  } finally {
    running = false;
    sendBtn.disabled = false;
    sendBtn.classList.remove("hidden");
    cancelBtn.classList.add("hidden");
  }
}

window.api.onEvent((evt) => {
  switch (evt.type) {
    case "status": setStatus(evt.message); break;
    case "warning": {
      const line = document.createElement("div");
      line.textContent = evt.message;
      warnBanner.appendChild(line);
      warnBanner.classList.remove("hidden");
      break;
    }
    case "round": addRoundBlock(evt); break;
    case "final":
      renderMarkdown(finalText, evt.answer);
      renderJudge(judgeLine, evt.judge);
      finalCard.classList.remove("hidden");
      setStatus(t("status.done"));
      break;
    case "split":
      // tek-model fallback'inde de dogru gorunsun
      processPanel.classList.add("hidden");
      finalCard.classList.add("hidden");
      buildColumns(splitGrid, evt.answers);
      splitGrid.classList.remove("hidden");
      break;
    case "history":
      activeHistId = evt.entry?.id || null;
      loadHistoryList();
      break;
    case "models": // gunluk otomatik guncelleme
      Object.assign(modelsByProvider, evt.byProviderId || {});
      if (evt.fetchedAt) modelsFetchedAt = evt.fetchedAt;
      if (!participantsModal.classList.contains("hidden")) renderParticipants();
      setStatus(t("modelsUpdated"));
      setTimeout(() => setStatus(""), 2000);
      break;
    case "usage":
      renderUsage(usageBar, { input: evt.input, output: evt.output, byModel: evt.byModel });
      break;
    case "cancelled": setStatus(t("cancelled")); break;
    case "error": setStatus(evt.message, true); break;
  }
});

copyBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(finalText.textContent);
  copyBtn.textContent = t("copied");
  setTimeout(() => (copyBtn.textContent = t("copy")), 1500);
});

// =====================================================================
//  Acilis
// =====================================================================
(async () => {
  config = await window.api.loadConfig();
  const osLang = await window.api.osLocale();
  // kullanici secimi varsa o; yoksa OS dili
  lang = I18N.normalize(config.lang || osLang);

  const cat = await window.api.modelCatalog();
  presets = cat.presets;
  modelsByProvider = { ...cat.catalogs };
  // katalogu olmayan (ozel) saglayicilar icin bos liste
  config.providers.forEach((p) => {
    if (!modelsByProvider[p.id]) modelsByProvider[p.id] = [];
  });
  // diske cache'lenmis canli model listesi varsa uygula
  try {
    const cache = await window.api.modelsCached();
    if (cache?.byProviderId) {
      Object.assign(modelsByProvider, cache.byProviderId);
      modelsFetchedAt = cache.fetchedAt || null;
    }
  } catch {}
  if (!config.judge) config.judge = { providerId: "anthropic", model: "" };

  applyTheme();
  applyI18n();
  updateBar();
  renderActiveModels();
  updateModeAvailability();
  loadHistoryList();

  // anahtar yoksa ayarlari ac
  const anyKey = config.providers.some((p) => p.apiKey);
  if (!anyKey) {
    renderProviders();
    settingsModal.classList.remove("hidden");
  }
})();
