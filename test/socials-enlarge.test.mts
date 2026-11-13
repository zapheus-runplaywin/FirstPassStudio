// The Socials tab's bigger view: a click on a preview opens that picture as big as the window allows (never over its
// own 1080 wide), ← and → step to the other previews, and Esc closes it.
// The browser: Playwright's own, or STUDIO_TEST_CHROMIUM; skipped without one (except in the Tests check).
import test from 'node:test';
import assert from 'node:assert/strict';
import { startStudio } from './support/studio.mts';
import type { BrowserType } from 'playwright';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let chromium: BrowserType | null = null;
try { ({ chromium } = require('playwright') as typeof import('playwright')); } catch { /* not installed */ }

test('a click on a Socials preview shows it bigger, and arrows step through them', async t => {
  let browser = null;
  try { browser = chromium && await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined }); } catch { browser = null; }
  if (!browser) {
    if (process.env.STUDIO_TEST_REQUIRE_BROWSER) assert.fail('no browser to test the Socials tab in');
    t.skip('no browser to test the Socials tab in; run npx playwright install chromium');
    return;
  }
  t.after(() => browser.close());
  const studio = await startStudio(t, { competition: 'Thunder League' });
  // The 13" Mac's window: the bigger view must fit it.
  const page = await browser.newPage({ viewport: { width: 1440, height: 820 } });
  await page.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '' }));
  await page.goto(`${studio.base}/socials.html`);
  await page.waitForSelector('#pics .preview');
  await page.check('input[data-size="story"]');
  await page.waitForSelector('#pics .preview:nth-child(2)');

  const firstSrc = await page.$eval('#pics .preview iframe', (f: HTMLIFrameElement) => f.src);
  await page.click('#pics .preview');
  const big = await page.waitForSelector('dialog#big[open] .preview');
  const box = await big.boundingBox();
  assert.ok(box!.width > 500, `bigger than the 220 wide preview (${box!.width})`);
  assert.ok(box!.height <= 820 && box!.width <= 1440, 'and it fits the window');
  assert.equal(await page.$eval('dialog#big iframe', (f: HTMLIFrameElement) => f.src), firstSrc, 'the picture clicked');

  // → shows the next preview, a Story, which shrinks to fit the window's height.
  await page.keyboard.press('ArrowRight');
  const second = await page.$$eval('#pics .preview iframe', (fs: HTMLIFrameElement[]) => fs[1].src);
  assert.equal(await page.$eval('dialog#big iframe', (f: HTMLIFrameElement) => f.src), second);
  const story = await (await page.$('dialog#big .preview'))!.boundingBox();
  assert.ok(story!.height <= 820, `a Story fits the window's height (${story!.height})`);
  assert.ok(Math.abs(story!.height / story!.width - 1920 / 1080) < 0.02, 'and keeps its shape');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.$eval('dialog#big iframe', (f: HTMLIFrameElement) => f.src), firstSrc, '← goes back');

  await page.keyboard.press('Escape');
  assert.equal(await page.$eval('dialog#big', (d: HTMLDialogElement) => d.open), false, 'Esc closes it');
});
