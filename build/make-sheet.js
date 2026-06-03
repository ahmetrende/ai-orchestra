// build/make-sheet.js - kontak sayfasini PNG'ye render eder
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1120,
    height: 880,
    show: false,
    backgroundColor: "#0f1117",
    useContentSize: true,
    webPreferences: { offscreen: false },
  });
  await win.loadFile(path.join(__dirname, "icons-sheet.html"));
  await new Promise((r) => setTimeout(r, 700));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, "icons-sheet.png"), img.toPNG());
  console.log("OK", img.getSize().width + "x" + img.getSize().height);
  app.quit();
});
