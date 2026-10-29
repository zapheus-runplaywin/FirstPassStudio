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

// onFrame(bitmap, width, height): each new picture, BGRA with premultiplied alpha, at width x height;
// returns false when the output didn't take it.
// chromaKey: draw the scene chroma key safe (public/chroma.js), for NDI's chroma signal.
// output: the output's id when it isn't the primary (scene.html draws that output's sources, with their sound).
module.exports = function sceneWindow({ port, width, height, frameRate, log, label, onFrame, chromaKey = false, output = '' }) {
  // The window is the format's full size at one pixel per point, so the scene is drawn 1:1 with no
  // scaling anywhere. (Drawn at half size at twice the density, it came out soft on the Mac, as if
  // drawn at half size and scaled up.) enableLargerThanScreen lets it be bigger than the
  // Mac's screen; if macOS still makes it smaller, fall back to half size at twice the density.
  const make = scale => new BrowserWindow({
    width: width / scale, height: height / scale, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
    useContentSize: true, resizable: false, enableLargerThanScreen: true,
    webPreferences: {
      offscreen: { deviceScaleFactor: scale },
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  let win = make(1);
  const [cw, ch] = win.getContentSize();
  if (cw < width || ch < height) {
    log(`${label}: the scene window could only be ${cw} x ${ch}, so drawing it at half size at twice the density`);
    win.destroy();
    win = make(2);
  }
  win.webContents.setFrameRate(Math.min(240, Math.ceil(frameRate) || 30));
  const url = `http://localhost:${port}/scene.html?fit=1${chromaKey ? '&chromaKey=true' : ''}${output && output !== 'main' ? `&output=${encodeURIComponent(output)}` : ''}`;
  let loaded = false;
  const retry = () => setTimeout(() => { if (win) win.loadURL(url); }, 1000);
  win.webContents.on('did-finish-load', async () => {
    const ok = await win?.webContents.executeJavaScript(SCENE_READY).catch(() => false);
    if (!win) return;
    if (!ok) { loaded = false; return retry(); }
    // Log the size the scene is drawn at, to show in the log whether anything is scaling it.
    const drawn = await win?.webContents.executeJavaScript('[innerWidth, innerHeight, devicePixelRatio]').catch(() => null);
    if (drawn && win) log(`${label}: scene drawn at ${drawn[0]} x ${drawn[1]} at ${drawn[2]}x for ${width} x ${height}`);
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
  // Log the first picture's size, so the log shows whether the output gets the full format, and say
  // once if the output won't take them (a picture of the wrong size never reaches it).
  let told = '';
  win.webContents.on('paint', (event, dirty, image) => {
    if (!loaded) return;
    const size = image.getSize();
    const taken = onFrame(image.toBitmap(), size.width, size.height);
    const now = `${size.width} x ${size.height}${taken === false ? ' (not taken)' : ''}`;
    if (now === told) return;
    told = now;
    log(taken === false ? `${label}: the scene's pictures are ${size.width} x ${size.height} but the output needs ${width} x ${height}, so nothing is going out`
      : `${label}: sending ${size.width} x ${size.height} pictures`);
  });
  win.webContents.on('render-process-gone', (e, details) => {
    loaded = false;
    log(`${label}'s scene page stopped (${details.reason}); reloading`);
    setTimeout(() => win?.webContents.reload(), 1000);
  });
  win.loadURL(url);

  return {
    destroy() { if (win) { win.destroy(); win = null; } },
    contents: () => win?.webContents || null, // for desktop/perf.js
  };
};
