// AI captions on the Socials tab: the Captions card on this Mac (a key saved and never shown again, the model picked
// from the key's own list with its price, the amber warning for a model whose cost isn't known, this month's spend and
// the hashtags), and a picture's caption written in the style picked, changed by hand, undone and saved with the
// pictures. Against the stand-in AI (support/ai.js).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { KEYS, setUp } = require('./support/ai');
const { openPage } = require('./support/browser');

test('the Captions card sets up the AI on this Mac, and a picture\'s caption is written, changed by hand and saved with it', async t => {
  const { ai, studio } = await setUp(t);
  const page = await openPage(t, studio, '/socials.html');
  if (!page) return;
  // As if the Mac app were there, so Save is on (the pictures themselves are the app's: test/app.test.js).
  await page.route(url => new URL(url).pathname === '/api/socials', async route => {
    const r = await route.fetch();
    route.fulfill({ response: r, json: { ...await r.json(), app: true } });
  });
  await page.reload();
  await page.waitForSelector('.pic[data-key] .caption');

  // Not set up: the card says so, and offers where to get a key.
  await page.waitForFunction(() => document.getElementById('capSummary').textContent === 'not set up yet');
  await page.click('#captionsCard summary');
  assert.equal(await page.getAttribute('#capBody a[href*="settings/keys"]', 'target'), '_blank');
  await page.fill('#capBody input[type=password]', KEYS.anthropic);
  await page.click('#capBody button:text("Save key")');
  await page.waitForSelector('#capBody code');
  assert.equal(await page.textContent('#capBody code'), '••••WXYZ');
  assert.ok(!(await page.content()).includes(KEYS.anthropic), 'the key is never on the page');
  assert.equal(await page.textContent('#capSummary'), 'Claude, claude-haiku-5-5');

  // The key's own models, each with its price; one that isn't in the price list warns in amber.
  const model = page.locator('#capBody select[aria-label=Model]');
  await model.waitFor();
  const options = await model.locator('option').allTextContents();
  assert.deepEqual(options, ['Claude Haiku 5.5 (claude-haiku-5-5): US$0.1 in, US$0.5 out per million tokens', 'Claude Mystery 9 (claude-mystery-9): cost unknown']);
  await model.selectOption('claude-mystery-9');
  await page.waitForSelector('#capBody .warn');
  assert.match(await page.textContent('#capBody .warn'), /don't know what Claude's claude-mystery-9 costs/);
  await page.locator('#capBody select[aria-label=Model]').selectOption('claude-haiku-5-5');
  await page.waitForFunction(() => !document.querySelector('#capBody .warn'));

  // The hashtags go on the end of every caption.
  await page.fill('#capBody input[aria-label="Hashtags and handles"]', '#ThunderLeague @thunderleague');
  await page.press('#capBody input[aria-label="Hashtags and handles"]', 'Tab');
  await studio.until(async () => (await studio.get('/api/socials')).settings.hashtags === '#ThunderLeague @thunderleague');

  // A picture's caption, in the style picked.
  const card = page.locator('.pic[data-key]').first();
  const key = await card.getAttribute('data-key');
  const name = await card.locator('h3').textContent();
  const pic = () => page.locator(`.pic[data-key="${key}"]`);
  await pic().locator('.caption summary').click();
  await pic().locator('.caption label:has-text("Hype")').click();
  ai.calls.length = 0;
  await pic().locator('.caption button:text("Write caption")').click();
  await page.waitForFunction(k => document.querySelector(`.pic[data-key="${k}"] .caption textarea`).value.includes('#ThunderLeague'), key);
  const box = () => pic().locator('.caption textarea');
  assert.equal(await box().inputValue(), 'What a night of netball! 🏐 Well played everyone.\n\n#ThunderLeague @thunderleague');
  assert.match(ai.calls.find(x => x.path === '/anthropic/v1/messages').body.messages[0].content, /Style: Hype/);
  assert.equal(await pic().locator('.caption .note').textContent(), 'Claude claude-haiku-5-5: about US$0.0005 (3000 tokens in, 400 out).');
  assert.equal(await pic().locator('.caption summary').textContent(), 'Caption ✓');
  await page.waitForFunction(() => /US\$0\.0005 for 1 caption/.test(document.getElementById('capBody').textContent), null);

  // Changed by hand, then written again: Undo brings the hand-made one back.
  await box().fill('Our own words.');
  await pic().locator('.caption button:text("Again")').click();
  await page.waitForFunction(k => document.querySelector(`.pic[data-key="${k}"] .caption textarea`).value.startsWith('What a night'), key);
  await pic().locator('.caption button:text("Undo")').click();
  assert.equal(await box().inputValue(), 'Our own words.');
  // The next picture starts in the style last picked.
  assert.equal(await page.locator('.pic[data-key]').nth(1).locator('.caption input[value=hype]').isChecked(), true);

  // Save sends each ticked picture's caption with it (the app puts them in Captions.txt).
  let sent = null;
  await page.route(url => new URL(url).pathname === '/api/socials/export', route => {
    sent = JSON.parse(route.request().postData());
    route.fulfill({ json: { folder: 'Pictures/FirstPass Studio/x', files: ['01 x.png'], skipped: [], zip: null, shared: false } });
  });
  await page.click('#none');
  await card.locator('.pic__ticks input').first().check();
  await page.click('#save');
  await page.waitForFunction(() => /Captions\.txt/.test(document.getElementById('status').textContent));
  assert.deepEqual(sent.captions, [{ name, text: 'Our own words.' }]);
  assert.deepEqual(page.errors, []);
});
