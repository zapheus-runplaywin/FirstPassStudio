// The Socials tab's hand picks and spotlights: Player of the match and Team of the round (picked from the finished
// games' line ups), Athlete spotlight, Sponsor spotlight and Thanks for watching. The browser: Playwright's own, or
// STUDIO_TEST_CHROMIUM; skipped without one (except in the Tests check).
import test from 'node:test';
import assert from 'node:assert/strict';
import { startStudio, type Json } from './support/studio.mts';
import { createWorld } from './support/playhq.mts';
import type { BrowserType } from 'playwright';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let chromium: BrowserType | null = null;
try { ({ chromium } = require('playwright') as typeof import('playwright')); } catch { /* not installed */ }

test('hand picks: player of the match, team of the round, athlete and sponsor spotlights, thanks for watching', async t => {
  const world = createWorld();
  const studio = await startStudio(t, { competition: 'Thunder League', world });
  const comp = (await studio.get('/api/sponsors')).competition.id;
  await studio.post('/api/sponsors', { name: 'Golds Bakery', website: 'goldsbakery.com.au', tagline: 'Fresh every morning', competitions: { [comp]: { tier: 'naming' } } });
  const socials = await studio.get('/api/socials');
  assert.deepEqual(['potm', 'teamround', 'spotlight', 'sponsorspot', 'thanks'].map(k => socials.settings.sponsor[k]), [true, true, true, false, false],
    'the sponsor spotlight and thanks show the sponsors themselves');
  const [first, second, tonight] = socials.nights.map((n: Json) => n.date);

  // The line ups to pick from: each finished game's two sides, with positions.
  const n = await studio.get(`/api/socials/night?date=${second}&with=lineups,sponsorlist`);
  assert.equal(n.nextNight, tonight);
  assert.deepEqual(n.sponsorList.map((s: Json) => [s.id, s.tier]), [['golds-bakery', 'Naming rights']]);
  const g = n.lineups.find((x: Json) => x.id === 'game-d1-r2-1');
  assert.ok(g.read);
  assert.deepEqual(g.home.players.map((p: Json) => p.position), ['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK']);
  assert.deepEqual((await studio.get(`/api/socials/night?date=${second}&with=lineups&division=Division%202`)).lineups.map((x: Json) => x.division), ['Division 2', 'Division 2']);

  // Player of the match: a name from either side, with that game's shooting; a medal's name for a special round.
  const potm = (await studio.get(`/api/socials/night?date=${second}&with=potm&game=game-d1-r2-1&athlete=Mavericks%20GS&medal=Anzac%20Medal`)).potm;
  assert.equal(potm.medal, 'Anzac Medal');
  assert.deepEqual([potm.player.name, potm.player.team, potm.player.position], ['Mavericks GS', 'Mavericks', 'GS']);
  assert.ok(potm.player.shooting.shots > 0);
  const mid = (await studio.get(`/api/socials/night?date=${second}&with=potm&game=game-d1-r2-1&athlete=Blizzardz%20C`)).potm;
  assert.equal(mid.player.shooting, null, 'a centre has no shooting line');
  assert.equal((await studio.get(`/api/socials/night?date=${second}&with=potm&game=game-d1-r2-1`)).potm.error, 'Pick the player of the match.');
  assert.equal((await studio.get(`/api/socials/night?date=${tonight}&with=potm&game=game-d1-r3-1&athlete=x`)).potm.error, 'No result for that game yet.');

  // Team of the round: an athlete a position from the division's line ups that night.
  const tr = (await studio.get(`/api/socials/night?date=${second}&with=teamround&division=Division%201&GS=Mavericks%20GS&C=Blizzardz%20C`)).teamRound;
  assert.deepEqual(tr.players.map((p: Json) => [p.position, p.name, p.team || '']),
    [['GS', 'Mavericks GS', 'Mavericks'], ['GA', '', ''], ['WA', '', ''], ['C', 'Blizzardz C', 'Blizzardz'], ['WD', '', ''], ['GD', '', ''], ['GK', '', '']]);

  // Athlete spotlight: from the register, with games played and goals up to that night.
  const sp = (await studio.get(`/api/socials/night?date=${second}&with=spotlight&athlete=Blizzardz%20GS`)).spotlight;
  assert.deepEqual([sp.name, sp.positions, sp.career], ['Blizzardz GS', ['GS'], [{ division: 'Division 1', games: 2, season: 2 }]]);
  assert.ok(sp.shooting.goals > 0);
  assert.equal((await studio.get(`/api/socials/night?date=${first}&with=spotlight&athlete=Blizzardz%20GS`)).spotlight.career[0].games, 1, 'as at that night');
  assert.match((await studio.get(`/api/socials/night?date=${second}&with=spotlight&athlete=Nobody`)).spotlight.error, /isn't on the Athletes tab/);

  // Sponsor spotlight: the sponsor picked, else the first; no time on screen without a stream.
  const ss = (await studio.get(`/api/socials/night?date=${second}&with=sponsorspot&sponsor=golds-bakery`)).sponsorSpot;
  assert.deepEqual([ss.name, ss.tagline, ss.seconds], ['Golds Bakery', 'Fresh every morning', 0]);

  let browser = null;
  try { browser = chromium && await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined }); } catch { browser = null; }
  if (!browser) {
    if (process.env.STUDIO_TEST_REQUIRE_BROWSER) assert.fail('no browser to test the hand picks in');
    t.skip('no browser to draw the pictures in; run npx playwright install chromium');
    return;
  }
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1080, height: 1080 } });
  await page.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '' }));
  const draw = async (kind: string, date: Json, more = '') => {
    await page.goto(`${studio.base}/social.html?kind=${kind}&date=${date}${more}`);
    await page.waitForFunction(() => window.socialReady !== undefined);
    return page.evaluate(() => window.socialReady);
  };
  const texts = (sel: string) => page.$$eval(sel, els => els.map(e => e.textContent));

  assert.equal(await draw('potm', second, '&game=game-d1-r2-1&athlete=Mavericks%20GS&medal=Anzac%20Medal'), true);
  assert.deepEqual([await page.textContent('#title'), await page.textContent('#tab'), await page.textContent('.champ__name')], ['Anzac Medal', 'Player of the match', 'Mavericks GS']);
  assert.match(String(await draw('potm', second, '&game=game-d1-r2-1')), /Pick the player of the match/);
  assert.equal(await draw('teamround', second, '&division=Division%201&GS=Mavericks%20GS&C=Blizzardz%20C'), true);
  assert.deepEqual(await texts('.bound--pos .shooter__rank'), ['GS', 'C']);
  assert.equal(await draw('spotlight', second, '&athlete=Blizzardz%20GS'), true);
  assert.equal(await page.textContent('.champ__name'), 'Blizzardz GS');
  assert.equal(await draw('sponsorspot', second, '&sponsor=golds-bakery'), true);
  assert.equal(await page.textContent('.champ__name'), 'Golds Bakery');
  assert.equal(await draw('thanks', second), true);
  assert.match((await page.textContent('#fit'))!, /See you next time.*Golds Bakery/s);

  // The tab: a night with results lists a Player of the match per game, with the line ups to pick from once read.
  await page.goto(`${studio.base}/socials.html`);
  await page.waitForSelector('#night option', { state: 'attached' });
  await page.selectOption('#night', second);
  await page.waitForFunction(() => document.querySelector('[data-key="potm:game-d1-r2-1"] select[aria-label="Player of the match"]'));
  const options = await page.$$eval('[data-key="potm:game-d1-r2-1"] select[aria-label="Player of the match"] optgroup', (gs: HTMLOptGroupElement[]) => gs.map(g => g.label));
  assert.deepEqual(options, ['Blizzardz', 'Mavericks']);
  assert.ok(await page.$('[data-key="teamround:Division 1"] select[aria-label="GS"]'));
  assert.ok(await page.$('[data-key="sponsorspot"] select'));
});
