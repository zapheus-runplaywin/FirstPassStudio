// The Socials tab's "of the night" pictures from the streamed games' stories: Runs of the night, Super shot time (each
// quarter's super shot period) and Comeback of the night (with its worm). The browser: Playwright's own, or
// STUDIO_TEST_CHROMIUM; skipped without one (except in the Tests check).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio.mts');
const { createWorld } = require('./support/playhq.mts');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* not installed */ }

test('runs of the night, super shot time and comeback of the night from the streamed games', async t => {
  const world = createWorld();
  const studio = await startStudio(t, { competition: 'Thunder League', world });
  const [first, second] = (await studio.get('/api/socials')).nights.map(n => n.date);
  const none = await studio.get(`/api/socials/night?date=${second}`);
  assert.deepEqual(none.ofNight, { runs: [], supers: [], comeback: null });

  // Blizzardz v Mavericks (31-26 in PlayHQ) streamed with the clock: Mavericks lead 4-0, then Blizzardz score five in a
  // row, two of them in Q1's super shot period (a +2 is a super shot).
  const act = b => studio.post('/api/scoreboard', b);
  await act({ type: 'selectGame', game: { id: 'game-d1-r2-1', division: 'Division 1', date: second, time: '11:06', home: { name: 'Blizzardz', score: 0 }, away: { name: 'Mavericks', score: 0 } } });
  await act({ type: 'source', value: 'manual' });
  await act({ type: 'resetScores' });
  await act({ type: 'clockLength', value: 600 });
  await act({ type: 'period', value: 1 });
  const goal = async (left, side, delta = 1) => { await act({ type: 'clockSet', secondsLeft: left }); await act({ type: 'score', side, delta }); };
  for (const left of [550, 500, 450, 400]) await goal(left, 'away');
  for (const left of [350, 300, 250]) await goal(left, 'home');
  await goal(150, 'home', 2);
  await goal(100, 'home');
  await act({ type: 'selectGame', game: { id: 'game-d1-r2-2', division: 'Division 1', date: second, time: '12:06', home: { name: 'Knights', score: 0 }, away: { name: "Travis' Disciples", score: 0 } } });

  const n = await studio.get(`/api/socials/night?date=${second}`);
  const { runs, supers, comeback } = n.ofNight;
  assert.equal(runs.length, 1);
  assert.deepEqual([runs[0].game.id, runs[0].longest.side, runs[0].longest.n], ['game-d1-r2-1', 'home', 5]);
  assert.equal(supers.length, 1);
  assert.deepEqual(supers[0].byPeriod[0], { n: 1, home: 3, away: 0 }, 'the +2 and the +1 in the last 3 minutes');
  assert.deepEqual(supers[0].points, { home: 3, away: 0 });
  assert.deepEqual([comeback.game.id, comeback.side, comeback.down], ['game-d1-r2-1', 'home', 4]);
  assert.ok(comeback.worm.segments.length);
  assert.deepEqual((await studio.get(`/api/socials/night?date=${first}`)).ofNight.runs, [], 'another night');

  let browser = null;
  try { browser = chromium && await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined }); } catch { browser = null; }
  if (!browser) {
    if (process.env.STUDIO_TEST_REQUIRE_BROWSER) assert.fail('no browser to test the pictures in');
    t.skip('no browser to draw the pictures in; run npx playwright install chromium');
    return;
  }
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1080, height: 1080 } });
  await page.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '' }));
  const draw = async (kind, date) => {
    await page.goto(`${studio.base}/social.html?kind=${kind}&date=${date}`);
    await page.waitForFunction(() => window.socialReady !== undefined);
    return page.evaluate(() => window.socialReady);
  };
  assert.equal(await draw('runs', second), true);
  assert.equal(await page.textContent('.bound--team .stat b'), '5');
  assert.equal(await draw('supershottime', second), true);
  assert.equal((await page.$$('.story tr')).length, 3);
  assert.equal(await draw('comeback', second), true);
  assert.ok(await page.$('.worm svg'));
  assert.match(String(await draw('comeback', first)), /none of this night's finished games were streamed/);
});
