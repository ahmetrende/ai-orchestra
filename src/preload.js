// preload.js - guvenli kopru (renderer <-> main)
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  loadConfig: () => ipcRenderer.invoke("config:load"),
  saveConfig: (cfg) => ipcRenderer.invoke("config:save", cfg),
  osLocale: () => ipcRenderer.invoke("app:locale"),
  appVersion: () => ipcRenderer.invoke("app:version"),
  buildInfo: () => ipcRenderer.invoke("app:buildInfo"),
  openExternal: (url) => ipcRenderer.invoke("shell:open", url),
  logError: (msg) => ipcRenderer.invoke("log:error", String(msg)),
  openLogs: () => ipcRenderer.invoke("log:open"),
  checkUpdates: () => ipcRenderer.invoke("updates:check"),
  exportMarkdown: (text, name) => ipcRenderer.invoke("export:save", { text, name }),
  cancelRun: () => ipcRenderer.invoke("orchestrate:cancel"),
  onMenu: (cb) => {
    const l = (_e, action) => cb(action);
    ipcRenderer.on("menu", l);
    return () => ipcRenderer.removeListener("menu", l);
  },
  modelCatalog: () => ipcRenderer.invoke("models:catalog"),
  refreshModels: () => ipcRenderer.invoke("models:refresh"),
  modelsCached: () => ipcRenderer.invoke("models:cached"),
  historyList: () => ipcRenderer.invoke("history:list"),
  historySearch: (q) => ipcRenderer.invoke("history:search", q),
  historyGet: (id) => ipcRenderer.invoke("history:get", id),
  historyDelete: (id) => ipcRenderer.invoke("history:delete", id),
  run: (payload) => ipcRenderer.invoke("orchestrate:run", payload),
  onEvent: (cb) => {
    const listener = (_e, evt) => cb(evt);
    ipcRenderer.on("orchestrate:event", listener);
    return () => ipcRenderer.removeListener("orchestrate:event", listener);
  },
});
