// Operator journeys for picking tonight's game, on Scoreboard control and the scoreboard graphic, against the
// stand-in PlayHQ (test/support/playhq.js): Studio starts with the game on the court, moves to the next one by
// itself when its scoring opens, keeps a final on until it's finished, and says what it's doing when there's
// nothing on the court. The browser: see test/support/browser.js.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio');
const { createWorld } = require('./support/playhq');
const { openBrowser, openPage } = require('./support/browser');

// Waits until the page's element's text matches (and fails with what it says instead).
async function says(page, sel, re, timeout = 10000) {
  try { await page.waitForFunction(([s, src, flags]) => new RegExp(src, flags).test(document.querySelector(s).textContent), [sel, re.source, re.flags], { timeout }); }
  catch (err) { throw new Error(`${sel} says "${await page.textContent(sel)}", not ${re}`); }
}
// The scoreboard graphic's team names (they're the board's).
const teams = page => page.evaluate(() => [document.querySelector('#homeName').textContent, document.querySelector('#awayName').textContent]);
async function showsTeams(page, home, away, timeout = 10000) {
  try { await page.waitForFunction(([h, a]) => document.querySelector('#homeName').textContent === h && document.querySelector('#awayName').textContent === a, [home, away], { timeout }); }
  catch (err) { throw new Error(`the scoreboard shows ${(await teams(page)).join(' v ')}, not ${home} v ${away}`); }
}

// A season where court 1's next game (Division 2's) starts 10 minutes after the next whole minute at least the
// given seconds away (game times are to the minute): its electronic scoring opens then, and Studio moves to it.
function worldWithNextGameSoon(seconds) {
  const opens = Math.ceil((Date.now() + seconds * 1000) / 60000) * 60000;
  return createWorld({ now: opens + 10 * 60000 - 90 * 60000 });
}

test('stream night on court 1: the game being played is on, then Studio moves to the next game by itself when its scoring opens', async t => {
  const world = worldWithNextGameSoon(20);
  const studio = await startStudio(t, { competition: 'Thunder League', world });
  const browser = await openBrowser(t);
  if (!browser) return;
  const now = world.gameNow(0), next = world.gameNow(1);
  const control = await openPage(t, studio, '/control.html', { browser });
  const graphic = await openPage(t, studio, '/scoreboard.html', { browser });
  // On: Division 1's game on court 1, following PlayHQ, and the control page names the next one.
  await showsTeams(graphic, now.home, now.away);
  await says(control, '#autoNote', new RegExp(`^Next: ${next.home} v ${next.away} \\(\\d+:\\d\\d\\), switches at `));
  assert.equal(await control.isChecked('#autoSelect'), true);
  assert.equal((await studio.get('/api/scoreboard')).court, 'Court 1');
  // The scorer scores: the graphic follows.
  Object.assign(world.live[now.id], { home: 3, away: 1, homeGoals: 3, awayGoals: 1 });
  await graphic.waitForFunction(() => document.querySelector('#homeScore').textContent === '3' && document.querySelector('#awayScore').textContent === '1', null, { timeout: 10000 });
  // Scoring for the next game opens: the graphic moves to it at 0-0 by itself (Studio looks every 15 seconds).
  await showsTeams(graphic, next.home, next.away, 100000);
  await graphic.waitForFunction(() => document.querySelector('#homeScore').textContent === '0' && document.querySelector('#awayScore').textContent === '0', null, { timeout: 5000 });
  await says(control, '#autoNote', /^Last game on this court today\./);
  const b = await studio.get('/api/scoreboard');
  assert.equal(b.gameId, next.id);
  assert.equal(b.period, 1, 'from the first quarter');
  assert.equal(b.clockElapsedMs, 0, 'with a full clock');
  assert.equal(b.source, 'playhq');
  assert.deepEqual(control.errors, []);
  assert.deepEqual(graphic.errors, []);
});

test('a final is kept on past the next game\'s start until PlayHQ marks it finished (it may go to extra time)', async t => {
  const world = worldWithNextGameSoon(20);
  const final = world.gameNow(0);
  world.rounds[final.roundId].name = 'Grand Final';
  const studio = await startStudio(t, { competition: 'Thunder League', world });
  const browser = await openBrowser(t);
  if (!browser) return;
  const control = await openPage(t, studio, '/control.html', { browser });
  const graphic = await openPage(t, studio, '/scoreboard.html', { browser });
  await showsTeams(graphic, final.home, final.away);
  // The next game's scoring opens while the final is still being played: the final stays, and the page says why.
  await says(control, '#autoNote', /Keeping the final on until PlayHQ marks it finished/, 100000);
  assert.deepEqual(await teams(graphic), [final.home, final.away]);
  // The scorer finishes it: Studio moves on.
  final.status = 'FINAL';
  final.score = { home: 41, away: 38 };
  const next = world.gameNow(1);
  await showsTeams(graphic, next.home, next.away, 100000);
  assert.deepEqual(control.errors, []);
});

