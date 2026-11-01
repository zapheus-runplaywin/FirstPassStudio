// The Production Planner (planner.js, planner.html): the commentator pool, a court and commentators per game night,
// nights that take the plan of the night before, the plan setting Scoreboard control's court, flags when the
// scoreboard is on something else, and the Commentators graphic reading who is on the mic.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio');
const { createWorld } = require('./support/playhq');

let studio;
test.before(async () => {
  studio = await startStudio(null, { competition: 'Thunder League', world: createWorld() });
  await studio.until(async () => (await studio.get('/api/scoreboard')).gameId);
});
test.after(() => studio && studio.stop());

const get = p => studio.get(p);
const post = (p, body) => studio.post(p, body);

test('the planner lists every game night of the season, with its courts and games', async () => {
  const p = await get('/api/planner');
  assert.equal(p.nights.length, 4);
  assert.equal(p.next, studio.world.today, 'opens on the next game night (tonight)');
  const tonight = p.nights.find(n => n.date === studio.world.today);
  assert.deepEqual(tonight.courts, ['Court 1', 'Court 2']);
  assert.equal(tonight.court, '', 'not planned yet');
  assert.equal(tonight.games.length, 4);
  assert.deepEqual(p.pool, []);
  assert.deepEqual((await get('/api/planner/onair')).names, [], 'nobody on the mic without a plan');
});

test('a pool, a night\'s plan, nights after it, and the scoreboard\'s court', async () => {
  let p = await post('/api/planner/pool', { pool: [{ name: 'Honey Harrington', guest: true }, { name: 'Will  Linter' }, { name: 'Sam Lee' }, { name: 'honey harrington' }] });
  assert.deepEqual(p.pool.map(x => x.name), ['Honey Harrington', 'Will Linter', 'Sam Lee'], 'spaces tidied, the same name once');
  const [honey, will, sam] = p.pool;

  // Tonight on Court 2, so the plan has to move Scoreboard control off Court 1.
  await post('/api/scoreboard', { type: 'autoCourt', value: 'Court 1' });
  const before = p.nights.find(n => n.date === studio.world.today);
  const times = before.games.filter(g => g.court === 'Court 2').map(g => g.time).sort();
  p = await post('/api/planner/night', { date: studio.world.today, court: 'Court 2', slots: { [times[0]]: [will.id, honey.id, sam.id, 'nobody'], [times[1]]: [sam.id] } });
  const tonight = p.nights.find(n => n.date === studio.world.today);
  assert.equal(tonight.court, 'Court 2');
  assert.ok(tonight.planned);
  assert.deepEqual(tonight.slots.map(s => s.people.length), [3, 1], 'three at most, people not in the pool dropped');

  const b = await studio.until(async () => { const s = await get('/api/scoreboard'); return s.autoCourt === 'Court 2' && s; });
  assert.ok(b.autoSelect, 'following the planned court turns automatic selection on');
  assert.match(b.planCourt, /\|Court 2$/);
  const due = tonight.slots.find(s => s.game && s.game.id === b.gameId);
  assert.ok(due, 'the scoreboard is on one of the planned games');
  const on = await get('/api/planner/onair');
  assert.deepEqual(on.names, due.people.map(id => p.pool.find(x => x.id === id).name));
  // The fixture board: every game of the night by time and court, the planned court streamed with who calls each.
  const fb = await get('/api/planner/fixtureboard');
  assert.equal(fb.date, studio.world.today);
  assert.equal(fb.court, 'Court 2');
  assert.deepEqual(fb.courts, ['Court 1', 'Court 2']);
  const all = fb.slots.flatMap(x => x.games);
  assert.equal(all.length, tonight.games.length, 'every game of the night, all courts');
  assert.ok(all.filter(g => g.court === 'Court 1').every(g => !g.streamed && !g.people.length), 'only the streamed court names commentators');
  assert.deepEqual(all.find(g => g.onAir).people.map(x => x.name), on.names);
  assert.deepEqual(all.filter(g => g.streamed)[0].people.find(x => x.name === 'Honey Harrington'), { name: 'Honey Harrington', guest: true, headshot: null });
  const later = await get(`/api/planner/fixtureboard?date=${p.nights[3].date}`);
  assert.equal(later.court, 'Court 2', 'another night, taking tonight\'s plan');
  assert.ok(later.slots.every(x => x.games.every(g => !g.onAir)));

  // The nights after it take tonight's plan; next week can have its own.
  const next = p.nights.find(n => n.date > studio.world.today);
  assert.equal(next.court, 'Court 2');
  assert.equal(next.from, studio.world.today);
  // (The stand-in PlayHQ has both divisions' next week games on a court at one time, so it has one slot there.)
  assert.deepEqual(next.slots[0].people, tonight.slots[0].people, 'slot by slot, first game to first game');

  // A court picked by hand stays, and the planner flags it.
  await post('/api/scoreboard', { type: 'autoCourt', value: 'Court 1' });
  await new Promise(r => setTimeout(r, 300));
  assert.equal((await get('/api/scoreboard')).autoCourt, 'Court 1', 'the plan doesn\'t undo a court changed by hand');
  p = await get('/api/planner');
  assert.ok(p.tonight.flags.some(f => f.kind === 'court' && /Court 1/.test(f.text) && /Court 2/.test(f.text)));
  assert.ok(p.tonight.flags.some(f => f.kind === 'game'), 'the game on the scoreboard isn\'t in tonight\'s plan');
  assert.deepEqual((await get('/api/planner/onair')).names, [], 'nobody planned for the Court 1 game');

  // Changing the plan's court for tonight sets it again.
  p = await post('/api/planner/night', { date: studio.world.today, court: 'Court 1', slots: {} });
  await studio.until(async () => (await get('/api/scoreboard')).autoCourt === 'Court 1');
  const court1 = p.nights.find(n => n.date === studio.world.today);
  assert.equal(court1.slots.length, 2);
  assert.ok(court1.slots.every(s => s.game && !s.people.length));

  // Taking someone out of the pool takes them out of every night.
  p = await post('/api/planner/pool', { pool: p.pool.filter(x => x.id !== sam.id) });
  assert.ok(p.nights.every(n => n.slots.every(s => !s.people.includes(sam.id))));
  // Back to the night before: tonight has no earlier plan, so it has none.
  p = await post('/api/planner/night', { date: studio.world.today, clear: true });
  assert.equal(p.nights.find(n => n.date === studio.world.today).court, '');
});

