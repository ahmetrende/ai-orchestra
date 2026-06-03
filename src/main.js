// main.js - Electron ana surec
const { app, BrowserWindow, ipcMain, safeStorage, shell, Menu, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { orchestrate, independent, callModel } = require("./orchestrator");
const catalog = require("./models");
const { t, normalize } = require("./i18n");

// --- Kalici veri dizini ------------------------------------------------------
// Uygulama silinse/yeniden kurulsa bile veriler korunsun diye ~/.ai-orchestra
// kullanilir (app cleaner'lar Application Support'u silebilir, burayi silmez).
const DATA_DIR = path.join(os.homedir(), ".ai-orchestra");
const CONFIG_PATH = () => path.join(DATA_DIR, "config.json");
const HISTORY_PATH = () => path.join(DATA_DIR, "history.json");

function ensureDataDir() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
}

// Eski konumdan (Application Support) tek seferlik goc
function migrateLegacyData() {
  ensureDataDir();
  for (const name of ["config.json", "history.json"]) {
    const oldPath = path.join(app.getPath("userData"), name);
    const newPath = path.join(DATA_DIR, name);
    try {
      if (!fs.existsSync(newPath) && fs.existsSync(oldPath)) {
        fs.copyFileSync(oldPath, newPath);
      }
    } catch {}
  }
}

// Lokal (Ollama vb.) saglayicilar anahtar istemez
const isLocalUrl = (url) => /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(url || "");

// --- Gecmis (history) ------------------------------------------------------
// Memory icin kompakt yanit ozeti
function memAnswer(result) {
  if (result && result.finalAnswer) return String(result.finalAnswer).slice(0, 2000);
  const txts = ((result && result.answers) || [])
    .map((a) => `${a.name}: ${a.text}`)
    .join("\n");
  return txts.slice(0, 2000);
}

// Eski tek-turlu kayitlari yeni cok-turlu (turns + memory) yapiya cevir
function normalizeEntry(e) {
  if (e.turns) return e;
  return {
    ...e,
    turns: [{ prompt: e.prompt, result: e.result, ts: e.ts, effectiveMode: e.effectiveMode }],
    memory: [{ q: e.prompt || "", a: memAnswer(e.result || {}) }],
  };
}

function loadHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_PATH(), "utf8")).map(normalizeEntry);
  } catch {
    return [];
  }
}
function saveHistory(h) {
  ensureDataDir();
  fs.writeFileSync(HISTORY_PATH(), JSON.stringify(h, null, 2), "utf8");
}

// --- Varsayilan config ---------------------------------------------------

function defaultConfig() {
  const providers = catalog.PROVIDER_PRESETS.map((p) => ({ ...p, apiKey: "" }));
  return {
    providers,
    participants: [
      { providerId: "anthropic", model: catalog.catalogFor("anthropic")[0].id, enabled: true },
      { providerId: "openai", model: catalog.catalogFor("openai")[0].id, enabled: true },
    ],
    judge: { providerId: "anthropic", model: catalog.catalogFor("anthropic")[0].id },
    rounds: 1,
  };
}

// --- Sifreleme yardimcilari (her provider.apiKey ayri sifrelenir) --------

const enc = (s) =>
  safeStorage.isEncryptionAvailable() && s
    ? safeStorage.encryptString(s).toString("base64")
    : null;
const dec = (b64) => {
  try {
    return safeStorage.isEncryptionAvailable() && b64
      ? safeStorage.decryptString(Buffer.from(b64, "base64"))
      : "";
  } catch {
    return "";
  }
};

// --- Eski (v1) configten goc --------------------------------------------

function migrate(data) {
  if (data.providers) return data; // zaten yeni format
  const cfg = defaultConfig();
  // v1 anahtarlarini tasip
  const aKey = data.anthropicKeyEnc ? dec(data.anthropicKeyEnc) : data.anthropicKey || "";
  const oKey = data.openaiKeyEnc ? dec(data.openaiKeyEnc) : data.openaiKey || "";
  cfg.providers = cfg.providers.map((p) => {
    if (p.id === "anthropic") return { ...p, apiKey: aKey };
    if (p.id === "openai") return { ...p, apiKey: oKey };
    return p;
  });
  if (data.claudeModel) cfg.participants[0].model = data.claudeModel;
  if (data.openaiModel) cfg.participants[1].model = data.openaiModel;
  if (data.judge === "openai") cfg.judge = { providerId: "openai", model: data.openaiModel || cfg.judge.model };
  if (typeof data.rounds === "number") cfg.rounds = data.rounds;
  return cfg;
}

