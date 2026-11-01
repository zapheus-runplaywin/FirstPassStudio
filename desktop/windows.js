// FirstPass Studio - the Mac app's own windows.
//
// Studio's pages (home, control, output, setup, athletes, API docs) open in the app's own window
// rather than the browser: no address bar, tabs or bookmarks, the Studio header doubles as
// the title bar, and the app shows in the Dock and the app switcher while a window is open.
// Links that open a new tab on Studio (a preview, the setup page) open another app window;
// links to anywhere else (PlayHQ, GitHub) open in the browser. "Open in Browser" in the File
// menu opens the page on show in the browser.
//
// Studio is on air only while one of these windows is open: opening one starts it (main.js) and
// closing the last one takes it off air, after asking if it is on air.

'use strict';

const { app, BrowserWindow, Menu, shell, clipboard, screen, dialog, protocol, nativeTheme } = require('electron');
const fs = require('fs');
const path = require('path');
// The Studio pages, in tab order, shared with the tab bar on every page (public/studiobar.js).
const { STUDIO_PAGES: TABS } = require('../public/studiobar.js');

// The pages with the Studio header (body class "fp"); everything else (the overlays, the
// debug log) gets a normal title bar.
const STUDIO_PAGES = new Set(TABS.flatMap(p => [p.href, ...(p.also || [])]));

// Room for the window buttons (red, yellow, green) at the left of the Studio header, which
// becomes the title bar: drag it to move the window, double-click it to zoom.
const HEADER_CSS = `
  .fp-bar { padding-left: 92px !important; -webkit-app-region: drag; -webkit-user-select: none; user-select: none; }
  .fp-bar a, .fp-bar button, .fp-bar input, .fp-bar select { -webkit-app-region: no-drag; }
`;

// The app's own pages (the splash, What's new, Back up settings, off air) and the logo and font
// they use, from inside the app's archive. They're served as studio://app/desktop/... rather than
// file://, since the shipped app's fuses (package.json) leave file:// as a browser has it, which
// can't read inside app.asar: the pages failed to load, so the splash had no logo and What's new
// never opened. Only files in desktop/ and public/ are served.
const APP_ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
protocol.registerSchemesAsPrivileged([{ scheme: 'studio', privileges: { standard: true, secure: true } }]);
// Answers studio:// from the first page loaded on. Set up then, not on app.whenReady: main.js's own
// whenReady (start, which can open What's new straight away) runs first, and a page asked for
// before this was set up never arrived, so What's new hung at launch.
let serving = false;
function serve() {
  if (serving) return;
  serving = true;
  protocol.handle('studio', async req => {
    const rel = path.normalize(decodeURIComponent(new URL(req.url).pathname)).replace(/^[/\\]+/, '');
    if (!/^(desktop|public)[/\\]/.test(rel)) return new Response('Not found', { status: 404 });
    try {
      return new Response(await fs.promises.readFile(path.join(APP_ROOT, rel)), { headers: { 'content-type': TYPES[path.extname(rel).toLowerCase()] || 'application/octet-stream' } });
    } catch { return new Response('Not found', { status: 404 }); }
  });
}
// Loads one of the pages above in a window.
const loadPage = (win, page, query = {}) => { serve(); return win.loadURL(`studio://app/desktop/${page}?${new URLSearchParams(query)}`); };
const isAppPage = u => u.startsWith('studio:');

