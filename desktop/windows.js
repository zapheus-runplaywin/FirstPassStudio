// FirstPass Studio - the Mac app's own windows.
//
// Studio's pages (home, control, setup, athletes, API docs) open in the app's own window
// rather than the browser: no address bar, tabs or bookmarks, the Studio header doubles as
// the title bar, and the app shows in the Dock and the app switcher while a window is open.
// Links that open a new tab on Studio (a preview, the setup page) open another app window;
// links to anywhere else (PlayHQ, GitHub) open in the browser. "Open in Browser" in the File
// menu opens the page on show in the browser, and the menu bar icon can send every page to
// the browser instead (saved as openInBrowser in app-settings.json).

'use strict';

const { app, BrowserWindow, Menu, shell, clipboard, screen, dialog } = require('electron');
const path = require('path');

// The pages with the Studio header (body class "fp"); everything else (the overlays, the
// debug log) gets a normal title bar.
const STUDIO_PAGES = new Set(['/', '/index.html', '/control.html', '/setup.html', '/athletes.html', '/api.html']);

// Room for the window buttons (red, yellow, green) at the left of the Studio header, which
// becomes the title bar: drag it to move the window, double-click it to zoom.
const HEADER_CSS = `
  .fp-bar { padding-left: 92px !important; -webkit-app-region: drag; -webkit-user-select: none; user-select: none; }
  .fp-bar a, .fp-bar button, .fp-bar input, .fp-bar select { -webkit-app-region: no-drag; }
`;

