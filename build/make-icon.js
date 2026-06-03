// build/make-icon.js
// icon.html'i Electron headless penceresinde render edip PNG olarak kaydeder.
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    useContentSize: true,
    webPreferences: { offscreen: false },
  });

  await win.loadFile(path.join(__dirname, "icon.html"));
  await new Promise((r) => setTimeout(r, 700)); // render bitsin

  const img = await win.webContents.capturePage();
  const size = img.getSize();
  fs.writeFileSync(path.join(__dirname, "icon-master.png"), img.toPNG());
  console.log("Yakalanan boyut:", size.width + "x" + size.height);
  app.quit();
});
