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

// The same, without waiting: the callback gets the error, if any.
function writeFile(file, data, options, callback) {
  if (typeof options === 'function') { callback = options; options = undefined; }
  const done = callback || (() => {});
  fs.mkdir(path.dirname(file), { recursive: true }, errDir => {
    if (errDir) return done(errDir);
    const tmp = tempName(file);
    fs.writeFile(tmp, data, options, errWrite => {
      if (errWrite) return fs.rm(tmp, { force: true }, () => done(errWrite));
      fs.rename(tmp, file, errRename => {
        if (errRename) return fs.rm(tmp, { force: true }, () => done(errRename));
        done(null);
      });
    });
  });
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

module.exports = { writeFileSync, writeFile, writeJsonSync, readJson };