module.exports = function studioWindows({ port, linkHost, appSettings, saveAppSetting, log, isOnAir, onWindowOpened, onAllClosed }) {
  const local = p => `http://localhost:${port}${p}`;

  // ─── Page zoom ──────────────────────────────────────────────────────────
  // Like Safari's: one level for every Studio window, in steps, remembered on this Mac (pageZoom in the app's
  // settings). The View menu shows it, the bar on every page shows a chip while it isn't 100% (a click on it puts
  // it back, by setting #zoom=100 on the page, caught below), and a pinch on the trackpad or ⌃ + the wheel steps
  // it (zoom-changed). Actual Size is ⌘⌥0, since ⌘0 is the Docs tab.
  const ZOOM_STEPS = [50, 67, 75, 85, 100, 115, 125, 150, 175, 200];
  let zoomPct = ZOOM_STEPS.includes(Number(appSettings().pageZoom)) ? Number(appSettings().pageZoom) : 100;
  const tellZoom = wc => wc.executeJavaScript(`document.dispatchEvent(new CustomEvent('studio-zoom', { detail: ${zoomPct} }))`, true).catch(() => {});
  function setZoom(pct) {
    zoomPct = ZOOM_STEPS.includes(pct) ? pct : 100;
    saveAppSetting('pageZoom', zoomPct);
    for (const w of pageWindows()) { w.webContents.setZoomFactor(zoomPct / 100); tellZoom(w.webContents); }
    refreshMenu();
  }
  const stepZoom = dir => setZoom(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, ZOOM_STEPS.indexOf(zoomPct) + dir))]);
  // A new page in a Studio window: at the level in use, and told it so the bar can show the chip.
  function applyZoom(wc) {
    wc.setZoomFactor(zoomPct / 100);
    tellZoom(wc);
  }
  // A page on this Studio: localhost, or the .local name the Studio links use.
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
  let quitting = false; // quitting closes every window without asking again
  // Quitting, or installing an update (main.js calls it then, since macOS's updater closes the
  // windows before the app is told it's quitting): no window asks before it closes. false: the
  // install failed and the app carries on.
  function setQuitting(on = true) {
    quitting = on;
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.confirmedClose = on;
  }
  app.on('before-quit', () => setQuitting());

  // Closing the last window takes Studio off air, so on air it asks first: mid-stream that
  // would stop the graphics and the Stream Deck.
  const closingGoesOffAir = () => isOnAir();
  // Asks without blocking (a blocking dialog inside a window's close can lock the app up).
  async function confirmOffAir(parent) {
    const { response } = await dialog.showMessageBox(parent || undefined, {
      type: 'warning', buttons: ['Take Off Air', 'Cancel'], defaultId: 1, cancelId: 1,
      message: 'Take Studio off air?',
      detail: 'Studio only runs while a Studio window is open. Closing the last one stops the graphics and Stream Deck buttons until Studio is opened again.',
    });
    return response === 0 && !quitting;
  }

  // ─── Splash ─────────────────────────────────────────────────────────────
  // The 1P Studio logo, shown while Studio starts from off air (Open Studio or a page in the menu
  // bar icon). It stays up for at least SPLASH_MIN so it doesn't flash, then closes as Studio's
  // first window shows. It never stays longer than SPLASH_MAX, whatever happens.
  const SPLASH_MIN = 1500, SPLASH_MAX = 30000;
  let splash = null, splashDone = Promise.resolve();
  // The splash and small panels (Export settings) aren't Studio pages: they don't put the app in
  // the Dock, take the app menu or keep Studio on air.
  const isSplash = w => w && (w.isSplash || w.isPanel);
  // Every window but the splash and panels.
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
    loadPage(win, 'splash.html', { version: app.getVersion() });
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

  // ─── Export settings ────────────────────────────────────────────────────
  // Asks for notes to put at the top of the backup's summary, and whether to include the media
  // folder (mediaLabel says how big it is; none: no media to ask about). Resolves with
  // { notes, media }, or null if cancelled or closed.
  function askExport({ mediaLabel = '' } = {}) {
    const win = new BrowserWindow({
      width: 520, height: mediaLabel ? 420 : 380, center: true, resizable: false, minimizable: false, maximizable: false,
      fullscreenable: false, show: false, backgroundColor: '#0F172A', title: 'Back up settings',
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    win.isPanel = true;
    win.once('ready-to-show', () => { win.show(); app.focus({ steal: true }); });
    loadPage(win, 'export.html', { media: mediaLabel });
    return new Promise(resolve => {
      win.on('closed', () => resolve(null));
      win.webContents.once('did-finish-load', () => {
        win.webContents.executeJavaScript('window.choice', true)
          .then(choice => { resolve(choice && typeof choice === 'object' ? { notes: String(choice.notes || '').slice(0, 5000), media: !!choice.media } : null); })
          .catch(() => resolve(null))
          .finally(() => { if (!win.isDestroyed()) win.close(); });
      });
    });
  }

  // ─── What's new ─────────────────────────────────────────────────────────
  // The changes since the version last opened (whatsnew.js), shown once after an update. A panel,
  // so it doesn't put Studio on air. recent: the latest releases, from the menu bar. Resolves 'open' (Open Studio) or null (Close, or closed).
  let whatsNew = null;
  // Each step is logged (app.log): on the Mac it opened neither at launch nor from the menu.
  function showWhatsNew(releases, { recent = false } = {}) {
    if (whatsNew && !whatsNew.isDestroyed()) {
      log(`What's new: already open (${whatsNew.isVisible() ? 'showing' : 'not showing yet'}), bringing it to the front`);
      whatsNew.show();
      whatsNew.focus();
      app.focus({ steal: true });
      return Promise.resolve(null);
    }
    const win = whatsNew = new BrowserWindow({
      width: 560, height: 560, center: true, resizable: true, minWidth: 420, minHeight: 320, minimizable: false,
      maximizable: false, fullscreenable: false, show: false, backgroundColor: '#0F172A', title: "What's new",
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    win.isPanel = true;
    // Links in a change's title (there shouldn't be any) never open in the panel.
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', e => e.preventDefault());
    const showIt = why => {
      if (win.isDestroyed() || win.isVisible()) return;
      log(`What's new: showing (${why})`);
      win.show();
      app.focus({ steal: true });
    };
    win.once('ready-to-show', () => showIt('ready'));
    // In case the page never says it's ready to show, show it anyway.
    setTimeout(() => showIt('not ready after 3 s'), 3000);
    win.webContents.on('did-fail-load', (e, code, desc, url, isMainFrame) => { if (isMainFrame) log(`What's new couldn't load ${url}: ${desc}`); });
    win.webContents.on('render-process-gone', (e, d) => log(`What's new page stopped (${d.reason})`));
    win.webContents.on('console-message', e => { if (e.level === 'error') log(`What's new page: ${e.message}`); });
    log(`What's new: opening, ${releases.length} version${releases.length === 1 ? '' : 's'}`);
    loadPage(win, 'whatsnew.html');
    return new Promise(resolve => {
      win.on('closed', () => { if (whatsNew === win) whatsNew = null; log("What's new closed"); resolve(null); });
      win.webContents.once('did-finish-load', () => {
        win.webContents.executeJavaScript(`show(${JSON.stringify(releases)}, ${JSON.stringify(app.getVersion())}, ${recent}); window.choice`, true)
          .then(choice => { log(`What's new: ${choice === 'open' ? 'Open Studio' : 'Close'}`); resolve(choice === 'open' ? 'open' : null); })
          .catch(err => { log(`What's new couldn't list the changes: ${String(err && err.message).split('\n')[0]}`); resolve(null); })
          .finally(() => { if (!win.isDestroyed()) win.close(); });
      });
    });
  }

  // ─── Dock ───────────────────────────────────────────────────────────────
  // A menu bar app (LSUIElement) until a window opens: then it is in the Dock and the app
  // switcher like any app, and back to just the menu bar icon when the last one closes.
  function refreshDock() {
    // Never while quitting: changing the Dock as the windows close can stop the app quitting.
    if (process.platform !== 'darwin' || quitting) return;
    if (pageWindows().length) app.dock.show().catch(() => {});
    else app.dock.hide();
  }

  // ─── Windows ────────────────────────────────────────────────────────────
  function create(url, { isMain = false } = {}) {
    const studioPage = STUDIO_PAGES.has(new URL(url).pathname);
    const saved = isMain && appSettings().windowBounds;
    // The popped-out preview starts at 16:9 (it fits the scene to whatever size it's made).
    const popout = new URL(url).pathname === '/preview.html';
    // A source or page preview (PVW, Preview) starts at half size, each one a step down and right of
    // the last so a few can be laid out on one screen.
    const pvw = new URL(url).pathname === '/pvw.html';
    const step = pvw ? 30 * (BrowserWindow.getAllWindows().filter(w => !w.isDestroyed() && w.isPvw).length % 10) : 0;
    const pvwBounds = () => {
      const a = screen.getPrimaryDisplay().workArea;
      return { width: 960, height: 540, useContentSize: true, x: a.x + 40 + step, y: a.y + 40 + step };
    };
    const bounds = saved && onScreen(saved) ? saved : popout ? { width: 1280, height: 720, useContentSize: true } : pvw ? pvwBounds() : { width: 1280, height: 860 };
    const win = new BrowserWindow({
      ...bounds,
      minWidth: popout || pvw ? 320 : 560, minHeight: popout || pvw ? 180 : 400,
      title: popout ? 'Scene View · FirstPass Studio' : 'FirstPass Studio',
      // The page background in the theme in use (studio.css --fp-gray), so nothing flashes white while it loads;
      // overlays are see-through: show them on dark.
      backgroundColor: studioPage ? (nativeTheme.shouldUseDarkColors ? '#0B1220' : '#F8FAFC') : '#1E293B',
      show: false,
      // The Studio header is the title bar; the window buttons sit inside it.
      titleBarStyle: studioPage ? 'hiddenInset' : 'default',
      trafficLightPosition: { x: 18, y: 26 },
      // Autoplay with sound: the Output page's Scene View plays the scene's sound while no video output is on.
      // The popped-out Scene View keeps playing at full speed behind other windows, as the outputs do: a
      // throttled one stopped following the scene (a sequence played from the Output page) until it was reopened.
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true, autoplayPolicy: 'no-user-gesture-required', backgroundThrottling: !popout },
    });
    win.studioUrl = url;
    win.isPvw = pvw;
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
      if (isStudio(to) || isAppPage(to)) return;
      e.preventDefault();
      if (/^https?:|^mailto:/.test(to)) shell.openExternal(to);
    });
    // A page with unsaved changes (Competitions setup) blocks leaving it; Electron would cancel
    // quietly, so ask. preventDefault here means leave anyway.
    wc.on('will-prevent-unload', e => {
      const choice = dialog.showMessageBoxSync(win, {
        type: 'warning', buttons: ['Leave without saving', 'Stay'], defaultId: 1, cancelId: 1,
        message: "This page has changes that aren't saved.",
        detail: 'Stay to save them, or leave and lose them.',
      });
      if (choice === 0) e.preventDefault();
      // Staying while an update installs: the install waits, and gives up (main.js says so).
      else if (quitting) setQuitting(false);
    });
    wc.on('did-navigate', (e, to) => { if (isStudio(to)) win.studioUrl = to; });
    wc.on('did-navigate-in-page', (e, to) => {
      // The bar's zoom chip asks for 100% with #zoom=100 (the page has no other way to reach the app).
      if (/#zoom=100$/.test(to)) { setZoom(100); wc.executeJavaScript('history.replaceState(null, "", location.pathname + location.search)', true).catch(() => {}); return; }
      if (isStudio(to)) win.studioUrl = to;
    });
    if (studioPage) {
      wc.on('did-finish-load', () => { if (isStudio(wc.getURL())) applyZoom(wc); });
      wc.on('zoom-changed', (e, dir) => stepZoom(dir === 'in' ? 1 : -1));
    }
    // Off air (or still starting): a page saying so, which tries again by itself.
    wc.on('did-fail-load', (e, code, desc, failed, isMainFrame) => {
      if (!isMainFrame || code === -3 /* aborted: a new page took over */ || !isStudio(failed)) return;
      log(`Couldn't load ${failed}: ${desc}`);
      loadPage(win, 'offair.html', { to: failed, on: isOnAir() ? '1' : '' });
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
    win.on('close', e => {
      if (quitting || win.confirmedClose || pageWindows().some(w => w !== win) || !closingGoesOffAir()) return;
      e.preventDefault();
      if (win.asking) return;
      win.asking = true;
      confirmOffAir(win).then(yes => {
        win.asking = false;
        if (yes && !win.isDestroyed()) { win.confirmedClose = true; win.close(); }
      });
    });
    win.on('closed', () => setImmediate(() => { refreshDock(); if (!pageWindows().length && !quitting) onAllClosed(); }));
    win.loadURL(url);
    refreshDock();
    onWindowOpened();
    return win;
  }

  const onScreen = b => screen.getAllDisplays().some(d => {
    const a = d.workArea;
    return b.x < a.x + a.width - 80 && b.x + b.width > a.x + 80 && b.y >= a.y - 20 && b.y < a.y + a.height - 80;
  });

  // Opens a Studio page (a path such as /control.html) in the app's window, reusing the main
  // one.
  function open(p) {
    const url = local(p);
    if (main && !main.isDestroyed()) {
      if (main.studioUrl !== url) main.loadURL(url);
      closeSplash();
      if (main.isMinimized()) main.restore();
      main.show();
      main.focus();
    } else {
      create(url, { isMain: true });
    }
    app.focus({ steal: true });
  }

  // The user guide (/guide/) in a window of its own, so it reads beside the page it's about; the one already open
  // comes to the front.
  function openGuide() {
    const url = local('/guide/');
    const open = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.studioUrl && new URL(w.studioUrl).pathname.startsWith('/guide/'));
    if (open) { if (open.isMinimized()) open.restore(); open.show(); open.focus(); } else create(url);
    app.focus({ steal: true });
  }

  // Once Studio is on air: pages showing "off air" load their page again.
  function reloadOffAir() {
    for (const w of pageWindows()) {
      if (w.studioUrl && isAppPage(w.webContents.getURL())) w.loadURL(w.studioUrl);
    }
  }

  // Closes every Studio window, which takes Studio off air; asks once first if it is on air,
  // unless already confirmed (Stop Studio in the menu bar).
  function closeAll({ confirmed = false } = {}) {
    const all = pageWindows();
    if (!all.length) return;
    const closeThem = () => { for (const w of all) if (!w.isDestroyed()) { w.confirmedClose = true; w.close(); } };
    if (confirmed || !closingGoesOffAir()) return closeThem();
    confirmOffAir(current()).then(yes => { if (yes) closeThem(); });
  }

  // Quitting takes Studio off air, so ⌘Q mid-stream asks first.
  async function quit() {
    if (!isOnAir()) return app.quit();
    const { response } = await dialog.showMessageBox(current() || undefined, {
      type: 'warning', buttons: ['Quit', 'Cancel'], defaultId: 1, cancelId: 1,
      message: 'Quit FirstPass Studio?',
      detail: 'Quitting takes Studio off air: the graphics, outputs and Stream Deck buttons stop working.',
    });
    if (response === 0) app.quit();
  }

  // After Stop Studio: open pages say Studio is off air rather than failing quietly.
  function showOffAir() {
    for (const w of pageWindows()) {
      if (isStudio(w.webContents.getURL())) loadPage(w, 'offair.html', { to: w.studioUrl, on: '' });
    }
  }

  // ─── The app menu (the bar at the top of the screen while a window is in front) ──
  const current = () => { const w = BrowserWindow.getFocusedWindow(); return w && !w.isDestroyed() && !isSplash(w) ? w : null; };

  // Before the menu loads another page in a window: a page with unsaved changes
  // (window.studioBeforeLeave, Competitions setup) asks Save, Don't save or Cancel first.
  function leaving(w, then) {
    w.webContents.executeJavaScript('window.studioBeforeLeave ? window.studioBeforeLeave() : true', true)
      .catch(() => true)
      .then(ok => { if (ok && !w.isDestroyed()) then(); });
  }

  function refreshMenu() {
    const go = p => ({ click: () => { const w = current(); if (w) leaving(w, () => w.loadURL(local(p))); else open(p); } });
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
          { label: 'Close Studio Windows', accelerator: 'CmdOrCtrl+Alt+W', click: () => closeAll() },
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
          { label: 'Back', accelerator: 'CmdOrCtrl+[', click: () => { const c = current(); if (c && c.webContents.navigationHistory.canGoBack()) leaving(c, () => c.webContents.navigationHistory.goBack()); } },
          { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: () => { const c = current(); if (c && c.webContents.navigationHistory.canGoForward()) leaving(c, () => c.webContents.navigationHistory.goForward()); } },
          { type: 'separator' },
          { label: `Zoom: ${zoomPct}%`, enabled: false },
          { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: () => stepZoom(1) },
          { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => stepZoom(-1) },
          { label: 'Actual Size', accelerator: 'CmdOrCtrl+Alt+0', enabled: zoomPct !== 100, click: () => setZoom(100) },
          { type: 'separator' },
          { role: 'togglefullscreen' },
          // Developer tools only from a checkout (npm run app): the shipped app has no use for them.
          ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]),
        ],
      },
      {
        label: 'Go',
        // ⌘1, ⌘2... in tab order, the same list as the tab bar on every page.
        submenu: TABS.map((p, i) => ({ label: p.label, accelerator: `CmdOrCtrl+${(i + 1) % 10}`, ...go(p.also && p.also[0] === '/' ? '/' : p.href) })),
      },
      { role: 'windowMenu' },
      // The Mac's Help menu (it brings the menu search box with it).
      { role: 'help', submenu: [{ label: 'FirstPass Studio User Guide', click: openGuide }] },
    ]));
  }
  return { open, openGuide, reloadOffAir, showOffAir, refreshMenu, closeAll, showSplash, closeSplash, splashStatus, askExport, showWhatsNew, setQuitting, isQuitting: () => quitting };
};
// For the app's hidden pages opened elsewhere (desktop/soundtap.js).
module.exports.loadPage = loadPage;
