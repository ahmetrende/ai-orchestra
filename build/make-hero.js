// build/make-hero.js - hero.html'i assets/hero.png olarak render eder
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280, height: 640, show: false, backgroundColor: "#15171D",
    useContentSize: true, webPreferences: { offscreen: false },
  });
  await win.loadFile(path.join(__dirname, "hero.html"));
  await new Promise((r) => setTimeout(r, 700));
  const img = await win.webContents.capturePage();
  const outDir = path.join(__dirname, "..", "assets");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "hero.png"), img.toPNG());
  console.log("OK", img.getSize().width + "x" + img.getSize().height);
  app.quit();
});
