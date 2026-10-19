// FirstPass Studio Mac app - the scene full screen on the Mac's own displays (outputs.js decides
// what goes where; the Output page sets it up).
//
// Each output is a borderless window covering one display, showing scene.html: over black (fill),
// as white on black where the scene isn't see-through (key), or over a chroma colour. They aren't
// Studio windows: closing them doesn't take Studio off air, and they close when Studio does.
// Clicking one and pressing Esc turns the output off, in case it ends up over the screen you're working on.

'use strict';

const { BrowserWindow, screen } = require('electron');

module.exports = function outputs({ port, log }) {
  const open = new Map(); // display id -> { win, key }
  let helper = null;

  function displays() {
    const primary = screen.getPrimaryDisplay().id;
    return screen.getAllDisplays().map((d, i) => ({
      id: String(d.id),
      label: d.label || (d.id === primary ? 'Built-in display' : `Display ${i + 1}`),
      width: d.size.width,
      height: d.size.height,
      primary: d.id === primary,
    }));
  }

  function sendDisplays() {
    if (helper) helper.postMessage({ type: 'displays', displays: displays() });
  }

  const pageFor = w => {
    const q = new URLSearchParams({ fit: '1' });
    if (w.kind === 'key') { q.set('key', '1'); q.set('mute', '1'); }
    q.set('bg', w.kind === 'chroma' ? w.color.replace('#', '') : '000000');
    return `http://localhost:${port}/scene.html?${q}`;
  };

  function show(list) {
    const wanted = new Map(list.map(w => [w.display, w]));
    for (const [id, o] of open) {
      if (!wanted.has(id)) { o.win.destroy(); open.delete(id); }
    }
    for (const [id, w] of wanted) {
      const d = screen.getAllDisplays().find(x => String(x.id) === id);
      if (!d) continue;
      const url = pageFor(w);
      const o = open.get(id);
      if (o && o.url === url) continue;
      if (o) { o.url = url; o.win.loadURL(url); continue; }
      const win = new BrowserWindow({
        x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
        frame: false, show: false, resizable: false, movable: false, minimizable: false, maximizable: false,
        fullscreenable: false, skipTaskbar: true, hasShadow: false, enableLargerThanScreen: true,
        backgroundColor: w.kind === 'chroma' ? w.color : '#000000',
        title: `FirstPass Studio ${w.kind}`,
        webPreferences: { backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
      });
      // Above everything on that display, the menu bar included.
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      win.webContents.on('before-input-event', (e, input) => {
        if (input.type === 'keyDown' && input.key === 'Escape') { e.preventDefault(); if (helper) helper.postMessage({ type: 'escape' }); }
      });
      win.once('ready-to-show', () => { win.setBounds(d.bounds); win.showInactive(); });
      win.on('closed', () => { if (open.get(id)?.win === win) open.delete(id); });
      win.loadURL(url);
      open.set(id, { win, url });
      log(`Output ${w.kind} on ${d.label || id} (${d.size.width} x ${d.size.height})`);
    }
  }

  function closeAll() {
    for (const o of open.values()) o.win.destroy();
    open.clear();
  }

  // Displays plugged in, unplugged or changed: tell the helper, and move or drop windows.
  for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) {
    screen.on(ev, () => {
      sendDisplays();
      for (const [id, o] of open) {
        const d = screen.getAllDisplays().find(x => String(x.id) === id);
        if (!d) { o.win.destroy(); open.delete(id); } else o.win.setBounds(d.bounds);
      }
    });
  }

  return {
    // A new helper (Studio on air): give it the displays and follow what it asks for.
    attach(child) {
      helper = child;
      child.on('message', msg => {
        if (msg?.type === 'ready') sendDisplays(); // the helper is listening now
        if (msg?.type === 'outputs') show(msg.windows || []);
      });
    },
    // Studio off air: the outputs go dark.
    detach(child) {
      if (helper === child) helper = null;
      closeAll();
    },
    closeAll,
  };
};
