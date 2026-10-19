// FirstPass Studio Mac app - the scene as NDI® sources on the network (outputs.js decides when; the
// Output page sets it up).
//
// The scene renders off screen (desktop/scenewindow.js) at the chosen format's size and frame rate, and
// native/ndi sends it as fill and key (two sources), chroma (over a colour) or one source with
// transparency, repeating the latest picture between changes. It loads the NDI runtime that NDI Tools
// installs; without it, or without the built module, available() says why. Sound plays through the
// Mac's audio output, as it does for the other outputs.
// NDI® is a registered trademark of Vizrt NDI AB.

'use strict';

const path = require('path');
const sceneWindow = require('./scenewindow');

const MODULE = path.join(__dirname, '..', 'native', 'ndi', 'build', 'Release', 'ndi.node');
let addon = null;
let loadError = '';
try { addon = require(MODULE); } catch (err) { loadError = err.message; }

// The sources each signal makes, named after the name on the Output page.
const SOURCES = {
  fillkey: name => [{ kind: 'fill', name: `${name} Fill` }, { kind: 'key', name: `${name} Key` }],
  chroma: name => [{ kind: 'chroma', name: `${name} Chroma` }],
  alpha: name => [{ kind: 'alpha', name }],
};

module.exports = function ndi({ port, log, onStatus }) {
  let win = null;
  let running = null; // { key, sources, format } while sending
  let error = '';
  let watch = null;
  let late = 0;

  if (!addon) log(`NDI output unavailable: ${loadError}`);

  function available() {
    if (!addon) return { ok: false, error: 'This copy of Studio was built without NDI output (cd native/ndi && npm install && npm run build).' };
    try { return addon.available(); } catch (err) { return { ok: false, error: err.message }; }
  }

  function status() {
    const s = addon ? addon.status() : { running: false };
    return { running: !!s.running, format: running?.format || '', sources: s.sources || [], late: s.late || 0, error };
  }

  const report = () => onStatus(status());

  function stop() {
    if (watch) { clearInterval(watch); watch = null; }
    if (win) { win.destroy(); win = null; }
    if (running) log(`NDI output stopped (${running.sources.map(s => s.name).join(', ')})`);
    running = null;
    if (addon) addon.stop();
  }

  // w: { signal, name, format: { id, width, height, rateN, rateD }, color, muted } from outputs.js, or
  // null to stop. muted: the Output page's preview is playing the sound instead.
  function show(w) {
    const key = w && JSON.stringify([w.signal, w.name, w.format, w.signal === 'chroma' ? w.color : '']);
    if (key && running?.key === key) { win?.setMuted(w.muted); return; }
    stop();
    error = '';
    if (!w) return report();
    if (!addon) { error = 'NDI output isn\'t in this copy of Studio.'; return report(); }

    const sources = (SOURCES[w.signal] || SOURCES.fillkey)(w.name);
    const { width, height, rateN, rateD } = w.format;
    const r = addon.start({ sources, color: w.color, width, height, rateN, rateD });
    if (!r.ok) {
      error = r.error;
      log(`NDI output failed: ${r.error}`);
      return report();
    }
    running = { key, sources, format: w.format.id };
    late = 0;
    log(`NDI output on: ${sources.map(s => s.name).join(', ')} (${w.format.id}, ${width} x ${height})`);

    win = sceneWindow({
      port, width, height, frameRate: rateN / rateD, muted: w.muted, log, label: 'NDI output',
      onFrame: (bitmap, bw, bh) => addon.frame(bitmap, bw, bh),
    });

    // Who's watching (receivers come and go), for the Output page; and log when the Mac falls behind.
    let ticks = 0;
    watch = setInterval(() => {
      const s = status();
      if (++ticks % 30 === 0) {
        if (s.late > late) log(`NDI output fell behind ${s.late - late} times in the last minute`);
        late = s.late;
      }
      report();
    }, 2000);
    report();
  }

  return { available, show, stop, status };
};
