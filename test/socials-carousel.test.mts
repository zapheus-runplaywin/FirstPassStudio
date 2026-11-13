// As a carousel on the Socials tab: the ticked pictures saved as one Instagram post in the order shown above Save,
// one size and up to 20, each marked 1/6, 2/6... (social.html?page=). The browser: Playwright's own, or
// STUDIO_TEST_CHROMIUM; skipped without one (except in the Tests check). Saving itself needs the Mac app (app.test.mts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { startStudio, type Json } from './support/studio.mts';
import type { BrowserType } from 'playwright';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let chromium: BrowserType | null = null;
try { ({ chromium } = require('playwright') as typeof import('playwright')); } catch { /* not installed */ }

test('a carousel is one size, up to 20, in order, and each picture is marked with its place', async t => {
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const date = (await studio.get('/api/socials')).next;
  const item = (size: Json, kind = 'fixtures') => ({ name: kind, link: `/social.html?kind=${kind}&size=${size}&date=${date}`, size });
  const save = (body: Json) => studio.request('POST', '/api/socials/export', { date, set: 'upcoming', carousel: true, ...body });
  let r = await save({ items: [item('square'), item('portrait')] });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /all one size/);
  r = await save({ items: Array.from({ length: 21 }, () => item('square')) });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /20 pictures at most.*untick 1/);
  assert.equal((await save({ items: [item('square'), item('square', 'polaroid')] })).status, 501, 'a good carousel only needs the app');

  let browser = null;
  try { browser = chromium && await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined }); } catch { browser = null; }
  if (!browser) {
    if (process.env.STUDIO_TEST_REQUIRE_BROWSER) assert.fail('no browser to test the carousel in');
    t.skip('no browser to draw the pictures in; run npx playwright install chromium');
    return;
  }
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1080, height: 1080 } });
  await page.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '' }));
  const mark = async (p: Json) => {
    await page.goto(`${studio.base}/social.html?kind=fixtures&date=${date}${p ? `&page=${p}` : ''}`);
    await page.waitForFunction(() => window.socialReady !== undefined);
    return page.$eval('#page', (e: HTMLElement) => e.hidden ? null : [...e.children].map(c => c.textContent));
  };
  assert.deepEqual(await mark('1/3'), ['Swipe', '1/3', '›']);
  assert.deepEqual(await mark('2/3'), ['2/3', '›']);
  assert.deepEqual(await mark('3/3'), ['3/3'], 'no arrow on the last');
  assert.equal(await mark(''), null);
  assert.equal(await mark('4/3'), null);

  // The tab: As a carousel lists the ticked pictures in order; › moves one later and Save sends them in that order.
  // (The app isn't here, so the tab is told it is, and the save is caught.)
  const tab = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await tab.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '' }));
  await tab.route(url => new URL(url).pathname === '/api/socials', async route => {
    const res = await route.fetch();
    route.fulfill({ response: res, json: { ...(await res.json()), app: true } });
  });
  let sent = null;
  await tab.route(url => new URL(url).pathname === '/api/socials/export', route => {
    sent = route.request().postDataJSON();
    route.fulfill({ json: { folder: 'x', files: ['01 a.png'], skipped: [{ name: '02 Milestones (portrait)', reason: 'No milestones.' }], zip: null } });
  });
  await tab.goto(`${studio.base}/socials.html`);
  await tab.waitForSelector('.pic[data-key]');
  await tab.click('#none');
  for (const key of ['fixtures', 'polaroid']) await tab.check(`.pic[data-key="${key}"] .pic__ticks input`);
  await tab.check('#carousel');
  const chips = () => tab.$$eval('#carouselOrder .chip', els => els.map(e => e.childNodes[1].textContent!.trim()));
  const [first, second] = await chips();
  assert.ok(first && second);
  await tab.click('#carouselOrder .chip:first-of-type button[title=Later]');
  assert.deepEqual(await chips(), [second, first]);
  const sizes = await tab.$$eval('[data-size]', (els: HTMLInputElement[]) => els.filter(e => e.checked).map(e => e.dataset.size));
  if (sizes.length !== 1) for (const s of sizes.slice(1)) await tab.uncheck(`[data-size="${s}"]`);
  await tab.click('#save');
  await tab.waitForFunction(() => /Saved/.test(document.getElementById('status')!.textContent));
  // A skipped picture is a warning, not a failed save.
  assert.match((await tab.textContent('#status'))!, /Skipped 1: 02 Milestones \(portrait\): No milestones\./);
  assert.equal(await tab.$eval('#status', e => e.className), 'warn');
  assert.equal(sent!.carousel, true);
  assert.deepEqual(sent!.items.map((i: Json) => i.name), [second, first]);
});
