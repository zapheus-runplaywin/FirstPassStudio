// The court's name on the graphics (board.js courtShown): PlayHQ's name for the game's court unless one is typed on
// Scoreboard control, which lasts the night; following a court keeps using PlayHQ's name.
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

const board = () => studio.get('/api/scoreboard');
const act = a => studio.post('/api/scoreboard', a);

test('blank shows PlayHQ\'s court name; a typed name is shown instead, and clearing it goes back', async () => {
  let b = await board();
  assert.ok(b.courtPlayhq, 'the game has a PlayHQ court');
  assert.equal(b.courtName, '');
  assert.equal(b.court, b.courtPlayhq, 'blank: PlayHQ\'s name');
  const playhqCourt = b.courtPlayhq;

  b = await act({ type: 'setTeams', court: '  Jerome Gillbard Centre ' });
  assert.equal(b.courtName, 'Jerome Gillbard Centre');
  assert.equal(b.court, 'Jerome Gillbard Centre', 'the typed name is shown');
  assert.equal(b.courtPlayhq, playhqCourt, 'PlayHQ\'s name is kept');
  for (const p of ['/api/countdown', '/api/teams', '/api/goals', '/api/stats']) {
    const d = await studio.get(p);
    if (d.court !== undefined) assert.equal(d.court, 'Jerome Gillbard Centre', `${p} shows the typed name`);
  }

  // Another game on the same night keeps the typed name; PlayHQ's follows the game.
  const games = await studio.get('/api/games');
  const other = games.find(g => g.id !== b.gameId);
  if (other) {
    b = await act({ type: 'selectGame', game: other });
    assert.equal(b.court, 'Jerome Gillbard Centre');
    assert.equal(b.courtPlayhq, other.court);
  }

  b = await act({ type: 'setTeams', court: '' });
  assert.equal(b.courtName, '');
  assert.equal(b.court, b.courtPlayhq, 'cleared: PlayHQ\'s name again');
});

test('a typed court name lasts the night; the next night goes back to PlayHQ\'s', async () => {
  await act({ type: 'setTeams', court: 'Jerome Gillbard Centre' });
  const nights = (await studio.get('/api/planner')).nights.map(n => n.date);
  const next = nights.find(d => d > studio.world.today);
  await studio.post('/api/rounds', { night: next });
  const b = await studio.until(async () => { const s = await board(); return s.courtNight.endsWith(`|${next}`) && s; });
  assert.equal(b.courtName, '', 'a new night clears the typed name');
  assert.equal(b.court, b.courtPlayhq);
  await studio.post('/api/rounds', { night: '' });
});
