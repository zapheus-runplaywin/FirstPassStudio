// FirstPass Studio - the Mac app.
//
// A menu bar app around the helper (server.js): it opens Studio's pages in its own window
// (windows.js), or the browser if chosen, and runs the helper in the background only while a
// Studio window is open. Opening a window puts Studio on air; closing the last one takes it off
// air, so nothing talks to PlayHQ while Studio isn't on screen. The Output page and the Stream Deck use the
// links on the Graphics page (the Mac's .local name, or localhost).
//
// Settings are saved in ~/Library/Application Support/FirstPass Studio (datadir.js), which
// installing or updating the app never touches, or in a folder in iCloud Drive picked from the
// menu (datalocation.js), in a subfolder named after this Mac. Updates download in the background and
// are installed when the app quits, so they never interrupt a stream.

'use strict';

const { app, Tray, Menu, shell, dialog, nativeImage, utilityProcess, clipboard } = require('electron');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { linkHost } = require('../linkhost');
const location = require('../datalocation');
const savefile = require('../savefile');
const { INSTALL_TIMEOUT } = require('./updates');
const whatsnew = require('./whatsnew');
const { unpacked } = require('../unpacked');

// server.js exits with this when its port is already taken (EXIT_PORT_IN_USE there).
const EXIT_PORT_IN_USE = 3;

const APP_DIR = path.join(__dirname, '..');
// Studio's Stream Deck plugin, packed into the app by its build (plugins/studio-deck).
const STREAMDECK_PLUGIN = unpacked(path.join(APP_DIR, 'plugins', 'studio-deck', 'dist', 'com.runplaywin.firstpass-studio.streamDeckPlugin'));
// Electron names this folder after productName: ~/Library/Application Support/FirstPass Studio,
// the same folder the helper uses when run from the repository. The logs and the app's own
// settings always stay here; the rest of the settings are here or in iCloud Drive (dataDir()).
const LOCAL_DIR = app.getPath('userData');
const dataDir = () => location.current(LOCAL_DIR).dataDir;
const LOG_FILE = path.join(LOCAL_DIR, 'logs', 'app.log');
// Whether this Mac had run the app before this launch (What's new isn't shown on a fresh install).
const USED_BEFORE = fs.existsSync(LOG_FILE) || fs.existsSync(path.join(LOCAL_DIR, 'app-settings.json'));
// The version the app last started as, from its log ("Starting 0.4.10, …"): what it's upgrading
// from, when app-settings.json has no record (the versions before What's new).
const LAST_STARTED = (() => {
  try {
    const fd = fs.openSync(LOG_FILE, 'r');
    const size = fs.fstatSync(fd).size, len = Math.min(size, 512 * 1024), buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    return whatsnew.lastStarted(buf.toString('utf8'));
  } catch { return null; }
})();

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
  return { ...read(path.join(APP_DIR, 'config.json')), ...read(path.join(dataDir(), 'config.json')) };
}
const MACHINE = machineConfig();
// Changes one of this computer's settings in the data folder's config.json (the app's own config.json keeps the defaults).
function setMachineConfig(key, value) {
  const file = path.join(dataDir(), 'config.json');
  const own = (() => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } })();
  try { savefile.writeJsonSync(file, { ...own, [key]: value }); log(`${key} is now ${JSON.stringify(value)}`); }
  catch (err) { log(`Couldn't save ${key} to config.json: ${err.message}`); dialog.showMessageBox({ type: 'error', message: `Couldn't save the setting`, detail: err.message }); }
}
const PORT = Number(MACHINE.port) || 8080;
// Links opened and copied from the menu use the Mac's Bonjour name (linkhost.js), the same as
// the Graphics page shows. The app checks the helper on localhost, which always works.
const HOST = linkHost(MACHINE.linkHost);
const pageUrl = p => `http://${HOST}:${PORT}${p}`;
// Opens a page in the app's own window, putting Studio on air first (with the splash, the
// 1P Studio logo, while it starts). Nothing opens if Studio can't start (something else has the port).
async function openPage(p) {
  if (!helper) {
    windows.showSplash();
    if (!await settingsReady() || !await startHelperChecked()) return windows.closeSplash(true);
    await waitUntilRunning();
    windows.splashStatus(helper ? 'Studio is on air' : 'Still starting…', !!helper);
  }
  windows.open(p);
  if (whatsNewLater) { const later = whatsNewLater; whatsNewLater = null; showWhatsNew(later); }
}

