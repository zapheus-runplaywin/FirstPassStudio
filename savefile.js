// FirstPass Studio - saving a file so it is never half written.
//
// Every file Studio saves (the scene, sequences, music, sponsors, a competition's settings, the
// control page's choices, the scores) goes through here. A plain write replaces the file's
// contents in place, so a crash, a power cut or the app's restart loop in the middle of one
// leaves a half-written file, and the next start reads it as broken and falls back to empty:
// "my scene is gone" with no error. Here the new contents are written to a temporary file beside
// the target and renamed over it. A rename is atomic on APFS and in iCloud Drive's local folder,
// so the file on disk is always the old one or the new one, never part of each.
//
// readJson is the matching read: a file that is there but not valid JSON is moved aside as
// <name>.broken-<time> (so the next save doesn't destroy the evidence) and reported through
// onError, instead of being silently taken as empty.

'use strict';

const fs = require('fs');
const path = require('path');

const tempName = file => path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`);

// Writes data (a string or Buffer) to file atomically. options: { mode } as for fs.writeFileSync.
function writeFileSync(file, data, options) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = tempName(file);
  try {
    fs.writeFileSync(tmp, data, options);
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

// The same, without waiting: the callback gets the error, if any. Saves of one file go one at a
// time, so the newest always lands last: two saves started close together could otherwise finish
// out of order and leave the older contents on disk (the scoreboard's clock coming back stopped
// after a restart). A save asked for while one is being written waits for it; if several wait,
// only the newest is written, and each of their callbacks gets that save's result.
// file -> { current: { data, options }, next: { data, options, callbacks } | null, flushed } while a save is being written
const saving = new Map();

function writeFile(file, data, options, callback) {
  if (typeof options === 'function') { callback = options; options = undefined; }
  const done = callback || (() => {});
  const busy = saving.get(file);
  if (busy) {
    const callbacks = busy.next ? busy.next.callbacks : [];
    callbacks.push(done);
    busy.next = { data, options, callbacks };
    return;
  }
  saving.set(file, { current: null, next: null, flushed: false });
  writeNow(file, data, options, [done]);
}

function writeNow(file, data, options, callbacks) {
  const state = saving.get(file);
  state.current = { data, options };
  const finish = err => {
    const next = state.next;
    state.next = null;
    if (next && !state.flushed) writeNow(file, next.data, next.options, next.callbacks);
    else if (saving.get(file) === state) saving.delete(file);
    for (const cb of callbacks) cb(err);
    if (next && state.flushed) for (const cb of next.callbacks) cb(null);
  };
  fs.mkdir(path.dirname(file), { recursive: true }, errDir => {
    if (errDir) return finish(errDir);
    const tmp = tempName(file);
    fs.writeFile(tmp, data, options, errWrite => {
      if (errWrite) return fs.rm(tmp, { force: true }, () => finish(errWrite));
      if (state.flushed) return fs.rm(tmp, { force: true }, () => finish(null)); // flushSync already wrote the newest
      fs.rename(tmp, file, errRename => {
        if (errRename) return fs.rm(tmp, { force: true }, () => finish(errRename));
        finish(null);
      });
    });
  });
}

// Writes every save still waiting or being written by writeFile, now, newest contents only. For
// Studio stopping (process exit): exiting doesn't wait for a save in the background, so without
// this the last change before going off air could be missing after a restart. The background
// writes already under way are dropped, so they can't land over what this wrote.
function flushSync() {
  for (const [file, state] of saving) {
    const latest = state.next || state.current;
    state.flushed = true;
    saving.delete(file);
    try { writeFileSync(file, latest.data, latest.options); } catch { /* as a failed background save: the old file stays */ }
  }
}

// Saves value as pretty JSON, atomically.
function writeJsonSync(file, value, options) {
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n', options);
}

// Reads a JSON file. A missing file gives fallback. A file that can't be parsed is moved aside
// as <file>.broken-<time>, onError(err, movedTo) is called if given, and fallback is returned.
// Any other error (permissions, a folder) also goes to onError and gives fallback.
function readJson(file, fallback, onError) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (err) {
    if (err.code !== 'ENOENT' && onError) onError(err, null);
    return fallback;
  }
  try { return JSON.parse(text); }
  catch (err) {
    let movedTo = null;
    try {
      movedTo = `${file}.broken-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      fs.renameSync(file, movedTo);
    } catch { movedTo = null; }
    if (onError) onError(err, movedTo);
    return fallback;
  }
}

module.exports = { writeFileSync, writeFile, flushSync, writeJsonSync, readJson };
