// FirstPass Studio - the Mac app.
//
// A menu bar app around the same helper (server.js) the Start script runs: it starts the
// helper in the background, keeps it running, and opens the pages in the browser. OBS and
// the Stream Deck use http://localhost:8080 exactly as before.
//
// Settings are saved in ~/Library/Application Support/FirstPass Studio (datadir.js), which
// installing or updating the app never touches. Updates download in the background and
// are installed when the app quits, so they never interrupt a stream.

'use strict';

const { app, Tray, Menu, shell, dialog, nativeImage, utilityProcess, clipboard } = require('electron');
const fs = require('fs');
const http = require('http');
const path = require('path');

const APP_DIR = path.join(__dirname, '..');
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

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => openPage('/'));
  app.whenReady().then(start);
}

// The port from config.json (the app's defaults, then the data folder's).
function port() {
  const read = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };
  return Number({ ...read(path.join(APP_DIR, 'config.json')), ...read(path.join(DATA_DIR, 'config.json')) }.port) || 8080;
}
const PORT = port();
const pageUrl = p => `http://localhost:${PORT}${p}`;
const openPage = p => shell.openExternal(pageUrl(p));

// Whether something already answers on the port (the Start script, or another copy).
function answering() {
  return new Promise(resolve => {
    const req = http.get(pageUrl('/api/version'), { timeout: 1500 }, res => { res.resume(); resolve(true); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// ─── The helper ─────────────────────────────────────────────────────────────
let helper = null, status = 'Starting…', quitting = false, restarts = 0, tray = null;

function startHelper() {
  status = 'Starting…'; refreshMenu();
  const child = helper = utilityProcess.fork(path.join(APP_DIR, 'server.js'), [], {
    cwd: APP_DIR,
    serviceName: 'FirstPass Studio helper',
    stdio: 'ignore',
    env: { ...process.env, FIRSTPASS_DATA_DIR: DATA_DIR, FIRSTPASS_PACKAGED: app.isPackaged ? '1' : '' },
  });
  const started = Date.now();
  child.on('spawn', async () => {
    for (let i = 0; i < 40 && helper === child; i++) {
      if (await answering()) { status = `Running on localhost:${PORT}`; refreshMenu(); log('Helper running'); return; }
      await new Promise(r => setTimeout(r, 250));
    }
  });
  child.on('exit', code => {
    if (helper === child) helper = null;
    if (quitting || child.restarting) return;
    log(`Helper stopped (code ${code})`);
    // Keep it running: restart straight away, but give up if it keeps failing at start
    // (the debug log says why).
    if (Date.now() - started > 60000) restarts = 0;
    if (++restarts <= 5) { status = 'Restarting…'; refreshMenu(); setTimeout(startHelper, 1000); return; }
    status = 'Stopped: see the debug log'; refreshMenu();
    dialog.showMessageBox({ type: 'error', message: 'FirstPass Studio stopped', detail: 'The helper stopped several times in a row. Open the debug log from the menu bar icon to see why, then choose Restart.' });
  });
}

function restartHelper() {
  restarts = 0;
  if (!helper) return startHelper();
  const child = helper;
  child.restarting = true;
  child.once('exit', () => setTimeout(startHelper, 300));
  child.kill();
}

// ─── Menu bar ───────────────────────────────────────────────────────────────
let updateReady = null;

function refreshMenu() {
  if (!tray) return;
  const login = app.getLoginItemSettings().openAtLogin;
  tray.setToolTip(`FirstPass Studio: ${status}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `FirstPass Studio ${app.getVersion()}`, enabled: false },
    { label: status, enabled: false },
    { type: 'separator' },
    { label: 'Open Studio', click: () => openPage('/') },
    { label: 'Scoreboard control', click: () => openPage('/control.html') },
    { label: 'Competition setup', click: () => openPage('/setup.html') },
    { label: 'Copy the Studio link', click: () => clipboard.writeText(pageUrl('/')) },
    { type: 'separator' },
    { label: 'Open the settings folder', click: () => shell.openPath(DATA_DIR) },
    { label: 'Open the debug log', click: () => shell.openPath(path.join(DATA_DIR, 'logs', 'playhq-graphics.log')) },
    { label: 'Restart the helper', click: restartHelper },
    { type: 'separator' },
    { label: 'Open at login', type: 'checkbox', checked: login, click: item => { app.setLoginItemSettings({ openAtLogin: item.checked }); refreshMenu(); } },
    updateReady
      ? { label: `Restart to update to ${updateReady}`, click: () => { quitting = true; require('electron-updater').autoUpdater.quitAndInstall(); } }
      : { label: 'Check for updates', enabled: app.isPackaged, click: () => checkForUpdates(true) },
    { type: 'separator' },
    { label: 'Quit FirstPass Studio', click: () => app.quit() },
  ]));
}

// ─── Updates ────────────────────────────────────────────────────────────────
// From GitHub Releases (the publish setting in package.json). A new version downloads in
// the background and is installed the next time the app quits; "Restart to update" in the
// menu installs it straight away.
function checkForUpdates(byHand) {
  if (!app.isPackaged) return;
  const { autoUpdater } = require('electron-updater');
  autoUpdater.logger = { info: m => log(`[update] ${m}`), warn: m => log(`[update] ${m}`), error: m => log(`[update] ${m}`), debug: () => {} };
  autoUpdater.autoInstallOnAppQuit = true;
  if (!checkForUpdates.wired) {
    checkForUpdates.wired = true;
    autoUpdater.on('update-downloaded', info => { updateReady = info.version; refreshMenu(); });
  }
  autoUpdater.checkForUpdates().then(r => {
    if (byHand && (!r || !r.isUpdateAvailable)) dialog.showMessageBox({ message: 'FirstPass Studio is up to date', detail: `Version ${app.getVersion()}` });
    else if (byHand) dialog.showMessageBox({ message: `Downloading version ${r.updateInfo.version}`, detail: 'It installs when you quit FirstPass Studio, or choose "Restart to update" from the menu bar icon once it has downloaded.' });
  }).catch(err => {
    log(`[update] ${err.message}`);
    if (byHand) dialog.showMessageBox({ type: 'warning', message: 'Couldn\'t check for updates', detail: err.message });
  });
}

// ─── Start ──────────────────────────────────────────────────────────────────
async function start() {
  if (process.platform === 'darwin') app.dock.hide(); // a menu bar app (Info.plist LSUIElement does the same when installed)
  const icon = nativeImage.createFromPath(path.join(__dirname, 'trayTemplate.png'));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  refreshMenu();
  log(`Starting ${app.getVersion()}, settings in ${DATA_DIR}`);

  if (await answering()) {
    const { response } = await dialog.showMessageBox({
      type: 'warning', buttons: ['Try again', 'Quit'], defaultId: 0, cancelId: 1,
      message: `Something is already using port ${PORT}`,
      detail: 'FirstPass Studio may already be running from the Start script. Close that window, then choose Try again.',
    });
    if (response === 1) return app.quit();
    if (await answering()) return app.quit();
  }
  startHelper();
  if (!app.getLoginItemSettings().wasOpenedAtLogin) setTimeout(() => openPage('/'), 1500);
  checkForUpdates(false);
  setInterval(() => checkForUpdates(false), 6 * 60 * 60 * 1000);
}

app.on('window-all-closed', e => e.preventDefault()); // no windows: keep running in the menu bar
app.on('before-quit', () => { quitting = true; if (helper) helper.kill(); });
