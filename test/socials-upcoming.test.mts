// The Socials tab's Upcoming pictures worked out from the season (socialstats.ts): Form guide, Round preview, Byes,
// Milestones (also on Results), Finals race, Countdown and Season draw. The browser: Playwright's own, or
// STUDIO_TEST_CHROMIUM; skipped without one (except in the Tests check).
import test from 'node:test';
import assert from 'node:assert/strict';
import { startStudio, type Json } from './support/studio.mts';
import { createWorld, discoverGame } from './support/playhq.mts';
import * as stats from '../out/socialstats.js';
import type { BrowserType } from 'playwright';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let chromium: BrowserType | null = null;
try { ({ chromium } = require('playwright') as typeof import('playwright')); } catch { /* not installed */ }

// Division 2 has no second game in Round 3, so Titans and Tsunamiz have a bye tonight; Blizzardz WD is new in Round 2.
function upcomingWorld() {
  const world = createWorld();
  const r3 = world.rounds['grade-div2-r3'];
  const gone = r3.games.pop();
  delete world.games[gone!.id];
  world.answers.discoverGame = ({ variables }) => {
    if (variables.gameID !== 'game-d1-r2-1') return null;
    const g = discoverGame(world, variables.gameID);
    const wd = g!.statistics!.home!.players.find(p => p.playerPosition.shortName === 'WD');
    wd!.player = { ...wd!.player, id: 'new-wd', profile: { firstName: 'Nova', lastName: 'Newcombe', gender: 'MALE' } };
    return { body: { data: { discoverGame: g } } };
  };
  return world;
}

test('Upcoming pictures: form, round preview, byes, milestones, countdown and season draw from the season', async t => {
  const world = upcomingWorld();
  const studio = await startStudio(t, { competition: 'Thunder League', world });
  const [first, second, tonight] = (await studio.get('/api/socials')).nights.map((n: Json) => n.date);
  assert.equal(tonight, world.today);
  const settings = (await studio.get('/api/socials')).settings.sponsor;
  for (const k of ['form', 'preview', 'byes', 'milestones', 'race', 'countdown', 'draw']) assert.equal(settings[k], true, `${k} carries the sponsor strip`);

  const n = await studio.get(`/api/socials/night?date=${tonight}&with=form`);
  assert.deepEqual(n.byes.map((b: Json) => [b.division, b.teams.map((x: Json) => x.name)]), [['Division 2', ['Titans', 'Tsunamiz']]]);
  assert.ok(n.byes[0].teams.every((x: Json) => x.logo));
  assert.deepEqual(n.countdown, { rounds: 2 }, 'tonight and next week before the finals');
  assert.deepEqual(n.firstNights, []);
  const f = n.form.find((x: Json) => x.id === 'game-d1-r3-1'); // Blizzardz v Travis' Disciples
  assert.deepEqual(f.home.map((r: Json) => r.result), ['W', 'W']);
  assert.deepEqual(f.away.map((r: Json) => [r.result, r.for, r.against]), [['L', 27, 32], ['L', 27, 32]]);
  assert.deepEqual(f.meetings, [], 'first meeting this season');
  const next = await studio.get(`/api/socials/night?date=${(await studio.get('/api/socials')).nights[3].date}&with=form&game=game-d1-r4-1`);
  assert.deepEqual(next.form.map((x: Json) => [x.id, x.wins]), [['game-d1-r4-1', { home: 0, away: 1, draws: 0 }]], 'Blizzardz beat Knights in Round 1');

  const p = (await studio.get(`/api/socials/night?date=${tonight}&with=preview&division=Division%201`)).preview;
  assert.equal(p.pick, 'game-d1-r3-1', 'the two best placed teams: 1st v 4th beats 2nd v 3rd on the sum of places');
  assert.deepEqual(p.games.find((g: Json) => g.id === 'game-d1-r3-1').home, { place: 1, points: 8 });

  assert.equal((await studio.get(`/api/socials/night?date=${first}`)).firstNights.length, 2, 'both divisions start their season on the first night');
  const d = (await studio.get(`/api/socials/night?date=${first}&with=draw&division=Division%201&team=Knights`)).draw;
  assert.deepEqual(d.games.map((g: Json) => [g.round, g.opponent, g.result ? `${g.result.result} ${g.result.for}-${g.result.against}` : '']),
    [['Round 1', 'Blizzardz', 'L 25-30'], ['Round 2', "Travis' Disciples", 'W 32-27'], ['Round 3', 'Mavericks', ''], ['Round 4', 'Blizzardz', '']]);

  // Milestones: 47 games before this season plus two this season makes tonight a 50th; 48 makes Round 2 a 50th; a
  // new athlete in Round 2 plays a first game, but nobody does in Round 1, their team's first game.
  await studio.post('/api/athletes/stats', { athlete: 'Blizzardz GS', records: [{ division: 'Division 1', games: 47, asOf: '2026-01-01' }] });
  await studio.post('/api/athletes/stats', { athlete: 'Knights GA', records: [{ division: 'Division 1', games: 48, asOf: '2026-01-01' }] });
  const coming = (await studio.get(`/api/socials/night?date=${tonight}&with=milestones`)).milestones;
  assert.deepEqual(coming.map((m: Json) => [m.name, m.team, m.games, m.played]), [['Blizzardz GS', 'Blizzardz', 50, false]]);
  const played = (await studio.get(`/api/socials/night?date=${second}&with=milestones`)).milestones;
  assert.deepEqual(played.map((m: Json) => [m.name, m.games, m.played]), [['Knights GA', 50, true], ['Nova Newcombe', 1, true]]);
  assert.deepEqual((await studio.get(`/api/socials/night?date=${first}&with=milestones`)).milestones, []);

  let browser = null;
  try { browser = chromium && await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined }); } catch { browser = null; }
  if (!browser) {
    if (process.env.STUDIO_TEST_REQUIRE_BROWSER) assert.fail('no browser to test the Upcoming pictures in');
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

  await draw('form', tonight, '&game=game-d1-r3-1');
  assert.deepEqual(await texts('.form__chips b'), ['W', 'W', 'L', 'L']);
  assert.match((await page.textContent('.info'))!, /First meeting this season/);
  await draw('preview', tonight, '&division=Division%201');
  assert.equal(await page.textContent('.result__final'), 'Game of the round');
  assert.match((await texts('.game__info'))[0], /^1st \(8 pts\)\s+v\s+4th \(0 pts\)/);
  await draw('byes', tonight);
  assert.deepEqual(await texts('.bound--bye .game__team'), ['Titans', 'Tsunamiz']);
  await draw('milestones', tonight, '&when=next');
  assert.match((await page.textContent('.bound--ms'))!, /Blizzardz GS.*set to play their 50th/);
  await draw('milestones', second, '&when=played');
  assert.deepEqual(await texts('.bound--ms .shooter__name'), ['Knights GA', 'Nova Newcombe']);
  assert.match((await texts('.bound--ms .shooter__team'))[1], /first game/);
  await draw('countdown', tonight);
  assert.deepEqual([await page.textContent('.count__big'), await page.textContent('.count__words')], ['2', 'rounds to go until finals']);
  await draw('draw', first, '&division=Division%201&team=Knights');
  assert.deepEqual(await texts('.bound--draw .bound__earned'), ['L 25–30', 'W 32–27', 'Round 3', 'Round 4']);
  await draw('race', tonight, '&division=Division%201');
});

