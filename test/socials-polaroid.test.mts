// The Results polaroid's caption: the score, then the opponent, division, round and date, each line kept on the print.
// The browser: Playwright's own, or STUDIO_TEST_CHROMIUM; skipped without one (except in the Tests check).
import test from 'node:test';
import assert from 'node:assert/strict';
import { startStudio, type Json } from './support/studio.mts';
import type { BrowserType } from 'playwright';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let chromium: BrowserType | null = null;
try { ({ chromium } = require('playwright') as typeof import('playwright')); } catch { /* not installed */ }

test('a Results polaroid names the round under the score', async t => {
  let browser = null;
  try { browser = chromium && await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined }); } catch { browser = null; }
  if (!browser) {
    if (process.env.STUDIO_TEST_REQUIRE_BROWSER) assert.fail('no browser to test the polaroid in');
    t.skip('no browser to test the polaroid in; run npx playwright install chromium');
    return;
  }
  t.after(() => browser.close());
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const date = (await studio.get('/api/socials')).nights[1].date;
  const g = (await studio.get(`/api/socials/night?date=${date}`)).games.find((x: Json) => x.finished);
  assert.ok(g && g.round, 'a finished game with a round');
  const page = await browser.newPage({ viewport: { width: 1080, height: 1080 } });
  await page.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '' }));
  await page.goto(`${studio.base}/social.html?kind=polaroid&date=${date}&game=${g.id}`);
  await page.waitForFunction(() => window.socialReady !== undefined);
  await page.evaluate(() => window.socialReady); // drawn, not just started
  const lines = await page.$$eval('.polaroid__caption > *', els => els.map(e => ({ text: e.textContent, fits: e.scrollWidth <= e.parentElement!.clientWidth })));
  assert.match(lines[0].text, /win|Draw/);
  assert.ok(lines[1].text.includes(g.division) && lines[1].text.includes(g.round), `"${lines[1].text}" names ${g.division} and ${g.round}`);
  assert.ok(lines.every(l => l.fits), 'both lines fit the print');
});
