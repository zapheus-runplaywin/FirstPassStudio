// Game story, Score worm and Watch it back on the Socials tab: the scoreboard keeps each streamed game's story (its
// Game stats and Score worm) when it moves to the next game, for pictures after the night. The browser: Playwright's
// own, or STUDIO_TEST_CHROMIUM; skipped without one (except in the Tests check).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio');
const { createWorld } = require('./support/playhq');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* not installed */ }

test('a streamed game keeps its story for Game story and Score worm, and Watch it back makes a QR code', async t => {
  const world = createWorld();
  const studio = await startStudio(t, { competition: 'Thunder League', world });
  const [, second] = (await studio.get('/api/socials')).nights.map(n => n.date);
  assert.deepEqual((await studio.get(`/api/socials/night?date=${second}`)).stories, [], 'nothing streamed yet');

  // Blizzardz v Mavericks finished 31-26: scored by hand on the scoreboard, quarter by quarter, then the next game picked.
  const act = b => studio.post('/api/scoreboard', b);
  await act({ type: 'selectGame', game: { id: 'game-d1-r2-1', division: 'Division 1', date: second, time: '11:06', home: { name: 'Blizzardz', score: 0 }, away: { name: 'Mavericks', score: 0 } } });
  await act({ type: 'source', value: 'manual' });
  await act({ type: 'resetScores' });
  const quarters = [[8, 5], [9, 6], [6, 8], [8, 7]];
  for (const [i, [h, a]] of quarters.entries()) {
    await act({ type: 'period', value: i + 1 });
    for (let n = 0; n < Math.max(h, a); n++) { if (n < a) await act({ type: 'score', side: 'away', delta: 1 }); if (n < h) await act({ type: 'score', side: 'home', delta: 1 }); }
  }
  await act({ type: 'selectGame', game: { id: 'game-d1-r2-2', division: 'Division 1', date: second, time: '12:06', home: { name: 'Knights', score: 0 }, away: { name: "Travis' Disciples", score: 0 } } });

  const n = await studio.get(`/api/socials/night?date=${second}&with=story&game=game-d1-r2-1`);
  assert.deepEqual(n.stories, ['game-d1-r2-1']);
  assert.deepEqual(n.storiesFrom, [], 'this Mac\'s own story');
  // The finished story is shared with the other Studio Macs (stories.ts): a second Studio copies it on its first look.
  assert.deepEqual((await studio.get('/api/stories')).stories.map(x => x.gameId), ['game-d1-r2-1']);
  const court2 = await startStudio(t, { competition: 'Thunder League', world, env: { FIRSTPASS_OTHER_STUDIOS: studio.base, FIRSTPASS_STORIES_FIRST_SYNC_MS: '500' } });
  const copied = await court2.until(async () => { const x = await court2.get(`/api/socials/night?date=${second}`); return x.storiesFrom.length && x; });
  assert.deepEqual(copied.stories, ['game-d1-r2-1']);
  assert.equal(copied.storiesFrom[0].via, 'network');
  assert.equal(copied.storiesFrom[0].games, 1);
  const s = n.story;
  // On failure, what made it incomplete (it has failed only on the Mac build, so the message is all there is to go on).
  const why = () => JSON.stringify({ gap: s.stats.gapInHistory, kept: [s.stats.home.score, s.stats.away.score], result: [s.game.home.score, s.game.away.score],
    finished: s.game.finished, goals: s.stats.totalGoals, log: studio.log().split('\n').filter(l => /\[(auto|goals|scoreboard)\]/.test(l)).slice(-25) }, null, 1);
  assert.equal(s.complete, true, `every goal seen, and the kept score is the result: ${s.complete ? '' : why()}`);
  assert.deepEqual(s.stats.quarters.map(q => [q.home, q.away]), quarters);
  assert.deepEqual([s.stats.stats.quartersWon.home, s.stats.stats.quartersWon.away], [3, 1]);
  assert.equal(s.worm.segments.flat().at(-1).margin, 5);
  assert.match((await studio.get(`/api/socials/night?date=${second}&with=story&game=game-d2-r2-1`)).story.error, /didn't stream or follow/);

  assert.match((await studio.get(`/api/socials/night?date=${second}&with=watch`)).watch.error, /Paste the link/);
  assert.match((await studio.get(`/api/socials/night?date=${second}&with=watch&link=javascript:alert(1)`)).watch.error, /isn't a web link/);

  let browser = null;
  try { browser = chromium && await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined }); } catch { browser = null; }
  if (!browser) {
    if (process.env.STUDIO_TEST_REQUIRE_BROWSER) assert.fail('no browser to test the Game story pictures in');
    t.skip('no browser to draw the pictures in; run npx playwright install chromium');
    return;
  }
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1080, height: 1080 } });
  await page.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '' }));
  const draw = async (kind, more = '') => {
    await page.goto(`${studio.base}/social.html?kind=${kind}&date=${second}${more}`);
    await page.waitForFunction(() => window.socialReady !== undefined);
    return page.evaluate(() => window.socialReady);
  };
  const texts = sel => page.$$eval(sel, els => els.map(e => e.textContent));

  assert.equal(await draw('story', '&game=game-d1-r2-1'), true);
  assert.deepEqual(await texts('.story tr:nth-child(2) td'), ['', 'Blizzardz', '8', '9', '6', '8', '31']);
  assert.ok((await texts('.bound--line .game__team')).includes('Quarters won'));
  assert.equal(await draw('worm', '&game=game-d1-r2-1'), true);
  assert.ok(await page.$('.worm svg path.line'));
  assert.equal(await draw('watch', '&link=https://www.youtube.com/@thunderleague/streams'), true);
  assert.ok(await page.$('.watch__qr svg'));
  assert.equal(await page.textContent('.watch__link'), 'youtube.com/@thunderleague/streams');

  // The second Studio's Socials tab lists the copied game's pictures and says where its story came from.
  await page.unrouteAll();
  await page.route(url => !String(url).startsWith(court2.base), route => route.fulfill({ status: 200, body: '' }));
  await page.goto(`${court2.base}/socials.html`);
  await page.waitForSelector('#night option', { state: 'attached' });
  await page.selectOption('#night', second);
  await page.waitForSelector('[data-key="story:game-d1-r2-1"]');
  assert.match(await page.textContent('#pics > p.help'), /Game stories from other Studio Macs: 1 game from .+ \(over the network\)\./);
});
