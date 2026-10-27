// The team lists (teamlist.html, positions, the lower thirds) follow the scoreboard's home and away even when
// PlayHQ's game page disagrees with the fixture: its teams listed the other way round, or its line-ups filed
// under the other team (told apart by the players' goals against the live feed's team totals). Against the
// stand-in PlayHQ; the team list graphic is checked in a browser too (see test/support/browser.js).

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio');
const { discoverGame } = require('./support/playhq');
const { openPage } = require('./support/browser');

let studio, game;
test.before(async () => {
  studio = await startStudio(null, { competition: 'Thunder League' });
  game = studio.world.gameNow(0); // Blizzardz v Travis' Disciples, being scored
  await studio.until(async () => (await studio.get('/api/scoreboard')).gameId === game.id);
  await studio.post('/api/scoreboard', { type: 'playhqRefresh', value: 3 });
  // Some goals, so the line-ups have shooters to check against the team totals: 6-2, with one super shot at home.
  Object.assign(studio.world.live[game.id], { home: 6, away: 2, homeGoals: 4, awayGoals: 2, homeSuper: 1, awaySuper: 0 });
});
test.after(() => studio && studio.stop());
test.afterEach(() => { studio.world.answers = {}; });

// The game page's answer, changed by fn (a copy of the stand-in's own).
const gamePage = fn => ({ variables }) => ({ body: { data: { discoverGame: fn(JSON.parse(JSON.stringify(discoverGame(studio.world, variables.gameID)))) } } });
// /api/teams once it has the line-ups PlayHQ now gives (it reads the game page every 3 seconds at most).
const teams = check => studio.until(async () => { const t = await studio.get('/api/teams'); return t.home.players.length && check(t) && t; }, 10000, 300);
const shooters = side => side.players.filter(p => p.shooting.goals || p.shooting.superGoals).map(p => p.name);

test('the line-ups as PlayHQ gives them: each team\'s own players, its shooters\' goals adding up to the team\'s', async () => {
  const t = await teams(x => shooters(x.home).length);
  assert.equal(t.home.name, game.home);
  assert.equal(t.away.name, game.away);
  assert.ok(t.home.players.every(p => p.name.startsWith('Blizzardz')), t.home.players.map(p => p.name).join(', '));
  assert.ok(t.away.players.every(p => p.name.startsWith('Travis')), t.away.players.map(p => p.name).join(', '));
  assert.deepEqual(t.home.players.slice(0, 7).map(p => p.position), ['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK']);
  assert.equal(t.scoring, 'live');
  assert.deepEqual(t.home.totals && [t.home.totals.goals, t.home.totals.superGoals], [4, 1]);
});

test('PlayHQ\'s game page listing the teams the other way round: swapped back to match the scoreboard', async () => {
  studio.world.answers.discoverGame = gamePage(g => ({ ...g, home: g.away, away: g.home, statistics: { home: g.statistics.away, away: g.statistics.home } }));
  // Once the game page is read again (it's kept for 3 seconds), the swap is logged and the lists are the board's way round.
  await studio.until(async () => { await studio.get('/api/teams'); return /the other way round from the fixture; swapped to match the scoreboard/.test(studio.log()); });
  const t = await teams(() => true);
  assert.equal(t.home.name, game.home, 'the scoreboard\'s home team on the home side');
  assert.ok(t.home.players.every(p => p.name.startsWith('Blizzardz')), t.home.players.map(p => p.name).join(', '));
  assert.ok(t.away.players.every(p => p.name.startsWith('Travis')));
});

test('line-ups filed under the other team: the players are swapped back, told by their goals', async () => {
  // The teams' names right, but each team's players under the other.
  studio.world.answers.discoverGame = gamePage(g => ({ ...g, statistics: { home: { ...g.statistics.home, players: g.statistics.away.players }, away: { ...g.statistics.away, players: g.statistics.home.players } } }));
  await studio.until(async () => { await studio.get('/api/teams'); return /line-ups sit under the other team .*swapped the players/.test(studio.log()); });
  const t = await teams(() => true);
  assert.ok(t.home.players.every(p => p.name.startsWith('Blizzardz')), t.home.players.map(p => p.name).join(', '));
  assert.ok(t.away.players.every(p => p.name.startsWith('Travis')));
});

test('the team list graphic shows the scoreboard\'s home team and its players, whichever way PlayHQ lists them', async t => {
  studio.world.answers.discoverGame = gamePage(g => ({ ...g, home: g.away, away: g.home, statistics: { home: g.statistics.away, away: g.statistics.home } }));
  const page = await openPage(t, studio, '/teamlist.html?side=home');
  if (!page) return;
  await page.waitForFunction(() => document.querySelectorAll('#players .teamlist__player').length >= 7, null, { timeout: 15000 });
  assert.equal(await page.textContent('#name'), game.home);
  const names = await page.$$eval('#players .pname', els => els.map(e => e.firstChild.textContent));
  assert.ok(names.every(n => n.startsWith('Blizzardz')), names.join(', '));
  assert.equal(await page.textContent('#players .teamlist__player .pos'), 'GS');
  assert.deepEqual(page.errors, []);
});
