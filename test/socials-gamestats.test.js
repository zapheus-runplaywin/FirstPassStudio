// The Socials tab's per game stats pictures: Game stats and Shooting duel (a finished game's line ups, with its story
// when Studio streamed it), Moments of the game (every moment the scoreboard saw, kept in the story), Head to head (the
// teams' meetings this season) and Team sheet (both squads with games played). The browser: Playwright's own, or
// STUDIO_TEST_CHROMIUM; skipped without one (except in the Tests check).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio');
const { createWorld } = require('./support/playhq');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* not installed */ }

test('game stats, shooting duel, moments of the game, head to head and team sheet', async t => {
  const world = createWorld();
  const studio = await startStudio(t, { competition: 'Thunder League', world });
  const nights = (await studio.get('/api/socials')).nights.map(n => n.date);
  const [, second, , fourth] = nights;

  // Blizzardz v Mavericks scored by hand on the scoreboard (Blizzardz 3 in a row, then Mavericks 5 in a row to lead),
  // then the next game picked, so the story is kept.
  const act = b => studio.post('/api/scoreboard', b);
  await act({ type: 'selectGame', game: { id: 'game-d1-r2-1', division: 'Division 1', date: second, time: '11:06', home: { name: 'Blizzardz', score: 0 }, away: { name: 'Mavericks', score: 0 } } });
  await act({ type: 'source', value: 'manual' });
  await act({ type: 'resetScores' });
  await act({ type: 'period', value: 1 });
  for (const c of 'hhhaaaaa') await act({ type: 'score', side: c === 'h' ? 'home' : 'away', delta: 1 });
  await act({ type: 'selectGame', game: { id: 'game-d1-r2-2', division: 'Division 1', date: second, time: '12:06', home: { name: 'Knights', score: 0 }, away: { name: "Travis' Disciples", score: 0 } } });

  const n = await studio.get(`/api/socials/night?date=${second}&with=gamestats&game=game-d1-r2-1`);
  const gs = n.gameStats;
  assert.equal(gs.read, true);
  for (const k of ['home', 'away']) {
    const side = gs.game[k];
    const sum = f => side.shooters.reduce((x, p) => x + p[f], 0);
    assert.equal(side.goals, sum('goals'));
    assert.equal(side.shots, sum('shots'));
    assert.equal(side.misses, side.shots - side.goals - side.superGoals);
    assert.deepEqual(side.shooters.map(p => p.points), [...side.shooters.map(p => p.points)].sort((a, b) => b - a), 'most points first');
  }
  assert.equal(gs.superShots, true, 'Thunder League plays super shots');
  assert.deepEqual([gs.story.longestRun.home, gs.story.longestRun.away], [3, 5]);
  assert.equal(gs.story.leadChanges, 1);
  assert.equal((await studio.get(`/api/socials/night?date=${second}&with=gamestats&game=game-d2-r2-1`)).gameStats.story, null, 'not streamed');
  assert.match((await studio.get(`/api/socials/night?date=${nights[2]}&with=gamestats&game=game-d1-r3-1`)).gameStats.error, /No result/);

  const story = (await studio.get(`/api/socials/night?date=${second}&with=story&game=game-d1-r2-1`)).story;
  assert.deepEqual(story.moments.map(m => [m.kind, m.side]).slice(0, 2), [['heating', 'home'], ['heating', 'away']]);
  assert.ok(story.moments.some(m => m.kind === 'fire' || (m.also || []).some(a => a.kind === 'fire')), 'five in a row');

  // Round 4 is each team's second meeting with a round 1 opponent.
  const met = (await studio.get(`/api/socials/night?date=${fourth}`)).met;
  assert.ok(met.every(x => x.n === 1));
  assert.ok((await studio.get(`/api/socials/night?date=${second}`)).met.every(x => x.n === 0));

  const sheet = (await studio.get(`/api/socials/night?date=${nights[2]}&with=teamsheet&game=game-d1-r3-1`)).teamSheet.game;
  assert.ok(sheet.home.players.length && sheet.away.players.length);
  assert.equal(sheet.home.players[0].position, 'GS', 'GS first');
  assert.ok(sheet.home.players.every(p => p.games === 2), 'two games each before round 3');

  let browser = null;
  try { browser = chromium && await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined }); } catch { browser = null; }
  if (!browser) {
    if (process.env.STUDIO_TEST_REQUIRE_BROWSER) assert.fail('no browser to test the game stats pictures in');
    t.skip('no browser to draw the pictures in; run npx playwright install chromium');
    return;
  }
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1080, height: 1080 } });
  await page.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '' }));
  const draw = async (kind, date, more) => {
    await page.goto(`${studio.base}/social.html?kind=${kind}&date=${date}${more}`);
    await page.waitForFunction(() => window.socialReady !== undefined);
    return page.evaluate(() => window.socialReady);
  };
  const texts = sel => page.$$eval(sel, els => els.map(e => e.textContent));
  assert.equal(await draw('gamestats', second, '&game=game-d1-r2-1'), true);
  assert.deepEqual(await texts('.bound--cmp .game__team'), ['Super shots', 'Goals', 'Attempts', 'Misses', 'Accuracy', 'Quarters won', 'Longest run', 'Biggest lead']);
  assert.equal(await draw('shooting', second, '&game=game-d1-r2-1'), true);
  assert.equal((await texts('.group__name')).length, 2);
  assert.equal(await draw('moments', second, '&game=game-d1-r2-1'), true);
  assert.equal((await texts('.bound--moment')).length, story.moments.length);
  assert.equal(await draw('h2h', fourth, '&game=game-d1-r4-1'), true);
  assert.equal((await texts('.card__lines .result')).length, 1);
  assert.match(String(await draw('h2h', second, '&game=game-d1-r2-1')), /haven't met yet/);
  assert.equal(await draw('teamsheet', nights[2], '&game=game-d1-r3-1'), true);
  assert.equal((await texts('.bound--sheet')).length, sheet.home.players.length + sheet.away.players.length);
});
