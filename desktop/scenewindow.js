// FirstPass Studio Mac app - the scene rendered off screen, for outputs that take its pictures rather
// than show a window: Blackmagic (desktop/decklink.js) and NDI (desktop/ndi.js).
//
// The window is transparent and renders at most at the output's frame rate; Chromium only paints
// when something changes, so the output keeps sending the latest picture in between. Pictures only
// start once scene.html is there and has drawn: before it, or if the helper isn't answering yet,
// Chromium paints a white page, which would go out on air.

'use strict';

const { BrowserWindow } = require('electron');

// True once scene.html (not an error page) is showing and has drawn a frame.
const SCENE_READY = `new Promise(done => !document.getElementById('stage') ? done(false)
  : requestAnimationFrame(() => requestAnimationFrame(() => done(true))))`;

// onFrame(bitmap, width, height): each new picture, BGRA with premultiplied alpha, at width x height.
module.exports = function sceneWindow({ port, width, height, frameRate, muted, log, label, onFrame }) {
  // Half size at twice the pixel density: the picture comes out at the format's full size, and the
  // window still fits on the Mac's screen (windows can't be bigger than it, even off screen).
  let win = new BrowserWindow({
    width: width / 2, height: height / 2, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
    useContentSize: true, resizable: false,
    webPreferences: {
      offscreen: { deviceScaleFactor: 2 },
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  win.webContents.setAudioMuted(!!muted);
  win.webContents.setFrameRate(Math.min(240, Math.ceil(frameRate) || 30));
  const url = `http://localhost:${port}/scene.html?fit=1`;
  let loaded = false;
  const retry = () => setTimeout(() => { if (win) win.loadURL(url); }, 1000);
  win.webContents.on('did-finish-load', async () => {
    const ok = await win?.webContents.executeJavaScript(SCENE_READY).catch(() => false);
    if (!win) return;
    if (!ok) { loaded = false; return retry(); }
    // Off screen, Chromium keeps handing over its blank (white) first frame for a moment after
    // the page is ready, so give it a few frames' grace.
    setTimeout(() => { if (win) { loaded = true; win.webContents.invalidate(); } }, 300);
  });
  win.webContents.on('did-fail-load', (e, code, description, failed, mainFrame) => {
    if (!mainFrame) return;
    loaded = false;
    log(`${label} couldn't load the scene (${description}); trying again`);
    retry();
  });
  win.webContents.on('paint', (event, dirty, image) => {
    if (!loaded) return;
    const size = image.getSize();
    onFrame(image.toBitmap(), size.width, size.height);
  });
  win.webContents.on('render-process-gone', (e, details) => {
    loaded = false;
    log(`${label}'s scene page stopped (${details.reason}); reloading`);
    setTimeout(() => win?.webContents.reload(), 1000);
  });
  win.loadURL(url);

  return {
    setMuted: m => win?.webContents.setAudioMuted(!!m),
    destroy() { if (win) { win.destroy(); win = null; } },
  };
};