function loadConfig() {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(CONFIG_PATH(), "utf8"));
  } catch {
    return defaultConfig();
  }
  data = migrate(data);
  // provider apiKey'leri coz
  data.providers = (data.providers || []).map((p) => ({
    ...p,
    apiKey: p.apiKeyEnc ? dec(p.apiKeyEnc) : p.apiKey || "",
    apiKeyEnc: undefined,
  }));
  // preset alanlarini (baseUrl/kind/tokenParam) guncel tut, builtin'leri garanti et
  const presetById = new Map(catalog.PROVIDER_PRESETS.map((p) => [p.id, p]));
  const existing = new Set(data.providers.map((p) => p.id));
  data.providers = data.providers.map((p) =>
    presetById.has(p.id) ? { ...presetById.get(p.id), apiKey: p.apiKey } : p
  );
  for (const preset of catalog.PROVIDER_PRESETS) {
    if (!existing.has(preset.id)) data.providers.push({ ...preset, apiKey: "" });
  }
  return data;
}

function saveConfig(cfg) {
  const out = { ...cfg };
  out.providers = (cfg.providers || []).map((p) => {
    const e = enc(p.apiKey);
    const copy = { ...p };
    if (e) {
      copy.apiKeyEnc = e;
      delete copy.apiKey;
    }
    return copy;
  });
  ensureDataDir();
  fs.writeFileSync(CONFIG_PATH(), JSON.stringify(out, null, 2), "utf8");
}

// --- Pencere -------------------------------------------------------------

const REPO = "ahmetrende/ai-orchestra";
let currentAbort = null; // calisan sorgunun iptali icin

