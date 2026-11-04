// The Socials tab's picture sets: a set is a name and the kinds of picture it shows, picked on the Show row (All shows
// every picture), remembered for the competition. Every kind of picture has a name for the set's editor.
// The browser: Playwright's own, or STUDIO_TEST_CHROMIUM; skipped without one (except in the Tests check).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio');
const { KINDS, KIND_NAMES } = require('../socials');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* not installed */ }

test('every kind of picture is named for the picture set editor, once', () => {
  assert.deepEqual(KIND_NAMES.map(k => k.kind).sort(), Object.keys(KINDS).sort());
  for (const k of KIND_NAMES) assert.ok(['upcoming', 'results', 'both'].includes(k.when), k.kind);
});

test('picture sets are checked and saved for the competition', async t => {
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const bad = (body, why) => studio.request('POST', '/api/socials/settings', body).then(r => assert.equal(r.status, 400, why));
  await bad({ pictureSets: [{ name: 'x', kinds: ['nonsense'] }] }, 'an unknown kind');
  await bad({ pictureSets: [{ name: 'x', kinds: ['toString'] }] }, 'not a kind either');
  await bad({ pictureSets: Array.from({ length: 13 }, () => ({ name: 'x', kinds: [] })) }, 'too many');
  await bad({ pictureSet: 'pset-1' }, 'no such set');
  const s = (await studio.post('/api/socials/settings', { pictureSets: [{ name: '  Weekly basics  ', kinds: ['ladder', 'fixtures', 'ladder'] }, { name: '', kinds: [] }] })).settings;
  assert.deepEqual(s.pictureSets.map(x => [x.name, x.kinds]), [['Weekly basics', ['fixtures', 'ladder']], ['My pictures', []]], 'kinds in order, once');
  assert.ok(s.pictureSets.every(x => /^pset-\d+$/.test(x.id)));
  assert.equal(s.pictureSet, '', 'All until one is picked');
  const picked = (await studio.post('/api/socials/settings', { pictureSet: s.pictureSets[0].id })).settings;
  assert.equal(picked.pictureSet, s.pictureSets[0].id);
  // Removing the set in use goes back to All.
  const gone = (await studio.post('/api/socials/settings', { pictureSets: [s.pictureSets[1]] })).settings;
  assert.deepEqual([gone.pictureSets.length, gone.pictureSet], [1, '']);
  assert.equal((await studio.get('/api/socials')).kinds.length, KIND_NAMES.length);
});

test('the Show row lists only the kinds in the picked picture set', async t => {
  let browser = null;
  try { browser = chromium && await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined }); } catch { browser = null; }
  if (!browser) {
    if (process.env.STUDIO_TEST_REQUIRE_BROWSER) assert.fail('no browser to test the Socials tab in');
    t.skip('no browser to test the Socials tab in; run npx playwright install chromium');
    return;
  }
  t.after(() => browser.close());
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '' }));
  await page.goto(`${studio.base}/socials.html`);
  await page.waitForSelector('.pic[data-key]');
  await page.click('label:has([name=set][value=upcoming])');
  const kinds = () => page.$$eval('.pic[data-key]', ss => [...new Set(ss.map(s => s.dataset.key.split(':')[0]))]);
  const all = await kinds();
  assert.ok(all.includes('fixtures') && all.includes('matchup') && all.length > 3, all.join());

  // A new set starts with every kind on this list ticked; keep two and save, and it's picked.
  await page.click('#show button:has-text("New picture set")');
  assert.equal(await page.$$eval('#picSetKinds input:checked', cs => cs.length), all.length);
  await page.fill('#picSetName', 'Weekly basics');
  await page.$$eval('#picSetKinds input', cs => cs.forEach(c => { c.checked = ['fixtures', 'matchup', 'ladder'].includes(c.value); }));
  await page.click('#picSet button[type=submit]');
  await page.waitForSelector('#show [aria-pressed="true"]:has-text("Weekly basics")');
  await page.waitForFunction(() => document.querySelectorAll('.pic[data-key]').length && [...document.querySelectorAll('.pic[data-key]')].every(s => /^(fixtures|matchup)/.test(s.dataset.key)));
  assert.deepEqual(await kinds(), ['fixtures', 'matchup']);
  assert.equal(await page.$eval('#show [aria-pressed="true"] .count', c => c.textContent), String(await page.$$eval('.pic[data-key]', s => s.length)));

  // On Results the same set shows its Ladder pictures.
  await page.click('label:has([name=set][value=results])');
  await page.waitForFunction(() => [...document.querySelectorAll('.pic[data-key]')].every(s => s.dataset.key.startsWith('ladder')));

  // ✎ changes it; Delete goes back to All.
  await page.click('#show .set:has-text("Weekly basics") .rm');
  assert.equal(await page.inputValue('#picSetName'), 'Weekly basics');
  await page.click('#picSetDelete');
  await page.waitForSelector('#show [aria-pressed="true"]:has-text("All")');
  assert.deepEqual((await studio.get('/api/socials')).settings.pictureSets, []);
});

test('Division lists one division\'s pictures, with the ones for the whole night', async t => {
  let browser = null;
  try { browser = chromium && await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined }); } catch { browser = null; }
  if (!browser) {
    if (process.env.STUDIO_TEST_REQUIRE_BROWSER) assert.fail('no browser to test the Socials tab in');
    t.skip('no browser to test the Socials tab in; run npx playwright install chromium');
    return;
  }
  t.after(() => browser.close());
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '' }));
  await page.goto(`${studio.base}/socials.html`);
  await page.waitForSelector('.pic[data-key]');
  await page.click('label:has([name=set][value=upcoming])');
  await page.waitForSelector('#division');
  const divisions = await page.$$eval('#division option', os => os.map(o => o.value));
  assert.ok(divisions.length > 2 && divisions[0] === '', divisions.join());
  const keys = () => page.$$eval('.pic[data-key]', ss => ss.map(s => s.dataset.key));
  const all = await keys();
  const div = divisions[1];
  await page.selectOption('#division', div);
  await page.waitForFunction(n => document.querySelectorAll('.pic[data-key]').length < n, all.length);
  const some = await keys();
  assert.ok(some.includes('fixtures') && some.includes('byes'), 'the whole night\'s pictures stay');
  assert.ok(some.includes(`preview:${div}`) && !some.includes(`preview:${divisions[2]}`), some.join());
  assert.equal(await page.$eval('#show [aria-pressed="true"] .count', c => c.textContent), String(some.length), 'All counts the division\'s');
  await page.selectOption('#division', '');
  await page.waitForFunction(n => document.querySelectorAll('.pic[data-key]').length === n, all.length);
});
