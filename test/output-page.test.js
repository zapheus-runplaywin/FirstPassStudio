// The Output page as one view (public/output/mode.js, board.js, sources.js): the picture with the status board beside
// it, the output's set-up behind Settings over the picture, each source's settings under its row behind the pencil,
// and Music's settings behind its Settings button. Every element keeps its id, so Stream Deck links and the other
// tests do too.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio');
const { openPage } = require('./support/browser');

test('Output page: the status board draws, set-up waits behind Settings and the pencil, and the add buttons stay in reach', async t => {
  const studio = await startStudio(t, { competition: 'Thunder League' });
  await studio.until(async () => (await studio.get('/api/scoreboard')).gameId);
  const page = await openPage(t, studio, '/output.html');
  if (!page) return;

  // One view: the board beside the picture, Output on and the add buttons in reach, the output's set-up folded away.
  await page.waitForSelector('#board .line');
  assert.equal((await page.$$('#board .lights')).length, 0, 'the outputs, ATEM and REC are the bar\'s chips, not a board row');
  assert.equal((await page.$$('#board .line')).length, 8);
  // The bar: ON AIR (or Off air) with a dot per output, hollow while it isn't sending; the chips are status, not links.
  await page.waitForSelector('.fp-chips .chip .odot');
  assert.equal((await page.$$('.fp-chips .chip .odot')).length, 1, 'one output, one dot');
  assert.equal((await page.$$('.fp-chips .chip .odot.on')).length, 0, 'off air: hollow');
  assert.equal((await page.$$('.fp-chips a.chip')).length, 0, 'no chip is a link');
  assert.equal((await page.$$('.fp-chips .chip.atem')).length, 0, 'no switcher set up: no ATEM chip');
  assert.match(await page.textContent('#board .game'), /0 – 0/, 'the game row shows the score');
  assert.doesNotMatch(await page.textContent('#board .game'), /Q1 \d+:\d\d/, 'the clock is the bar\'s PlayHQ chip, not the board\'s');
  assert.match(await page.textContent('.fp-chips .chip.playhq'), /Q1 \d+:\d\d/, 'the PlayHQ chip carries the quarter and clock');
  assert.equal(await page.isVisible('#boardRecord'), true, 'recording is controlled from the board');
  assert.equal(await page.isVisible('#outOn'), true);
  assert.equal(await page.isVisible('#addBrowser'), true);
  assert.equal(await page.isVisible('#hideAll'), true);
  assert.equal(await page.isVisible('#outSection'), false);
  assert.equal(await page.isVisible('#settings'), false, 'no source selected: no settings');
  assert.equal(await page.isVisible('#mFadeIn'), false, "the music's settings wait behind Settings");
  assert.equal(await page.isVisible('#mPlay'), true, 'its player is there');

  // Settings opens the picked output's set-up as a drawer under the row, and closes it again.
  await page.click('#outCfg');
  assert.equal(await page.getAttribute('#outCfg', 'aria-pressed'), 'true');
  assert.equal(await page.isVisible('#outSection'), true);
  await page.click('#outCfg');
  assert.equal(await page.isVisible('#outSection'), false);

  // A new source opens its settings under its row; Done closes them; the pencil opens them again.
  await page.click('#addBrowser');
  await page.selectOption('#newPage', 'scoreboard.html');
  await page.click('#addGo');
  await page.waitForSelector('#sources li.editor #settings');
  assert.equal(await page.isVisible('#fName'), true);
  assert.equal(await page.inputValue('#fName'), 'Scoreboard');
  assert.equal(await page.getAttribute('#sources li.sel .edit', 'aria-pressed'), 'true');
  await page.click('#settingsDone');
  assert.equal(await page.isVisible('#settings'), false);
  assert.equal((await page.$$('#sources li.editor')).length, 0);
  await page.click('#sources li .edit');
  await page.waitForSelector('#sources li.editor #settings');
  assert.equal(await page.isVisible('#fRemove'), true);
  assert.equal(await page.isVisible('#sources li .pvw'), true, 'the eye previews the source');

  // Music's Settings unfolds its form.
  await page.click('#musicCfg');
  assert.equal(await page.isVisible('#mFadeIn'), true);
  await page.click('#musicCfg');
  assert.equal(await page.isVisible('#mFadeIn'), false);
  assert.deepEqual(page.errors, []);
});
