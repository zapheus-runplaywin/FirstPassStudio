// FirstPass Studio Mac app - the scene full screen on the Mac's own displays (outputs.js decides
// what goes where; the Output page sets it up).
//
// Each display output is a window that opens full screen on its display, showing scene.html (with
// ?output=<id> for an output besides the primary, which draws that output's sources): over black (fill),
// as white on black where the scene isn't see-through (key), or over a chroma colour. They're ordinary
// windows otherwise: leave full screen (the green button or ⌃⌘F) to move one to another display or get
// at other apps, and the scene scales to fit whatever size it is. They aren't Studio windows: closing
// them doesn't take Studio off air, and they close when Studio does. Closing one, or clicking it and
// pressing Esc, turns the output off, in case it ends up over the screen you're working on.
// A Blackmagic UltraStudio or DeckLink output goes to desktop/decklink.ts, NDI to desktop/ndi.ts, and an
// output's sound sent to the Mac's other sound outputs (Sound goes to) to desktop/soundcopy.ts.

import { app, BrowserWindow, screen, type UtilityProcess } from 'electron';
import * as decklinkLib from './decklink';
import * as soundCopyLib from './soundcopy';
import * as ndiLib from './ndi';
import * as perfLib from './perf';
import { obj, arr } from '../check';

// A display output from the helper (outputs.ts there): fill, key or chroma on one of the Mac's displays.
interface DisplayWanted { kind: 'fill' | 'key' | 'chroma', display: string, output?: string, sound?: string, color?: string, safe?: boolean }
// Every window the helper wants: the display outputs, the Blackmagic output and the NDI outputs, told apart by kind.
type Wanted = DisplayWanted | (decklinkLib.Wanted & { kind: 'decklink' }) | (ndiLib.Wanted & { kind: 'ndi' });

