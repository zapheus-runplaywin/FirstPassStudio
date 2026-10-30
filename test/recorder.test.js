// The game recordings (recorder.js): each PlayHQ game on air is one file in Recordings/, from when it's due on the
// scoreboard to a set time after full time, with what PlayHQ said, each scoreboard action, and what went to air (the
// scene, the board, a graphic's reads), only when it changed, starting with the last of each already known; never a
// Studio page's reads or a private answer. Lines are written as gzip members of their own, so the file reads up to
// its last write; going off air ends it. A recording with no game, or older than 60 days, is tidied away, and
// recording can be turned off.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { startStudio } = require('./support/studio');

const read = f => zlib.gunzipSync(fs.readFileSync(f), { finishFlush: zlib.constants.Z_SYNC_FLUSH }).toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

test('the recorder keeps only changes, starts with what it already knows, and tidies away what has no game or is old', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-recorder-'));
  try {
    const recordings = path.join(dir, 'Recordings');
    fs.mkdirSync(recordings);
    // Left from earlier: one night with a game, one with none (set up only), one too old.
    const member = lines => zlib.gzipSync(lines.map(l => JSON.stringify(l)).join('\n') + '\n');
    fs.writeFileSync(path.join(recordings, '2026-10-01 1900.jsonl.gz'), member([{ t: 1, k: 'start' }, { t: 2, k: 'game', id: 'g1', home: 'A', away: 'B' }]));
    fs.writeFileSync(path.join(recordings, '2026-10-02 1900.jsonl.gz'), member([{ t: 1, k: 'start' }]));
    const old = path.join(recordings, '2026-01-01 1900.jsonl.gz');
    fs.writeFileSync(old, member([{ t: 1, k: 'start' }, { t: 2, k: 'game', id: 'g0' }]));
    const longAgo = new Date(Date.now() - 61 * 86400000);
    fs.utimesSync(old, longAgo, longAgo);

    const recorder = require('../recorder');
    recorder.init(() => {}, { dir: recordings, settings: path.join(dir, 'recordings.json'), start: { version: '9.9.9', competition: 'thunder' } });
    const names = fs.readdirSync(recordings).sort();
    assert.deepEqual(names, ['2026-10-01 1900.jsonl.gz'], 'the set-up-only and the old one are gone, and none is started with no game');
    const now = recorder.state();
    assert.equal(now.record, true);
    assert.equal(now.recording, '', 'on air with no game: nothing recorded');

    recorder.scene({ sources: [1] }, JSON.stringify({ sources: [1] }));
    recorder.scene({ sources: [1] }, JSON.stringify({ sources: [1] }));
    assert.equal(recorder.state().recording, '');
    recorder.board({ gameId: 'g7', home: { name: 'Stormz', score: 0 }, away: { name: 'Semi Pro', score: 0 }, division: 'Div 1', serverNow: 1 });
    recorder.board({ gameId: 'g7', home: { name: 'Stormz', score: 0 }, away: { name: 'Semi Pro', score: 0 }, division: 'Div 1', serverNow: 2 });
    recorder.board({ gameId: 'g7', home: { name: 'Stormz', score: 1 }, away: { name: 'Semi Pro', score: 0 }, division: 'Div 1', serverNow: 3 });
    recorder.action({ type: 'score', side: 'home', delta: 1 });
    recorder.playhq('gradeLadder', { gradeID: 'x' }, 'na', { ladder: 1 });
    recorder.playhq('gradeLadder', { gradeID: 'x' }, 'na', { ladder: 1 });
    recorder.live('g7', { data: { game: { id: 'g7' } } });
    recorder.live('g7', { errors: [{ message: 'not electronically scored' }] });
    const graphic = () => true;
    recorder.answer({ method: 'GET', url: '/api/ladder?division=1', headers: {} }, 200, '{"rows":[1],"serverNow":5}', undefined, graphic);
    recorder.answer({ method: 'GET', url: '/api/ladder?division=1', headers: {} }, 200, '{"rows":[1],"serverNow":6}', undefined, graphic);
    recorder.answer({ method: 'GET', url: '/api/teams', headers: {} }, 200, '{}', undefined, () => false);
    recorder.answer({ method: 'POST', url: '/api/scoreboard', headers: {} }, 200, '{}', undefined, graphic);
    recorder.answer({ method: 'GET', url: '/api/stats', headers: {} }, 500, '{}', undefined, graphic);

    const r = recorder.list().find(x => x.recording);
    assert.deepEqual(r.games.map(g => [g.id, g.home, g.away, g.division]), [['g7', 'Stormz', 'Semi Pro', 'Div 1']]);
    const lines = recorder.read(r.name);
    const kinds = lines.map(l => l.k);
    assert.deepEqual(kinds, ['start', 'game', 'scene', 'board', 'board', 'action', 'playhq', 'live', 'live', 'api'], 'the scene from before the game, then each change');
    assert.match(r.name, /^\d{4}-\d{2}-\d{2} \d{4} Stormz v Semi Pro\.jsonl\.gz$/, 'named after the game');
    assert.equal(lines[0].version, '9.9.9');
    assert.equal(lines[4].board.home.score, 1);
    assert.deepEqual(lines[6], { t: lines[6].t, k: 'playhq', op: 'gradeLadder', vars: { gradeID: 'x' }, tenant: 'na', data: { ladder: 1 } });
    assert.deepEqual(lines[8].errors, [{ message: 'not electronically scored' }]);
    assert.equal(lines[9].p, '/api/ladder?division=1');

    assert.match(recorder.remove(r.name), /still being made/);
    assert.match(recorder.remove('../recordings.json'), /no recording/);
    assert.equal(recorder.remove('2026-10-01 1900.jsonl.gz'), null);

    // Off: the recording ends; on again: a new one starts, as the game is still due.
    recorder.setRecord(false);
    assert.equal(recorder.state().recording, '');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'recordings.json'), 'utf8')).record, false);
    assert.equal(recorder.read(r.name).at(-1).k, 'end');
    recorder.scene({ sources: [2] }, JSON.stringify({ sources: [2] }));
    assert.equal(recorder.read(r.name).at(-1).k, 'end', 'nothing more once off');
    recorder.setRecord(true, {});
    assert.ok(recorder.state().recording);
    recorder.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a recording follows its game: due before the start, stopped after full time or by the next game', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-recorder-'));
  const recorder = require('../recorder');
  try {
    const recordings = path.join(dir, 'Recordings');
    const settings = path.join(dir, 'recordings.json');
    recorder.init(() => {}, { dir: recordings, settings, start: () => ({ version: '9.9.9' }), lead: () => 10 * 60000 });
    const two = n => String(n).padStart(2, '0');
    const at = ms => { const d = new Date(ms); return { date: `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`, time: `${two(d.getHours())}:${two(d.getMinutes())}` }; };
    const startMs = Math.ceil((Date.now() + 30 * 60000) / 60000) * 60000; // half an hour away, on the minute
    const game = (id, extra = {}) => ({ gameId: id, ...at(startMs), home: { name: 'Fliers', score: 0 }, away: { name: 'Gold/Coast', score: 0 }, ...extra });

    recorder.board(game('a1'));
    assert.equal(recorder.state().recording, '', 'not due yet');
    assert.equal(recorder.state().waiting.from, startMs - 10 * 60000, 'due ten minutes before the start');
    recorder.check(startMs - 11 * 60000);
    assert.equal(recorder.state().recording, '');
    recorder.check(startMs - 10 * 60000);
    const first = recorder.state().recording;
    assert.match(first, / Fliers v Gold Coast\.jsonl\.gz$/, 'a slash isn\'t put in the name');

    // PlayHQ says it's finished: it keeps going for the minutes after full time, then stops for good.
    recorder.setAfter(5);
    assert.equal(JSON.parse(fs.readFileSync(settings, 'utf8')).afterMinutes, 5);
    recorder.board(game('a1', { playhqStatus: 'COMPLETED' }));
    const ft = Date.now();
    recorder.check(ft + 4 * 60000);
    assert.equal(recorder.state().recording, first, 'still recording after full time');
    recorder.check(ft + 5 * 60000 + 1000);
    assert.equal(recorder.state().recording, '', 'stopped after full time');
    assert.deepEqual(recorder.read(first).at(-1), { ...recorder.read(first).at(-1), k: 'end', why: 'full time' });
    recorder.check(ft + 6 * 60000);
    assert.equal(recorder.state().recording, '', 'not started again for the same game');
    assert.match(recorder.state().waiting.why, /stopped/);

    // The next game: a game PlayHQ already says is finished isn't recorded; one due is, and the next game stops it.
    recorder.board(game('a2', { ...at(Date.now()), playhqStatus: 'FINAL' }));
    assert.equal(recorder.state().recording, '');
    assert.match(recorder.state().waiting.why, /finished/);
    recorder.board(game('a3', { ...at(Date.now()) }));
    const third = recorder.state().recording;
    assert.ok(third, 'a game due now records straight away');
    recorder.board(game('a4', { ...at(Date.now()), home: { name: 'Next', score: 0 } }));
    assert.equal(recorder.read(third).at(-1).why, 'next game');
    const fourth = recorder.state().recording;
    assert.ok(fourth && fourth !== third);
    assert.deepEqual(recorder.read(fourth).filter(l => l.k === 'game').map(l => l.id), ['a4'], 'one game a recording');
    assert.equal(recorder.read(fourth).filter(l => l.k === 'board').at(-1).board.gameId, 'a4');

    // Hand scoring: PlayHQ never says it's finished, so it stops four hours after the start.
    recorder.check(Date.now() + 4 * 3600000 + 60000);
    assert.equal(recorder.read(fourth).at(-1).why, 'too long');

    // A board with no game: nothing.
    recorder.board({ gameId: null, home: { name: 'Home' }, away: { name: 'Away' } });
    assert.equal(recorder.state().recording, '');
    assert.equal(recorder.state().waiting, null);
  } finally { recorder.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a PlayHQ game on air is recorded, a graphic\'s reads but not a Studio page\'s, and going off air ends it', async t => {
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const game = studio.world.gameNow(0);
  await studio.until(async () => (await studio.get('/api/scoreboard')).gameId);
  await studio.post('/api/scoreboard', { type: 'score', side: 'home', delta: 1 });
  const graphic = { referer: `${studio.base}/ladder.html?division=1` };
  await studio.request('GET', '/api/scoreboard', undefined, graphic);
  await studio.request('GET', '/api/teams', undefined, { referer: `${studio.base}/control.html` });
  await studio.request('GET', '/api/athletes', undefined, graphic);

  const s = await studio.get('/api/recordings');
  assert.equal(s.record, true);
  const r = s.recordings.find(x => x.recording);
  assert.ok(r, 'one is being made');
  assert.ok(r.games.some(g => g.id === game.id && g.home === game.home && g.away === game.away), 'the game is a chapter');

  const file = path.join(studio.dataDir, 'Recordings', r.name);
  let lines = read(file);
  const kinds = new Set(lines.map(l => l.k));
  for (const k of ['start', 'game', 'playhq', 'board', 'scene', 'action', 'api']) assert.ok(kinds.has(k), `has ${k}`);
  assert.ok(lines.some(l => l.k === 'action' && l.action.type === 'score'));
  const reads = lines.filter(l => l.k === 'api').map(l => l.p);
  assert.ok(reads.includes('/api/scoreboard'), 'a graphic\'s read');
  assert.ok(!reads.includes('/api/teams'), 'not the control page\'s');
  assert.ok(!reads.includes('/api/athletes'), 'never a private one');
  assert.ok(!JSON.stringify(lines).includes('x-studio-deck'), 'no keys');

  // The file downloads, and the recordings are private reads.
  const dl = await studio.request('GET', `/api/recordings/${encodeURIComponent(r.name)}/file`);
  assert.equal(dl.status, 200);
  assert.match(dl.type, /gzip/);
  assert.equal((await studio.request('DELETE', `/api/recordings/${encodeURIComponent(r.name)}`)).status, 400, 'not while being made');

  studio.child.kill();
  await studio.exitedPromise;
  lines = read(file);
  assert.equal(lines.at(-1).k, 'end', 'off air ends the recording');
});
