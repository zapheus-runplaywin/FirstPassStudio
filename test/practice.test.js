// Practice games (practice.js): a recorded game plays back as if it were live. PlayHQ isn't asked anything; the
// recording answers instead, with its times moved to now, so the game starts five minutes from now (or is wherever
// it was jumped to). The scoreboard follows it like a real game, pausing stops its clock, and stopping puts the
// scoreboard back as it was. Nothing it does is recorded as a night.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { startStudio } = require('./support/studio');
const practice = require('../practice');
const { localZone } = require('./support/playhq');

// Dates and times here are read in the time zone Studio runs in for the tests.
process.env.TZ = localZone().tz;

const two = n => String(n).padStart(2, '0');
const dateOf = ms => { const d = new Date(ms); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`; };
const timeOf = ms => { const d = new Date(ms); return `${two(d.getHours())}:${two(d.getMinutes())}:00`; };

test('a recorded answer\'s dates and times move together, by the gap to now', () => {
  const at = new Date('2026-10-20T19:30:00').getTime();
  const gap = new Date('2026-10-30T08:15:00').getTime() - at;
  const moved = practice.shift({
    games: [{ id: 'g', date: '2026-10-20', dates: ['2026-10-20'], allocation: { time: '19:30:00', court: { name: 'Court 1' } } }],
    game: { date: '2026-10-20' },
    clock: { time: '07:30', status: 'RESUME', lastUpdatedAt: String(at) },
    updatedAt: '2026-10-20T08:30:00.000Z',
    score: 31,
  }, gap);
  assert.deepEqual(moved.games[0], { id: 'g', date: '2026-10-30', dates: ['2026-10-30'], allocation: { time: '08:15:00', court: { name: 'Court 1' } } });
  assert.equal(moved.game.date, '2026-10-30', 'a date on its own moves too');
  assert.equal(moved.clock.lastUpdatedAt, String(at + gap));
  assert.equal(moved.clock.time, '07:30', 'the time left on the clock is not a time of day');
  assert.equal(moved.updatedAt, new Date(Date.parse('2026-10-20T08:30:00.000Z') + gap).toISOString());
  assert.equal(moved.score, 31);
});

// A recorded night, three days ago: the game starts at T0, is 5-3 in the second quarter 20 minutes in, and
// finishes 30-25.
function recording(dir, game) {
  const T0 = Math.floor((Date.now() - 3 * 86400000) / 60000) * 60000;
  const stat = (type, count) => ({ type: { value: type }, count });
  const live = (t, home, away, period, status = 'IN_PROGRESS') => ({ t, k: 'live', id: game.id, data: { game: {
    id: game.id, status, break: null,
    statistics: { home: { statisticsV2: [stat('TOTAL_SCORE', home)] }, away: { statisticsV2: [stat('TOTAL_SCORE', away)] } },
    result: { home: { statistics: [stat('TOTAL_SCORE', home)] }, away: { statistics: [stat('TOTAL_SCORE', away)] }, currentPeriod: { value: period } },
    clock: { period, periodValue: period, status: status === 'IN_PROGRESS' ? 'RESUME' : 'PAUSE', time: '08:00', lastUpdatedAt: String(t) } } } });
  const lines = [
    { t: T0 - 30 * 60000, k: 'start', version: 'test', competition: 'thunder-league' },
    { t: T0 - 20 * 60000, k: 'game', id: game.id, home: game.home, away: game.away, division: game.division, round: 'Round 3', court: game.court },
    { t: T0 - 20 * 60000, k: 'board', board: { gameId: game.id, roundId: game.roundId, division: game.division, court: game.court, date: dateOf(T0), time: timeOf(T0),
      home: { name: game.home, score: 0 }, away: { name: game.away, score: 0 }, serverNow: 1 } },
    { t: T0 - 15 * 60000, k: 'live', id: game.id, errors: [{ message: 'The game could not be found or was not electronically scored' }] },
    live(T0 + 60000, 0, 0, 'FIRST_QTR'),
    live(T0 + 20 * 60000, 5, 3, 'SECOND_QTR'),
    live(T0 + 60 * 60000, 30, 25, 'FOURTH_QTR', 'FINAL'),
    { t: T0 + 70 * 60000, k: 'end' },
  ];
  const name = `${dateOf(T0)} ${timeOf(T0 - 30 * 60000).slice(0, 5).replace(':', '')}.jsonl.gz`;
  fs.mkdirSync(path.join(dir, 'Recordings'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Recordings', name), zlib.gzipSync(lines.map(l => JSON.stringify(l)).join('\n') + '\n'));
  return { name, T0 };
}

test('a practice game plays a recording as if live, from PlayHQ\'s answers moved to now, and leaves the scoreboard as it was', async t => {
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const real = studio.world.gameNow(0);
  await studio.until(async () => (await studio.get('/api/scoreboard')).gameId === real.id);
  await studio.post('/api/scoreboard', { type: 'playhqRefresh', value: 1 });
  await studio.post('/api/scoreboard', { type: 'score', side: 'home', delta: 2 });
  const before = await studio.get('/api/scoreboard');

  // Another game of the season, recorded three days ago.
  const game = studio.world.divisions[1].rounds[2].games[1];
  const { name } = recording(studio.dataDir, game);
  const list = await studio.get('/api/recordings');
  assert.ok(list.recordings.some(r => r.name === name && r.games.some(g => g.id === game.id)), 'it\'s listed');

  const s = await studio.post('/api/practice', { start: { recording: name, game: game.id, lead: 10 } });
  assert.equal(s.active, true);
  assert.deepEqual(s.jumps.map(j => j.label), ['Start', 'Q1', 'Q2', 'Q4', 'Full time']);
  const asked = studio.calls().length;
  const board = () => studio.get('/api/scoreboard');
  let b = await board();
  assert.equal(b.gameId, game.id);
  assert.equal(b.home.name, game.home);
  assert.equal(b.date, dateOf(Date.now()), 'the game is today');
  const startsIn = new Date(`${b.date}T${b.time}`).getTime() - Date.now();
  assert.ok(startsIn > 8.5 * 60000 && startsIn < 11 * 60000, `starts about ten minutes from now, as asked (${Math.round(startsIn / 1000)}s)`);
  const atStart = (await studio.post('/api/practice', { jump: 'start', lead: 0 })).position;
  const startAt = (await studio.get('/api/practice')).jumps[0].at;
  assert.ok(atStart - startAt >= 0 && atStart - startAt < 2000, 'Start can be moved to the first centre pass (playing on from there)');
  b = await board();
  assert.ok(Math.abs(new Date(`${b.date}T${b.time}`).getTime() - Date.now()) < 90000, 'which is now');
  assert.equal(b.home.score, 0);

  // Q2: the score as it was 20 minutes in, read from the recording.
  await studio.post('/api/practice', { jump: 'SECOND_QTR' });
  b = await studio.until(async () => { const x = await board(); return x.home.score === 5 && x.away.score === 3 && x; });
  assert.equal(b.source, 'playhq');

  // Paused, the recording stands still.
  const p1 = (await studio.post('/api/practice', { pause: true })).position;
  await new Promise(r => setTimeout(r, 1200));
  const p2 = (await studio.get('/api/practice')).position;
  assert.equal(p2, p1);
  const played = (await studio.post('/api/practice', { pause: false })).position;
  assert.equal(played, p1);

  await studio.post('/api/practice', { jump: 'end' });
  await studio.until(async () => { const x = await board(); return x.home.score === 30 && x.away.score === 25; });
  assert.equal(studio.calls().length, asked, 'PlayHQ wasn\'t asked anything');

  // The night's recording didn't record the practice.
  const night = (await studio.get('/api/recordings')).recordings.find(r => r.recording);
  const lines = zlib.gunzipSync(fs.readFileSync(path.join(studio.dataDir, 'Recordings', night.name)), { finishFlush: zlib.constants.Z_SYNC_FLUSH })
    .toString().split('\n').filter(Boolean).map(l => JSON.parse(l));
  const on = lines.findIndex(l => l.k === 'practice' && l.on);
  assert.ok(on > 0, 'the practice start is noted');
  assert.ok(!lines.slice(on + 1).some(l => l.k !== 'practice'), 'and nothing after it');

  // Stop: the scoreboard as it was.
  assert.equal((await studio.post('/api/practice', { stop: true })).active, false);
  b = await board();
  assert.equal(b.gameId, before.gameId);
  assert.equal(b.home.score, before.home.score);
  assert.equal(b.autoSelect, before.autoSelect);
  assert.match((await studio.request('POST', '/api/practice', { jump: 'start' })).text, /No practice game/);
});