function create({ port, log }: { port: number, log: (message: string) => void }) {
  const open = new Map<string, { win: BrowserWindow, url: string, output?: string, hz: number }>(); // display id -> its window
  let quitting = false; // quitting closes the windows, which mustn't turn the output off for next time
  app.on('before-quit', () => { quitting = true; });
  let helper: UtilityProcess | null = null;
  const decklink = decklinkLib.create({ port, log, onStatus: (status, output) => helper?.postMessage({ type: 'decklinkStatus', status, output }),
    onLevel: (level, output) => helper?.postMessage({ type: 'soundLevel', output, device: 'sdi', ...level }),
    onTimecode: t => helper?.postMessage({ type: 'sdiTimecode', ...t }) });
  const soundCopy = soundCopyLib.create({ port, log });
  const ndi = ndiLib.create({ port, log, onStatus: (status, output) => helper?.postMessage({ type: 'ndiStatus', status, output }) });
  // How hard each output is working (desktop/perf.ts), while any output is showing.
  const perf = perfLib.create({
    windows: () => [
      ...[...open.values()].map(o => ({ output: o.output || 'main', contents: o.win.isDestroyed() ? null : o.win.webContents, target: o.hz })),
      ...decklink.windows(), ...ndi.windows(),
    ],
    send: p => helper?.postMessage({ type: 'perf', ...p }),
  });

  // The Blackmagic devices (and their video formats) for the Output page.
  function sendDecklink() {
    if (helper) helper.postMessage({ type: 'decklink', ...decklink.devices() });
  }

  // Whether the NDI runtime is installed, for the Output page.
  function sendNdi() {
    if (helper) helper.postMessage({ type: 'ndi', ...ndi.available() });
  }

  function displays() {
    const primary = screen.getPrimaryDisplay().id;
    return screen.getAllDisplays().map((d, i) => ({
      id: String(d.id),
      label: d.label || (d.id === primary ? 'Built-in display' : `Display ${i + 1}`),
      width: d.size.width,
      height: d.size.height,
      scale: d.scaleFactor,
      primary: d.id === primary,
    }));
  }

  function sendDisplays() {
    if (helper) helper.postMessage({ type: 'displays', displays: displays() });
  }

  const pageFor = (w: DisplayWanted) => {
    const q = new URLSearchParams({ fit: '1' });
    if (w.kind === 'key' || w.sound === 'none') q.set('mute', '1'); // the key is the fill's shape: the fill plays the sound; none: only its sound copies play it
    if (w.kind === 'key') q.set('key', '1');
    if (w.output && w.output !== 'main') q.set('output', w.output); // another output's sources and their sound
    q.set('bg', w.kind === 'chroma' ? (w.color || '#00ff00').replace('#', '') : '000000');
    if (w.safe) q.set('chromaKey', 'true'); // chroma key safe (public/chroma.ts)
    return `http://localhost:${port}/scene.html?${q}`;
  };

  function show(list: Wanted[]) {
    decklink.show(list.flatMap(w => w.kind === 'decklink' ? [w] : [])[0] || null);
    ndi.show(list.flatMap(w => w.kind === 'ndi' ? [w] : []));
    if (list.length) perf.start(); // it stops itself once nothing is showing
    const wanted = new Map(list.flatMap((w): [string, DisplayWanted][] => w.kind !== 'decklink' && w.kind !== 'ndi' && w.display ? [[w.display, w]] : []));
    for (const [id, o] of open) {
      if (!wanted.has(id)) { o.win.destroy(); open.delete(id); }
    }
    for (const [id, w] of wanted) {
      const d = screen.getAllDisplays().find(x => String(x.id) === id);
      if (!d) continue;
      const url = pageFor(w);
      const o = open.get(id);
      if (o && o.url === url) continue;
      if (o) { o.url = url; o.output = w.output; o.win.loadURL(url); continue; }
      const win = new BrowserWindow({
        x: d.workArea.x, y: d.workArea.y, width: d.workArea.width, height: d.workArea.height,
        show: false, fullscreenable: true,
        backgroundColor: w.kind === 'chroma' ? w.color || '#00ff00' : '#000000',
        title: `FirstPass Studio output: ${{ fill: 'Fill', key: 'Key', chroma: 'Chroma' }[w.kind]} (${d.label || 'display'})`,
        webPreferences: { backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
      });
      win.on('page-title-updated', e => e.preventDefault()); // keep saying which output it is
      win.webContents.on('before-input-event', (e, input) => {
        if (input.type === 'keyDown' && input.key === 'Escape') { e.preventDefault(); if (helper) helper.postMessage({ type: 'escape', output: open.get(id)?.output }); }
      });
      // Opens full screen on its display, without taking the focus from the window you're working in.
      win.once('ready-to-show', () => { win.showInactive(); win.setFullScreen(true); });
      // Closed by hand (not by Studio): the output is off, rather than reopening on the next change.
      win.on('close', () => { const now = open.get(id); if (!quitting && now?.win === win && helper) helper.postMessage({ type: 'escape', output: now.output }); });
      win.on('closed', () => { if (open.get(id)?.win === win) open.delete(id); });
      win.loadURL(url);
      open.set(id, { win, url, output: w.output, hz: d.displayFrequency || 60 });
      log(`Output ${w.kind} on ${d.label || id} (${d.size.width} x ${d.size.height}${d.scaleFactor !== 1 ? ` at ${d.scaleFactor}x` : ''}, ${d.displayFrequency} Hz)`);
    }
  }

  function closeAll() {
    for (const o of open.values()) o.win.destroy();
    open.clear();
    decklink.stop();
    decklink.readInput(null);
    ndi.stop();
    soundCopy.stop();
  }

  // Displays plugged in, unplugged or changed: tell the helper, and drop the windows of a display that's gone.
  const displaysChanged = () => {
    sendDisplays();
    for (const [id, o] of open) {
      const d = screen.getAllDisplays().find(x => String(x.id) === id);
      if (!d) { o.win.destroy(); open.delete(id); }
    }
  };
  screen.on('display-added', displaysChanged);
  screen.on('display-removed', displaysChanged);
  screen.on('display-metrics-changed', displaysChanged);

  return {
    // A new helper (Studio on air): give it the displays and follow what it asks for.
    attach(child: UtilityProcess) {
      helper = child;
      child.on('message', (message: unknown) => {
        const msg = obj(message);
        if (msg.type === 'ready') { sendDisplays(); sendDecklink(); sendNdi(); } // the helper is listening now
        if (msg.type === 'scan') { sendDecklink(); sendNdi(); }
        // The helper's own lists (outputs.ts there builds them), taken as they come: the windows by kind, the copies by device.
        if (msg.type === 'outputs') { show(arr(msg.windows) as Wanted[]); soundCopy.show(arr(msg.copies) as soundCopyLib.Copy[]); }
        if (msg.type === 'readTimecode') decklink.readInput(msg.device === null || msg.device === undefined ? null : { device: String(msg.device) }); // a 4K replay following the SDI input
      });
    },
    // Studio off air: the outputs go dark.
    detach(child: UtilityProcess) {
      if (helper === child) helper = null;
      closeAll();
    },
    closeAll,
    // Installing an update (main.js): the windows are about to close, and the outputs stay on for
    // when the new version opens. false: the install failed and the app carries on.
    setQuitting(on = true) { quitting = on; },
  };
}

export { create };
