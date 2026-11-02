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
  assert.equal((await page.$$('#board .line')).length, 7, 'the mics carry their dip, so it has no line of its own');
  assert.equal((await page.$$('#board .line.full')).length, 1, 'the next game spans the board');
  // Countdowns hours or days away read as such, not as thousands of minutes; a time on another day names the day.
  assert.deepEqual(await page.evaluate(() => [boardLeft(65e3), boardLeft(3600e3 + 125e3), boardLeft(2 * 86400e3 + 732e3), boardLeft(86400e3)]),
    ['1:05', '1:02:05', '2 days', '1 day']);
  assert.match(await page.evaluate(() => boardAt(Date.now() + 3 * 86400e3)), / \w{3}$/, 'another day: the day is named');
  assert.doesNotMatch(await page.evaluate(() => boardAt(new Date().setHours(23, 59, 0, 0))), / \w{3}$/, 'today: just the time');
  // The bar: ON AIR (or Off air) with a dot per output, hollow while it isn't sending; the chips are status, not links.
  await page.waitForSelector('.fp-chips .chip .odot');
  assert.equal((await page.$$('.fp-chips .chip .odot')).length, 1, 'one output, one dot');
  assert.equal((await page.$$('.fp-chips .chip .odot.on')).length, 0, 'off air: hollow');
  assert.equal((await page.$$('.fp-chips a.chip')).length, 0, 'no chip is a link');
  assert.equal((await page.$$('.fp-chips .chip.atem')).length, 0, 'no switcher set up: no ATEM chip');
  assert.match(await page.textContent('#board .game'), /0 – 0/, 'the game row shows the score');
  // The PlayHQ line above the score: status, ping, how often PlayHQ is checked (an icon, no word), bandwidth and data,
  // always on one line, even with the longest words.
  await page.waitForSelector('#board .pqrow .pqchip.rf');
  assert.equal((await page.$$('#board .pqrow .pqchip')).length, 5);
  assert.match(await page.textContent('#board .pqchip.rf'), /^\d+(\.\d)? s$/, 'the refresh chip is the icon and the seconds');
  assert.equal(await page.$$eval('#board .pqchip.rf svg', s => s.length), 1);
  const oneLine = await page.evaluate(() => {
    lastHealth.playhq.state = 'bad'; lastHealth.playhq.net = { ...lastHealth.playhq.net, failed: true, bytesPerSec: 99999, bytes: 99e6 };
    renderBoard();
    const r = document.querySelector('#board .pqrow');
    return new Set([...r.children].map(c => Math.round(c.getBoundingClientRect().top))).size === 1 && r.scrollWidth <= r.clientWidth + 1;
  });
  assert.equal(oneLine, true, 'the PlayHQ chips stay on one line');
  assert.doesNotMatch(await page.textContent('#board .game'), /Q1 \d+:\d\d/, 'the clock is the bar\'s PlayHQ chip, not the board\'s');
  assert.match(await page.textContent('.fp-chips .chip.playhq'), /Q1 \d+:\d\d/, 'the PlayHQ chip carries the quarter and clock');
  assert.equal(await page.isVisible('#boardRecord'), true, 'recording is controlled from the board');
  await page.waitForFunction(() => /MicsNo mics/i.test(document.querySelector('#board').textContent), null, { timeout: 5000 }); // the mics line says so in a word
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
