// FirstPass Studio - where this computer's settings are saved.
//
// Everything Studio saves (competitions, the control page's choices, scores, the debug log
// and this computer's own settings) lives in one data folder outside the app, so installing
// or updating Studio never touches it:
//   Mac      ~/Library/Application Support/FirstPass Studio
//   Windows  %APPDATA%\FirstPass Studio
//   Linux    ~/.config/FirstPass Studio
// The settings can instead be kept in iCloud Drive (datalocation.js), in a subfolder named
// after this Mac; data-location.json in the folder above says where. The logs, the scores and
// clock and caches stay in the folder above either way (LOCAL_DIR, local()).
// FIRSTPASS_DATA_DIR picks another folder (the desktop app passes the one it resolved), and
// FIRSTPASS_LOCAL_DIR the local one (it defaults to FIRSTPASS_DATA_DIR when only that is set).
// The app folder itself only holds the app: the pages, the code, the default config.json
// and the import configs in imports/.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const location = require('./datalocation');

const APP_DIR = __dirname;
const NAME = 'FirstPass Studio';

function defaultDir() {
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', NAME);
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), NAME);
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), NAME);
}

const LOCAL_DIR = path.resolve(process.env.FIRSTPASS_LOCAL_DIR || process.env.FIRSTPASS_DATA_DIR || defaultDir());
fs.mkdirSync(LOCAL_DIR, { recursive: true });
const LOCATION = location.current(LOCAL_DIR);
const DATA_DIR = path.resolve(process.env.FIRSTPASS_DATA_DIR || LOCATION.dataDir);
// A cloud folder that has gone (iCloud Drive turned off, or signed out) is never made again
// empty: that would look like every setting had been lost.
if (!LOCATION.local && DATA_DIR === LOCATION.dataDir && !fs.existsSync(DATA_DIR)) {
  throw new Error(`The settings folder in ${LOCATION.name} can't be found: ${DATA_DIR}. Check ${LOCATION.name} is on, or move the settings back to this Mac from the 1P menu.`);
}
fs.mkdirSync(DATA_DIR, { recursive: true });

// Import configs can be saved into imports/ only when running from a copy of the
// repository (not the installed app, whose folder is read-only).
function canSaveImports() {
  if (process.env.FIRSTPASS_PACKAGED) return false;
  try { fs.accessSync(path.join(APP_DIR, 'imports'), fs.constants.W_OK); return true; } catch { return false; }
}

module.exports = {
  APP_DIR,
  DATA_DIR,
  LOCAL_DIR,
  // Where the settings are, for the setup and home pages: { local } or { provider, name, folder, computer }.
  location: process.env.FIRSTPASS_DATA_DIR && DATA_DIR !== LOCATION.dataDir ? { local: true, dataDir: DATA_DIR } : LOCATION,
  IMPORTS_DIR: path.join(APP_DIR, 'imports'),
  file: (...parts) => path.join(DATA_DIR, ...parts),
  // Files that stay on this computer when the settings are in a cloud drive (datalocation.LOCAL_ONLY).
  local: (...parts) => path.join(LOCAL_DIR, ...parts),
  canSaveImports,
};
