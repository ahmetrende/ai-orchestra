// build/probe.js - kaynak ikondaki siyah kose bolgesini olcer
const { app, BrowserWindow } = require("electron");
const path = require("path");

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, webSecurity: false },
  });
  await win.loadURL("about:blank");
  const target = process.argv[2] || "user-icon.png";
  const fileUrl = "file://" + encodeURI(path.join(__dirname, target));

  const script = `
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onerror = () => reject(new Error("img load fail"));
      img.onload = () => {
        try {
          const c = document.createElement("canvas");
          c.width = img.width; c.height = img.height;
          const ctx = c.getContext("2d");
          ctx.drawImage(img, 0, 0);
          const d = ctx.getImageData(0, 0, img.width, img.height).data;
          const px = (x, y) => { const i = (y * img.width + x) * 4; return [d[i], d[i+1], d[i+2], d[i+3]]; };
          const isDark = (x, y) => { const [r, g, b] = px(x, y); return r + g + b < 150; };
          let diag = -1, topx = -1, lefty = -1;
          for (let t = 0; t < img.width / 2; t++) { if (!isDark(t, t)) { diag = t; break; } }
          for (let x = 0; x < img.width / 2; x++) { if (!isDark(x, 3)) { topx = x; break; } }
          for (let y = 0; y < img.height / 2; y++) { if (!isDark(3, y)) { lefty = y; break; } }
          resolve({ w: img.width, h: img.height, diag, topx, lefty, corner: px(2, 2) });
        } catch (e) { reject(e); }
      };
      img.src = ${JSON.stringify(fileUrl)};
    });
  `;

  try {
    const result = await win.webContents.executeJavaScript(script);
    console.log(JSON.stringify(result));
  } catch (e) {
    console.error("HATA:", e.message);
  }
  app.quit();
});
