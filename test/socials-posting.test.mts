// The Facebook and Instagram card on the Socials tab (this Mac only): a token pasted, checked and kept, the Page and
// the Instagram account it reaches shown with only the token's last four characters, and Disconnect. Against the
// stand-in Meta (support/meta.mts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { startStudio } from './support/studio.mts';
import { openPage } from './support/browser.mts';
import { startMeta, TOKENS, PAGE, IG } from './support/meta.mts';

test('the Facebook and Instagram card connects the competition\'s Page and Instagram, and disconnects them', async t => {
  const meta = await startMeta();
  t.after(() => meta.close());
  const studio = await startStudio(t, { competition: 'Thunder League', env: { FIRSTPASS_POSTING_API: meta.base, POSTING_KEYCHAIN: '0' } });
  const page = await openPage(t, studio, '/socials.html');
  if (!page) return;
  await page.waitForFunction(() => document.getElementById('postSummary')!.textContent === 'not connected');
  await page.click('#postingCard summary');
  await page.fill('#postBody input[type=password]', TOKENS.expired);
  await page.click('#postBody button:text("Connect")');
  await page.waitForSelector('#postBody .error');
  assert.match((await page.textContent('#postBody .error'))!, /token no longer works/);

  await page.fill('#postBody input[type=password]', TOKENS.user);
  await page.click('#postBody button:text("Connect")');
  await page.waitForSelector('#postBody code');
  assert.equal(await page.textContent('#postBody code'), '••••PAGE');
  assert.equal(await page.textContent('#postSummary'), `${PAGE.name}, @${IG.username}`);
  assert.equal(await page.getAttribute(`#postBody a:text("@${IG.username}")`, 'href'), `https://www.instagram.com/${IG.username}/`);
  const html = await page.content();
  assert.ok(!html.includes(TOKENS.user) && !html.includes(TOKENS.page), 'no token on the page');

  await page.click('#postBody button:text("Disconnect")');
  await page.waitForFunction(() => document.getElementById('postSummary')!.textContent === 'not connected');
  assert.equal((await studio.get('/api/posting') as { account: unknown }).account, null);
  assert.deepEqual(page.errors, []);
});
