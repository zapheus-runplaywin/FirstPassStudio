// Open on your phone: the Socials tab's QR code opens the pair page by the Mac's network link, which goes on to the
// Socials tab once the phone is paired, at once when it already is. Only Studio's own pages can be the next stop.
// The browser: Playwright's own, or STUDIO_TEST_CHROMIUM; skipped without one (except in the Tests check).
import test from 'node:test';
import assert from 'node:assert/strict';
import { startStudio } from './support/studio.mts';
import type { BrowserType } from 'playwright';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let chromium: BrowserType | null = null;
try { ({ chromium } = require('playwright') as typeof import('playwright')); } catch { /* not installed */ }

test('the phone link is the pair page going on to the page, as a QR code; only Studio pages', async t => {
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const r = await studio.request('GET', '/api/phone-link?page=/socials.html');
  assert.equal(r.status, 200);
  assert.match(r.json.link, /^http:\/\/[^/]+:\d+\/pair\.html\?then=%2Fsocials\.html$/);
  assert.match(r.json.svg, /^<svg [^>]*viewBox=/);
  for (const bad of ['https://example.com/', '//example.com/x.html', '/socials.html?x=1', '/../config.json']) {
    assert.equal((await studio.request('GET', `/api/phone-link?page=${encodeURIComponent(bad)}`)).status, 400, bad);
  }
});

test('Open on your phone shows the QR code on the Mac, and a paired phone goes straight on to Socials', async t => {
  let browser = null;
  try { browser = chromium && await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined }); } catch { browser = null; }
  if (!browser) {
    if (process.env.STUDIO_TEST_REQUIRE_BROWSER) assert.fail('no browser to test the Socials tab in');
    t.skip('no browser to test the Socials tab in; run npx playwright install chromium');
    return;
  }
  t.after(() => browser.close());
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const mac = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await mac.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '' }));
  await mac.goto(`${studio.base}/socials.html`);
  await mac.waitForSelector('#phone:not([hidden])');
  await mac.click('#phone');
  await mac.waitForSelector('#phoneBox[open] .code svg');
  assert.match((await mac.textContent('#phoneBox code'))!, /\/pair\.html\?then=%2Fsocials\.html$/);
  assert.match((await mac.textContent('#phoneBox'))!, /press Allow everything/);
  // The Remote has its own QR code.
  await mac.click('#phoneBox .fp-seg label >> nth=1');
  await mac.waitForFunction(() => /then=%2Fremote\.html$/.test(document.querySelector('#phoneBox code')!.textContent));
  // And the Commentator mic.
  await mac.click('#phoneBox .fp-seg label >> nth=2');
  await mac.waitForFunction(() => /then=%2Fcommentator\.html$/.test(document.querySelector('#phoneBox code')!.textContent));
  assert.match((await mac.textContent('#phoneBox'))!, /backup commentator headset/);

  // The phone: not this Mac, and paired already.
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await phone.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '' }));
  await phone.route(url => new URL(url).pathname === '/api/devices', route => route.fulfill({ status: 403, json: { error: 'this Mac only' } }));
  await phone.route(url => new URL(url).pathname === '/api/pair/me', route => route.fulfill({ json: { paired: true, name: 'Matt\'s iPhone', level: 'full' } }));
  await phone.route(url => new URL(url).pathname === '/api/socials', async route => {
    const r = await route.fetch();
    route.fulfill({ response: r, json: { ...await r.json(), here: false } });
  });
  await phone.goto(`${studio.base}/pair.html?then=%2Fsocials.html`);
  await phone.waitForURL(/\/socials\.html$/);
  await phone.waitForSelector('#save');
  assert.equal(await phone.isHidden('#phone'), true, 'no QR code on the phone itself');

  // A next stop that isn't a Studio page is ignored.
  await phone.goto(`${studio.base}/pair.html?then=https%3A%2F%2Fexample.com%2F`);
  await phone.waitForSelector('#paired:not([hidden])');
  assert.match(phone.url(), /\/pair\.html/);
  // Paired for everything, the links are the phone pages.
  assert.deepEqual(await phone.$$eval('#paired .links a:not([hidden])', els => els.map(e => e.textContent)), ['Socials', 'Remote', 'Commentator']);
});
