// The Output page's two views (public/output/mode.js, board.js): Prep shows the whole page, with the sources' settings
// and the output's set-up as a section; Show hides the set-up behind a Settings drawer over the picture and draws the
// status board beside it (lights, the game row, eight lines), with the sources as show-and-hide only. The choice is
// remembered on this Mac. Every element keeps its id in both, so Stream Deck links and the other tests do too.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio');
const { openPage } = require('./support/browser');

test('Output page starts in Prep, Show draws the status board and a Settings drawer, and the choice is kept', async t => {
  const studio = await startStudio(t, { competition: 'Thunder League' });
  await studio.until(async () => (await studio.get('/api/scoreboard')).gameId);
  const page = await openPage(t, studio, '/output.html');
  if (!page) return;
  const pressed = m => page.getAttribute(`#modeSeg button[data-mode="${m}"]`, 'aria-pressed');

  // Prep: the whole page, with the sources' settings and the output's set-up as a folding section.
  assert.equal(await pressed('prep'), 'true');
  assert.equal(await page.isVisible('#settings'), true);
  assert.equal(await page.isVisible('#outSection'), true);
  assert.equal(await page.isVisible('#health'), true);
  assert.equal(await page.isVisible('#board'), false);
  assert.equal(await page.isVisible('#outCfg'), false);

  // Show: the set-up and the sources' settings go away, the board draws beside the picture.
  await page.click('#modeSeg button[data-mode="show"]');
  assert.equal(await pressed('show'), 'true');
  assert.equal(await page.isVisible('#settings'), false);
  assert.equal(await page.isVisible('#outSection'), false);
  assert.equal(await page.isVisible('#health'), false);
  assert.equal(await page.isVisible('#outOn'), true, 'Output on stays in the row over the picture');
  await page.waitForSelector('#board .line');
  assert.ok((await page.$$('#board .lights .light')).length >= 3, 'an output light, ATEM and REC');
  assert.equal((await page.$$('#board .line')).length, 8);
  assert.match(await page.textContent('#board .game'), /0 – 0/, 'the game row shows the score');
  assert.match(await page.textContent('#board .game'), /Q1 \d+:\d\d/, 'and shows the clock');
  assert.equal(await page.isVisible('#boardRecord'), true, 'recording is controlled from the board');

  // Settings opens the picked output's set-up as a drawer under the row, and closes it again.
  await page.click('#outCfg');
  assert.equal(await page.getAttribute('#outCfg', 'aria-pressed'), 'true');
  assert.equal(await page.isVisible('#outSection'), true);
  await page.click('#outCfg');
  assert.equal(await page.isVisible('#outSection'), false);

  // The view is remembered on this Mac.
  await page.reload({ waitUntil: 'load' });
  assert.equal(await pressed('show'), 'true');
  assert.equal(await page.isVisible('#settings'), false);
  await page.click('#modeSeg button[data-mode="prep"]');
  assert.equal(await page.isVisible('#settings'), true);
  assert.deepEqual(page.errors, []);
});