test('the operator follows another court, then picks a game by hand, then hands it back to automatic', async t => {
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const browser = await openBrowser(t);
  if (!browser) return;
  const world = studio.world;
  const control = await openPage(t, studio, '/control.html', { browser });
  const graphic = await openPage(t, studio, '/scoreboard.html', { browser });
  const court1 = world.gameNow(0), court2 = world.games['game-d1-r3-2'];
  await showsTeams(graphic, court1.home, court1.away);
  // Court 2: its game comes on.
  await control.fill('#autoCourt', '2');
  await control.press('#autoCourt', 'Tab');
  await showsTeams(graphic, court2.home, court2.away);
  assert.equal((await studio.get('/api/scoreboard')).court, 'Court 2');
  // The game list has this game night's games in every division; picking one turns automatic off.
  await control.waitForFunction(() => document.querySelectorAll('#games option').length === 4, null, { timeout: 10000 });
  const options = await control.$$eval('#games option', os => os.map(o => o.textContent));
  assert.ok(options.every(o => /Round 3/.test(o)), options.join('\n'));
  const pickIndex = options.findIndex(o => o.includes('Division 2') && o.includes('Court 2'));
  await control.selectOption('#games', String(pickIndex));
  await control.click('#useGame');
  const picked = world.divisions[1].rounds[2].games[1];
  await showsTeams(graphic, picked.home, picked.away);
  // The control page hears that automatic went off a moment after the graphic changes.
  await control.waitForFunction(() => !document.querySelector('#autoSelect').checked, null, { timeout: 5000 });
  await says(control, '#autoNote', /^Off, so the game stays as picked from the list/);
  // Ticked again: back to the game on court 2.
  await control.check('#autoSelect');
  await showsTeams(graphic, court2.home, court2.away);
  assert.deepEqual(control.errors, []);
});

test('a competition with no court to follow, or a court with no games today: a game is still on, and the page says what to do', async t => {
  // The Thunder League without its court to follow (as a new competition starts).
  const tpl = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'templates', 'Thunder League.json'), 'utf8'));
  (tpl.settings || tpl).defaultCourt = '';
  const studio = await startStudio(t);
  await studio.post('/api/setup-template', JSON.stringify(tpl));
  const control = await openPage(t, studio, '/control.html');
  if (!control) return;
  const world = studio.world;
  await control.check('#autoSelect');
  await says(control, '#autoNote', /^Set a court to follow its games through the night\. Showing this game night's first game\./);
  const first = await studio.get('/api/scoreboard');
  assert.ok([world.gameNow(0).id, world.games['game-d1-r3-2'].id].includes(first.gameId), 'one of this game night\'s first games');
  await control.fill('#autoCourt', 'Court 7');
  await control.press('#autoCourt', 'Tab');
  await says(control, '#autoNote', /^No games on Court 7 today\. Showing this game night's first game\./);
  assert.ok((await studio.get('/api/scoreboard')).gameId, 'the board still has a game');
  // Court 1 after all: its game.
  await control.fill('#autoCourt', '1');
  await control.press('#autoCourt', 'Tab');
  await says(control, '#autoNote', /^Next: /);
  assert.equal((await studio.get('/api/scoreboard')).gameId, world.gameNow(0).id);
  assert.deepEqual(control.errors, []);
});

test('a game night picked by hand changes the games list and every page\'s round, and Automatic puts it back', async t => {
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const control = await openPage(t, studio, '/control.html');
  if (!control) return;
  await control.waitForFunction(() => /^Automatic: \w{3}, \d+ \w{3} \(Round 3\)$/.test(document.querySelector('#round option').textContent), null, { timeout: 10000 });
  const night = studio.world.divisions[0].rounds[0].games[0].date;
  assert.match(await control.textContent(`#round option[value="${night}"]`), / · Round 1$/);
  await control.selectOption('#round', night);
  await says(control, '#roundNote', /^Picked by hand/);
  await control.waitForFunction(() => [...document.querySelectorAll('#games option')].every(o => / Round 1 /.test(o.textContent)), null, { timeout: 10000 });
  assert.equal((await studio.get('/api/rounds')).choice, night);
  const fixtures = await studio.get('/api/fixtures');
  assert.match(JSON.stringify(fixtures), /Round 1/);
  await control.selectOption('#round', '');
  await says(control, '#roundNote', /^Automatic picks the first game night in the next 5 days/);
  await control.waitForFunction(() => [...document.querySelectorAll('#games option')].every(o => / Round 3 /.test(o.textContent)), null, { timeout: 10000 });
  assert.equal((await studio.get('/api/rounds')).choice, '');
});
