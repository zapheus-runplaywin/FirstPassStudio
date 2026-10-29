// FirstPass Studio Mac app - the scene out of a Blackmagic UltraStudio or DeckLink (outputs.js decides
// when; the Output page sets it up).
//
// The scene renders in an off-screen window, transparent, at the device's frame rate. Each new picture
// (Chromium only paints when something changes) goes to native/decklink, which keeps the device playing
// the latest one: as fill and key with the device's external keyer, or as fill only. With its sound in the
// SDI (sound 'sdi', or 'both' to hear it on the Mac too), desktop/soundtap.js hears the window and the sound
// goes out embedded, with the fill; 'mac' leaves it on the Mac's sound output only. Talks to the
// Blackmagic Desktop Video driver; without it, or without the built module, devices() says why.

'use strict';

const path = require('path');
const sceneWindow = require('./scenewindow');
const soundTap = require('./soundtap');

const MODULE = require('../unpacked').unpacked(path.join(__dirname, '..', 'native', 'decklink', 'build', 'Release', 'decklink.node'));
let addon = null;
let loadError = '';
try { addon = require(MODULE); } catch (err) { loadError = err.message; }

module.exports = function decklink({ port, log, onStatus }) {
  let win = null;
  let running = null; // { key, name, mode } while sending
  let error = '';
  let counts = { late: 0, dropped: 0 };
  let watch = null;
  let tap = null;
  let gaps = { gaps: 0, skipped: 0 };

  if (!addon) log(`DeckLink output unavailable: ${loadError}`);

  function devices() {
    if (!addon) return { ok: false, error: 'This copy of Studio was built without DeckLink output (cd native/decklink && npm install && npm run build).' };
    try { return addon.devices(); } catch (err) { return { ok: false, error: err.message }; }
  }

  function status() {
    const s = addon ? addon.status() : { running: false };
    return { running: !!s.running, name: s.name || '', mode: running?.mode || '', late: s.late || 0, dropped: s.dropped || 0, sound: running?.sound || '', error };
  }

  const report = () => onStatus(status(), output);
  let output = 'main'; // the output it's sending

  function stop() {
    if (watch) { clearInterval(watch); watch = null; }
    if (tap) { tap.stop(); tap = null; }
    if (win) { win.destroy(); win = null; }
    if (running) log(`DeckLink output stopped (${running.name})`);
    running = null;
    if (addon) addon.stop();
  }

  // w: { device, mode, keying, straight, sound, output } from outputs.js, or null to stop.
  function show(w) {
    const key = w && JSON.stringify([w.device, w.mode, w.keying, w.straight, w.sound, w.output]);
    if (key && running?.key === key) return;
    stop();
    error = '';
    if (!w) return report();
    output = w.output || 'main';
    if (!addon) { error = 'DeckLink output isn\'t in this copy of Studio.'; return report(); }

    const list = devices();
    const device = list.ok && list.devices.find(d => d.id === w.device);
    const mode = device && device.modes.find(m => m.mode === w.mode);
    const inSdi = w.sound !== 'mac';
    const r = addon.start({ device: w.device, mode: w.mode, keying: w.keying, straight: !!w.straight, audio: inSdi });
    if (!r.ok) {
      // A format the device said it can't send: say that rather than guess at another app holding it.
      error = mode && mode.supported === false ? `${device.name} says it can't send ${mode.name}. Pick another video format.` : r.error;
      log(`DeckLink output failed on ${device?.name || w.device}: ${error}`);
      return report();
    }
    // The sound: in the SDI when asked and the device took it, else on the Mac.
    const sound = inSdi && r.audio ? (w.sound === 'both' ? 'both' : 'sdi') : 'mac';
    running = { key, name: r.name, mode: mode?.name || '', sound };
    counts = { late: 0, dropped: 0 };
    gaps = { gaps: 0, skipped: 0 };
    log(`DeckLink output on ${r.name}: ${running.mode} (${r.width} x ${r.height}, ${r.frameRate} fps), ${w.keying === 'external' ? 'fill and key' : 'fill only'}${w.straight ? ', straight alpha' : ''}, `
      + (sound === 'mac' ? `sound on the Mac${inSdi ? ` (${r.name} wouldn't take sound)` : ''}` : `sound in the SDI${w.keying === 'external' ? ' fill' : ''}${sound === 'both' ? ' and on the Mac' : ''}`));

    running.frameRate = r.frameRate;
    win = sceneWindow({
      port, width: r.width, height: r.height, frameRate: r.frameRate, log, label: 'DeckLink output', output,
      onFrame: (bitmap, width, height) => addon.frame(bitmap, width, height),
    });
    if (sound !== 'mac' && win.contents()) {
      tap = soundTap({ contents: win.contents(), echo: sound === 'both', log, label: 'DeckLink output', onSound: pcm => addon.audio(pcm) });
    }

    // Log when the device has to repeat or drop frames (the Mac falling behind).
    watch = setInterval(() => {
      const s = status();
      if (s.late > counts.late || s.dropped > counts.dropped) log(`DeckLink output: ${s.late - counts.late} late and ${s.dropped - counts.dropped} dropped frames in the last minute`);
      counts = { late: s.late, dropped: s.dropped };
      const a = addon.status();
      if (a.gaps > gaps.gaps || a.skipped > gaps.skipped) log(`DeckLink output: the sound ran dry ${a.gaps - gaps.gaps} times and ${a.skipped - gaps.skipped} pieces were left out to catch up in the last minute`);
      gaps = { gaps: a.gaps || 0, skipped: a.skipped || 0 };
      report();
    }, 60000);
    report();
  }

  // The scene window sending now, for desktop/perf.js.
  const windows = () => win && running ? [{ output, contents: win.contents(), target: running.frameRate }] : [];

  return { devices, show, stop, status, windows };
};
