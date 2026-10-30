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

test('writeFile (async) saves started close together land in order: the newest is what stays', async () => {
  const dir = tmp();
  const file = path.join(dir, 'scoreboard-state.json');
  // A big save first (slow to write) then small ones: written side by side, a small one would
  // finish first and the big, older one would be renamed over it.
  const saves = [JSON.stringify({ n: 0, pad: 'x'.repeat(20e6) }), ...Array.from({ length: 20 }, (_, i) => JSON.stringify({ n: i + 1 }))];
  const results = await Promise.all(saves.map(data => new Promise(resolve => savefile.writeFile(file, data, resolve))));
  assert.deepEqual(results, saves.map(() => null), 'every save reports success');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { n: 20 });
  assert.deepEqual(fs.readdirSync(dir), ['scoreboard-state.json'], 'no temporary files left');
  // Once those are done, the next save is written straight away.
  await new Promise((resolve, reject) => savefile.writeFile(file, '{"n":21}', err => (err ? reject(err) : resolve())));
  assert.equal(fs.readFileSync(file, 'utf8'), '{"n":21}');
});

test('flushSync: a process exiting with saves still in the background leaves the newest on disk', () => {
  const dir = tmp();
  const file = path.join(dir, 'scoreboard-state.json');
  // As Studio going off air: saves started, then exit straight away, with the flush on exit.
  const script = `
    const savefile = require(${JSON.stringify(path.join(__dirname, '..', 'savefile'))});
    process.on('exit', () => savefile.flushSync());
    const file = ${JSON.stringify(file)};
    savefile.writeFile(file, JSON.stringify({ n: 0, pad: 'x'.repeat(5e6) }));
    for (let i = 1; i <= 5; i++) savefile.writeFile(file, JSON.stringify({ n: i }));
    process.exit(0);`;
  require('node:child_process').execFileSync(process.execPath, ['-e', script]);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { n: 5 });
  assert.deepEqual(fs.readdirSync(dir), ['scoreboard-state.json'], 'no temporary files left');
});

test('flushSync: a save under way when it runs is dropped, so it never lands over the newest', async () => {
  const dir = tmp();
  const file = path.join(dir, 'scoreboard-state.json');
  const done = [];
  savefile.writeFile(file, JSON.stringify({ n: 0, pad: 'x'.repeat(5e6) }), err => done.push(err));
  savefile.writeFile(file, '{"n":1}', err => done.push(err));
  savefile.flushSync();
  assert.equal(fs.readFileSync(file, 'utf8'), '{"n":1}');
  await new Promise(resolve => { const check = () => (done.length === 2 ? resolve() : setTimeout(check, 10)); check(); });
  assert.deepEqual(done, [null, null]);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"n":1}');
  assert.deepEqual(fs.readdirSync(dir), ['scoreboard-state.json'], 'no temporary files left');
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
