// Scoreboard control as an operator panel (control.html): the game in one bar over the scores and the clock, the
// graphics, team lists, finals and the rest as tabs (the open one kept on this Mac), the clock button keeping its key
// as it changes between Start and Stop, and Change game… opening the Game section at the bottom, which folds.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio');
const { openPage } = require('./support/browser');

test('the game bar, the tabs and the Game section', async t => {
  const studio = await startStudio(t, { competition: 'Thunder League' });
  await studio.until(async () => (await studio.get('/api/scoreboard')).gameId);
  const page = await openPage(t, studio, '/control.html');
  if (!page) return;
  await page.waitForFunction(() => /·/.test(document.querySelector('#gameMeta').textContent));
  assert.match(await page.textContent('#gameName'), /^\S.* v \S/);
  assert.match(await page.textContent('#gameMeta'), /Division 1 · Round \d+ · Court 1 · \d\d:\d\d/);
  assert.equal(await page.getAttribute('#srcPlayhq', 'aria-pressed'), 'true');
  // The clock's button keeps its key as it changes.
  const word = await page.textContent('#clockWord');
  assert.match(word, /^(Start|Stop)$/);
  await page.click('#clockToggle');
  await page.waitForFunction(w => document.querySelector('#clockWord').textContent === (w === 'Start' ? 'Stop' : 'Start'), word);
  assert.equal(await page.textContent('#clockToggle kbd'), 'Space');
  await page.click('#clockToggle');
  // Tabs: Graphics first, the others on a click, the choice kept.
  assert.equal(await page.isVisible('#titlelink'), true);
  assert.equal(await page.isVisible('#finDivision'), false);
  await page.click('#ctlTabs button[data-tab="finals"]');
  assert.equal(await page.isVisible('#finDivision'), true);
  assert.equal(await page.isVisible('#titlelink'), false);
  await page.reload({ waitUntil: 'load' });
  assert.equal(await page.getAttribute('#ctlTabs button[data-tab="finals"]', 'aria-selected'), 'true');
  assert.equal(await page.isVisible('#finDivision'), true);
  // The Game section folds to its title and Change game… opens it again.
  assert.equal(await page.isVisible('#games'), true);
  await page.click('#gameSection h2');
  assert.equal(await page.isVisible('#games'), false);
  await page.reload({ waitUntil: 'load' });
  assert.equal(await page.isVisible('#games'), false, 'stays folded');
  await page.click('#changeGame');
  assert.equal(await page.isVisible('#games'), true);
  assert.deepEqual(page.errors, []);
});
