// The one list of graphics pages (public/pages.js): every graphic in public/ is in it, every page with
// link options (pageoptions.js) is in it, the Docs page describes every page in it, and the Output page
// and examples.js read it rather than keeping lists of their own.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { STUDIO_GRAPHICS } = require('../public/pages.js');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const read = f => fs.readFileSync(path.join(PUBLIC, f), 'utf8');
// Pages that aren't graphics: the Studio pages you work in, and the scene's own pages.
const NOT_GRAPHICS = new Set(['output.html', 'control.html', 'setup.html', 'sponsors.html', 'sponsorreport.html', 'athletes.html', 'planner.html', 'socials.html', 'social.html', 'api.html', 'devices.html', 'pair.html', 'graphics.html', 'scene.html', 'preview.html', 'pvw.html']);
// results.html is served from fixtures.html (ALIASES in server.js).
const ALIASES = { 'results.html': 'fixtures.html' };
const files = new Set(STUDIO_GRAPHICS.map(p => p.file));

test('every page in the list exists, once, with a name and a Docs section', () => {
  assert.equal(files.size, STUDIO_GRAPHICS.length, 'no page is listed twice');
  for (const p of STUDIO_GRAPHICS) {
    assert.ok(fs.existsSync(path.join(PUBLIC, ALIASES[p.file] || p.file)), `${p.file} exists`);
    assert.ok(p.name && p.docs, `${p.file} has a name and a docs section`);
    for (const [caption, link, ms] of p.examples || []) {
      assert.ok(caption && link.startsWith(`/${p.file}`) && ms > 0, `${p.file} example ${caption} links to the page`);
    }
  }
});

test('every graphic in public/ is in the list', () => {
  const graphics = fs.readdirSync(PUBLIC).filter(n => n.endsWith('.html') && !NOT_GRAPHICS.has(n));
  for (const n of graphics) assert.ok(files.has(n), `${n} is in public/pages.js`);
  for (const n of NOT_GRAPHICS) assert.ok(!files.has(n), `${n} isn't a graphic`);
});

test('every page with link options is in the list', () => {
  const src = read('pageoptions.js');
  const keys = [...src.matchAll(/^    '([a-z]+\.html)': \[/gm)].map(m => m[1]);
  assert.ok(keys.length > 20, `found ${keys.length} pages with options`);
  for (const k of keys) assert.ok(files.has(k), `${k} (pageoptions.js) is in public/pages.js`);
});

test('the Docs page describes every page in the list, in the section the list names', () => {
  const docs = read('graphics.html');
  for (const p of STUDIO_GRAPHICS) {
    assert.ok(docs.includes(`'/${p.file}`) || docs.includes(`"/${p.file}`) || docs.includes(`/${p.file}?`), `${p.file} is on the Docs page`);
    assert.ok(docs.includes(`id="${p.docs}"`), `the Docs page has a ${p.docs} section for ${p.file}`);
  }
});

test('the Output page and examples.js read the list instead of keeping their own', () => {
  const output = read('output.html');
  assert.match(output, /<script src="pages\.js"><\/script>/);
  // The Output page's script lives in public/output/ (one file per section); the list is read in common.js.
  const common = read('output/common.js');
  assert.match(common, /const PAGES = STUDIO_GRAPHICS\.map/);
  assert.doesNotMatch(common, /\['Scoreboard', 'scoreboard\.html'\]/);
  assert.doesNotMatch(output, /\['Scoreboard', 'scoreboard\.html'\]/);
  const examples = fs.readFileSync(path.join(ROOT, 'examples.js'), 'utf8');
  assert.match(examples, /require\('\.\/public\/pages\.js'\)/);
  assert.doesNotMatch(examples, /'\/clash\.html', 6000/);
});
