// FirstPass Studio Mac app - an output's sound sent to one of the Mac's sound outputs by name, such as the
// commentators' mixer (outputs.js: a named destination in the Output page's "Sound goes to").
//
// Each copy is a hidden window of its own playing scene.html?copy=1: the same output's videos, music and page
// sounds, and the Mac's mics ticked for it (or every mic, for Output 1's main destination), all to that device
// (setSinkId), while the output's own windows carry on (the display, the Blackmagic SDI, the Mac's sound output,
// or muted). It's a window of its own because a window whose sound goes into the SDI (desktop/soundtap.js) has
// all of it captured, wherever it plays. It opens while its output is on and closes when the output goes off or
// the destination is removed.

'use strict';

const { BrowserWindow } = require('electron');

module.exports = function soundCopy({ port, log }) {
  const open = new Map(); // "output id|device" -> { win, url }

  const pageFor = c => {
    const q = new URLSearchParams({ copy: '1', sink: c.device });
    if (c.output && c.output !== 'main') q.set('output', c.output);
    if (c.mics === 'all') q.set('mics', 'all');
    else if (c.mics && c.mics.length) q.set('mics', c.mics.join(','));
    if (c.main) q.set('main', '1'); // the output's main destination: it reports the mics' meters too
    return `http://localhost:${port}/scene.html?${q}`;
  };

  // list: [{ output, device, mics, main }], every copy that should be playing now.
  function show(list) {
    const wanted = new Map(list.filter(c => c && c.device).map(c => [`${c.output || 'main'}|${c.device}`, c]));
    for (const [id, o] of open) {
      if (!wanted.has(id)) { o.win.destroy(); open.delete(id); log(`Sound copy for ${id} closed`); }
    }
    for (const [id, c] of wanted) {
      const url = pageFor(c);
      const o = open.get(id);
      if (o && o.url === url) continue;
      if (o && !o.win.isDestroyed()) { o.url = url; o.win.loadURL(url); continue; }
      const win = new BrowserWindow({
        show: false, width: 320, height: 180, title: 'FirstPass Studio sound copy',
        webPreferences: { backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
      });
      // Its page crashed: it opens again a moment later.
      win.webContents.on('render-process-gone', () => setTimeout(() => { const now = open.get(id); if (now?.win === win && !win.isDestroyed()) win.loadURL(now.url); }, 2000));
      win.on('closed', () => { if (open.get(id)?.win === win) open.delete(id); });
      win.loadURL(url);
      open.set(id, { win, url });
      log(`Sound copy for ${c.output || 'main'} to ${c.device}${c.mics === 'all' ? ' with every mic' : c.mics && c.mics.length ? ` with ${c.mics.length} mic${c.mics.length === 1 ? '' : 's'}` : ', no mics'}`);
    }
  }

  function stop() {
    for (const o of open.values()) if (!o.win.isDestroyed()) o.win.destroy();
    open.clear();
  }

  return { show, stop, windows: () => [...open.entries()].map(([id, o]) => ({ output: id.split('|')[0], contents: o.win.isDestroyed() ? null : o.win.webContents })) };
};
