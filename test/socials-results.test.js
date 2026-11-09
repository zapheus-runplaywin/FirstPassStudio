// The Socials tab's Results stat pictures worked out from the season (socialstats.js and socials.js): Sharpshooter,
// Super shot leaders, On fire, Night in numbers, Club round up, On a roll, Team season card and Season wrap. The
// browser: Playwright's own, or STUDIO_TEST_CHROMIUM; skipped without one (except in the Tests check).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startStudio, ROOT } = require('./support/studio');
const { createWorld } = require('./support/playhq');
const stats = require('../socialstats');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* not installed */ }

// The whole season played: the home team wins every game of Rounds 3 and 4 by 6 or more, so Knights and Titans finish
// on three wins in a row and both divisions end their season on the last night.
function playedWorld() {
  const world = createWorld();
  for (const div of world.divisions) for (const r of [2, 3]) for (const g of div.rounds[r].games) { g.status = 'FINAL'; g.score = { home: 30 + r, away: 24 }; delete world.live[g.id]; }
  return world;
}

test('Results stats: sharpshooter, super shots, on fire, numbers, clubs, runs, season card and wrap', async t => {
  const world = playedWorld();
  const studio = await startStudio(t, { world });
  // Knights and Titans belong to one club, Thunder.
  const tpl = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', 'Thunder League.json'), 'utf8'));
  tpl.settings.clubs = { ...(tpl.settings.clubs || {}), Thunder: {} };
  tpl.settings.teamClubs = { Knights: 'Thunder', Titans: 'Thunder' };
  await studio.post('/api/setup-template', Buffer.from(JSON.stringify(tpl)));
  const socials = await studio.get('/api/socials');
  for (const k of ['accuracy', 'supershots', 'teamsupers', 'onfire', 'numbers', 'club', 'streaks', 'season', 'wrap']) assert.equal(socials.settings.sponsor[k], true, `${k} carries the sponsor strip`);
  const nights = socials.nights.map(n => n.date);
  const last = nights[3];

  const n = await studio.get(`/api/socials/night?date=${last}&with=numbers,accuracy,onfire,supershots,teamsupers,season,wrap&division=Division%201&team=Blizzardz`);
  assert.deepEqual(n.lastNights, ['Division 1', 'Division 2']);
  assert.deepEqual(n.superShotDivisions, ['Division 1', 'Division 2']);
  assert.deepEqual(n.clubs, [{ club: 'Thunder', games: n.games.filter(g => [g.home.name, g.away.name].some(x => x === 'Knights' || x === 'Titans')).map(g => g.id) }]);
  assert.equal(n.clubs[0].games.length, 2);
  assert.deepEqual(n.streaks.map(x => [x.team, x.run, x.unbeaten]), [['Knights', 3, false], ['Titans', 3, false]]);
  assert.ok(n.streaks.every(x => x.logo));
  const { goalOrder, ...numbers } = n.numbers;
  assert.deepEqual(goalOrder, { complete: 0, of: 4, missing: n.games.map(g => `${g.home.name} v ${g.away.name}`) }, 'no stories, so no goal order tiles');
  assert.deepEqual(n.goalOrder, goalOrder);
  assert.deepEqual({ ...numbers, highest: numbers.highest.team }, { games: 4, points: 228, close: 0, draws: 0, biggest: 9, highest: 'Knights', closeMargin: 3,
    superShots: 8, notCounted: 0, accuracy: 82, averageWin: 9, upsets: 0 });
  // The night's shooting % is every game's team counts added up: goals and super goals over attempts.
  const sides = (await Promise.all(n.games.map(g => studio.get(`/api/socials/night?date=${last}&with=gamestats&game=${g.id}`))))
    .flatMap(x => [x.gameStats.game.home, x.gameStats.game.away]);
  const sum = k => sides.reduce((a, x) => a + x[k], 0);
  assert.equal(n.numbers.accuracy, Math.round((sum('goals') + sum('superGoals')) / sum('shots') * 100));

  assert.equal(n.accuracy.minShots, 10);
  assert.ok(n.accuracy.players.every(p => p.shots >= 10));
  assert.deepEqual(n.accuracy.players.map(p => p.accuracy), [...n.accuracy.players.map(p => p.accuracy)].sort((a, b) => b - a), 'best first');
  assert.ok(n.onFire.players.length && n.onFire.players.every(p => p.rise > 0 && p.recent - p.earlier > 0));
  assert.equal(n.superShots.night.length, 3);
  assert.ok(n.superShots.season.every(p => p.superGoals > 0));
  // Team super shots: every Division 1 team, its night and season from the team counts (one each a game here), most first.
  const ts = n.teamSupers;
  assert.equal(ts.teams.length, 4);
  assert.ok(ts.teams.every(t => t.season === t.games && t.tonight === 1 && t.logo !== undefined));
  assert.deepEqual(ts.teams.map(t => t.season), [...ts.teams.map(t => t.season)].sort((a, b) => b - a), 'most first');
  assert.equal(ts.notCounted, 0);

  const s = n.season;
  assert.deepEqual([s.played, s.won, s.lost, s.drawn, s.place, s.percentage], [4, 3, 1, 0, 2, 108.3]);
  assert.deepEqual(s.run, { result: 'L', games: 1 });
  assert.equal(s.biggestWin.opponent, "Travis' Disciples");
  assert.equal(s.topShooter.team, 'Blizzardz');
  assert.equal((await studio.get(`/api/socials/night?date=${last}&with=season&division=Division%201`)).season.error, 'Pick a team.');

  assert.equal(n.wrap.champion, null, 'no finals played');
  assert.equal(n.wrap.topShooter.name, 'Knights GS');
  assert.equal(n.wrap.biggestWin.id, 'game-d1-r4-1');
  assert.ok(n.wrap.superShots.superGoals > 0);

  // An earlier night: nobody is on a run of three yet, and it isn't anyone's last night.
  const early = await studio.get(`/api/socials/night?date=${nights[1]}`);
  assert.deepEqual(early.streaks, []);
  assert.deepEqual(early.lastNights, []);

  let browser = null;
  try { browser = chromium && await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined }); } catch { browser = null; }
  if (!browser) {
    if (process.env.STUDIO_TEST_REQUIRE_BROWSER) assert.fail('no browser to test the Results pictures in');
    t.skip('no browser to draw the pictures in; run npx playwright install chromium');
    return;
  }
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1080, height: 1080 } });
  await page.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '' }));
  const draw = async (kind, date, more = '') => {
    await page.goto(`${studio.base}/social.html?kind=${kind}&date=${date}${more}`);
    await page.waitForFunction(() => window.socialReady !== undefined);
    assert.equal(await page.evaluate(() => window.socialReady), true, `${kind} draws`);
  };
  const texts = sel => page.$$eval(sel, els => els.map(e => e.textContent));

  await draw('accuracy', last, '&division=Division%201');
  assert.equal((await texts('.shooter__name')).length, n.accuracy.players.length);
  await draw('supershots', last, '&division=Division%201');
  assert.deepEqual(await texts('.group__name'), ['Tonight', 'Season']);
  await draw('teamsupers', last, '&division=Division%201');
  assert.equal((await texts('.shooter__name')).length, ts.teams.length);
  await draw('onfire', last, '&division=Division%201');
  assert.match((await texts('.shooter__team'))[0], /was \d/);
  await draw('numbers', last);
  assert.ok((await texts('.tiles .stat b')).includes('228'));
  // No upsets that night, so the average winning margin takes their tile.
  assert.deepEqual((await texts('.tiles .stat small')).slice(-2), ['Shooting', 'Average win']);
  assert.ok((await texts('.tiles .stat b')).includes('82%'));
  await draw('club', last);
  assert.equal(await page.textContent('#title'), 'Thunder');
  assert.equal((await texts('.result')).length, 2);
  await draw('streaks', last);
  assert.equal(await page.textContent('#title'), 'On a roll');
  assert.match(await page.textContent('#fit'), /Knights.*3 wins in a row.*Titans/s);
  await draw('season', last, '&division=Division%201&team=Blizzardz');
  assert.equal(await page.textContent('#title'), 'Blizzardz');
  await draw('wrap', last, '&division=Division%201');
  assert.deepEqual(await texts('.group__name'), ['Top shooter', 'Sharpest shooter', 'Most super shots', 'Biggest win']);
  // Nothing to show still draws, saying so.
  await page.goto(`${studio.base}/social.html?kind=streaks&date=${nights[1]}`);
  await page.waitForFunction(() => window.socialReady !== undefined);
  assert.match(String(await page.evaluate(() => window.socialReady)), /No team is unbeaten/);
});

