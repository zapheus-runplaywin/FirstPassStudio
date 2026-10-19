// FirstPass Studio Mac app - the scene out of a Blackmagic UltraStudio or DeckLink (outputs.js decides
// when; the Output page sets it up).
//
// The scene renders in an off-screen window, transparent, at the device's frame rate. Each new picture
// (Chromium only paints when something changes) goes to native/decklink, which keeps the device playing
// the latest one: as fill and key with the device's external keyer, or as fill only. Talks to the
// Blackmagic Desktop Video driver; without it, or without the built module, devices() says why.

'use strict';

const path = require('path');
const { BrowserWindow } = require('electron');

const MODULE = path.join(__dirname, '..', 'native', 'decklink', 'build', 'Release', 'decklink.node');
let addon = null;
let loadError = '';
try { addon = require(MODULE); } catch (err) { loadError = err.message; }

// True once scene.html (not an error page) is showing and has drawn a frame.
const SCENE_READY = `new Promise(done => !document.getElementById('stage') ? done(false)
  : requestAnimationFrame(() => requestAnimationFrame(() => done(true))))`;

module.exports = function decklink({ port, log, onStatus }) {
  let win = null;
  let running = null; // { key, name, mode } while sending
  let error = '';
  let counts = { late: 0, dropped: 0 };
  let watch = null;

  if (!addon) log(`DeckLink output unavailable: ${loadError}`);

  function devices() {
    if (!addon) return { ok: false, error: 'This copy of Studio was built without DeckLink output (cd native/decklink && npm install && npm run build).' };
    try { return addon.devices(); } catch (err) { return { ok: false, error: err.message }; }
  }

  function status() {
    const s = addon ? addon.status() : { running: false };
    return { running: !!s.running, name: s.name || '', mode: running?.mode || '', late: s.late || 0, dropped: s.dropped || 0, error };
  }

  const report = () => onStatus(status());

  function stop() {
    if (watch) { clearInterval(watch); watch = null; }
    if (win) { win.destroy(); win = null; }
    if (running) log(`DeckLink output stopped (${running.name})`);
    running = null;
    if (addon) addon.stop();
  }

  // w: { device, mode, keying, straight, muted } from outputs.js, or null to stop. muted: the Output
  // page's preview is playing the sound instead, so it isn't heard twice.
  function show(w) {
    const key = w && JSON.stringify([w.device, w.mode, w.keying, w.straight]);
    if (key && running?.key === key) { win?.webContents.setAudioMuted(!!w.muted); return; }
    stop();
    error = '';
    if (!w) return report();
    if (!addon) { error = 'DeckLink output isn\'t in this copy of Studio.'; return report(); }

    const list = devices();
    const device = list.ok && list.devices.find(d => d.id === w.device);
    const mode = device && device.modes.find(m => m.mode === w.mode);
    const r = addon.start({ device: w.device, mode: w.mode, keying: w.keying, straight: !!w.straight });
    if (!r.ok) {
      error = r.error;
      log(`DeckLink output failed on ${device?.name || w.device}: ${r.error}`);
      return report();
    }
    running = { key, name: r.name, mode: mode?.name || '' };
    counts = { late: 0, dropped: 0 };
    log(`DeckLink output on ${r.name}: ${running.mode} (${r.width} x ${r.height}, ${r.frameRate} fps), ${w.keying === 'external' ? 'fill and key' : 'fill only'}${w.straight ? ', straight alpha' : ''}`);

    // Half size at twice the pixel density: the picture comes out at the format's full size, and the
    // window still fits on the Mac's screen (windows can't be bigger than it, even off screen).
    win = new BrowserWindow({
      width: r.width / 2, height: r.height / 2, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
      useContentSize: true, resizable: false,
      webPreferences: {
        offscreen: { deviceScaleFactor: 2 },
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required',
      },
    });
    win.webContents.setAudioMuted(!!w.muted);
    win.webContents.setFrameRate(Math.min(240, Math.ceil(r.frameRate) || 30));
    // Only send pictures once the scene page is there: before it, or if the helper isn't answering
    // yet, Chromium paints a white page, which would go out on air.
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
      log(`DeckLink output couldn't load the scene (${description}); trying again`);
      retry();
    });
    win.webContents.on('paint', (event, dirty, image) => {
      const size = image.getSize();
      if (!loaded) return;
      addon.frame(image.toBitmap(), size.width, size.height);
    });
    win.webContents.on('render-process-gone', (e, details) => {
      loaded = false;
      log(`DeckLink output's scene page stopped (${details.reason}); reloading`);
      setTimeout(() => win?.webContents.reload(), 1000);
    });
    const url = `http://localhost:${port}/scene.html?fit=1`;
    win.loadURL(url);

    // Log when the device has to repeat or drop frames (the Mac falling behind).
    watch = setInterval(() => {
      const s = status();
      if (s.late > counts.late || s.dropped > counts.dropped) log(`DeckLink output: ${s.late - counts.late} late and ${s.dropped - counts.dropped} dropped frames in the last minute`);
      counts = { late: s.late, dropped: s.dropped };
      report();
    }, 60000);
    report();
  }

  return { devices, show, stop, status };
};
