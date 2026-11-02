// Operator journey for the Production Planner, against the stand-in PlayHQ (test/support/playhq.js): add the
// commentators, plan tonight on a court, put people on the game being played, and see Scoreboard control follow the
// planned court and the Commentators graphic name them (as a line, and as lower thirds with a headshot); then change the court by hand and see the Planner flag it.
// The browser: see test/support/browser.js.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio');
const { createWorld } = require('./support/playhq');
const { openBrowser, openPage } = require('./support/browser');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('plan tonight: the commentators, the court and who calls the game on now', async t => {
  const world = createWorld();
  const studio = await startStudio(t, { competition: 'Thunder League', world });
  const browser = await openBrowser(t);
  if (!browser) return;
  await studio.until(async () => (await studio.get('/api/scoreboard')).gameId);
  // Scoreboard control starts on Court 2, so planning Court 1 has to move it.
  await studio.post('/api/scoreboard', { type: 'autoCourt', value: 'Court 2' });
  const planner = await openPage(t, studio, '/planner.html', { browser });
  await planner.waitForSelector('details.night[open]');

  // The commentators.
  for (const name of ['Honey Harrington', 'Will Linter']) {
    await planner.fill('#newName', name);
    await planner.press('#newName', 'Enter');
    await planner.waitForFunction(n => [...document.querySelectorAll('.person__name')].some(e => e.textContent === n), name);
  }
  await planner.locator('.person', { hasText: 'Honey Harrington' }).locator('input[type=checkbox]').check();
  await studio.until(async () => (await studio.get('/api/planner')).pool.find(p => p.name === 'Honey Harrington').guest);

  // Tonight (the open night) on Court 1, both on the game being played.
  const tonight = planner.locator('details.night[open]');
  await tonight.locator('select').first().selectOption('Court 1');
  await planner.waitForSelector('details.night[open] .slot');
  const now = world.gameNow(0);
  const slot = () => planner.locator('details.night[open] .slot', { hasText: `${now.home} v ${now.away}` });
  for (const name of ['Will Linter', 'Honey Harrington (guest)']) {
    await slot().locator('select').selectOption({ label: name });
    await planner.waitForFunction(n => [...document.querySelectorAll('details.night[open] .seat')].some(e => e.textContent.startsWith(n)), name);
  }

  // Scoreboard control follows the plan's court, and says where it came from.
  const control = await openPage(t, studio, '/control.html', { browser });
  await control.waitForFunction(() => document.querySelector('#autoCourt').value === 'Court 1' && !document.querySelector('#courtFrom').hidden && /Production Planner/.test(document.querySelector('#courtFrom').textContent));
  await studio.until(async () => (await studio.get('/api/scoreboard')).gameId === now.id, 20000);

  // The Commentators graphic, with no names typed, names them.
  const graphic = await openPage(t, studio, '/commentators.html', { browser });
  await graphic.waitForFunction(() => /Will Linter and Honey Harrington/.test(document.querySelector('#lineNames').textContent));
  assert.equal(await graphic.textContent('#lineLabel'), 'Commentators', 'one of the two is not a guest');

  // As lower thirds, a bar each: Will on the left, Honey mirrored on the right with a Special guest tab, and with
  // ?photo=1 Will's headshot in place of the competition logo (Honey has none, so keeps the logo).
  const will = (await studio.get('/api/planner')).pool.find(p => p.name === 'Will Linter');
  assert.equal((await studio.request('POST', `/api/planner/headshot?id=${will.id}&ext=png`, PNG, { 'content-type': 'application/octet-stream' })).status, 200);
  const thirds = await openPage(t, studio, '/commentators.html?style=lowerthirds&photo=1', { browser });
  await thirds.waitForFunction(() => document.querySelectorAll('#thirds .l3').length === 2);
  const bars = await thirds.$$eval('#thirds .l3', els => els.map(e => ({
    name: e.querySelector('.l3__name').textContent, tag: e.querySelector('.l3__tag').textContent, line: e.querySelector('.l3__line').textContent,
    right: e.classList.contains('l3--right'), photo: (e.querySelector('.l3__photo') || {}).src || null, logo: !!e.querySelector('.l3__logo') })));
  assert.deepEqual(bars, [
    { name: 'Will Linter', tag: '', line: 'Commentator', right: false, photo: `${studio.base}/headshots/${will.id}.png`, logo: false },
    { name: 'Honey Harrington', tag: 'Special guest', line: 'Commentator', right: true, photo: null, logo: true },
  ]);

  // A court changed by hand on Scoreboard control stays, and the Planner flags it.
  await control.fill('#autoCourt', 'Court 2');
  await control.press('#autoCourt', 'Tab');
  await studio.until(async () => (await studio.get('/api/scoreboard')).autoCourt === 'Court 2');
  await planner.reload();
  await planner.waitForFunction(() => /following Court 2, but the plan for tonight is Court 1/.test(document.querySelector('#flags').textContent));
  assert.equal((await studio.get('/api/scoreboard')).autoCourt, 'Court 2');
  assert.deepEqual(planner.errors, []);
  assert.deepEqual(control.errors, []);
  assert.deepEqual(graphic.errors, []);
  assert.deepEqual(thirds.errors, []);
});