test('finals race: in, out or still a chance from the points and the games left', () => {
  const day = (d: Json) => `2026-11-${String(d).padStart(2, '0')}`;
  // A game as socialstats takes it; these have no id, as none of the counts reads one.
  const g = (date: string, home: string, away: string, done: boolean) => ({ date, division: 'D', round: 'Round', home: { name: home, score: done ? 30 : null }, away: { name: away, score: done ? 20 : null }, finished: done }) as Parameters<typeof stats.countdown>[0][number];
  // One round left (two games), top 2 play finals, a win worth 4: A can't be caught, B and C can still miss out (or tie),
  // D can reach 8 at most, short of the 12 in second place.
  const season = [g(day(4), 'A', 'B', false), g(day(4), 'C', 'D', false), g(day(4), 'E', 'F', true)];
  const rows = ([['A', 20], ['B', 12], ['C', 12], ['D', 4], ['E', 4], ['F', 0]] as [string, number][]).map(([team, points], i) => ({ team, teamId: null, position: i + 1, points, won: points / 4, played: 4 }));
  const r = stats.race(season, day(4), 'D', rows, 2).rows;
  assert.deepEqual(r.map(x => [x.team, x.status, x.left]), [['A', 'in', 1], ['B', 'chance', 1], ['C', 'chance', 1], ['D', 'out', 1], ['E', 'out', 0], ['F', 'out', 0]]);
  assert.deepEqual(stats.raceOn(season, day(4), ['D']), [{ division: 'D', left: 1 }]);
  assert.deepEqual(stats.raceOn(season, day(5), ['D']), [], 'no nights left');
  assert.deepEqual(stats.countdown([g(day(4), 'A', 'B', false), { ...g(day(11), 'A', 'B', false), round: 'Grand Final' }], day(11), ['D']), { grandFinal: 0 });
  assert.deepEqual(stats.countdown([{ ...g(day(4), 'A', 'B', false), round: 'Semi Final' }, { ...g(day(18), 'A', 'B', false), round: 'Grand Final' }], day(4), ['D']), { grandFinal: 14 });
});