// Whether something already answers on the port (another copy, or server.js run by hand).
function answering() {
  return new Promise(resolve => {
    const req = http.get(`http://localhost:${PORT}/api/version`, { timeout: 1500 }, res => { res.resume(); resolve(true); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// The app's own settings (not the helper's): where the main window was.
const APP_SETTINGS = path.join(LOCAL_DIR, 'app-settings.json');
function appSettings() { try { return JSON.parse(fs.readFileSync(APP_SETTINGS, 'utf8')); } catch { return {}; } }
function saveAppSetting(key, value) {
  try { savefile.writeJsonSync(APP_SETTINGS, { ...appSettings(), [key]: value }); } catch (err) { log(`Couldn't save ${key}: ${err.message}`); }
}

const windows = require('./windows')({
  port: PORT, linkHost: HOST, appSettings, saveAppSetting, log,
  isOnAir: () => wanted && !!helper,
  // A window opened another way (File > New Window, a link opening a new tab) puts Studio on air too.
  onWindowOpened: () => { if (!helper && !wanted) startHelperChecked(); },
  // The last window closed: Studio goes off air.
  onAllClosed: () => { log('Last Studio window closed'); stopHelper(); },
});

// The scene full screen on the Mac's displays (chroma, or fill and key), set up on the Output page.
// Made once the app is ready, since it needs the screen module.
let outputs = null;

// ─── The helper ─────────────────────────────────────────────────────────────
// wanted: whether it should be running (a Studio window is open), so a pending restart doesn't
// bring back a helper that was just stopped.
let helper = null, wanted = false, status = 'Studio is off air', quitting = false, restarts = 0, tray = null;

function startHelper() {
  status = 'Starting…'; refreshMenu();
  // The working directory is the local data folder, not the app's: the app's code is inside its
  // archive (app.asar), which can't be a working directory; server.js finds its own files by __dirname.
  const child = helper = utilityProcess.fork(path.join(APP_DIR, 'server.js'), [], {
    cwd: LOCAL_DIR,
    serviceName: 'FirstPass Studio helper',
    stdio: 'ignore',
    env: { ...process.env, FIRSTPASS_DATA_DIR: dataDir(), FIRSTPASS_LOCAL_DIR: LOCAL_DIR, FIRSTPASS_PACKAGED: app.isPackaged ? '1' : '' },
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
    if (code === EXIT_PORT_IN_USE) {
      // server.js found the port taken (by something that doesn't answer like Studio, or a copy
      // that started between the check and the start). Restarting won't help: say so, and offer to try again.
      wanted = false; status = `Studio is off air: port ${PORT} is in use`; refreshMenu();
      dialog.showMessageBox({
        type: 'warning', buttons: ['Try again', 'Cancel'], defaultId: 0, cancelId: 1,
        message: `Something is already using port ${PORT}`,
        detail: `Studio can't start until it is free. FirstPass Studio may already be running from a copy of the repository (npm start), or another program is using the port. Stop that, then choose Try again. The debug log has the details.`,
      }).then(({ response }) => { if (response === 0) startHelperChecked(); });
      return;
    }
    // Keep it running: restart straight away, but give up if it keeps failing at start
    // (the debug log says why).
    if (Date.now() - started > 60000) restarts = 0;
    if (++restarts <= 5) { status = 'Restarting…'; refreshMenu(); setTimeout(() => { if (wanted && !helper) startHelper(); }, 1000); return; }
    status = 'Studio stopped: see the debug log'; refreshMenu();
    dialog.showMessageBox({ type: 'error', message: 'FirstPass Studio stopped', detail: 'Studio stopped several times in a row. Open the debug log from the menu bar icon to see why, then choose Open Studio.' });
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

// A small symbol for a menu item: desktop/<name>Template.png (and @2x), drawn in the menu's colour.
const menuIcons = {};
function menuIcon(name) {
  if (!menuIcons[name]) {
    menuIcons[name] = nativeImage.createFromPath(path.join(__dirname, `${name}Template.png`));
    menuIcons[name].setTemplateImage(true);
  }
  return menuIcons[name];
}

function refreshMenu() {
  if (!tray) return;
  const login = app.getLoginItemSettings().openAtLogin;
  const running = !!helper;
  const pending = !helper && wanted && status === 'Restarting…';
  tray.setToolTip(`FirstPass Studio: ${status}`);
  // Studio starts by opening one of its pages; Stop Studio only shows while it is on air.
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `FirstPass Studio ${app.getVersion()}`, enabled: false },
    { label: status, enabled: false },
    ...(running || pending ? [{ label: 'Stop Studio', click: stopStudio }] : []),
    { type: 'separator' },
    { label: 'Open Studio', click: () => openPage('/') },
    { label: 'Scoreboard control', click: () => openPage('/control.html') },
    { label: 'Competition setup', click: () => openPage('/setup.html') },
    { label: 'Copy the Studio link', click: () => clipboard.writeText(pageUrl('/')) },
    // Opening the file hands it to the Stream Deck app, which installs or updates the plugin.
    { label: 'Install the Stream Deck plugin', enabled: fs.existsSync(STREAMDECK_PLUGIN), click: () => shell.openPath(STREAMDECK_PLUGIN) },
    { type: 'separator' },
    { label: 'Open the settings folder', click: () => shell.openPath(dataDir()) },
    settingsFolderMenu(),
    { label: exporting ? 'Backing up…' : 'Back up…', icon: menuIcon('backup'), enabled: !moving && !exporting, click: exportSettings },
    { label: moving === 'backup' ? 'Restoring…' : 'Restore…', icon: menuIcon('restore'), enabled: !moving && !exporting, click: restoreFromBackup },
    { label: 'Open the debug log', click: () => shell.openPath(path.join(LOCAL_DIR, 'logs', 'playhq-graphics.log')) },
    { label: 'Restart Studio', enabled: running, click: restartHelper },
    { type: 'separator' },
    { label: 'Open at login', type: 'checkbox', checked: login, click: item => { app.setLoginItemSettings({ openAtLogin: item.checked }); refreshMenu(); } },
    // config.json remoteChanges (access.js): off, only this Mac can change scores, the scene, settings and media; other
    // devices can still open every page. The helper reads config.json when it starts, so it restarts on a change.
    { label: 'Let other devices change things', type: 'checkbox', checked: machineConfig().remoteChanges !== false, toolTip: 'Phones, other computers and Stream Decks on this network can change scores, the scene and settings. Untick to keep changes to this Mac; they can still see every page.',
      click: item => { setMachineConfig('remoteChanges', item.checked); if (helper) restartHelper(); refreshMenu(); } },
    updateMenuItem(),
    { label: 'What\'s new…', enabled: !!whatsnew.since(whatsnew.load(), null, app.getVersion()).length, click: () => showWhatsNew(whatsnew.since(whatsnew.load(), null, app.getVersion()).slice(0, 10), { recent: true }) },
    { type: 'separator' },
    { label: 'Quit FirstPass Studio', click: () => app.quit() },
  ]));
}

// ─── Settings folder ────────────────────────────────────────────────────────
// On this Mac, or in iCloud Drive in a subfolder named after this Mac (datalocation.js).

function settingsFolderMenu() {
  const where = location.current(LOCAL_DIR);
  return {
    label: 'Settings folder',
    submenu: [
      { label: where.local ? 'Saved on this Mac' : `Saved in ${where.name} (${where.computer})`, enabled: false },
      { type: 'separator' },
      { label: where.local ? 'Move to iCloud Drive…' : 'Move to another iCloud Drive folder…', enabled: !moving, click: () => moveSettings('icloud') },
      { label: 'Move back to this Mac…', enabled: !where.local && !moving, click: () => moveSettings(null) },
      { type: 'separator' },
      { label: 'Restore from another Mac…', enabled: !moving, click: restoreFromMac },
    ],
  };
}

// Before Studio starts: the settings folder in iCloud Drive is there, belongs to this Mac, and
// every file in it is downloaded (iCloud may keep only placeholders of files not used lately).
async function settingsReady() {
  for (;;) {
    const where = location.current(LOCAL_DIR);
    if (where.local) return true;
    if (fs.existsSync(where.dataDir)) {
      const other = location.usedByAnother(where.dataDir, LOCAL_DIR);
      if (other) {
        windows.closeSplash(true);
        const { response } = await dialog.showMessageBox({
          type: 'warning', buttons: ['Cancel', 'Use them anyway'], defaultId: 0, cancelId: 0,
          message: 'Another Mac is using these settings',
          detail: `The settings folder ${where.dataDir} is used by another Mac called ${other.computer}. Two copies of Studio saving into one folder overwrite each other's settings. Give this Mac its own name (System Settings > General > Sharing > Local hostname) and move the settings again, or use them anyway if the other Mac has stopped using them.`,
        });
        if (response === 0) return false;
        location.save(LOCAL_DIR, where);
        windows.showSplash();
      }
      if (location.placeholders(where.dataDir).length) {
        windows.splashStatus(`Downloading the settings from ${where.name}…`);
        const left = await location.download(where.dataDir);
        if (left.length) log(`Still not downloaded from ${where.name}: ${left.join(', ')}`);
      }
      return true;
    }
    windows.closeSplash(true);
    log(`Settings folder not found: ${where.dataDir}`);
    const { response } = await dialog.showMessageBox({
      type: 'warning', buttons: ['Try again', 'Cancel'], defaultId: 0, cancelId: 1,
      message: `The settings folder in ${where.name} can't be found`,
      detail: `${where.dataDir}\n\nCheck ${where.name} is turned on and this Mac is signed in to iCloud, then choose Try again. To use this Mac's own folder instead, choose Settings folder > Move back to this Mac in the menu bar.`,
    });
    if (response === 1) return false;
    windows.showSplash();
  }
}

// Stops the helper and waits until it has gone, so nothing is saving while the folder moves.
function helperStopped() {
  if (!helper) return Promise.resolve();
  const child = helper;
  child.restarting = true;
  helper = null;
  return new Promise(resolve => { child.once('exit', resolve); child.kill(); setTimeout(resolve, 5000); });
}

let moving = false;
// Moves the settings into a folder in a cloud drive (provider 'icloud'), or back to this Mac
// (provider null). Studio goes off air for the move and comes back on after.
async function moveSettings(provider) {
  const where = location.current(LOCAL_DIR);
  let target = { provider: null, dataDir: LOCAL_DIR };
  if (provider) {
    const drive = location.PROVIDERS[provider];
    if (!fs.existsSync(drive.root())) {
      return dialog.showMessageBox({ type: 'warning', message: `${drive.name} isn't turned on`, detail: 'Turn it on in System Settings > your name > iCloud > iCloud Drive, then try again.' });
    }
    const pick = await dialog.showOpenDialog({
      title: `Keep the settings in ${drive.name}`,
      message: `Pick a folder in ${drive.name}. The settings go in a subfolder named after this Mac (${location.computerName()}).`,
      buttonLabel: 'Use this folder',
      defaultPath: where.local ? drive.root() : where.folder,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (pick.canceled || !pick.filePaths[0]) return;
    const checked = location.check(pick.filePaths[0], provider);
    if (!checked.ok) return dialog.showMessageBox({ type: 'warning', message: 'Pick another folder', detail: checked.error });
    target = checked;
    if (path.resolve(target.dataDir) === path.resolve(where.dataDir)) return;
    const other = location.usedByAnother(target.dataDir, LOCAL_DIR);
    if (other) {
      return dialog.showMessageBox({ type: 'warning', message: `Another Mac called ${other.computer} uses that folder`,
        detail: `Two Macs saving into one folder overwrite each other's settings. Give this Mac its own name in System Settings > General > Sharing > Local hostname (it is ${checked.computer}), then try again.` });
    }
  } else {
    const { response } = await dialog.showMessageBox({
      type: 'question', buttons: ['Move back', 'Cancel'], defaultId: 0, cancelId: 1,
      message: 'Move the settings back to this Mac?',
      detail: `They are moved from ${where.dataDir} to ${LOCAL_DIR}, and stop syncing with ${where.name}.`,
    });
    if (response === 1) return;
  }
  let existing = null;
  if (location.hasSettings(target.dataDir)) {
    const { response } = await dialog.showMessageBox({
      type: 'question', buttons: ['Use those', 'Replace them', 'Cancel'], defaultId: 0, cancelId: 2,
      message: 'That folder already has settings for this Mac',
      detail: `${target.dataDir}\n\nUse those: Studio uses the settings already there.\nReplace them: Studio puts the settings it uses now there instead.\n\nEither way a copy of both is kept in the backups folder on this Mac.`,
    });
    if (response === 2) return;
    existing = response === 0 ? 'use' : 'replace';
  }
  const wasOn = !!helper || wanted;
  if (wasOn) {
    const { response } = await dialog.showMessageBox({
      type: 'question', buttons: ['Move', 'Cancel'], defaultId: 0, cancelId: 1,
      message: 'Studio goes off air while the settings move',
      detail: 'It comes back on air straight after, usually within a few seconds. Avoid moving them during a live game.',
    });
    if (response === 1) return;
  }
  moving = true; refreshMenu();
  try {
    await helperStopped();
    if (wasOn) windows.showOffAir();
    status = 'Moving the settings…'; refreshMenu();
    if (!where.local && location.placeholders(where.dataDir).length) await location.download(where.dataDir);
    const result = location.move({ from: where.dataDir, to: target.dataDir, localDir: LOCAL_DIR, existing, log });
    location.save(LOCAL_DIR, target);
    log(`Settings now in ${target.dataDir}`);
    dialog.showMessageBox({
      message: provider ? `The settings are in ${location.PROVIDERS[provider].name}` : 'The settings are back on this Mac',
      detail: `${target.dataDir}${result.backup ? `\n\nA copy of the settings as they were is in ${result.backup}.` : ''}${provider ? '\n\nThe debug log, the scores and the clock stay on this Mac.' : ''}`,
    });
  } catch (err) {
    log(`Couldn't move the settings: ${err.message}`);
    dialog.showMessageBox({ type: 'error', message: 'Couldn\'t move the settings', detail: `${err.message}\n\nStudio carries on with the settings in ${where.dataDir}.` });
  } finally {
    moving = false;
    status = 'Studio is off air';
    if (wasOn && wanted) startHelper(); else refreshMenu();
  }
}

// Copies another Mac's settings (its subfolder in iCloud Drive) over this Mac's, after backing
// this Mac's up. The other Mac's folder is only read. Studio goes off air for the copy.
async function restoreFromMac() {
  const where = location.current(LOCAL_DIR);
  const drive = location.PROVIDERS.icloud;
  let from = null;
  const others = where.local ? [] : location.otherMacs(where.folder, where.dataDir).slice(0, 4);
  if (others.length) {
    const { response } = await dialog.showMessageBox({
      type: 'question', buttons: [...others.map(o => o.computer), 'Choose a folder…', 'Cancel'], cancelId: others.length + 1,
      message: 'Restore the settings from which Mac?',
      detail: `These Macs keep their settings beside this one's in ${drive.name}.`,
    });
    if (response === others.length + 1) return;
    if (response < others.length) from = others[response].dir;
  }
  if (!from) {
    const pick = await dialog.showOpenDialog({
      title: 'Restore from another Mac',
      message: 'Pick the other Mac\'s settings folder (the one named after that Mac).',
      buttonLabel: 'Restore from this folder',
      defaultPath: where.local ? (fs.existsSync(drive.root()) ? drive.root() : undefined) : where.folder,
      properties: ['openDirectory'],
    });
    if (pick.canceled || !pick.filePaths[0]) return;
    from = pick.filePaths[0];
  }
  if (path.resolve(from) === path.resolve(where.dataDir)) {
    return dialog.showMessageBox({ type: 'warning', message: 'That is this Mac\'s own settings folder', detail: 'Pick the folder named after the other Mac.' });
  }
  if (!location.hasSettings(from) && !location.placeholders(from).length) {
    return dialog.showMessageBox({ type: 'warning', message: 'No settings in that folder', detail: `${from}\n\nPick the folder named after the other Mac, inside the folder you chose for ${drive.name}.` });
  }
  const name = (location.owner(from) || {}).computer || path.basename(from);
  const wasOn = !!helper || wanted;
  const { response } = await dialog.showMessageBox({
    type: 'warning', buttons: ['Restore', 'Cancel'], defaultId: 0, cancelId: 1,
    message: `Replace this Mac's settings with ${name}'s?`,
    detail: `Competitions, scenes, sequences, music and the control page's choices are copied from ${from}${where.local ? ` into a folder for this Mac beside it (${location.computerName()}), and this Mac keeps its settings in ${drive.name} from then on` : ''}. ${name} keeps its own. This Mac's settings are backed up first, in the backups folder on this Mac.${wasOn ? '\n\nStudio goes off air while they copy and comes straight back. Avoid doing this during a live game.' : ''}`,
  });
  if (response === 1) return;
  moving = true; refreshMenu();
  try {
    await helperStopped();
    if (wasOn) windows.showOffAir();
    status = 'Restoring the settings…'; refreshMenu();
    const left = await location.download(from);
    if (left.length) throw new Error(`${left.length} files are still downloading from ${drive.name}. Try again in a minute`);
    // Settings on the Mac itself go to iCloud Drive too, in this Mac's subfolder beside the other Mac's.
    const result = where.local
      ? location.restoreToCloud({ from, localDir: LOCAL_DIR, log })
      : location.restore({ from, to: where.dataDir, localDir: LOCAL_DIR, log });
    const into = result.target ? result.target.dataDir : where.dataDir;
    dialog.showMessageBox({
      message: `Restored the settings from ${name}`,
      detail: `${result.files} files copied into ${into}${result.target ? `, this Mac's own folder in ${drive.name}. This Mac keeps its settings there from now on` : ''}.${result.backup ? `\n\nThis Mac's settings as they were are in ${result.backup}.` : ''}`,
    });
  } catch (err) {
    log(`Couldn't restore the settings: ${err.message}`);
    dialog.showMessageBox({ type: 'error', message: 'Couldn\'t restore the settings', detail: err.message });
  } finally {
    moving = false;
    status = 'Studio is off air';
    if (wasOn && wanted) startHelper(); else refreshMenu();
  }
}

// Back up settings: saves every setting (datalocation.exportEntries) as one zip, named with the
// date and time so each one is new and they sort oldest to newest, and a summary of what's in it
// (exportSummary, with the notes typed in) beside it as <name>.txt, also inside the zip.
// Studio stays on air: nothing is changed.
let exporting = false;
async function exportSettings() {
  const where = location.current(LOCAL_DIR);
  if (!fs.existsSync(where.dataDir)) return dialog.showMessageBox({ type: 'warning', message: 'The settings folder can\'t be found', detail: where.dataDir });
  const media = location.exportEntries(where.dataDir).list.filter(e => e.file && e.name.split('/')[1] === 'media');
  const mb = media.reduce((n, e) => n + fs.statSync(e.file).size, 0) / 1e6;
  const choice = await windows.askExport({ mediaLabel: media.length ? `Include the media folder (${media.length} files, ${mb < 1 ? '<1' : Math.round(mb)} MB)` : '' });
  if (!choice) return;
  const name = location.exportName();
  const pick = await dialog.showSaveDialog({
    title: 'Back up settings', buttonLabel: 'Save',
    message: 'The summary is saved beside the zip, with the same name.',
    defaultPath: path.join(app.getPath('downloads'), `${name}.zip`),
    filters: [{ name: 'Zip', extensions: ['zip'] }],
  });
  if (pick.canceled || !pick.filePath) return;
  const summaryFile = pick.filePath.replace(/\.zip$/i, '') + '.txt';
  const part = `${pick.filePath}.part`;
  exporting = true; refreshMenu();
  try {
    if (!where.local && location.placeholders(where.dataDir).length) await location.download(where.dataDir);
    const { list, skipped, summary } = location.exportEntries(where.dataDir, { media: choice.media, folder: name, about: { studio: app.getVersion() }, notes: choice.notes });
    const out = fs.createWriteStream(part);
    const done = new Promise((resolve, reject) => { out.on('finish', resolve); out.on('error', reject); });
    await require('../zip').write(out, list);
    await done;
    fs.renameSync(part, pick.filePath);
    fs.writeFileSync(summaryFile, summary);
    log(`Backed up the settings to ${pick.filePath}: ${list.length - 2} files${skipped.length ? `, without ${skipped.join(', ')} (not downloaded from iCloud)` : ''}`);
    const { response } = await dialog.showMessageBox({
      buttons: ['Show in Finder', 'OK'], defaultId: 1, cancelId: 1,
      message: 'Backed up the settings',
      detail: `${list.length - 2} files in ${pick.filePath}, and a summary in ${path.basename(summaryFile)} beside it.${skipped.length ? `\n\n${skipped.length} files are still only in iCloud and weren't included: ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? '…' : ''}` : ''}`,
    });
    if (response === 0) shell.showItemInFolder(pick.filePath);
  } catch (err) {
    fs.rmSync(part, { force: true });
    log(`Couldn't back up the settings: ${err.message}`);
    dialog.showMessageBox({ type: 'error', message: 'Couldn\'t back up the settings', detail: err.message });
  } finally {
    exporting = false; refreshMenu();
  }
}

// Restore: puts a backup zip made with Back up… in place of this Mac's settings, wherever they
// are kept (datalocation.restoreBackup). This Mac's settings are backed up first, in the backups
// folder. Studio goes off air for the swap and comes back on after.
async function restoreFromBackup() {
  const where = location.current(LOCAL_DIR);
  const pick = await dialog.showOpenDialog({
    title: 'Restore from a backup', buttonLabel: 'Restore…',
    message: 'Pick a FirstPassStudioBackup zip made with Back up….',
    defaultPath: app.getPath('downloads'),
    filters: [{ name: 'Zip', extensions: ['zip'] }], properties: ['openFile'],
  });
  if (pick.canceled || !pick.filePaths[0]) return;
  const file = pick.filePaths[0];
  let backup;
  try { backup = await location.readBackup(file); } catch (err) {
    return dialog.showMessageBox({ type: 'warning', message: 'Can\'t restore that file', detail: err.message });
  }
  const { about, summary } = backup;
  const made = about.exported ? new Date(about.exported).toLocaleString('en-AU', { dateStyle: 'long', timeStyle: 'short' }) : 'an unknown date';
  const notes = location.backupNotes(summary);
  const counts = (summary.match(/^[A-Z][a-z]+ \(\d+\)$/gm) || []).join(', ');
  const wasOn = !!helper || wanted;
  const { response } = await dialog.showMessageBox({
    type: 'warning', buttons: ['Restore', 'Cancel'], defaultId: 0, cancelId: 1,
    message: 'Replace this Mac\'s settings with this backup?',
    detail: `${backup.root}\nMade ${made}${about.computer ? ` on ${about.computer}` : ''}${about.studio ? ` with Studio ${about.studio}` : ''}.`
      + `${notes ? `\n\nNotes: ${notes.length > 300 ? `${notes.slice(0, 300)}…` : notes}` : ''}${counts ? `\n\n${counts}.` : ''}`
      + `\n\nThis Mac's settings are backed up first, in the backups folder on this Mac.${about.media === false ? ' The backup has no media folder, so this Mac\'s media stays.' : ''}`
      + `${wasOn ? '\n\nStudio goes off air while they swap and comes straight back. Avoid doing this during a live game.' : ''}`,
  });
  if (response === 1) return;
  moving = 'backup'; refreshMenu();
  try {
    await helperStopped();
    if (wasOn) windows.showOffAir();
    status = 'Restoring the settings…'; refreshMenu();
    const result = await location.restoreBackup({ file, to: where.dataDir, localDir: LOCAL_DIR, log });
    log(`Restored the settings from ${file}`);
    dialog.showMessageBox({
      message: 'Restored the settings from the backup',
      detail: `${result.files} files from ${path.basename(file)} are now in ${where.dataDir}.${result.backup ? `\n\nThis Mac's settings as they were are in ${result.backup}.` : ''}`,
    });
  } catch (err) {
    log(`Couldn't restore the backup: ${err.message}`);
    dialog.showMessageBox({ type: 'error', message: 'Couldn\'t restore the backup', detail: `${err.message}\n\nThis Mac's settings weren't changed.` });
  } finally {
    moving = false;
    status = 'Studio is off air';
    if (wasOn && wanted) startHelper(); else refreshMenu();
  }
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

// ─── What's new ─────────────────────────────────────────────────────────────
// The first time the app opens after an update, a window lists what changed since the version
// last opened, every change between the two (whatsnew.js, from the release notes bundled at build time). Opened at login it
// waits until Studio is first opened, rather than popping up as the Mac starts. The version it
// was shown for is saved in app-settings.json (whatsNewSeen), so it shows once.
let whatsNewLater = null;
function whatsNewOnLaunch() {
  const { show, seen } = whatsnew.onLaunch({ data: whatsnew.load(), current: app.getVersion(), lastSeen: appSettings().whatsNewSeen || LAST_STARTED, usedBefore: USED_BEFORE });
  if (seen) saveAppSetting('whatsNewSeen', seen);
  if (!show) return;
  log(`What's new: ${show.map(r => r.version).join(', ')}`);
  if (app.getLoginItemSettings().wasOpenedAtLogin) whatsNewLater = show;
  else showWhatsNew(show);
}
function showWhatsNew(releases, options) {
  windows.showWhatsNew(releases, options).then(choice => { if (choice === 'open') openPage('/'); });
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
  log(`Starting ${app.getVersion()}, settings in ${dataDir()}`);

  // The app always starts in the menu bar off air (nothing talks to PlayHQ), at login or opened
  // by hand. Open Studio, or any page in the menu, puts it on air.
  log('Off air until Studio is opened');
  whatsNewOnLaunch();
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
