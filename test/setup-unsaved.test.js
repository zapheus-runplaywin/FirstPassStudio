// Competitions setup with changes not saved yet: leaving the page by a tab, opening another
// competition, switching competition or making a new one asks Save, Don't save or Keep editing first
// (unsaved.js, the same question as a dialog editor)
// (in a real browser, Chromium through Playwright, as pages.test.js does).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* not installed */ }

test('setup: unsaved changes are saved, discarded or kept before leaving them', async t => {
  let browser = null;
  try { browser = chromium && await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined }); } catch { /* none */ }
  if (!browser) {
    if (process.env.STUDIO_TEST_REQUIRE_BROWSER) assert.fail('no browser to test the setup page in');
    t.skip('no browser to test the setup page in; run npx playwright install chromium');
    return;
  }
  t.after(() => browser.close());
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const id = studio.competition.id;
  await studio.post('/api/setup-new', { name: 'Second Comp' });
  const saved = async () => (await studio.get(`/api/setup/${id}`)).settings.displayName;
  const page = await browser.newPage();
  // The browser's Leave page? is counted (Studio's own questions are pressed below).
  let leaveAsked = 0;
  page.on('dialog', d => { if (d.type() === 'beforeunload') leaveAsked++; d.accept(); });
  const load = async () => { await page.goto(studio.base + '/setup.html'); await page.waitForSelector('#editor:not([hidden])'); };
  const change = text => page.fill('#displayName', text);
  const ask = () => page.waitForSelector('dialog.fp-ask[open]');
  const press = label => page.click(`dialog.fp-ask button:text-is("${label}")`);

  // A tab, Keep editing: stays, with the change still there.
  await load();
  await change('Changed once');
  await page.click('nav a[href="/sponsors.html"]');
  await ask();
  assert.match(await page.textContent('dialog.fp-ask'), /Save your changes to Thunder League/);
  await press('Keep editing');
  assert.equal(new URL(page.url()).pathname, '/setup.html');
  assert.equal(await page.inputValue('#displayName'), 'Changed once');

  // A tab, Save: saved, then the tab opens.
  await page.click('nav a[href="/sponsors.html"]');
  await ask();
  await Promise.all([page.waitForURL('**/sponsors.html'), press('Save')]);
  assert.equal(await saved(), 'Changed once');

  // A tab, Don't save: not saved, and the tab opens.
  await load();
  await change('Not kept');
  await page.click('nav a[href="/athletes.html"]');
  await ask();
  await Promise.all([page.waitForURL('**/athletes.html'), press("Don't save")]);
  assert.equal(await saved(), 'Changed once');

  // Another competition in the list, Keep editing, then Save.
  await load();
  await change('Changed twice');
  await page.click('.comp:has-text("Second Comp") .comp__name');
  await ask();
  await press('Keep editing');
  assert.equal(await page.inputValue('#name'), 'Thunder League');
  await page.click('.comp:has-text("Second Comp") .comp__name');
  await ask();
  await press('Save');
  await page.waitForFunction(() => document.getElementById('name').value === 'Second Comp');
  assert.equal(await saved(), 'Changed twice');

  // Use this one: Don't save, and cancelling the switch shows what's saved again.
  await page.click('.comp:has-text("Thunder League") .comp__name');
  await page.waitForFunction(() => document.getElementById('name').value === 'Thunder League');
  await change('Thrown away');
  await page.click('.comp:has-text("Second Comp") button:text-is("Use this one")');
  await ask();
  await press("Don't save");
  await page.waitForSelector('dialog.fp-ask:has-text("Switch every graphic")');
  await press('Cancel');
  await page.waitForFunction(() => document.getElementById('displayName').value === 'Changed twice');
  assert.equal((await studio.get('/api/setup')).active, id, 'still in use');

  // New competition: asked after its name, and Keep editing makes nothing.
  await change('Changed thrice');
  await page.click('#newComp');
  await page.fill('dialog.fp-ask input', 'Third Comp');
  await page.click('dialog.fp-ask button:text-is("OK")');
  await page.waitForSelector('dialog.fp-ask .fp-ask__question');
  await press('Keep editing');
  assert.ok(!(await studio.get('/api/setup')).competitions.some(c => c.name === 'Third Comp'));
  assert.equal(await page.inputValue('#displayName'), 'Changed thrice');

  // Loading another page some other way (here, the address): the browser's own question.
  await load();
  assert.equal(leaveAsked, 1);

  // Nothing changed: no question.
  await page.click('nav a[href="/sponsors.html"]');
  await page.waitForURL('**/sponsors.html');
  assert.equal(leaveAsked, 1);
});