test('a slot keeps its commentators when PlayHQ moves its game, and says so', async () => {
  let p = await get('/api/planner');
  const n = p.nights[3];
  const court1 = n.games.filter(g => g.court === 'Court 1');
  const id = p.pool[0].id;
  p = await post('/api/planner/night', { date: n.date, court: 'Court 1', slots: { [court1[0].time]: [id] } });
  assert.ok(!p.nights[3].slots[0].changed);
  // As if PlayHQ had since moved that game away and put another in its place: the plan saved a different game.
  const fs = require('node:fs'), path = require('node:path');
  const dir = path.join(studio.dataDir, 'competitions');
  const file = path.join(dir, fs.readdirSync(dir).find(d => fs.existsSync(path.join(dir, d, 'planner.json'))), 'planner.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  saved.nights[n.date].slots[court1[0].time].game = { id: 'game-gone', home: 'Old Home', away: 'Old Away' };
  saved.nights[n.date].slots['23:59'] = { people: [id], game: { id: 'game-moved', home: 'Moved Home', away: 'Moved Away' } };
  fs.writeFileSync(file, JSON.stringify(saved));
  const v = (await get('/api/planner')).nights[3];
  const swapped = v.slots.find(s => s.time === court1[0].time);
  assert.deepEqual(swapped.people, [id], 'the people stay in the slot');
  assert.equal(swapped.changed.was, 'Old Home v Old Away');
  const gone = v.slots.find(s => s.time === '23:59');
  assert.equal(gone.game, null, 'a slot with no game now is still shown, so its people can be moved');
  assert.equal(gone.changed.was, 'Moved Home v Moved Away');
});

test('the fixture board says which games are done, live and next, with live scores and the winner', async () => {
  let p = await get('/api/planner');
  const id = p.pool[0].id;
  const games = (await get('/api/games')).filter(g => g.court === 'Court 1' && g.date === studio.world.today).sort((a, b) => a.time.localeCompare(b.time));
  p = await post('/api/planner/night', { date: studio.world.today, court: 'Court 1', slots: { [games[0].time.slice(0, 5)]: [id] } });
  await post('/api/scoreboard', { type: 'selectGame', game: games[0] });
  await post('/api/scoreboard', { type: 'score', side: 'home', delta: 3 });
  const find = (r, gid) => r.slots.flatMap(x => x.games).find(g => g.id === gid);
  let r = await get('/api/planner/fixtureboard');
  let g0 = find(r, games[0].id);
  assert.equal(g0.state, 'live', 'scored, so live');
  assert.deepEqual(g0.score, { home: 3, away: 0 }, 'the scoreboard\'s score');
  assert.match(g0.period, /^Q\d$/);
  // The other division's game being played now is live too, with its score from the live feed (as the ticker reads it).
  const other = r.slots.flatMap(x => x.games).find(g => g.id !== games[0].id && g.state === 'live');
  assert.ok(other && other.score, 'another court\'s live game has a score');
  // Finished games from earlier rounds aren't tonight; tonight's later games are next.
  assert.ok(r.slots.flatMap(x => x.games).some(g => g.state === 'next' || g.state === 'live'));
  // The scoreboard moves on: the first game is done, with the score it had (PlayHQ has no result yet) and its winner.
  await post('/api/scoreboard', { type: 'selectGame', game: games[1] });
  r = await get('/api/planner/fixtureboard');
  g0 = find(r, games[0].id);
  assert.equal(g0.state, 'done');
  assert.deepEqual(g0.score, { home: 3, away: 0 });
  assert.equal(g0.winner, 'home');
  assert.equal(g0.people[0].name, p.pool[0].name);
  // The old roster link is gone (Matt, 2026-10-29): fixtureboard.html is the only link.
  assert.equal((await fetch(`${studio.base}/roster.html`)).status, 404);
});

test('the commentators graphics read who is on the mic', async () => {
  const page = await fetch(`${studio.base}/commentators.html`).then(r => r.text());
  assert.match(page, /\/api\/planner\/onair/, 'the Commentators graphic falls back to the plan');
  const res = await fetch(`${studio.base}/api/planner/onair`);
  assert.equal(res.status, 200);
});
