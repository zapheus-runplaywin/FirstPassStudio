// The tab bar on every Studio page comes from one list (public/studiobar.js): each Studio page has
// the empty header and loads the script, the list is in Matt's tab order, and the Mac app's Go menu
// reads the same list. The page test (pages.test.js) checks the bar renders without errors.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { STUDIO_PAGES } = require('../public/studiobar.js');

const PUBLIC = path.join(__dirname, '..', 'public');

test('the tabs are Output, Scoreboard control, Competitions setup, Sponsors, Athletes, Stream Deck, Docs', () => {
  assert.deepEqual(STUDIO_PAGES.map(p => p.label), ['Output', 'Production Planner', 'Scoreboard control', 'Competitions setup', 'Sponsors', 'Athletes', 'Stream Deck', 'Docs']);
  for (const p of STUDIO_PAGES) assert.ok(fs.existsSync(path.join(PUBLIC, p.href.slice(1))), `${p.href} exists`);
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
