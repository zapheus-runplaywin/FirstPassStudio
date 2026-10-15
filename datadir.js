// FirstPass Studio - where this computer's settings are saved.
//
// Everything Studio saves (competitions, the control page's choices, scores, the debug log
// and this computer's own settings) lives in one data folder outside the app, so installing
// or updating Studio never touches it:
//   Mac      ~/Library/Application Support/FirstPass Studio
//   Windows  %APPDATA%\FirstPass Studio
//   Linux    ~/.config/FirstPass Studio
// FIRSTPASS_DATA_DIR picks another folder (the desktop app sets it to the same place).
// The app folder itself only holds the app: the pages, the code, the default config.json
// and the import configs in imports/.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_DIR = __dirname;
const NAME = 'FirstPass Studio';

function defaultDir() {
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', NAME);
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), NAME);
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), NAME);
}

const DATA_DIR = path.resolve(process.env.FIRSTPASS_DATA_DIR || defaultDir());
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
  IMPORTS_DIR: path.join(APP_DIR, 'imports'),
  file: (...parts) => path.join(DATA_DIR, ...parts),
  canSaveImports,
};
