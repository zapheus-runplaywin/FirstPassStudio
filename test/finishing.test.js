// The finishing touches of the UI level-up: page zoom in the Mac app (View menu with the level, Actual Size on ⌘⌥0
// clear of the Docs tab's ⌘0, a chip in the bar while the zoom isn't 100% that puts it back), the Docs tab
// (the user guide with Studio's bar on top) and its contents list, and the off air page in the brand.
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

test('the Docs tab is the guide under Studio\'s bar, with its contents, and the bar shows the zoom chip when told', async t => {
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const page = await openPage(t, studio, '/guide/');
  if (!page) return;
  await page.waitForSelector('.fp-bar nav a');
  assert.equal(await page.textContent('.fp-bar a[aria-current="page"]'), 'Docs');
  const links = await page.$$eval('nav.toc a[href^="#"]', as => as.map(a => [a.textContent, a.getAttribute('href')]));
  assert.ok(links.length >= 12, `contents has the chapters (${links.length})`);
  assert.ok(links.some(l => l[1] === '#ref'), 'the Reference');
  for (const [text, href] of links) {
    assert.ok(text.trim(), 'a title');
    assert.ok(await page.$(href), `${href} is in the guide`);
  }
  // The contents stay in view below the bar, not under it.
  const bar = await page.$eval('.fp-bar', b => b.getBoundingClientRect().bottom);
  await page.evaluate(() => window.scrollTo(0, 4000));
  const toc = await page.$eval('nav.toc', n => n.getBoundingClientRect().top);
  assert.ok(toc >= bar - 1, `the contents (${toc}) sit below the bar (${bar})`);
  // Each Studio page's "More in the guide" lands on a part of the guide that is there.
  for (const f of ['output', 'control', 'planner', 'socials', 'recordings', 'setup', 'sponsors', 'athletes']) {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', `${f}.html`), 'utf8');
    const m = /<a href="\/guide\/#([\w-]+)">More in the guide<\/a>/.exec(html);
    assert.ok(m, `${f}.html links to the guide`);
    assert.ok(await page.$(`#${m[1]}`), `${f}.html's #${m[1]} is in the guide`);
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