module.exports = function studioWindows({ port, linkHost, appSettings, saveAppSetting, log, isOnAir, openBrowser }) {
  const local = p => `http://localhost:${port}${p}`;
  // A page on this Studio: localhost, or the .local name the home page's links use.
  const isStudio = u => {
    try {
      const url = new URL(u);
      return url.protocol === 'http:' && Number(url.port || 80) === port &&
        ['localhost', '127.0.0.1', linkHost.toLowerCase()].includes(url.hostname.toLowerCase());
    } catch { return false; }
  };
  // The same page on the link name, for the browser and for copying.
  const linkFor = u => { const url = new URL(u); url.hostname = linkHost; return url.toString(); };

  let main = null; // the window "Open Studio" reuses

  // ─── Splash ─────────────────────────────────────────────────────────────
  // The 1P Studio logo, shown while the app starts Studio when opened by hand. It stays up for
  // at least SPLASH_MIN so it doesn't flash, then closes as Studio's first window shows (or the
  // page opens in the browser). It never stays longer than SPLASH_MAX, whatever happens.
  const SPLASH_MIN = 1500, SPLASH_MAX = 30000;
  let splash = null, splashDone = Promise.resolve();
  const isSplash = w => w && w.isSplash;
  // Every window but the splash: it doesn't put the app in the Dock or take the app menu.
  const pageWindows = () => BrowserWindow.getAllWindows().filter(w => !w.isDestroyed() && !isSplash(w));

  function showSplash() {
    if (splash) return;
    const win = splash = new BrowserWindow({
      width: 440, height: 360, center: true, frame: false, resizable: false, minimizable: false,
      maximizable: false, fullscreenable: false, show: false, backgroundColor: '#101729',
      title: 'FirstPass Studio',
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    win.isSplash = true;
    const shownAt = Date.now();
    let finish;
    splashDone = new Promise(resolve => { finish = resolve; });
    win.closeAfterMin = () => setTimeout(() => { if (!win.isDestroyed()) win.close(); }, Math.max(0, shownAt + SPLASH_MIN - Date.now()));
    win.once('ready-to-show', () => { win.show(); app.focus({ steal: true }); });
    win.on('closed', () => { if (splash === win) splash = null; finish(); });
    setTimeout(() => closeSplash(true), SPLASH_MAX);
    win.loadFile(path.join(__dirname, 'splash.html'), { query: { version: app.getVersion() } });
  }

  // Closes the splash: once it has been up for SPLASH_MIN, or straight away (before a dialog).
  function closeSplash(now = false) {
    const win = splash;
    if (!win || win.isDestroyed()) return;
    if (now) win.close(); else win.closeAfterMin();
  }

  // The line under the logo ("Studio is on air"), and whether the bar stops sweeping.
  function splashStatus(text, done = false) {
    if (splash && !splash.isDestroyed()) splash.webContents.executeJavaScript(`setStatus(${JSON.stringify(text)}, ${done})`).catch(() => {});
  }

  // ─── Dock ───────────────────────────────────────────────────────────────
  // A menu bar app (LSUIElement) until a window opens: then it is in the Dock and the app
  // switcher like any app, and back to just the menu bar icon when the last one closes.
  function refreshDock() {
    if (process.platform !== 'darwin') return;
    if (pageWindows().length) app.dock.show().catch(() => {});
    else app.dock.hide();
  }

  // ─── Windows ────────────────────────────────────────────────────────────
  function create(url, { isMain = false } = {}) {
    const studioPage = STUDIO_PAGES.has(new URL(url).pathname);
    const saved = isMain && appSettings().windowBounds;
    const bounds = saved && onScreen(saved) ? saved : { width: 1280, height: 860 };
    const win = new BrowserWindow({
      ...bounds,
      minWidth: 560, minHeight: 400,
      title: 'FirstPass Studio',
      backgroundColor: studioPage ? '#F8FAFC' : '#1E293B', // overlays are see-through: show them on dark
      show: false,
      // The Studio header is the title bar; the window buttons sit inside it.
      titleBarStyle: studioPage ? 'hiddenInset' : 'default',
      trafficLightPosition: { x: 18, y: 26 },
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true },
    });
    win.studioUrl = url;
    // While the splash is up, the window shows as it closes rather than behind it.
    win.once('ready-to-show', () => {
      if (!splash) return win.show();
      closeSplash();
      splashDone.then(() => { if (!win.isDestroyed()) win.show(); });
    });

    const wc = win.webContents;
    wc.on('dom-ready', () => { if (studioPage) wc.insertCSS(HEADER_CSS).catch(() => {}); });
    // Pages that open a new tab: Studio pages get an app window, anything else the browser.
    wc.setWindowOpenHandler(({ url: to }) => {
      if (isStudio(to)) create(to);
      else if (/^https?:|^mailto:/.test(to)) shell.openExternal(to);
      return { action: 'deny' };
    });
    // Following a link to somewhere other than Studio (PlayHQ, GitHub) opens the browser.
    wc.on('will-navigate', (e, to) => {
      if (isStudio(to) || to.startsWith('file:')) return;
      e.preventDefault();
      if (/^https?:|^mailto:/.test(to)) shell.openExternal(to);
    });
    wc.on('did-navigate', (e, to) => { if (isStudio(to)) win.studioUrl = to; });
    wc.on('did-navigate-in-page', (e, to) => { if (isStudio(to)) win.studioUrl = to; });
    // Off air (or still starting): a page saying so, which tries again by itself.
    wc.on('did-fail-load', (e, code, desc, failed, isMainFrame) => {
      if (!isMainFrame || code === -3 /* aborted: a new page took over */ || !isStudio(failed)) return;
      log(`Couldn't load ${failed}: ${desc}`);
      win.loadFile(path.join(__dirname, 'offair.html'), { query: { to: failed, on: isOnAir() ? '1' : '' } });
    });
    wc.on('page-title-updated', () => refreshMenu());
    win.on('focus', () => refreshMenu());

    if (isMain) {
      main = win;
      const keep = () => { if (!win.isDestroyed() && !win.isFullScreen()) saveAppSetting('windowBounds', win.getNormalBounds()); };
      win.on('resized', keep);
      win.on('moved', keep);
      win.on('closed', () => { if (main === win) main = null; });
    }
    win.on('closed', () => setImmediate(refreshDock));
    win.loadURL(url);
    refreshDock();
    return win;
  }

  const onScreen = b => screen.getAllDisplays().some(d => {
    const a = d.workArea;
    return b.x < a.x + a.width - 80 && b.x + b.width > a.x + 80 && b.y >= a.y - 20 && b.y < a.y + a.height - 80;
  });

  // Opens a Studio page (a path such as /control.html) in the app's window, reusing the main
  // one, or in the browser when that is chosen in the menu bar icon.
  function open(p) {
    if (appSettings().openInBrowser) { closeSplash(); return openBrowser(p); }
    const url = local(p);
    if (main && !main.isDestroyed()) {
      if (main.studioUrl !== url) main.loadURL(url);
      if (main.isMinimized()) main.restore();
      main.show();
      main.focus();
    } else {
      create(url, { isMain: true });
    }
    app.focus({ steal: true });
  }

  // After Start Studio: pages showing "off air" load their page again.
  function reloadOffAir() {
    for (const w of pageWindows()) {
      if (w.studioUrl && w.webContents.getURL().startsWith('file:')) w.loadURL(w.studioUrl);
    }
  }

  function closeAll() { for (const w of pageWindows()) w.close(); }

  // Quitting takes Studio off air, so ⌘Q mid-stream asks first: closing the windows keeps it
  // running in the menu bar.
  async function quit() {
    if (!isOnAir()) return app.quit();
    const { response } = await dialog.showMessageBox(current() || undefined, {
      type: 'warning', buttons: ['Close Windows', 'Quit', 'Cancel'], defaultId: 0, cancelId: 2,
      message: 'Quit FirstPass Studio?',
      detail: 'Quitting takes Studio off air: the OBS graphics and Stream Deck buttons stop working. Close the windows instead to keep Studio running in the menu bar.',
    });
    if (response === 0) closeAll();
    else if (response === 1) app.quit();
  }

  // After Stop Studio: open pages say Studio is off air rather than failing quietly.
  function showOffAir() {
    for (const w of pageWindows()) {
      if (isStudio(w.webContents.getURL())) w.loadFile(path.join(__dirname, 'offair.html'), { query: { to: w.studioUrl, on: '' } });
    }
  }

  // ─── The app menu (the bar at the top of the screen while a window is in front) ──
  const current = () => { const w = BrowserWindow.getFocusedWindow(); return w && !w.isDestroyed() && !isSplash(w) ? w : null; };

  function refreshMenu() {
    const go = p => ({ click: () => { const w = current(); if (w && !appSettings().openInBrowser) w.loadURL(local(p)); else open(p); } });
    const w = current();
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {
        label: 'FirstPass Studio',
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { label: 'Close Studio Windows', accelerator: 'CmdOrCtrl+Alt+W', click: closeAll },
          { label: 'Quit FirstPass Studio', accelerator: 'CmdOrCtrl+Q', click: quit },
        ],
      },
      {
        label: 'File',
        submenu: [
          { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => create(local('/')) },
          { type: 'separator' },
          { label: 'Open in Browser', accelerator: 'CmdOrCtrl+Shift+O', enabled: !!w, click: () => { const c = current(); if (c) shell.openExternal(linkFor(c.studioUrl)); } },
          { label: 'Copy Page Link', accelerator: 'CmdOrCtrl+Shift+C', enabled: !!w, click: () => { const c = current(); if (c) clipboard.writeText(linkFor(c.studioUrl)); } },
          { type: 'separator' },
          { role: 'close' },
        ],
      },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          { type: 'separator' },
          { label: 'Back', accelerator: 'CmdOrCtrl+[', click: () => { const c = current(); if (c && c.webContents.navigationHistory.canGoBack()) c.webContents.navigationHistory.goBack(); } },
          { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: () => { const c = current(); if (c && c.webContents.navigationHistory.canGoForward()) c.webContents.navigationHistory.goForward(); } },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
          { role: 'toggleDevTools' },
        ],
      },
      {
        label: 'Go',
        submenu: [
          { label: 'Studio Home', accelerator: 'CmdOrCtrl+1', ...go('/') },
          { label: 'Scoreboard Control', accelerator: 'CmdOrCtrl+2', ...go('/control.html') },
          { label: 'Competition Setup', accelerator: 'CmdOrCtrl+3', ...go('/setup.html') },
          { label: 'Athlete Photos', accelerator: 'CmdOrCtrl+4', ...go('/athletes.html') },
          { label: 'Stream Deck API', accelerator: 'CmdOrCtrl+5', ...go('/api.html') },
        ],
      },
      { role: 'windowMenu' },
    ]));
  }
  return { open, reloadOffAir, showOffAir, refreshMenu, showSplash, closeSplash, splashStatus };
};
