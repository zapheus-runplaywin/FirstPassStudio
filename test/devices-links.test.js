// The Devices tab's Links (links.js): every link Studio answers, drawn one way, from the two lists Studio keeps
// (graphiclinks.js with pageoptions.js, and openapi.yaml as /openapi.json). Each ready-made link in openapi.yaml
// fits its path and is a link Studio knows; the page draws every graphic and every link, a Stream Deck link is copied
// with this Mac's key, a read can be tried, and Find narrows the list.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const { startStudio, ROOT } = require('./support/studio');
const { openPage } = require('./support/browser');

const doc = YAML.parse(fs.readFileSync(path.join(ROOT, 'public', 'openapi.yaml'), 'utf8'));
const ops = Object.entries(doc.paths).flatMap(([p, item]) => Object.entries(item).map(([method, op]) => ({ path: p, method, op })));
const { LINKS } = require('../public/graphiclinks.js');

test('every ready-made link in openapi.yaml fits its own path, and every operation has a tag and a summary', () => {
  for (const { path: p, op } of ops) {
    assert.ok(op.summary && op.tags && op.tags.length, `${p} has a summary and a tag`);
    assert.ok(doc.tags.some(t => t.name === op.tags[0]), `${p}'s tag ${op.tags[0]} is listed under tags`);
    const shape = new RegExp('^' + p.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\?\{[^}]+\\?\}|\{[^}]+\}/g, '[^/?]+') + '(\\?.*)?$');
    for (const [label, link] of op['x-links'] || []) {
      assert.ok(label, `${p}: a ready-made link has a label`);
      // A link with its optional last part left out (/deck/streak/goalforgoal, /deck/streak/level) still starts the path.
      const short = p.replace(/\/\{[^}]+\}$/, '');
      assert.ok(shape.test(link) || link.startsWith(short.replace(/\{[^}]+\}/g, '')) , `${link} fits ${p}`);
    }
  }
});

test('Studio knows every ready-made link and serves openapi.yaml as JSON', async t => {
  const studio = await startStudio(t);
  const json = await studio.get('/openapi.json');
  assert.deepEqual(Object.keys(json.paths), Object.keys(doc.paths));
  const unknown = [];
  for (const { op } of ops) {
    for (const [, link] of op['x-links'] || []) {
      const r = await studio.request('GET', link);
      if ((r.json && /Unknown Stream Deck link/.test(r.json.error || '')) || r.status >= 500) unknown.push(`${link} ${r.status}`);
    }
  }
  assert.deepEqual(unknown, []);
});

test('the Links list draws every graphic and every link the same way', async t => {
  const studio = await startStudio(t);
  const page = await openPage(t, studio, '/api.html');
  if (!page) return;
  await page.waitForFunction(() => document.querySelectorAll('#linkGroups .lnk').length > 50);
  // The link set's key comes from Devices once the page has loaded.
  await page.waitForFunction(() => [...document.querySelectorAll('#linkGroups .lnk__link code')].some(c => /\/k\/[^/]+\/deck\//.test(c.textContent)));
  const cards = await page.$$eval('#linkGroups .lnk', cs => cs.map(c => ({ title: c.querySelector('h4').textContent, links: [...c.querySelectorAll('.lnk__link code')].map(x => x.textContent) })));
  for (const l of LINKS) assert.ok(cards.some(c => c.title === l.name && c.links.some(x => x.endsWith(l.link))), `${l.name} is drawn with its link`);
  for (const { op } of ops) assert.ok(cards.some(c => c.title === op.summary), `${op.summary} is drawn`);
  // A Stream Deck link is copied with this Mac's key after the port; a graphic's link isn't.
  const home = cards.find(c => c.title === 'Change a team\'s score').links[0];
  assert.match(home, /\/k\/[^/]+\/deck\/home\/add1$/);
  assert.doesNotMatch(cards.find(c => c.title === 'Live scoreboard').links[0], /\/k\//);
  // Every graphic has Preview; a read has Try, which shows Studio's answer.
  assert.equal(await page.$$eval('#links-scoreboard .lnk a.pvw', a => a.length), 1);
  const read = page.locator('#links-status .lnk', { hasText: 'Read the full scoreboard' });
  await read.locator('button', { hasText: 'Try' }).click();
  await read.locator('.lnk__out').filter({ hasText: /^200/ }).waitFor();
  // Find narrows the list to the links that mention it, and hides the groups left empty.
  await page.fill('#linkFilter', 'super shot');
  const shown = await page.$$eval('#linkGroups .lnk', cs => cs.filter(c => !c.hidden && !c.closest('section').hidden).length);
  assert.ok(shown > 0 && shown < cards.length / 4, `${shown} of ${cards.length} shown`);
  assert.equal(await page.$eval('#links-pairing', s => s.hidden), true);
  assert.deepEqual(page.errors, []);
});