test('Results stats: runs, numbers and clubs from the games alone', () => {
  const g = (id, date, home, hs, away, as) => ({ id, date, division: 'D', home: { name: home, score: hs }, away: { name: away, score: as }, finished: true });
  const season = [g(1, 'a', 'A', 30, 'B', 20), g(2, 'b', 'A', 25, 'C', 25), g(3, 'c', 'A', 31, 'B', 30), g(4, 'c', 'C', 40, 'D', 10)];
  // A: W, D, W (unbeaten in 3, a run of 1); C: D, W.
  assert.deepEqual(stats.streaks(season, 'c', season.filter(x => x.date === 'c')).map(x => [x.team, x.unbeaten, x.run, x.played]), [['A', true, 1, 3]]);
  const num = stats.numbers(season.filter(x => x.date === 'c'));
  assert.deepEqual([num.games, num.points, num.close, num.biggest, num.highest.team], [2, 111, 1, 30, 'C']);
  assert.equal(num.averageWin, 16, 'the average margin of the games with a winner, to a whole goal (15.5)');
  assert.equal(stats.numbers([...season.filter(x => x.date === 'c'), g(6, 'c', 'B', 22, 'D', 20)]).averageWin, 11, '11 exactly');
  assert.deepEqual([stats.numbers([g(5, 'd', 'A', 20, 'B', 20)]).draws, stats.numbers([g(5, 'd', 'A', 20, 'B', 20)]).averageWin], [1, null], 'a draw has no winning margin');
  assert.deepEqual(stats.clubs(season.filter(x => x.date === 'c'), t => ({ A: 'Club', D: 'Club' })[t] || ''), [{ club: 'Club', games: [3, 4] }]);
  assert.deepEqual(stats.lastNights(season, 'c'), ['D']);
});
