// The finishing touches of the UI level-up: page zoom in the Mac app (View menu with the level, Actual Size on ⌘⌥0
// clear of the Docs tab's ⌘0, a chip in the bar while the zoom isn't 100% that puts it back), the Docs page's
// contents list, and the off air page in the brand.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startStudio } = require('./support/studio');
const { openPage } = require('./support/browser');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('the View menu zooms in steps with Actual Size on ⌘⌥0, and the off air page carries the mark', () => {
  const w = read('desktop/windows.js');
  assert.match(w, /accelerator: 'CmdOrCtrl\+Alt\+0'/, 'Actual Size is ⌘⌥0 (⌘0 is the Docs tab)');
  assert.doesNotMatch(w, /role: '(resetZoom|zoomIn|zoomOut)'/, 'the roles would bind ⌘0 and show no level');
  assert.match(w, /label: `Zoom: \$\{zoomPct\}%`/);
  assert.match(w, /saveAppSetting\('pageZoom'/, 'the level is kept on this Mac');
  assert.match(w, /'zoom-changed'/, 'a pinch or ⌃ wheel steps it');
  assert.match(w, /#zoom=100/, 'the bar chip asks for 100% through the page address');
  const off = read('desktop/offair.html');
  assert.match(off, /1p-studio-dark\.svg/);
  assert.match(off, /firstpass-studio\.svg/);
  assert.match(off, /prefers-color-scheme: dark/);
  assert.match(read('public/studio.css'), /\.chip\.zoom/);
});

test('the Docs page lists its cards as contents, and the bar shows the zoom chip when told', async t => {
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const page = await openPage(t, studio, '/graphics.html');
  if (!page) return;
  await page.waitForSelector('#contents li');
  const links = await page.$$eval('#contents li:not([hidden]) a', as => as.map(a => [a.textContent, a.getAttribute('href')]));
  assert.ok(links.length >= 10, `contents has the cards (${links.length})`);
  assert.ok(links.some(l => l[1] === '#output'), 'the Output card by its anchor');
  for (const [text, href] of links) {
    assert.ok(text.trim(), 'a title');
    assert.equal(await page.$eval(href, c => c.tagName), 'DIV', `${href} is a card`);
  }
  // The zoom chip: hidden at 100%, shown with the level otherwise, a click asks for 100%.
  assert.equal(await page.isVisible('.fp-bar .chip.zoom'), false);
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('studio-zoom', { detail: 125 })));
  assert.equal(await page.isVisible('.fp-bar .chip.zoom'), true);
  assert.equal(await page.textContent('.fp-bar .chip.zoom'), '125%');
  await page.click('.fp-bar .chip.zoom');
  assert.equal(await page.evaluate(() => location.hash), '#zoom=100');
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('studio-zoom', { detail: 100 })));
  assert.equal(await page.isVisible('.fp-bar .chip.zoom'), false);
  assert.deepEqual(page.errors, []);
});
