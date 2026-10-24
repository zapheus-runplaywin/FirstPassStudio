// FirstPass Studio Mac app - the scene as NDI® sources on the network (outputs.js decides when; the
// Output page sets it up).
//
// The scene renders off screen (desktop/scenewindow.js) at the chosen format's size and frame rate, and
// native/ndi sends it as fill and key (two sources), chroma (over a colour) or one source with
// transparency, repeating the latest picture between changes. It loads the NDI runtime that NDI's
// runtime installer puts in /usr/local/lib, or the copy inside one of NDI Tools' apps, and only a
// copy whose code signature is Vizrt's or NewTek's (desktop/signed.js): loading a library runs its
// code inside Studio, and any app could carry a file called libndi.dylib. Without a runtime, or
// without the built module, available() says why. Sound plays through the Mac's audio output, as it
// does for the other outputs.
// NDI® is a registered trademark of Vizrt NDI AB.

'use strict';

const fs = require('fs');
const path = require('path');
const sceneWindow = require('./scenewindow');
const signed = require('./signed');

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

// NDI Tools' apps on the Mac carry their own copy of the NDI library rather than installing it in
// /usr/local/lib (only NDI's runtime installer does that), so look inside them too. Only copies
// signed by NDI's makers are offered (signed.trusted); the rest are logged once and left alone.
const checked = new Map(); // path -> { ok, why }
function bundledCopies(log = () => {}) {
  const out = [];
  for (const file of foundCopies()) {
    if (!checked.has(file)) {
      const r = signed.trusted(file);
      checked.set(file, r);
      if (!r.ok) log(`NDI: not loading ${file}: ${r.why}`);
    }
    if (checked.get(file).ok) out.push(file);
  }
  return out;
}
function foundCopies() {
  const found = [];
  const look = (dir, depth) => {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const name of names) {
      const full = path.join(dir, name);
      if (/^libndi.*\.dylib$/i.test(name)) found.push(full);
      else if (depth > 0 && !name.startsWith('.') && (/ndi/i.test(name) || /^(Contents|Frameworks|MacOS|Resources|lib)$/.test(name))) look(full, depth - 1);
    }
  };
  for (const dir of ['/Applications', '/Library/Application Support']) look(dir, 5);
  return found;
}

module.exports = function ndi({ port, log, onStatus }) {
  let win = null;
  let running = null; // { key, sources, format } while sending
  let error = '';
  let watch = null;
  let late = 0;
  let loadedFrom = '';
  let lastWhy = '';

  if (!addon) log(`NDI output unavailable: ${loadError}`);

  function available() {
    if (!addon) return { ok: false, error: 'This copy of Studio was built without NDI output (cd native/ndi && npm install && npm run build).' };
    try {
      const copies = loadedFrom ? [] : bundledCopies(log);
      const r = addon.available(copies);
      if (r.ok && r.path !== loadedFrom) { loadedFrom = r.path; log(`NDI runtime ${r.version} from ${r.path}`); }
      const why = r.ok ? '' : `${r.error} (also tried ${copies.length ? copies.join(', ') : 'no copies inside NDI apps'})`;
      if (why && why !== lastWhy) log(`NDI output unavailable: ${why}`);
      lastWhy = why;
      return r;
    } catch (err) { return { ok: false, error: err.message }; }
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

  // w: { signal, name, format: { id, width, height, rateN, rateD }, color, safe } from outputs.js, or
  // null to stop.
  function show(w) {
    const key = w && JSON.stringify([w.signal, w.name, w.format, w.signal === 'chroma' ? w.color : '', !!w.safe]);
    if (key && running?.key === key) return;
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
      port, width, height, frameRate: rateN / rateD, log, label: 'NDI output', chromaKey: !!w.safe,
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
