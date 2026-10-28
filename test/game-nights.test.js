// The control page picks a game night, not a round: divisions can be on different rounds the same
// night (one on Round 3 while another plays Finals Round 1), and the night lists every division's games.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio');
const { createWorld } = require('./support/playhq');

let studio;
test.before(async () => {
  const world = createWorld();
  // Division 2 is in finals tonight, numbered from 1 again as PlayHQ does.
  Object.assign(world.divisions[1].rounds[2], { name: 'Finals Round 1', number: 1 });
  Object.assign(world.divisions[1].rounds[3], { name: 'Grand Final', number: 2 });
  studio = await startStudio(null, { competition: 'Thunder League', world });
  await studio.until(async () => (await studio.get('/api/scoreboard')).gameId);
});
test.after(() => studio && studio.stop());

const get = p => studio.get(p);
const rounds = games => [...new Set(games.map(g => `${g.division} ${g.round}`))].sort();

test('tonight lists every division\'s games, each with its own round', async () => {
  const r = await get('/api/rounds');
  assert.equal(r.auto, studio.world.today);
  assert.equal(r.autoRounds, 'Division 1 Round 3, Division 2 Finals Round 1');
  assert.equal(r.nights.length, 4);
  assert.deepEqual(rounds(await get('/api/games')), ['Division 1 Round 3', 'Division 2 Finals Round 1']);
  const f = await get('/api/fixtures');
  assert.deepEqual(rounds(f.games), ['Division 1 Round 3', 'Division 2 Finals Round 1']);
});

test('picking a night pulls in every division\'s games that date, and a round number still works', async () => {
  try {
    const next = (await get('/api/rounds')).nights[3];
    assert.equal(next.summary, 'Division 1 Round 4, Division 2 Grand Final');
    await studio.post('/api/rounds', { night: next.date });
    assert.deepEqual(rounds(await get('/api/games')), ['Division 1 Round 4', 'Division 2 Grand Final']);
    assert.deepEqual(rounds((await get('/api/fixtures')).games), ['Division 1 Round 4', 'Division 2 Grand Final']);
    assert.equal((await get('/api/scoreboard')).date, next.date, 'automatic selection follows the picked night');

    // A round's number or name (as Studio used to keep) means the night it's played in the first division that has it.
    const r = await studio.post('/api/rounds', { round: '2' });
    assert.equal(r.choice, studio.world.divisions[0].rounds[1].games[0].date);
    assert.deepEqual(rounds(await get('/api/games')), ['Division 1 Round 2', 'Division 2 Round 2']);

    const bad = await studio.request('POST', '/api/rounds', { round: 'Round 99' });
    assert.equal(bad.status, 400);
    assert.match(bad.json.error, /No game night for round "Round 99"/);
  } finally {
    await studio.post('/api/rounds', { night: '' });
  }
  assert.equal((await get('/api/rounds')).choice, '');
});
