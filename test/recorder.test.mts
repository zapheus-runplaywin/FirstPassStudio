// The game recordings (recorder.ts): each PlayHQ game on air is one file in Recordings/, from when it's due on the
// scoreboard to a set time after full time, with what PlayHQ said, each scoreboard action, and what went to air (the
// scene, the board, a graphic's reads), only when it changed, starting with the last of each already known; never a
// Studio page's reads or a private answer. Lines are written as gzip members of their own, so the file reads up to
// its last write; going off air ends it. A recording with no game, or older than 60 days, is tidied away, and
// recording can be turned off.
import { createRequire } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { startStudio, type Json } from './support/studio.mts';

const require = createRequire(import.meta.url);

const read = (f: Json) => zlib.gunzipSync(fs.readFileSync(f), { finishFlush: zlib.constants.Z_SYNC_FLUSH }).toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

test('the recorder keeps only changes, starts with what it already knows, and tidies away what has no game or is old', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-recorder-'));
  try {
    const recordings = path.join(dir, 'Recordings');
    fs.mkdirSync(recordings);
    // Left from earlier: one night with a game, one with none (set up only), one too old.
    const member = (lines: Json) => zlib.gzipSync(lines.map((l: Json) => JSON.stringify(l)).join('\n') + '\n');
    fs.writeFileSync(path.join(recordings, '2026-10-01 1900.jsonl.gz'), member([{ t: 1, k: 'start' }, { t: 2, k: 'game', id: 'g1', home: 'A', away: 'B' }]));
    fs.writeFileSync(path.join(recordings, '2026-10-02 1900.jsonl.gz'), member([{ t: 1, k: 'start' }]));
    const old = path.join(recordings, '2026-01-01 1900.jsonl.gz');
    fs.writeFileSync(old, member([{ t: 1, k: 'start' }, { t: 2, k: 'game', id: 'g0' }]));
    const longAgo = new Date(Date.now() - 61 * 86400000);
    fs.utimesSync(old, longAgo, longAgo);

    const recorder = require('../out/recorder');
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

    const r = recorder.list().find((x: Json) => x.recording);
    assert.deepEqual(r.games.map((g: Json) => [g.id, g.home, g.away, g.division]), [['g7', 'Stormz', 'Semi Pro', 'Div 1']]);
    const lines = recorder.read(r.name);
    const kinds = lines.map((l: Json) => l.k);
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
  const recorder = require('../out/recorder');
  try {
    const recordings = path.join(dir, 'Recordings');
    const settings = path.join(dir, 'recordings.json');
    recorder.init(() => {}, { dir: recordings, settings, start: () => ({ version: '9.9.9' }), lead: () => 10 * 60000 });
    const two = (n: Json) => String(n).padStart(2, '0');
    const at = (ms: number) => { const d = new Date(ms); return { date: `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`, time: `${two(d.getHours())}:${two(d.getMinutes())}` }; };
    const startMs = Math.ceil((Date.now() + 30 * 60000) / 60000) * 60000; // half an hour away, on the minute
    const game = (id: string, extra = {}) => ({ gameId: id, ...at(startMs), home: { name: 'Fliers', score: 0 }, away: { name: 'Gold/Coast', score: 0 }, ...extra });

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
    assert.deepEqual(recorder.read(fourth).filter((l: Json) => l.k === 'game').map((l: Json) => l.id), ['a4'], 'one game a recording');
    assert.equal(recorder.read(fourth).filter((l: Json) => l.k === 'board').at(-1).board.gameId, 'a4');

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
  const r = s.recordings.find((x: Json) => x.recording);
  assert.ok(r, 'one is being made');
  assert.ok(r.games.some((g: Json) => g.id === game.id && g.home === game.home && g.away === game.away), 'the game is a chapter');

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

test('each game followed in the background gets a recording of its own: what PlayHQ said, from its first reading to after full time', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-recorder-'));
  const recorder = require('../out/recorder');
  try {
    const recordings = path.join(dir, 'Recordings');
    recorder.init(() => {}, { dir: recordings, settings: path.join(dir, 'recordings.json'), start: { version: '9.9.9', competition: 'thunder' } });
    recorder.setRecord(true);
    recorder.setAfter(10);
    recorder.playhq('discoverFixtureByRound', { roundID: 'r3' }, 'na', { games: 1 }); // known before the game is read
    recorder.live('g9', { data: { game: { id: 'g9', n: 0 } } });
    const g = { gameId: 'g9', home: 'Titans', away: 'Tsunamiz', court: 'Court 2', division: 'Division 2', round: 'Round 3', date: '2026-11-09', time: '19:30:00' };
    const now = Date.now();
    recorder.followGames([{ ...g, started: false }], now);
    assert.equal(recorder.state().followed.length, 0, 'nothing until Studio has read the game');
    recorder.followGames([{ ...g, started: true }], now);
    const [name] = recorder.state().followed;
    assert.match(name, /^\d{4}-\d{2}-\d{2} \d{4} Titans v Tsunamiz \(followed\)\.jsonl\.gz$/);
    recorder.live('g9', { data: { game: { id: 'g9', n: 1 } } });
    recorder.live('g9', { data: { game: { id: 'g9', n: 1 } } }); // the same again: not recorded twice
    recorder.live('other', { data: { game: { id: 'other' } } }); // another game's isn't in it
    recorder.playhq('gradeLadder', { gradeID: 'x' }, 'na', { ladder: 'new' });
    const listed = recorder.list().find((r: Json) => r.name === name);
    assert.equal(listed.followed, true);
    assert.equal(listed.recording, true);
    assert.deepEqual(listed.games.map((x: Json) => [x.id, x.court, x.date, x.time, x.followed]), [['g9', 'Court 2', '2026-11-09', '19:30:00', true]]);
    let lines = recorder.read(name);
    assert.deepEqual(lines.slice(0, 2).map((l: Json) => l.k), ['start', 'game']);
    assert.equal(lines[0].followed, true);
    assert.ok(lines.some((l: Json) => l.k === 'playhq' && l.op === 'discoverFixtureByRound'), 'starts with what PlayHQ already said');
    assert.deepEqual(lines.at(-1).data, { ladder: 'new' }, 'and every PlayHQ answer from then on');
    assert.deepEqual(lines.filter((l: Json) => l.k === 'live').map((l: Json) => l.data.game.n), [0, 1]);
    assert.match(recorder.remove(name), /still being made/);
    // Finished: kept going for the minutes after full time, then stopped, and not started again.
    recorder.followGames([{ ...g, started: true, done: true }], now);
    recorder.followGames([{ ...g, started: true, done: true }], now + 9 * 60000);
    assert.equal(recorder.state().followed.length, 1);
    recorder.followGames([{ ...g, started: true, done: true }], now + 10 * 60000);
    assert.equal(recorder.state().followed.length, 0);
    recorder.followGames([{ ...g, started: true }], now + 11 * 60000);
    assert.equal(recorder.state().followed.length, 0, 'not started again');
    lines = recorder.read(name);
    assert.deepEqual(lines.at(-1), { t: lines.at(-1).t, k: 'end', why: 'full time' });
    // A game no longer followed (picked for the scoreboard) stops at once; off air stops the rest.
    recorder.followGames([{ ...g, gameId: 'g10', started: true }, { ...g, gameId: 'g11', started: true }]);
    assert.equal(recorder.state().followed.length, 2);
    recorder.followGames([{ ...g, gameId: 'g11', started: true }]);
    assert.equal(recorder.state().followed.length, 1);
    recorder.closeFollowed();
    assert.equal(recorder.state().followed.length, 0);
    assert.equal(recorder.list().filter((r: Json) => r.followed).length, 3);
  } finally { recorder.closeFollowed(); recorder.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the Mark moment key is off until turned on, then notes the quarter and the clock in the game being recorded', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-recorder-'));
  const recorder = require('../out/recorder');
  try {
    const settings = path.join(dir, 'recordings.json');
    recorder.init(() => {}, { dir: path.join(dir, 'Recordings'), settings, start: { version: '9.9.9' } });
    const at = (period: Json, clockMs: Json) => () => ({ period, clockMs });
    assert.equal(recorder.state().marks, false, 'off by default');

    // Off: nothing is marked, even with a game recording.
    recorder.board({ gameId: 'm1', home: { name: 'Stormz' }, away: { name: 'Semi Pro' } });
    const first = recorder.state().recording;
    assert.ok(first);
    assert.deepEqual(recorder.mark(at(1, 300000)), { error: 'The Mark moment key is turned off. Turn it on on the Recordings page.', status: 409 });
    assert.deepEqual(recorder.deck(['mark'], at(1, 300000)), { status: 409, body: { error: 'The Mark moment key is turned off. Turn it on on the Recordings page.' } });
    assert.ok(!recorder.read(first).some((l: Json) => l.k === 'mark'));

    // On: kept in recordings.json beside the other settings, and each press is a line in the same form as a Vantage flag.
    recorder.setMarks(true);
    assert.deepEqual(JSON.parse(fs.readFileSync(settings, 'utf8')), { record: true, afterMinutes: 10, marks: true });
    assert.deepEqual(recorder.deck(['mark'], at(2, 462000)), { status: 200, body: { ok: true, marked: 1 } });
    assert.deepEqual(recorder.mark(at(2, 301499.6)), { marked: 2 });
    assert.equal(recorder.state().marked, 2);
    const marks = recorder.read(first).filter((l: Json) => l.k === 'mark');
    assert.deepEqual(marks.map((l: Json) => l.flag), [{ period: 2, clockMs: 462000 }, { period: 2, clockMs: 301500 }]);
    assert.ok(marks.every((l: Json) => /^[0-9a-f-]{36}$/.test(l.id) && Math.abs(l.t - Date.now()) < 5000), 'each has an id and the time it was pressed');
    assert.notEqual(marks[0].id, marks[1].id);
    assert.deepEqual(Object.keys(marks[0]).sort(), ['flag', 'id', 'k', 't'], 'nothing else is kept with a mark');

    // A board that can't say the quarter or the clock still marks the moment: the time of the press is what finds it.
    recorder.mark(at(undefined, null));
    recorder.mark(at('x', -5));
    assert.deepEqual(recorder.read(first).filter((l: Json) => l.k === 'mark').slice(2).map((l: Json) => l.flag), [{ period: 1, clockMs: 0 }, { period: 1, clockMs: 0 }]);

    // Only /deck/mark is the mark link.
    assert.equal(recorder.deck(['home', 'add1'], at(1, 0)), null);
    assert.equal(recorder.deck(['mark', 'twice'], at(1, 0)).status, 404);

    // A practice game isn't the real game: nothing is marked while one runs.
    recorder.pause(true);
    assert.equal(recorder.mark(at(1, 0)).status, 409);
    assert.match(recorder.mark(at(1, 0)).error, /practice game or 4K replay/);
    recorder.pause(false);
    assert.equal(recorder.read(first).filter((l: Json) => l.k === 'mark').length, 4);

    // The next game starts its own count, and the setting is remembered by the next Studio.
    recorder.board({ gameId: 'm2', home: { name: 'Fliers' }, away: { name: 'Gold' } });
    assert.notEqual(recorder.state().recording, first);
    assert.equal(recorder.state().marked, 0);
    assert.deepEqual(recorder.mark(at(1, 600000)), { marked: 1 });
    assert.equal(recorder.read(first).filter((l: Json) => l.k === 'mark').length, 4, 'the first game keeps its own');
    recorder.close();
    assert.match(recorder.mark(at(1, 0)).error, /No game is being recorded/);
    assert.equal(recorder.state().marked, 0);
    recorder.init(() => {}, { dir: path.join(dir, 'Recordings'), settings, start: { version: '9.9.9' } });
    assert.equal(recorder.state().marks, true);
    recorder.setMarks(false);
    assert.equal(JSON.parse(fs.readFileSync(settings, 'utf8')).marks, false);
  } finally { recorder.close(); recorder.setMarks(false); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the Mark moment link and its switch work through Studio, and a mark is somewhere a replay can jump to', async t => {
  const studio = await startStudio(t, { competition: 'Thunder League' });
  await studio.until(async () => (await studio.get('/api/scoreboard')).gameId);
  await studio.until(async () => (await studio.get('/api/recordings')).recording);

  // Off until turned on: the key answers why, and marks nothing.
  assert.equal((await studio.get('/api/recordings')).marks, false);
  const off = await studio.request('GET', '/deck/mark');
  assert.equal(off.status, 409);
  assert.match(off.text, /turned off/);

  // The Recordings page's switch, sent the way the page sends it.
  assert.equal((await studio.request('POST', '/api/recordings', { marks: 'yes' })).status, 400);
  assert.equal((await studio.post('/api/recordings', { marks: true })).marks, true);
  assert.equal((await studio.get('/api/recordings')).record, true, 'recording itself is untouched');

  for (const link of ['/deck/source/manual', '/deck/clock/playhq/off', '/deck/clock/stop', '/deck/quarter/2', '/deck/clock/set/7:42']) assert.equal((await studio.request('GET', link)).status, 200, link);
  const on = await studio.request('GET', '/deck/mark');
  assert.equal(on.status, 200);
  assert.deepEqual(on.json, { ok: true, marked: 1 });
  const s = await studio.get('/api/recordings');
  assert.equal(s.marked, 1);

  const file = path.join(studio.dataDir, 'Recordings', s.recording);
  await studio.request('GET', `/api/recordings/${encodeURIComponent(s.recording)}/file`); // writes what's pending
  const marks = read(file).filter(l => l.k === 'mark');
  assert.deepEqual(marks.map(l => l.flag), [{ period: 2, clockMs: 462000 }]);

  // The replay's jump list names it with what went on air.
  const replay = require('../out/replay');
  replay.init(() => {}, { read: () => read(file) });
  const loaded = replay.load(s.recording);
  assert.ok(loaded.events.some((e: Json) => e.label === 'Marked moment · Q2 7:42 left' && e.t === marks[0].t));

  // Turned off again, the key stops.
  await studio.post('/api/recordings', { marks: false });
  assert.equal((await studio.request('GET', '/deck/mark')).status, 409);
  assert.equal(read(file).filter(l => l.k === 'mark').length, 1);
});
