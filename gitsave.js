// PlayHQ Graphics - keep the settings/ folder in git.
//
// Everything changed on the competition setup page and the lasting settings on the
// control page are saved as plain files in settings/. When this folder is a git
// checkout (see "Update (Mac).command"), each change is committed here a minute after
// the last edit, so the history shows what changed and when. Nothing is pushed: the
// Update script sends these commits to GitHub. Without git, the files are still saved;
// they just aren't committed. Turn it off with "gitAutoCommit": false in config.json.

'use strict';

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const QUIET_MS = 60 * 1000;

let enabled = false, log = () => {}, timer = null, reasons = new Set(), busy = false;

const git = args => new Promise((resolve, reject) =>
  execFile('git', args, { cwd: ROOT, timeout: 30000 }, (err, stdout, stderr) => err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout.trim())));

function init(machineConfig, logFn) {
  log = logFn;
  if (machineConfig.gitAutoCommit === false) { log('info', 'git', 'Committing settings to git is off (gitAutoCommit in config.json)'); return; }
  if (!fs.existsSync(path.join(ROOT, '.git'))) { log('info', 'git', 'This folder is not a git checkout, so settings are saved as files only. Run the Update script once to use git.'); return; }
  git(['--version']).then(v => { enabled = true; log('info', 'git', `Settings changes will be committed (${v})`); changed('changes made while the helper was off'); })
    .catch(err => log('warn', 'git', `git isn't available, so settings are saved as files only: ${err.message}`));
}

// Something in settings/ changed; commit it once things have been quiet for a minute.
function changed(reason) {
  if (!enabled) return;
  if (reason) reasons.add(reason);
  clearTimeout(timer);
  timer = setTimeout(commit, QUIET_MS);
}

async function commit() {
  if (busy) return changed();
  busy = true;
  const why = [...reasons].join(', ') || 'settings';
  reasons = new Set();
  try {
    await git(['add', '-A', '--', 'settings']);
    if (!(await git(['status', '--porcelain', '--', 'settings']))) return;
    // A commit needs a name; use one when this computer has none set up for git.
    const who = await git(['config', 'user.name']).catch(() => '') ? [] : ['-c', 'user.name=FirstPass Studio', '-c', 'user.email=firstpass-studio@localhost'];
    await git([...who, 'commit', '-q', '-m', `Settings: ${why}`, '--', 'settings']);
    log('info', 'git', `Committed settings: ${why}`);
  } catch (err) {
    log('warn', 'git', `Couldn't commit settings (they are still saved): ${err.message}`);
  } finally { busy = false; }
}

module.exports = { init, changed, commit };
