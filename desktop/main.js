// FirstPass Studio - the Mac app.
//
// A menu bar app around the helper (server.js): it opens Studio's pages in its own window
// (windows.js), or the browser if chosen, and runs the helper in the background only while a
// Studio window is open. Opening a window puts Studio on air; closing the last one takes it off
// air, so nothing talks to PlayHQ while Studio isn't on screen. The Output page and the Stream Deck use the
// links on the home page (the Mac's .local name, or localhost).
//
// Settings are saved in ~/Library/Application Support/FirstPass Studio (datadir.js), which
// installing or updating the app never touches. Updates download in the background and
// are installed when the app quits, so they never interrupt a stream.

'use strict';

const { app, Tray, Menu, shell, dialog, nativeImage, utilityProcess, clipboard } = require('electron');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { linkHost } = require('../linkhost');
const { INSTALL_TIMEOUT } = require('./updates');

const APP_DIR = path.join(__dirname, '..');
// Studio's Stream Deck plugin, packed into the app by its build (plugins/studio-deck).
const STREAMDECK_PLUGIN = path.join(APP_DIR, 'plugins', 'studio-deck', 'dist', 'com.runplaywin.firstpass-studio.streamDeckPlugin');
// Electron names this folder after productName: ~/Library/Application Support/FirstPass Studio,
// the same folder the helper uses when run from the repository.
const DATA_DIR = app.getPath('userData');
const LOG_FILE = path.join(DATA_DIR, 'logs', 'app.log');

function log(message) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${message}\n`);
  } catch { /* nowhere to write */ }
}

// Plays VP9 videos with Chromium's own decoder, not the Mac's hardware one: the hardware decoder
// drops a WebM's transparency (the alpha the scene's converted ProRes clips carry). H.264 and HEVC
// still use the hardware.
app.commandLine.appendSwitch('disable_accelerated_vp9_decode');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Opening the app again by hand opens Studio (and puts it on air).
  app.on('second-instance', () => openPage('/'));
  app.whenReady().then(start);
}

// This computer's settings from config.json (the app's defaults, then the data folder's).
function machineConfig() {
  const read = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };
  return { ...read(path.join(APP_DIR, 'config.json')), ...read(path.join(DATA_DIR, 'config.json')) };
}
const MACHINE = machineConfig();
const PORT = Number(MACHINE.port) || 8080;
// Links opened and copied from the menu use the Mac's Bonjour name (linkhost.js), the same as
// the home page shows. The app checks the helper on localhost, which always works.
const HOST = linkHost(MACHINE.linkHost);
const pageUrl = p => `http://${HOST}:${PORT}${p}`;
// Opens a page in the browser; on localhost if the .local name doesn't answer (no network).
const openInBrowser = p => require('dns').lookup(HOST, err => shell.openExternal(err ? `http://localhost:${PORT}${p}` : pageUrl(p)));
// Opens a page in the app's own window (or the browser, if ticked in the menu), putting Studio
// on air first. Nothing opens if Studio can't start (something else has the port).
async function openPage(p) {
  if (!helper) {
    if (!await startHelperChecked()) return;
    await waitUntilRunning();
  }
  windows.open(p);
}

