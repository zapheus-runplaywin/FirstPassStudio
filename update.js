// PlayHQ Graphics - update from GitHub and back up your settings there.
//
// Double-click "Update (Mac).command" or "Update (Windows).bat". It:
//   1. the first time, turns this folder into a git checkout of the GitHub repository
//      (keeping logs, saved setups and the scoreboard as they are);
//   2. commits anything changed in settings/ (setup page and control page settings);
//   3. pulls the newest version from GitHub, merging it with your settings commits;
//   4. pushes your settings commits to GitHub, so they're backed up and in the history.
// Updates never change settings/: only you (through the setup and control pages) do.

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const REPO = 'https://github.com/zapheus-runplaywin/playhq-graphics.git';
const BRANCH = 'main';

function git(args, { show = false, quiet = false } = {}) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: show ? 'inherit' : 'pipe' });
  if (r.error) throw new Error(r.error.code === 'ENOENT' ? 'NOGIT' : r.error.message);
  if (r.status !== 0 && !quiet) throw new Error(((r.stderr || '') + (r.stdout || '')).trim() || `git ${args[0]} failed`);
  return { ok: r.status === 0, out: (r.stdout || '').trim() };
}
const say = s => console.log(s);

function commitSettings() {
  if (!fs.existsSync(path.join(ROOT, 'settings'))) return false;
  git(['add', '-A', '--', 'settings']);
  if (!git(['status', '--porcelain', '--', 'settings']).out) return false;
  const who = git(['config', 'user.name'], { quiet: true }).out ? [] : ['-c', 'user.name=FirstPass Studio', '-c', 'user.email=firstpass-studio@localhost'];
  git([...who, 'commit', '-q', '-m', 'Settings: saved before updating', '--', 'settings']);
  return true;
}

function main() {
  try { git(['--version']); } catch (err) {
    if (err.message !== 'NOGIT') throw err;
    say('Git is not installed on this computer.');
    say(process.platform === 'darwin'
      ? 'On a Mac, a window may have just offered to install the "command line developer tools", which include git. Install them, then run Update again.'
      : 'Install it from https://git-scm.com/download/win, then run Update again.');
    return 1;
  }

  const isRepo = fs.existsSync(path.join(ROOT, '.git'));
  if (!isRepo || !git(['rev-parse', '--verify', '-q', 'HEAD'], { quiet: true }).ok) {
    say('Setting this folder up as a copy of the GitHub repository (only needed once)...');
    if (!isRepo) git(['init', '-q']);
    if (!git(['remote', 'get-url', 'origin'], { quiet: true }).ok) git(['remote', 'add', 'origin', REPO]);
    say('Downloading from GitHub. If it asks you to sign in, use your GitHub account.');
    git(['fetch', 'origin', BRANCH], { show: true });
    // Point this folder at GitHub's version, then bring every program file up to date.
    // Logs, saved setups, the scoreboard and other files git doesn't track are left alone.
    git(['reset', '-q', `origin/${BRANCH}`]);
    git(['branch', '-M', BRANCH]);
    git(['branch', '-q', '-u', `origin/${BRANCH}`]);
    git(['checkout', '-q', '--', '.']);
    say('Done: this folder now follows GitHub.');
  }

  if (commitSettings()) say('Saved your latest settings in git.');

  say('Getting the newest version...');
  const pull = git(['pull', '--no-edit', '--no-rebase', 'origin', BRANCH], { show: true, quiet: true });
  if (!pull.ok) {
    git(['merge', '--abort'], { quiet: true });
    say('\nThe update could not be applied, so nothing was changed. The message above says why.');
    say('If it mentions files you changed, send the message to Claude in the FirstPass Studio project.');
    return 1;
  }

  const ahead = git(['rev-list', '--count', `origin/${BRANCH}..HEAD`], { quiet: true }).out;
  if (Number(ahead) > 0) {
    say('Backing up your settings to GitHub...');
    const push = git(['push', 'origin', `HEAD:${BRANCH}`], { show: true, quiet: true });
    if (!push.ok) say('Your settings are saved and committed here, but could not be sent to GitHub (see above). Update tries again next time.');
  }
  say('\nUp to date. If the helper is running, close its window and start it again.');
  return 0;
}

try { process.exitCode = main(); } catch (err) {
  console.error(`\nUpdate failed: ${err.message}`);
  process.exitCode = 1;
}
