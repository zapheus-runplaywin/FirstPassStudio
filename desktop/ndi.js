// FirstPass Studio Mac app - the scene as NDI® sources on the network (outputs.js decides when; the
// Output page sets it up).
//
// Each output set to NDI gets its own sender: its own sources (named after the output's source name),
// format and off-screen scene window. The scene renders off screen (desktop/scenewindow.js) at the chosen format's size and frame rate, and
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

const MODULE = require('../unpacked').unpacked(path.join(__dirname, '..', 'native', 'ndi', 'build', 'Release', 'ndi.node'));
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
  // One sender for each output that sends NDI, by output id: { win, running: { key, id, sources, format }, error, watch, late }.
  const senders = new Map();
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

  function status(output) {
    const x = senders.get(output);
    const s = addon && x?.running ? addon.status(x.running.id) : { running: false };
    return { running: !!s.running, format: x?.running?.format || '', sources: s.sources || [], late: s.late || 0, error: x?.error || '' };
  }

  const report = output => onStatus(status(output), output);

  function stop(output) {
    if (output === undefined) { for (const o of [...senders.keys()]) stop(o); return; }
    const x = senders.get(output);
    if (!x) return;
    if (x.watch) clearInterval(x.watch);
    if (x.win) x.win.destroy();
    if (x.running) { log(`NDI output stopped (${x.running.sources.map(s => s.name).join(', ')})`); if (addon) addon.stop(x.running.id); }
    senders.delete(output);
  }

  // list: [{ signal, name, format: { id, width, height, rateN, rateD }, color, safe, output }] from outputs.js,
  // one for each output sending NDI (an empty list stops them all).
  function show(list) {
    const wanted = new Map(list.map(w => [w.output || 'main', w]));
    for (const output of [...senders.keys()]) if (!wanted.has(output)) { stop(output); report(output); }
    for (const [output, w] of wanted) start(output, w);
  }

  function start(output, w) {
    const key = JSON.stringify([w.signal, w.name, w.format, w.signal === 'chroma' ? w.color : '', !!w.safe]);
    if (senders.get(output)?.key === key) return;
    stop(output);
    const x = { key, win: null, running: null, error: '', watch: null, late: 0 };
    senders.set(output, x);
    if (!addon) { x.error = 'NDI output isn\'t in this copy of Studio.'; return report(output); }

    const sources = (SOURCES[w.signal] || SOURCES.fillkey)(w.name);
    const { width, height, rateN, rateD } = w.format;
    const r = addon.start({ sources, color: w.color, width, height, rateN, rateD });
    if (!r.ok) {
      // Kept for the Output page, but not as running: the next change tries again (a runtime that wasn't
      // ready, a name another app had for a moment) rather than leaving the output dead until it's turned off and on.
      x.key = '';
      x.error = r.error;
      log(`NDI output failed: ${r.error}`);
      return report(output);
    }
    x.running = { id: r.id, sources, format: w.format.id, frameRate: rateN / rateD };
    log(`NDI output on: ${sources.map(s => s.name).join(', ')} (${w.format.id}, ${width} x ${height})`);

    x.win = sceneWindow({
      port, width, height, frameRate: rateN / rateD, log, label: `NDI output ${w.name}`, chromaKey: !!w.safe, output,
      onFrame: (bitmap, bw, bh) => addon.frame(r.id, bitmap, bw, bh),
    });

    // Who's watching (receivers come and go), for the Output page; and once a minute while someone is,
    // how many new pictures the scene drew and how many frames went out, against the format's rate. A
    // choppy picture with both at the full rate was lost on the network, not on the Mac.
    let ticks = 0;
    let counted = { at: Date.now(), sent: 0, pictures: 0 };
    x.watch = setInterval(() => {
      const s = status(output);
      if (++ticks % 30 === 0) {
        if (s.late > x.late) log(`NDI output ${w.name} fell behind ${s.late - x.late} times in the last minute`);
        x.late = s.late;
        const raw = addon.status(r.id);
        const now = { at: Date.now(), sent: raw.sent || 0, pictures: raw.pictures || 0 };
        const secs = (now.at - counted.at) / 1000;
        const rate = n => Math.round(n / secs);
        if (now.sent > counted.sent) {
          log(`NDI output ${w.name}: ${rate(now.sent - counted.sent)} frames a second sent of ${Math.round(rateN / rateD)}, the scene drew ${rate(now.pictures - counted.pictures)} new pictures a second (fewer is normal while nothing moves)`);
        }
        counted = now;
      }
      report(output);
    }, 2000);
    report(output);
  }

  // The scene windows sending now, for desktop/perf.js.
  const windows = () => [...senders].filter(([, x]) => x.win && x.running)
    .map(([output, x]) => ({ output, contents: x.win.contents(), target: x.running.frameRate }));

  return { available, show, stop: () => stop(), status, windows };
};
