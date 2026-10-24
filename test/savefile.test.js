// Saving files so they are never half written (savefile.js): a save replaces the file in one
// step and leaves no temporary file behind, a failed save leaves the old file as it was, and a
// file that is there but broken is moved aside and reported rather than silently taken as empty.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const savefile = require('../savefile');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'studio-savefile-'));

test('writeJsonSync writes pretty JSON, makes the folder, and leaves no temporary file', () => {
  const dir = tmp();
  const file = path.join(dir, 'deep', 'er', 'scene.json');
  savefile.writeJsonSync(file, { a: 1, b: [2] });
  assert.equal(fs.readFileSync(file, 'utf8'), '{\n  "a": 1,\n  "b": [\n    2\n  ]\n}\n');
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['scene.json']);
});

test('writeFileSync replaces the old contents whole and keeps the mode asked for', () => {
  const dir = tmp();
  const file = path.join(dir, 'keys.json');
  savefile.writeFileSync(file, 'old');
  savefile.writeFileSync(file, 'new contents', { mode: 0o600 });
  assert.equal(fs.readFileSync(file, 'utf8'), 'new contents');
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(dir), ['keys.json']);
});

test('a save that fails leaves the old file untouched and no temporary file', () => {
  const dir = tmp();
  const file = path.join(dir, 'control.json');
  savefile.writeJsonSync(file, { round: '3' });
  // A folder where the file should go makes the rename fail.
  const blocked = path.join(dir, 'blocked.json');
  fs.mkdirSync(blocked);
  assert.throws(() => savefile.writeJsonSync(blocked, { x: 1 }));
  assert.ok(fs.statSync(blocked).isDirectory());
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { round: '3' });
  assert.deepEqual(fs.readdirSync(dir).sort(), ['blocked.json', 'control.json']);
});

test('writeFile (async) saves atomically and reports errors through the callback', async () => {
  const dir = tmp();
  const file = path.join(dir, 'scoreboard-state.json');
  await new Promise((resolve, reject) => savefile.writeFile(file, '{"1":{}}', err => (err ? reject(err) : resolve())));
  assert.equal(fs.readFileSync(file, 'utf8'), '{"1":{}}');
  assert.deepEqual(fs.readdirSync(dir), ['scoreboard-state.json']);
  const blocked = path.join(dir, 'blocked.json');
  fs.mkdirSync(blocked);
  const err = await new Promise(resolve => savefile.writeFile(blocked, 'x', resolve));
  assert.ok(err, 'the error is passed on');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['blocked.json', 'scoreboard-state.json']);
});

test('readJson gives the fallback for a missing file without calling onError', () => {
  const calls = [];
  assert.deepEqual(savefile.readJson(path.join(tmp(), 'none.json'), { none: true }, err => calls.push(err)), { none: true });
  assert.equal(calls.length, 0);
});

test('readJson moves a broken file aside, reports it, and gives the fallback', () => {
  const dir = tmp();
  const file = path.join(dir, 'scene.json');
  fs.writeFileSync(file, '{"sources": [ {"id": "a"'); // cut off mid-write
  const calls = [];
  assert.deepEqual(savefile.readJson(file, {}, (err, movedTo) => calls.push({ err, movedTo })), {});
  assert.equal(calls.length, 1);
  assert.ok(calls[0].err instanceof SyntaxError);
  assert.ok(!fs.existsSync(file), 'the broken file is no longer in the way of the next save');
  const left = fs.readdirSync(dir);
  assert.equal(left.length, 1);
  assert.match(left[0], /^scene\.json\.broken-\d{4}-\d{2}-\d{2}T/);
  assert.equal(calls[0].movedTo, path.join(dir, left[0]));
  assert.equal(fs.readFileSync(calls[0].movedTo, 'utf8'), '{"sources": [ {"id": "a"', 'the evidence is kept');
  // The next save works as normal.
  savefile.writeJsonSync(file, { sources: [] });
  assert.deepEqual(savefile.readJson(file, null), { sources: [] });
});

test('readJson reads a good file', () => {
  const file = path.join(tmp(), 'ok.json');
  fs.writeFileSync(file, '{"ok": 1}');
  assert.deepEqual(savefile.readJson(file, null), { ok: 1 });
});
