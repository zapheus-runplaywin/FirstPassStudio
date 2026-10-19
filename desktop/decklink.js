// FirstPass Studio Mac app - the scene out of a Blackmagic UltraStudio or DeckLink (outputs.js decides
// when; the Output page sets it up).
//
// The scene renders in an off-screen window, transparent, at the device's frame rate. Each new picture
// (Chromium only paints when something changes) goes to native/decklink, which keeps the device playing
// the latest one: as fill and key with the device's external keyer, or as fill only. Talks to the
// Blackmagic Desktop Video driver; without it, or without the built module, devices() says why.

'use strict';

const path = require('path');
const sceneWindow = require('./scenewindow');

const MODULE = path.join(__dirname, '..', 'native', 'decklink', 'build', 'Release', 'decklink.node');
let addon = null;
let loadError = '';
try { addon = require(MODULE); } catch (err) { loadError = err.message; }

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
    if (key && running?.key === key) { win?.setMuted(w.muted); return; }
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

    win = sceneWindow({
      port, width: r.width, height: r.height, frameRate: r.frameRate, muted: w.muted, log, label: 'DeckLink output',
      onFrame: (bitmap, width, height) => addon.frame(bitmap, width, height),
    });

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
