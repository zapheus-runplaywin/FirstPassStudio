// FirstPass Studio Mac app - one output window's sound, for an output that carries it itself (the Blackmagic
// output's SDI, desktop/decklink.ts).
//
// A hidden page (soundtap.html) captures the window's sound, as Chromium captures a tab's, and hands it over
// as 48 kHz stereo, 16-bit interleaved, in 20 ms pieces: onSound(buffer). echo: the window still plays it on the
// Mac's sound output too; without it the Mac goes quiet for that window while it's captured. The sound is taken
// as it plays, with none of the browser's call processing (automatic level, noise suppression), which squashes
// music; the log says what the capture is when it starts. If the capture stops or can't start (it says why in
// the log), it tries again every few seconds, and the window's sound plays on the Mac meanwhile, so it isn't lost.
// Every half second onLevel([left, right]) gives the loudest moment of each side since the last (0 to 1), for the
// status board's Sound out meters.

import path from 'node:path';
import { BrowserWindow, session, type WebContents, type WebFrameMain } from 'electron';
import { loadPage } from './windows';

const RETRY_MS = 5000;
// Which window each tap page captures: [{ win (the tap page's), contents (the window it hears), echo }].
interface Tap { win: BrowserWindow, contents: WebContents, echo: boolean }
const taps = new Set<Tap>();
let handling = false;
// A capture asked for by a tap page gets its window's sound (and picture, which the page stops at once);
// anything else asking to capture the screen gets nothing.
const sameFrame = (a: WebFrameMain | null | undefined, b: WebFrameMain | null | undefined) => !!(a && b) && a.processId === b.processId && a.routingId === b.routingId;
function handle() {
  if (handling) return;
  handling = true;
  session.defaultSession.setDisplayMediaRequestHandler((request, answer) => {
    const asking = request.frame?.top || request.frame;
    const t = [...taps].find(x => !x.win.isDestroyed() && sameFrame(x.win.webContents.mainFrame, asking));
    if (!t || t.contents.isDestroyed()) return answer({});
    answer({ video: t.contents.mainFrame, audio: t.contents.mainFrame, enableLocalEcho: t.echo });
  });
}

interface Options {
  contents: WebContents, echo?: boolean, log: (message: string) => void, label: string,
  onSound: (pcm: Buffer) => void, onLevel?: (peak: [number, number]) => void,
}

function create({ contents, echo = false, log, label, onSound, onLevel = () => {} }: Options) {
  handle();
  let win: BrowserWindow | null = null, tap: Tap | null = null, retry: NodeJS.Timeout | null = null, stopped = false;

  function start() {
    retry = null;
    if (stopped || contents.isDestroyed()) return;
    const w = win = new BrowserWindow({
      show: false, width: 100, height: 100,
      webPreferences: { preload: path.join(__dirname, 'soundtap-preload.js'), backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
    });
    tap = { win: w, contents, echo };
    taps.add(tap);
    // The page's sound, as a typed array or a plain ArrayBuffer (structured clone keeps either).
    w.webContents.ipc.on('soundtap:sound', (e, data: unknown) => {
      if (ArrayBuffer.isView(data) && data.byteLength) onSound(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
      else if (data instanceof ArrayBuffer && data.byteLength) onSound(Buffer.from(data));
    });
    w.webContents.ipc.on('soundtap:level', (e, l: unknown, r: unknown) => onLevel([Number(l) || 0, Number(r) || 0]));
    w.webContents.ipc.on('soundtap:said', (e, said: unknown) => {
      const text = String(said);
      if (text.startsWith('started')) {
        const how = text.slice('started'.length).replace(/^:\s*/, '');
        return log(`${label}: sound captured${how ? ` (${how})` : ''}${echo ? ', and still played on the Mac' : ''}`);
      }
      log(`${label}: sound ${text === 'ended' ? 'capture stopped' : `capture ${text}`}; trying again`);
      again();
    });
    w.webContents.on('render-process-gone', () => again());
    w.webContents.once('did-finish-load', () => {
      win?.webContents.executeJavaScript('studioTapStart()', true).catch((err: Error) => { log(`${label}: sound capture didn't start (${err.message})`); again(); });
    });
    loadPage(w, 'soundtap.html');
  }

  function close() {
    if (!win) return;
    if (tap) taps.delete(tap);
    if (!win.isDestroyed()) win.destroy();
    win = null;
  }

  function again() {
    close();
    if (!stopped && !retry) retry = setTimeout(start, RETRY_MS);
  }

  start();
  return {
    stop() { stopped = true; if (retry) clearTimeout(retry); retry = null; close(); },
  };
}

export { create };
