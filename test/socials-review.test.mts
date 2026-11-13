// Round in review and ladder movers on the Socials tab: each team's place before the night (this night's results taken
// back off PlayHQ's ladder), the night's biggest win, closest game and upsets, drawn on the Round in review picture and
// as movers on the Ladder picture. The browser: Playwright's own, or STUDIO_TEST_CHROMIUM; skipped without one (except in
// the Tests check).
import test from 'node:test';
import assert from 'node:assert/strict';
import { startStudio, type Json } from './support/studio.mts';
import { createWorld } from './support/playhq.mts';
import type { BrowserType } from 'playwright';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let chromium: BrowserType | null = null;
try { ({ chromium } = require('playwright') as typeof import('playwright')); } catch { /* not installed */ }

// Knights thrash Blizzardz in Round 1, so Division 1 stands Knights, Mavericks, Travis' Disciples, Blizzardz before
// Round 2; then Blizzardz (4th) beat Mavericks (2nd), an upset in a ladder of 4. Titans win big in Division 2's Round 2.
function reviewWorld() {
  const world = createWorld();
  world.games['game-d1-r1-1'].score = { home: 20, away: 40 };
  world.games['game-d2-r2-2'].score = { home: 40, away: 27 };
  return world;
}

test('Round in review and ladder movers: places before the night, the biggest win, the closest game and the upsets', async t => {
  const world = reviewWorld();
  const studio = await startStudio(t, { competition: 'Thunder League', world });
  const [first, second] = (await studio.get('/api/socials')).nights.map((n: Json) => n.date);
  assert.equal((await studio.get('/api/socials')).settings.sponsor.review, true, 'carries the sponsor strip to start with');

  const n = await studio.get(`/api/socials/night?date=${second}&with=review`);
  const div1 = n.ladders.find((l: Json) => l.division === 'Division 1');
  assert.equal(div1.movers, true);
  assert.deepEqual(div1.rows.map((r: Json) => [r.team, r.before, r.position, r.moved]),
    [['Knights', 1, 1, 0], ['Mavericks', 2, 2, 0], ['Blizzardz', 4, 3, 1], ["Travis' Disciples", 3, 4, -1]]);
  assert.deepEqual(n.review.upsets, [{ id: 'game-d1-r2-1', winnerWas: 4, loserWas: 2, gap: 2 }], '2 places is an upset in a ladder of 4; Titans (4th) beating Semi Pro (3rd) isn\'t');
  assert.equal(n.review.biggest, 'game-d2-r2-2');
  assert.ok(n.review.closest && n.review.closest !== n.review.biggest);

  // An older night: the ladder isn't after it, so no movers and no upsets.
  const old = await studio.get(`/api/socials/night?date=${first}&with=review`);
  assert.ok(old.ladders.every((l: Json) => !l.movers && l.rows.every((r: Json) => r.moved === undefined)));
  assert.deepEqual(old.review.upsets, []);
  assert.ok(old.review.biggest);

  let browser = null;
  try { browser = chromium && await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined }); } catch { browser = null; }
  if (!browser) {
    if (process.env.STUDIO_TEST_REQUIRE_BROWSER) assert.fail('no browser to test the Round in review picture in');
    t.skip('no browser to draw the pictures in; run npx playwright install chromium');
    return;
  }
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1080, height: 1080 } });
  await page.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '' }));
  const draw = async (kind: string, date: Json, more = '') => {
    await page.goto(`${studio.base}/social.html?kind=${kind}&date=${date}${more}`);
    await page.waitForFunction(() => window.socialReady !== undefined);
    assert.equal(await page.evaluate(() => window.socialReady), true, `${kind} draws`);
  };
  const texts = (sel: string) => page.$$eval(sel, els => els.map(e => e.textContent));

  await draw('review', second);
  assert.equal(await page.textContent('#title'), 'Round in review');
  // Every other game was won by 5, so the upset is also the closest game (the first of them): a game shows once, saying both.
  assert.deepEqual(await texts('.review .group__name'), ['Upset  ·  Closest game', 'Biggest win']);
  assert.match((await texts('.review__note'))[0], /^4th beat 2nd\s+·\s+Blizzardz by 5\s+·\s+Division 1$/);
  assert.match((await texts('.review__note'))[1], /^Titans by 13\s+·\s+Division 2$/);
  // Night in numbers counts the night's upsets by the same rule.
  assert.equal((await studio.get(`/api/socials/night?date=${second}&with=numbers`)).numbers.upsets, 1);
  await draw('numbers', second);
  assert.ok((await texts('.tiles .stat small')).includes('Upset'));
  assert.ok(!(await texts('.tiles .stat small')).includes('Average win'), 'the average winning margin only shows on a night without an upset');

  // Ladder movers: on the division's latest night, unless turned off.
  await draw('ladder', second, '&division=Division%201');
  assert.deepEqual(await texts('.ladder .move'), ['–', '–', '▲1', '▼1']);
  await draw('ladder', second, '&division=Division%201&movers=0');
  assert.deepEqual(await texts('.ladder .move'), []);
  await draw('ladder', first, '&division=Division%201');
  assert.deepEqual(await texts('.ladder .move'), [], 'an older night\'s ladder is today\'s, so no movers');
  // The ladder says what it's after: this night's round, else the division's latest round with results.
  assert.deepEqual(old.ladders.map((l: Json) => [l.after, l.asAt]), [['', { date: second, round: 'Round 2' }], ['', { date: second, round: 'Round 2' }]]);
  assert.match((await page.textContent('#when'))!, /After Round 2/);
  const tonight = (await studio.get('/api/socials')).nights[2].date;
  await draw('ladder', tonight, '&division=Division%201');
  assert.match((await page.textContent('#when'))!, /After Round 2/, 'before tonight\'s results: after the last round played');
});
