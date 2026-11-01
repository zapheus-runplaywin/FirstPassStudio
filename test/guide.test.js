// The user guide comes with Studio at /guide/ (Help > FirstPass Studio User Guide, User guide in the menu bar
// icon, the Docs tab): its page, every picture it shows and its Montserrat, all from Studio, so it reads at a
// venue with no internet; nothing else of docs/user-guide can be read.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startStudio, ROOT } = require('./support/studio');
const { openPage } = require('./support/browser');

const GUIDE = path.join(ROOT, 'docs', 'user-guide');
const files = require('../package.json').build.files;
const packed = rel => files.some(f => f === rel || (f.includes('*') && path.matchesGlob(rel, f)));
const pictures = [...new Set([...fs.readFileSync(path.join(GUIDE, 'index.html'), 'utf8').matchAll(/\bsrc="(img\/[^"]+)"/g)].map(m => m[1]))];

let studio;
test.before(async () => { studio = await startStudio(null); });
test.after(() => studio && studio.stop());

test('the guide and every picture it shows are packed into the Mac app', () => {
  assert.ok(pictures.length > 50, `only ${pictures.length} pictures found in the guide`);
  assert.ok(packed('docs/user-guide/index.html'));
  for (const p of pictures) assert.ok(packed(`docs/user-guide/${p}`), `${p} is in the guide but not in package.json build.files`);
  // Not the print PDF's light pictures, the PDFs or the tools that make them.
  for (const rel of ['docs/user-guide/img/light/s-output.webp', 'docs/user-guide/FirstPass Studio User Guide (web).pdf', 'docs/user-guide/shots/run.js'])
    assert.ok(!packed(rel), `${rel} would be packed into the app`);
});

test('Studio serves the guide at /guide/ with its own fonts', async () => {
  const moved = await fetch(`${studio.base}/guide`, { redirect: 'manual' });
  assert.equal(moved.status, 302);
  assert.equal(moved.headers.get('location'), '/guide/');
  const page = await studio.request('GET', '/guide/');
  assert.equal(page.status, 200);
  assert.match(page.type, /text\/html/);
  assert.match(page.text, /<title>FirstPass Studio User Guide<\/title>/);
  assert.doesNotMatch(page.text, /fonts\.googleapis\.com/);
  assert.match(page.text, /@font-face[^}]*url\("\/vendor\/montserrat\/montserrat-latin-800-normal\.woff2"\)/);
  assert.equal((await studio.request('GET', '/guide/index.html')).text, page.text);
  for (const p of pictures) {
    const r = await studio.request('GET', `/guide/${p}`);
    assert.equal(r.status, 200, p);
  }
});

test('nothing else of the guide folder, or outside it, can be read through /guide/', async () => {
  for (const p of ['/guide/shots/run.js', '/guide/img/light/s-output.webp', '/guide/web-pdf/build.py', '/guide/FirstPass%20Studio%20User%20Guide%20(web).pdf',
    '/guide/..%2f..%2fserver.js', '/guide/img/..%2f..%2f..%2fpackage.json', '/guide/img/..%2f..%2f..%2fconfig.json', '/guide/img%2f..%2f..%2f..%2fpublic%2fstudio.css']) {
    const r = await studio.request('GET', p);
    assert.equal(r.status, 404, p);
  }
});

test('the guide opens in a browser with every picture and Montserrat, asking nothing of the internet', async t => {
  const page = await openPage(t, studio, '/guide/');
  if (!page) return;
  await page.evaluate(async () => {
    for (const img of document.images) { img.loading = 'eager'; if (!img.complete) await new Promise(r => { img.onload = img.onerror = r; }); }
    await document.fonts.ready;
  });
  const broken = await page.evaluate(() => [...document.images].filter(i => !i.naturalWidth).map(i => i.getAttribute('src')));
  assert.deepEqual(broken, []);
  assert.ok(await page.evaluate(() => document.fonts.check('800 16px Montserrat') && [...document.fonts].some(f => f.family.replace(/"/g, '') === 'Montserrat' && f.status === 'loaded')));
  assert.deepEqual(page.errors, []);
});