// Native menubar (Help -> About / Check for Updates, Edit -> Find, File -> Export)
function buildMenu(win) {
  const isMac = process.platform === "darwin";
  const m = (ch) => () => win && win.webContents.send("menu", ch);
  const template = [
    ...(isMac
      ? [{
          label: "AI Orchestra",
          submenu: [
            { label: "About AI Orchestra", click: m("about") },
            { label: "Check for Updates…", click: m("check-updates") },
            { type: "separator" },
            { role: "hide" }, { role: "hideOthers" }, { role: "unhide" },
            { type: "separator" }, { role: "quit" },
          ],
        }]
      : []),
    {
      label: "File",
      submenu: [
        { label: "New Question", accelerator: "CmdOrCtrl+N", click: m("new-chat") },
        { label: "Export Conversation as Markdown…", accelerator: "CmdOrCtrl+E", click: m("export") },
        ...(isMac ? [] : [{ type: "separator" }, { role: "quit" }]),
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" }, { role: "redo" }, { type: "separator" },
        { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
        { type: "separator" },
        { label: "Find…", accelerator: "CmdOrCtrl+F", click: m("find") },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" }, { role: "toggleDevTools" }, { type: "separator" },
        { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
        { type: "separator" }, { role: "togglefullscreen" },
      ],
    },
    {
      label: "Help",
      submenu: [
        { label: "About AI Orchestra", click: m("about") },
        { label: "Check for Updates…", click: m("check-updates") },
        { type: "separator" },
        { label: "GitHub", click: () => shell.openExternal(`https://github.com/${REPO}`) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1040,
    height: 780,
    minWidth: 760,
    minHeight: 560,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#0f1117",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, "index.html"));
  return win;
}

app.whenReady().then(() => {
  migrateLegacyData();
  const win = createWindow();
  buildMenu(win);
  // gunde 1 otomatik model guncellemesi
  win.webContents.once("did-finish-load", () => {
    setTimeout(() => maybeAutoRefresh().catch(() => {}), 3000);
  });
  setInterval(() => maybeAutoRefresh().catch(() => {}), 6 * 60 * 60 * 1000);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// --- IPC -----------------------------------------------------------------

ipcMain.handle("config:load", () => loadConfig());
ipcMain.handle("config:save", (_e, cfg) => {
  saveConfig(cfg);
  return { ok: true };
});

// Isletim sistemi dili (kullanici secimi yoksa varsayilan)
ipcMain.handle("app:locale", () => normalize(app.getLocale()));

// Uygulama surumu
ipcMain.handle("app:version", () => app.getVersion());

// Dis baglantilari tarayicida ac (sadece http/https)
ipcMain.handle("shell:open", (_e, url) => {
  if (typeof url === "string" && /^https?:\/\//i.test(url)) shell.openExternal(url);
});

// Surum karsilastir (semver-ish): a>b -> 1
function cmpVer(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  }
  return 0;
}

// Guncelleme kontrolu: GitHub son release ile kiyasla
ipcMain.handle("updates:check", async () => {
  const current = app.getVersion();
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { "user-agent": "ai-orchestra", accept: "application/vnd.github+json" },
    });
    if (r.status === 404) return { ok: true, current, latest: null, note: "no-release", repoUrl: `https://github.com/${REPO}` };
    if (!r.ok) throw new Error(String(r.status));
    const d = await r.json();
    const latest = (d.tag_name || "").replace(/^v/i, "");
    return {
      ok: true,
      current,
      latest,
      url: d.html_url || `https://github.com/${REPO}/releases`,
      hasUpdate: latest ? cmpVer(latest, current) > 0 : false,
    };
  } catch (e) {
    return { ok: false, current, error: e.message };
  }
});

// Konusmayi Markdown olarak kaydet
ipcMain.handle("export:save", async (e, { text, name }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: name || "conversation.md",
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (canceled || !filePath) return { ok: false };
  try {
    fs.writeFileSync(filePath, text, "utf8");
    return { ok: true, filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// --- Gecmis IPC ---
ipcMain.handle("history:list", () =>
  loadHistory().map(({ id, title, ts, mode }) => ({ id, title, ts, mode }))
);
ipcMain.handle("history:get", (_e, id) => loadHistory().find((x) => x.id === id) || null);
// Baslik + soru + cevap iceriklerinde arama
ipcMain.handle("history:search", (_e, q) => {
  const needle = String(q || "").trim().toLowerCase();
  const all = loadHistory();
  const hits = !needle
    ? all
    : all.filter(
        (x) =>
          (x.title || "").toLowerCase().includes(needle) ||
          JSON.stringify(x.turns || []).toLowerCase().includes(needle)
      );
  return hits.map(({ id, title, ts, mode }) => ({ id, title, ts, mode }));
});
ipcMain.handle("history:delete", (_e, id) => {
  saveHistory(loadHistory().filter((x) => x.id !== id));
  return { ok: true };
});

// Gomulu model kataloglari + ozel saglayici sablonu
ipcMain.handle("models:catalog", () => ({
  catalogs: Object.fromEntries(
    Object.keys(catalog.CATALOGS).map((id) => [id, catalog.catalogFor(id)])
  ),
  presets: catalog.PROVIDER_PRESETS,
  customTemplate: catalog.CUSTOM_PROVIDER_TEMPLATE,
}));

// --- Model cache (gunluk otomatik guncelleme icin) ---
const MODELS_CACHE_PATH = () => path.join(DATA_DIR, "models-cache.json");
function loadModelsCache() {
  try {
    return JSON.parse(fs.readFileSync(MODELS_CACHE_PATH(), "utf8"));
  } catch {
    return null;
  }
}
function saveModelsCache(c) {
  ensureDataDir();
  fs.writeFileSync(MODELS_CACHE_PATH(), JSON.stringify(c, null, 2), "utf8");
}

// Her saglayici icin canli /models cek, katalog fiyatlariyla birlestir, cache'le
async function refreshAllModels() {
  const cfg = loadConfig();
  const byProviderId = {};
  const rawByProviderId = {}; // ham ID listesi cache'lenir (merge mantigi degisse de gecerli kalir)
  const errors = [];
  await Promise.all(
    cfg.providers.map(async (p) => {
      if (!p.apiKey && !isLocalUrl(p.baseUrl)) return; // anahtari olmayanlari atla (lokal haric)
      try {
        let ids = [];
        if (p.kind === "anthropic") {
          const r = await fetch(`${p.baseUrl}/models?limit=100`, {
            headers: { "x-api-key": p.apiKey, "anthropic-version": "2023-06-01" },
          });
          if (!r.ok) throw new Error(`${r.status}`);
          ids = ((await r.json()).data || []).map((m) => m.id);
        } else {
          const r = await fetch(`${p.baseUrl}/models`, {
            headers: p.apiKey ? { authorization: `Bearer ${p.apiKey}` } : {},
          });
          if (!r.ok) throw new Error(`${r.status}`);
          ids = ((await r.json()).data || []).map((m) => m.id).filter(catalog.isChatModel);
        }
        rawByProviderId[p.id] = ids;
        byProviderId[p.id] = catalog.mergeWithCatalog(catalog.CATALOGS[p.id] || [], ids);
      } catch (e) {
        errors.push(`${p.name}: ${e.message}`);
      }
    })
  );
  const fetchedAt = Date.now();
  if (Object.keys(rawByProviderId).length) {
    saveModelsCache({ fetchedAt, raw: rawByProviderId });
  }
  return { byProviderId, errors, fetchedAt };
}

ipcMain.handle("models:refresh", () => refreshAllModels());
// Cache okunurken ham ID'ler GUNCEL merge mantigiyla islenir
ipcMain.handle("models:cached", () => {
  const c = loadModelsCache();
  if (!c || !c.raw) return null; // eski format cache yok sayilir
  const byProviderId = {};
  for (const [pid, ids] of Object.entries(c.raw)) {
    byProviderId[pid] = catalog.mergeWithCatalog(catalog.CATALOGS[pid] || [], ids);
  }
  return { fetchedAt: c.fetchedAt, byProviderId };
});

// Gunluk otomatik guncelleme: acilista yas kontrolu + acik kaldikca 6 saatte bir kontrol
const DAY_MS = 24 * 60 * 60 * 1000;
async function maybeAutoRefresh() {
  const logPath = path.join(DATA_DIR, "last-refresh.log");
  try {
    const cache = loadModelsCache();
    if (cache && cache.raw && Date.now() - (cache.fetchedAt || 0) < DAY_MS) return;
    const r = await refreshAllModels();
    ensureDataDir();
    fs.writeFileSync(
      logPath,
      JSON.stringify(
        { at: new Date().toISOString(), errors: r.errors, ok: Object.keys(r.byProviderId) },
        null, 2
      ),
      "utf8"
    );
    if (!Object.keys(r.byProviderId).length) return;
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send("orchestrate:event", {
        type: "models",
        byProviderId: r.byProviderId,
        fetchedAt: r.fetchedAt,
      });
    }
  } catch (e) {
    try {
      ensureDataDir();
      fs.writeFileSync(logPath, "FATAL: " + (e.stack || e.message), "utf8");
    } catch {}
  }
}

// Calistir: payload {mode, prompt, rounds, participants:[{providerId,model}], judge:{providerId,model}}
ipcMain.handle("orchestrate:run", async (event, payload) => {
  const cfg = loadConfig();
  const byId = new Map(cfg.providers.map((p) => [p.id, p]));
  const send = (evt) => event.sender.send("orchestrate:event", evt);

  const resolve = (sel) => {
    const prov = byId.get(sel.providerId);
    if (!prov) return null;
    return {
      name: `${prov.name} · ${sel.model}`,
      providerId: prov.id,
      provider: { kind: prov.kind, baseUrl: prov.baseUrl, apiKey: prov.apiKey, tokenParam: prov.tokenParam },
      model: sel.model,
    };
  };

  const lang = normalize(payload.lang);
  const fail = (key, params) => {
    const msg = t(lang, key, params);
    send({ type: "error", message: msg });
    return { ok: false, error: msg };
  };
  const warn = (key, params) => send({ type: "warning", message: t(lang, key, params) });

  // Lokal (Ollama vb.) saglayicilar anahtar istemez; digerleri ister.
  const isLocal = (url) => /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(url || "");
  const needsKey = (prov) => !isLocal(prov.baseUrl);

  const requested = (payload.participants || []).map(resolve).filter(Boolean);
  const valid = requested.filter((p) => p.provider.apiKey || !needsKey(p.provider));
  const skipped = requested.filter((p) => !(p.provider.apiKey || !needsKey(p.provider)));

  // Hic kullanilabilir model yoksa: gercek hata
  if (valid.length === 0) return fail("error.noKeys");

  // Anahtari olmayanlari atladiysak uyar (ama devam et)
  if (skipped.length) warn("warn.skipped", { names: skipped.map((s) => s.name).join(", ") });

  // Orkestra modunda tek model kaldiysa: tartisma/sentez yok -> bagimsiz calis + uyar
  let effectiveMode = payload.mode;
  if (payload.mode !== "split" && valid.length < 2) {
    warn("warn.single");
    effectiveMode = "split";
  }

  const judge = resolve(payload.judge) || valid[0];

  const ac = new AbortController();
  currentAbort = ac;

  // Devam eden konusma: memory'den baglam olustur
  let convId = payload.conversationId || null;
  let promptForModels = payload.prompt;
  if (convId) {
    const existing = loadHistory().find((x) => x.id === convId);
    if (existing) {
      const mem = (existing.memory || []).slice(-6);
      let ctx = mem.map((m) => `Q: ${m.q}\nA: ${m.a}`).join("\n\n");
      if (ctx.length > 7000) ctx = ctx.slice(-7000);
      promptForModels =
        "Below is the context of an ongoing conversation (previous questions and answers). Use it as background knowledge.\n\n" +
        ctx +
        "\n\n---\nNew question — answer THIS question, in the same language as the question:\n" +
        payload.prompt;
    } else {
      convId = null; // kayit silinmisse yeni konusma olarak devam
    }
  }

  try {
    const runner = effectiveMode === "split" ? independent : orchestrate;
    const result = await runner(
      { participants: valid, judge, rounds: payload.rounds, prompt: promptForModels, lang, signal: ac.signal },
      send
    );

    if (ac.signal.aborted) {
      send({ type: "cancelled" });
      return { ok: false, cancelled: true };
    }

    // --- Gecmise kaydet ---
    const memA = memAnswer(result);
    const newTurn = { prompt: payload.prompt, result, ts: Date.now(), effectiveMode };

    if (convId) {
      // mevcut konusmaya tur ekle
      const hist = loadHistory();
      const idx = hist.findIndex((x) => x.id === convId);
      if (idx >= 0) {
        const e = hist[idx];
        e.turns.push(newTurn);
        e.memory = e.memory || [];
        e.memory.push({ q: payload.prompt, a: memA });
        e.ts = Date.now();
        hist.splice(idx, 1);
        hist.unshift(e); // en uste tasi
        saveHistory(hist);
        send({ type: "history", entry: { id: e.id, title: e.title, ts: e.ts, mode: e.mode } });
      }
    } else {
      // yeni konusma: otomatik kisa baslik uret (ilk katilimciyla)
      let title = (payload.prompt || "").trim().replace(/\s+/g, " ").slice(0, 60) || "—";
      try {
        const titler = valid[0];
        const tr = await callModel(titler.provider, {
          model: titler.model,
          user:
            "Generate a very short title (3-6 words) for the following question, in the SAME language as the question. Reply with ONLY the title, no quotes, no punctuation at the end:\n\n" +
            payload.prompt.slice(0, 600),
          maxTokens: 30,
        });
        const cand = (tr.text || "").trim().replace(/^["'`]+|["'`]+$/g, "");
        if (cand) title = cand.slice(0, 80);
      } catch {
        /* baslik uretilemezse prompt kisaltmasi kalir */
      }

      const entry = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        ts: Date.now(),
        title,
        mode: payload.mode === "split" ? "split" : "orchestra",
        rounds: payload.rounds,
        turns: [newTurn],
        memory: [{ q: payload.prompt, a: memA }],
      };
      const hist = loadHistory();
      hist.unshift(entry);
      if (hist.length > 300) hist.length = 300;
      saveHistory(hist);
      send({ type: "history", entry: { id: entry.id, title: entry.title, ts: entry.ts, mode: entry.mode } });
    }

    return { ok: true, ...result };
  } catch (err) {
    if (ac.signal.aborted || err.name === "AbortError") {
      send({ type: "cancelled" });
      return { ok: false, cancelled: true };
    }
    send({ type: "error", message: err.message });
    return { ok: false, error: err.message };
  } finally {
    if (currentAbort === ac) currentAbort = null;
  }
});

ipcMain.handle("orchestrate:cancel", () => {
  if (currentAbort) currentAbort.abort();
  return { ok: true };
});
