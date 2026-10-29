// FirstPass Studio Mac app - one output window's sound, for an output that carries it itself (the Blackmagic
// output's SDI, desktop/decklink.js).
//
// A hidden page (soundtap.html) captures the window's sound, as Chromium captures a tab's, and hands it over
// as 48 kHz stereo, 16-bit interleaved, in 20 ms pieces: onSound(buffer). echo: the window still plays it on the
// Mac's sound output too; without it the Mac goes quiet for that window while it's captured. If the capture
// stops or can't start (it says why in the log), it tries again every few seconds, and the window's sound plays
// on the Mac meanwhile, so it isn't lost.

'use strict';

const path = require('path');
const { BrowserWindow, session } = require('electron');
const { loadPage } = require('./windows');

const RETRY_MS = 5000;
// Which window each tap page captures: [{ win (the tap page's), contents (the window it hears), echo }].
const taps = new Set();
let handling = false;
// A capture asked for by a tap page gets its window's sound (and picture, which the page stops at once);
// anything else asking to capture the screen gets nothing.
const sameFrame = (a, b) => !!(a && b) && a.processId === b.processId && a.routingId === b.routingId;
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

module.exports = function soundTap({ contents, echo = false, log, label, onSound }) {
  handle();
  let win = null, tap = null, retry = null, stopped = false;

  function start() {
    retry = null;
    if (stopped || contents.isDestroyed()) return;
    win = new BrowserWindow({
      show: false, width: 100, height: 100,
      webPreferences: { preload: path.join(__dirname, 'soundtap-preload.js'), backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
    });
    tap = { win, contents, echo };
    taps.add(tap);
    win.webContents.ipc.on('soundtap:sound', (e, data) => {
      if (data && data.byteLength) onSound(Buffer.from(data.buffer || data, data.byteOffset || 0, data.byteLength));
    });
    win.webContents.ipc.on('soundtap:said', (e, text) => {
      if (text === 'started') return log(`${label}: sound captured${echo ? ' (and still played on the Mac)' : ''}`);
      log(`${label}: sound ${text === 'ended' ? 'capture stopped' : `capture ${text}`}; trying again`);
      again();
    });
    win.webContents.on('render-process-gone', () => again());
    win.webContents.once('did-finish-load', () => {
      win?.webContents.executeJavaScript('studioTapStart()', true).catch(err => { log(`${label}: sound capture didn't start (${err.message})`); again(); });
    });
    loadPage(win, 'soundtap.html');
  }

  function close() {
    if (!win) return;
    taps.delete(tap);
    if (!win.isDestroyed()) win.destroy();
    win = null;
  }

  function again() {
    close();
    if (!stopped && !retry) retry = setTimeout(start, RETRY_MS);
  }

  start();
  return {
    stop() { stopped = true; clearTimeout(retry); retry = null; close(); },
  };
};