// Whether something already answers on the port (another copy, or server.js run by hand).
function answering() {
  return new Promise(resolve => {
    const req = http.get(`http://localhost:${PORT}/api/version`, { timeout: 1500 }, res => { res.resume(); resolve(true); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// The app's own settings (not the helper's): whether the helper starts at login.
const APP_SETTINGS = path.join(DATA_DIR, 'app-settings.json');
function appSettings() { try { return JSON.parse(fs.readFileSync(APP_SETTINGS, 'utf8')); } catch { return {}; } }
function saveAppSetting(key, value) {
  try { fs.writeFileSync(APP_SETTINGS, JSON.stringify({ ...appSettings(), [key]: value }, null, 2) + '\n'); } catch (err) { log(`Couldn't save ${key}: ${err.message}`); }
}

const windows = require('./windows')({
  port: PORT, linkHost: HOST, appSettings, saveAppSetting, log, openBrowser: openInBrowser,
  isOnAir: () => wanted && !!helper,
  // A window opened another way (File > New Window, a link opening a new tab) puts Studio on air too.
  onWindowOpened: () => { if (!helper && !wanted) startHelperChecked(); },
  // The last window closed: Studio goes off air, unless pages open in the browser instead
  // (the app can't see browser tabs, so then Stop Studio takes it off air).
  onAllClosed: () => { if (!appSettings().openInBrowser) { log('Last Studio window closed'); stopHelper(); } },
});

// The scene full screen on the Mac's displays (chroma, or fill and key), set up on the Output page.
// Made once the app is ready, since it needs the screen module.
let outputs = null;

// ─── The helper ─────────────────────────────────────────────────────────────
// wanted: whether it should be running (a Studio window is open, or Start Studio was chosen with
// pages in the browser), so a pending restart doesn't bring back a helper that was just stopped.
let helper = null, wanted = false, status = 'Studio is off air', quitting = false, restarts = 0, tray = null;

function startHelper() {
  status = 'Starting…'; refreshMenu();
  const child = helper = utilityProcess.fork(path.join(APP_DIR, 'server.js'), [], {
    cwd: APP_DIR,
    serviceName: 'FirstPass Studio helper',
    stdio: 'ignore',
    env: { ...process.env, FIRSTPASS_DATA_DIR: DATA_DIR, FIRSTPASS_PACKAGED: app.isPackaged ? '1' : '' },
  });
  outputs?.attach(child);
  const started = Date.now();
  child.on('spawn', async () => {
    for (let i = 0; i < 40 && helper === child; i++) {
      if (await answering()) { status = `Studio is on air at ${HOST}:${PORT}`; refreshMenu(); log('Helper running'); windows.reloadOffAir(); return; }
      await new Promise(r => setTimeout(r, 250));
    }
  });
  child.on('exit', code => {
    outputs?.detach(child);
    if (helper === child) helper = null;
    if (quitting || child.restarting || child.stopping) return;
    log(`Helper stopped (code ${code})`);
    // Keep it running: restart straight away, but give up if it keeps failing at start
    // (the debug log says why).
    if (Date.now() - started > 60000) restarts = 0;
    if (++restarts <= 5) { status = 'Restarting…'; refreshMenu(); setTimeout(() => { if (wanted && !helper) startHelper(); }, 1000); return; }
    status = 'Studio stopped: see the debug log'; refreshMenu();
    dialog.showMessageBox({ type: 'error', message: 'FirstPass Studio stopped', detail: 'Studio stopped several times in a row. Open the debug log from the menu bar icon to see why, then choose Start Studio.' });
  });
}

// Starts the helper unless something else already answers on the port (another copy, or
// server.js run by hand from the repository). Resolves true if it started.
async function startHelperChecked() {
  if (helper) return true;
  status = 'Starting…'; refreshMenu();
  while (await answering()) {
    windows.closeSplash(true); // or it would sit over the dialog
    const { response } = await dialog.showMessageBox({
      type: 'warning', buttons: ['Try again', 'Cancel'], defaultId: 0, cancelId: 1,
      message: `Something is already using port ${PORT}`,
      detail: 'FirstPass Studio may already be running from a copy of the repository (npm start). Stop that, then choose Try again.',
    });
    if (response === 1) { status = 'Studio is off air'; refreshMenu(); return false; }
  }
  if (helper) return true;
  restarts = 0; wanted = true;
  startHelper();
  return true;
}

// Waits (up to about 10 s) for the helper to answer, so a page opened straight after starts loading.
async function waitUntilRunning() {
  for (let i = 0; i < 40 && helper; i++) {
    if (await answering()) return;
    await new Promise(r => setTimeout(r, 250));
  }
}

// Stops the helper: nothing talks to PlayHQ, and the pages and the Stream Deck get no answer
// until a Studio window opens again.
function stopHelper() {
  wanted = false;
  if (!helper) { status = 'Studio is off air'; refreshMenu(); return; }
  const child = helper;
  child.stopping = true;
  helper = null;
  child.kill();
  status = 'Studio is off air'; refreshMenu();
  windows.showOffAir();
  log('Helper stopped');
}

// Stop Studio in the menu bar: closes the Studio windows (without asking) and goes off air.
function stopStudio() {
  windows.closeAll({ confirmed: true });
  stopHelper();
}

function restartHelper() {
  restarts = 0;
  if (!helper) return startHelper();
  const child = helper;
  child.restarting = true;
  child.once('exit', () => setTimeout(() => { if (wanted && !helper) startHelper(); }, 300));
  child.kill();
}

// ─── Menu bar ───────────────────────────────────────────────────────────────

function refreshMenu() {
  if (!tray) return;
  const login = app.getLoginItemSettings().openAtLogin;
  const running = !!helper;
  const pending = !helper && wanted && status === 'Restarting…';
  tray.setToolTip(`FirstPass Studio: ${status}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `FirstPass Studio ${app.getVersion()}`, enabled: false },
    { label: status, enabled: false },
    running || pending
      ? { label: 'Stop Studio', click: stopStudio }
      : { label: 'Start Studio', enabled: status !== 'Starting…', click: () => openPage('/') },
    { type: 'separator' },
    { label: 'Open Studio', click: () => openPage('/') },
    { label: 'Scoreboard control', click: () => openPage('/control.html') },
    { label: 'Competition setup', click: () => openPage('/setup.html') },
    { label: 'Copy the Studio link', click: () => clipboard.writeText(pageUrl('/')) },
    // Opening the file hands it to the Stream Deck app, which installs or updates the plugin.
    { label: 'Install the Stream Deck plugin', enabled: fs.existsSync(STREAMDECK_PLUGIN), click: () => shell.openPath(STREAMDECK_PLUGIN) },
    { type: 'separator' },
    { label: 'Open the settings folder', click: () => shell.openPath(DATA_DIR) },
    { label: 'Open the debug log', click: () => shell.openPath(path.join(DATA_DIR, 'logs', 'playhq-graphics.log')) },
    { label: 'Restart Studio', enabled: running, click: restartHelper },
    { type: 'separator' },
    { label: 'Open at login', type: 'checkbox', checked: login, click: item => { app.setLoginItemSettings({ openAtLogin: item.checked }); refreshMenu(); } },
    { label: 'Open Studio at login', type: 'checkbox', checked: !!appSettings().startHelperAtLogin, enabled: login, click: item => { saveAppSetting('startHelperAtLogin', item.checked); refreshMenu(); } },
    // With the other settings, away from the page links, so it isn't ticked by accident.
    { label: 'Open pages in the browser instead of the app window', type: 'checkbox', checked: !!appSettings().openInBrowser, click: item => { saveAppSetting('openInBrowser', item.checked); log(`Open pages in the browser: ${item.checked ? 'on' : 'off'}`); refreshMenu(); } },
    updateMenuItem(),
    { type: 'separator' },
    { label: 'Quit FirstPass Studio', click: () => app.quit() },
  ]));
}

// ─── Updates ────────────────────────────────────────────────────────────────
// From GitHub Releases (updates.js). A new version downloads in the background and is installed
// the next time the app quits; "Restart to update" in the menu installs the newest one straight away.
let updates = null;
function appUpdates() {
  if (!updates && app.isPackaged) {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.logger = { info: m => log(`[update] ${m}`), warn: m => log(`[update] ${m}`), error: m => log(`[update] ${m}`), debug: () => {} };
    // Logs a failed check or download in full; the dialog below keeps it short.
    autoUpdater.on('error', (err, detail) => log(`[update] ${detail || err.message}`));
    updates = require('./updates').createUpdates({ updater: autoUpdater, log, onChange: refreshMenu, onInstall: () => { quitting = true; } });
  }
  return updates;
}

function updateMenuItem() {
  const { ready, fetching, installing } = updates ? updates.state() : {};
  if (fetching) return { label: `Downloading ${fetching}…`, enabled: false };
  if (installing) return { label: `Installing ${ready}…`, enabled: false };
  if (ready) return { label: `Restart to update to ${ready}`, click: restartToUpdate };
  return { label: 'Check for updates', enabled: app.isPackaged, click: () => checkForUpdates(true) };
}

function restartToUpdate() {
  appUpdates().restartToUpdate().then(ok => {
    if (ok === false) dialog.showMessageBox({ type: 'warning', message: 'Couldn\'t install the update', detail: 'Try again, or quit FirstPass Studio to install it. The details are in the debug log.' });
  });
}

function checkForUpdates(byHand) {
  if (!appUpdates()) return;
  updates.check().then(r => {
    if (byHand && (!r || !r.isUpdateAvailable)) dialog.showMessageBox({ message: 'FirstPass Studio is up to date', detail: `Version ${app.getVersion()}` });
    else if (byHand) dialog.showMessageBox({ message: `Downloading version ${r.updateInfo.version}`, detail: 'It installs when you quit FirstPass Studio, or choose "Restart to update" from the menu bar icon once it has downloaded.' });
  }).catch(err => {
    if (byHand) dialog.showMessageBox({ type: 'warning', message: 'Couldn\'t check for updates', detail: updateErrorText(err) });
  });
}

// The updater's errors carry the whole HTTP response (headers and all); this is the part a
// person can act on. The full error is in the debug log.
function updateErrorText(err) {
  const status = err.statusCode || Number((/HttpError: (\d{3})/.exec(err.message) || [])[1]);
  if (status === 404) return 'The updates page on GitHub couldn\'t be found. The FirstPassStudio-releases repository needs to be public, with at least one published release.';
  if (status) return `GitHub answered with error ${status}. Try again in a few minutes. The details are in the debug log.`;
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|ERR_INTERNET_DISCONNECTED/.test(err.message)) return 'GitHub couldn\'t be reached. Check the Mac is online and try again.';
  return `${err.message.split('\n')[0]}\n\nThe details are in the debug log.`;
}

// ─── Start ──────────────────────────────────────────────────────────────────
async function start() {
  if (process.platform === 'darwin') app.dock.hide(); // a menu bar app (Info.plist LSUIElement does the same when installed)
  const icon = nativeImage.createFromPath(path.join(__dirname, 'trayTemplate.png'));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  outputs = require('./outputs')({ port: PORT, log });
  refreshMenu();
  windows.refreshMenu();
  log(`Starting ${app.getVersion()}, settings in ${DATA_DIR}`);

  // Opened at login, the app sits in the menu bar off air (nothing talks to PlayHQ) unless
  // "Open Studio at login" (startHelperAtLogin) is ticked. Opened by hand, it opens Studio,
  // which puts it on air, with the splash (the 1P Studio logo) showing until Studio's window opens.
  const atLogin = app.getLoginItemSettings().wasOpenedAtLogin;
  if (!atLogin) windows.showSplash();
  if (atLogin && !appSettings().startHelperAtLogin) {
    log('Opened at login: off air until Studio is opened');
  } else if (await startHelperChecked()) {
    await waitUntilRunning();
    windows.splashStatus(helper ? 'Studio is on air' : 'Still starting…', !!helper);
    await openPage('/');
  }
  checkForUpdates(false);
  setInterval(() => checkForUpdates(false), 6 * 60 * 60 * 1000);
}

app.on('window-all-closed', e => e.preventDefault()); // no windows: the app stays in the menu bar, off air
// Clicking the Dock icon with no window open opens Studio.
app.on('activate', (e, hasWindows) => { if (!hasWindows) openPage('/'); });
// Quitting always quits: the helper is stopped, and if anything still holds the app up after a
// few seconds (a window that won't close, an update install that hangs) it exits anyway.
// A downloaded update is handed to macOS's updater first (updates.js), which then quits the app
// and installs it; that can take a little longer.
let quitStarted = false;
app.on('before-quit', e => {
  if (quitStarted) return;
  quitStarted = quitting = true;
  log('Quitting');
  if (helper) { helper.stopping = true; helper.kill(); }
  const exitAfter = s => setTimeout(() => { log(`Still running ${s} s after Quit: exiting`); app.exit(0); }, s * 1000).unref();
  if (updates && updates.pending()) {
    e.preventDefault();
    updates.installOnQuit().then(ok => { if (!ok) app.exit(0); });
    exitAfter(INSTALL_TIMEOUT / 1000 + 5);
  } else {
    exitAfter(5);
  }
});
