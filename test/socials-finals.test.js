// Finals on the Socials tab: after a division's last home and away round, Finals bound (who made it and what their place
// earned) and the Finals draw; on a finals night the draw again, and each finals game named on its match up, full time
// and the results. The browser: Playwright's own, or STUDIO_TEST_CHROMIUM; skipped without one (except in the Tests check).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio');
const { createWorld } = require('./support/playhq');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* not installed */ }

// The season's last round (Round 4) played, Blizzardz and Mavericks winning it, so Division 1's ladder is Blizzardz,
// Mavericks, Knights, Travis' Disciples; and its semi finals on PlayHQ a week later.
function finalsWorld() {
  const world = createWorld();
  for (const div of world.divisions) {
    for (const g of div.rounds[3].games) {
      g.status = 'FINAL';
      const homeWins = div.teams.indexOf(g.home) > div.teams.indexOf(g.away);
      g.score = homeWins ? { home: 20, away: 40 } : { home: 40, away: 20 };
    }
  }
  const div = world.divisions[0], last = div.rounds[3];
  const date = new Date(Date.parse(`${last.games[0].date}T00:00:00Z`) + 7 * 864e5).toISOString().slice(0, 10);
  const round = { id: `${div.id}-r5`, name: 'Semi Finals', number: 5, current: false, gradeId: div.id, games: [] };
  for (const [i, [home, away]] of [['Blizzardz', 'Mavericks'], ['Knights', "Travis' Disciples"]].entries()) {
    const g = { ...last.games[i], id: `game-d1-sf-${i + 1}`, roundId: round.id, date, status: 'UPCOMING', home, away, score: null };
    round.games.push(g);
    world.games[g.id] = g;
  }
  div.rounds.push(round);
  world.rounds[round.id] = round;
  return { world, lastDate: last.games[0].date, semisDate: date };
}

test('finals pictures: Finals bound and the draw after the last round, the finals named on a finals night', async t => {
  let browser = null;
  try { browser = chromium && await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined }); } catch { browser = null; }
  if (!browser) {
    if (process.env.STUDIO_TEST_REQUIRE_BROWSER) assert.fail('no browser to test the finals pictures in');
    t.skip('no browser to test the finals pictures in; run npx playwright install chromium');
    return;
  }
  t.after(() => browser.close());
  const { world, lastDate, semisDate } = finalsWorld();
  const studio = await startStudio(t, { competition: 'Thunder League', world });

  // Before the last round, no finals pictures.
  assert.deepEqual((await studio.get(`/api/socials/night?date=${world.today}`)).finals, []);
  const last = await studio.get(`/api/socials/night?date=${lastDate}`);
  assert.deepEqual(last.finals.find(f => f.division === 'Division 1'), { division: 'Division 1', finalsNight: false, lastRound: true, left: 0 });

  const page = await browser.newPage({ viewport: { width: 1080, height: 1080 } });
  await page.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '' }));
  const draw = async (kind, date, more = '') => {
    await page.goto(`${studio.base}/social.html?kind=${kind}&date=${date}${more}`);
    await page.waitForFunction(() => window.socialReady !== undefined);
    assert.equal(await page.evaluate(() => window.socialReady), true, `${kind} draws`);
  };
  const texts = sel => page.$$eval(sel, els => els.map(e => e.textContent));
  const firstFinal = sel => page.$eval('.final', (e, sel) => [...e.querySelectorAll(sel)].map(x => x.textContent), sel);

  await draw('finalsbound', lastDate, '&division=Division%201');
  assert.deepEqual(await texts('.bound .game__team'), ['Blizzardz', 'Mavericks', 'Knights', "Travis' Disciples"]);
  assert.deepEqual(await texts('.bound__earned'), ['Double chance', 'Double chance', 'Elimination final', 'Elimination final']);
  assert.deepEqual(await texts('.tag'), [], 'the season is over: no "as it stands"');

  await draw('finalsdraw', lastDate, '&division=Division%201');
  assert.deepEqual(await texts('.group__name'), ['Semi finals', 'Preliminary final', 'Grand final']);
  assert.deepEqual(await texts('.final__name span:first-child'), ['Major semi final', 'Minor semi final'], 'a final named once, by its week alone');
  assert.deepEqual(await firstFinal('.game__team'), ['Blizzardz', 'Mavericks']);
  assert.deepEqual(await texts('.final__tbc'), ['Loser major semi final', 'Winner minor semi final', 'Winner major semi final', 'Winner preliminary final']);
  assert.equal(await page.$$eval('.final--gf', e => e.length), 1, 'the grand final stands out');

  // The semi finals night: the draw to post before it, and each game named.
  const semis = await studio.get(`/api/socials/night?date=${semisDate}`);
  assert.deepEqual(semis.finals, [{ division: 'Division 1', finalsNight: true, lastRound: false, left: 2 }]);
  assert.deepEqual(semis.games.map(g => g.final), ['Major semi final', 'Minor semi final']);
  await draw('matchup', semisDate, `&game=${semis.games[0].id}`);
  assert.match(await page.textContent('#when'), /Division 1\s+·\s+Major semi final/);

  // A winner entered by hand fills in the draw: Blizzardz into the grand final, Mavericks into the preliminary final.
  await studio.post('/api/finals/result', { division: '1', game: 'MSF', winner: 'Blizzardz', homeScore: 40, awayScore: 31 });
  await draw('finalsdraw', semisDate, '&division=Division%201');
  assert.deepEqual(await firstFinal('.score'), ['40', '31']);
  assert.deepEqual(await texts('.game__team.won'), ['Blizzardz']);
  assert.ok((await texts('.final--gf .game__team')).includes('Blizzardz'), 'the winner goes through to the grand final');
  assert.ok((await texts('.game__team')).filter(x => x === 'Mavericks').length === 2, 'the loser gets another chance');
});
