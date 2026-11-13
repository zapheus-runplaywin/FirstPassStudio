// The fixture board's "On the mic" photos (fixtureboard.html): beside the teams inside the streamed games' boxes,
// each commentator's Planner headshot (or the neutral silhouette) with their name under it, only where there is
// room; on a crowded board they fall back to name pills. The board's data is stood in for, so the layout is known.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startStudio, type Studio, type Json } from './support/studio.mts';
import { openBrowser } from './support/browser.mts';
import type { TestContext } from 'node:test';

let studio: Studio;
test.before(async () => { studio = await startStudio(null, { competition: 'Thunder League' }); });
test.after(() => studio && studio.stop());

const team = (name: string) => ({ name, logo: null });
function night(courts: Json, people: Json, names = [['Stormz', 'Titans'], ['Game of Throws', 'Saddle Up']]) {
  const slots = ['18:30', '19:35'].map((time, i) => ({ time, games: courts.map((court: Json, c: Json) => ({
    id: `${i}-${c}`, time, court, division: 'Open Mixed', round: 'Round 10', home: team(names[i][0]), away: team(names[i][1]),
    streamed: c === 0, onAir: false, people: c === 0 ? people : [], state: 'next', winner: '',
  })) }));
  return { date: '2026-11-04', today: true, competition: 'Thunder League', venue: 'Gold Netball Centre', court: courts[0], courts, slots };
}

async function board(t: TestContext, browser: Json, data: Json) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  t.after(() => context.close());
  await context.route((url: string) => !String(url).startsWith(studio.base), (r: Json) => r.fulfill({ status: 200, body: '', contentType: 'text/css' }));
  await context.route(`${studio.base}/api/planner/fixtureboard*`, (r: Json) => r.fulfill({ json: data }));
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (err: Json) => errors.push(err.message));
  await page.goto(`${studio.base}/fixtureboard.html?refresh=0`);
  await page.waitForSelector('.game');
  t.after(() => assert.deepEqual(errors, []));
  return page;
}

test('commentators on the streamed games show as photos with their names, where there is room', async t => {
  const browser = await openBrowser(t);
  if (!browser) return;
  const people = [{ name: 'Bec Nitschke', guest: false, headshot: '/silhouettes/female.svg' }, { name: 'Honey Harrington', guest: true, headshot: null }];
  const page = await board(t, browser, night(['Indoor 01'], people));
  const groups = await page.$$eval('.game.withmic', (gs: Json) => gs.map((g: Json) => ({
    tab: g.querySelector('.onmic__tab').textContent,
    faces: [...g.querySelectorAll('.face')].map(f => ({ name: f.textContent, img: f.querySelector('img').getAttribute('src'), guest: f.classList.contains('guest') })),
  })));
  assert.equal(groups.length, 2, 'both streamed games');
  assert.equal(groups[0].tab, 'On the mic');
  assert.deepEqual(groups[0].faces, [
    { name: 'Bec Nitschke', img: '/silhouettes/female.svg', guest: false },
    { name: 'Honey Harrington', img: 'silhouettes/neutral.svg', guest: true },
  ], 'a headshot, else the neutral silhouette; a guest marked');
  assert.equal(await page.$$eval('.mic', (m: Json) => m.length), 0, 'no name pills as well');
});

test('four courts, two commentators: photos (Matt\'s usual night)', async t => {
  const browser = await openBrowser(t);
  if (!browser) return;
  const people = [{ name: 'Bec Nitschke', guest: false, headshot: null }, { name: 'Honey Harrington', guest: true, headshot: null }];
  const page = await board(t, browser, night(['Indoor 01', 'Indoor 02', 'Indoor 03', 'Indoor 04'], people));
  assert.equal(await page.$$eval('.game.withmic', (m: Json) => m.length), 2);
  assert.equal(await page.$$eval('.withmic .name', (ns: Json) => ns.filter((n: Json) => n.scrollWidth > n.clientWidth + 1).length), 0, 'no team name cut short');
});

test('a crowded board keeps the name pills instead', async t => {
  const browser = await openBrowser(t);
  if (!browser) return;
  const people = ['Bec Nitschke', 'Honey Harrington', 'Sam Lee'].map(name => ({ name, guest: false, headshot: null }));
  const courts = ['Indoor 01', 'Indoor 02', 'Indoor 03', 'Indoor 04', 'Indoor 05', 'Indoor 06', 'Indoor 07', 'Indoor 08'];
  const page = await board(t, browser, night(courts, people));
  assert.equal(await page.$$eval('.onmic', (m: Json) => m.length), 0, 'no photos');
  assert.deepEqual(await page.$$eval('.game.streamed .mic', (m: Json) => m.map((x: Json) => x.textContent)), ['Bec NitschkeHoney HarringtonSam Lee', 'Bec NitschkeHoney HarringtonSam Lee']);
});
