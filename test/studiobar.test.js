// The tab bar on every Studio page comes from one list (public/studiobar.js): each Studio page has
// the empty header and loads the script, the list is in Matt's keyboard order (⌘1 to ⌘0), the bar shows
// it in three groups (Run, Plan, Set up) with Docs apart, and the Mac app's Go menu reads the same list.
// The bar also carries the status chips from /api/health. The page test (pages.test.js) checks the bar
// renders without errors.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { STUDIO_PAGES, GROUPS } = require('../public/studiobar.js');
const { startStudio } = require('./support/studio');
const { openPage } = require('./support/browser');

const PUBLIC = path.join(__dirname, '..', 'public');

test('the tabs are Output, Production Planner, Scoreboard control, Recordings, Socials, Competitions setup, Sponsors, Athletes, Stream Deck, Docs', () => {
  assert.deepEqual(STUDIO_PAGES.map(p => p.label), ['Output', 'Production Planner', 'Scoreboard control', 'Recordings', 'Socials', 'Competitions setup', 'Sponsors', 'Athletes', 'Stream Deck', 'Docs']);
  for (const p of STUDIO_PAGES) assert.ok(fs.existsSync(path.join(PUBLIC, p.href.slice(1))), `${p.href} exists`);
});

test('the bar groups the tabs: Run, Plan, Set up, and Docs on its own', () => {
  assert.deepEqual(GROUPS, ['Run', 'Plan', 'Set up']);
  const inGroup = g => STUDIO_PAGES.filter(p => p.group === g).map(p => p.label);
  assert.deepEqual(inGroup('Run'), ['Output', 'Scoreboard control']);
  assert.deepEqual(inGroup('Plan'), ['Production Planner', 'Socials']);
  assert.deepEqual(inGroup('Set up'), ['Recordings', 'Competitions setup', 'Sponsors', 'Athletes', 'Stream Deck']);
  assert.deepEqual(inGroup('Docs'), ['Docs']);
  assert.ok(STUDIO_PAGES.every(p => [...GROUPS, 'Docs'].includes(p.group)), 'every tab is in a group');
});

test('the bar draws the brand, the grouped tabs and the status chips, and the chips follow /api/health', async t => {
  const studio = await startStudio(t, { competition: 'Thunder League' });
  await studio.until(async () => (await studio.get('/api/scoreboard')).gameId);
  const page = await openPage(t, studio, '/sponsors.html');
  if (!page) return;
  assert.equal(await page.$eval('.fp-bar .fp-brand img.fp-word', i => i.getAttribute('src')), '/studio/firstpass-studio.svg');
  assert.deepEqual(await page.$$eval('.fp-bar nav:not(.fp-docs) .fp-grp', els => els.map(e => e.textContent)), ['Run', 'Plan', 'Set up']);
  assert.deepEqual(await page.$$eval('.fp-bar nav:not(.fp-docs) a', els => els.map(e => e.textContent)),
    ['Output', 'Scoreboard', 'Planner', 'Socials', 'Recordings', 'Competitions', 'Sponsors', 'Athletes', 'Stream Deck']);
  assert.equal(await page.$eval('.fp-bar nav a[aria-current="page"]', a => a.textContent), 'Sponsors');
  assert.equal(await page.$eval('.fp-bar .fp-docs a', a => a.textContent), 'Docs');
  await page.waitForFunction(() => document.querySelector('.fp-chips .chip.game') && !/No game/.test(document.querySelector('.fp-chips .chip.game').textContent), null, { timeout: 8000 });
  assert.equal(await page.$eval('.fp-chips .chip:first-child', c => c.textContent), 'Off air');
  assert.match(await page.$eval('.fp-chips .chip.game', c => c.textContent), / v .* · Court 1$/);
  assert.match(await page.$eval('.fp-chips .chip.playhq', c => c.textContent), /^PlayHQ · Q1 \d+:\d\d$/);
  assert.equal(await page.$('.fp-chips .chip.seq'), null, 'no sequence chip while nothing plays');
  // The practice strip and the refused banner keep their places under the bar.
  assert.equal(await page.$eval('header.fp-bar', h => h.nextElementSibling.className), 'fp-practice');
  assert.deepEqual(page.errors, []);
});

test('every Studio page has the empty bar and loads studiobar.js straight after it, and no page keeps a copy of the tabs', () => {
  const studioPages = fs.readdirSync(PUBLIC).filter(n => n.endsWith('.html') && fs.readFileSync(path.join(PUBLIC, n), 'utf8').includes('class="fp-bar"'));
  assert.ok(studioPages.length >= 8, `${studioPages.length} pages have the bar`);
  for (const n of studioPages) {
    const html = fs.readFileSync(path.join(PUBLIC, n), 'utf8');
    assert.match(html, /<header class="fp-bar"><\/header><script src="studiobar\.js"><\/script>/, `${n} has the empty bar and the script`);
    assert.doesNotMatch(html, /class="fp-logo"/, `${n} doesn't carry its own copy of the wordmark`);
  }
});
