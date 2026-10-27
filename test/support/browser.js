// The browser for the operator journey tests: Playwright's own Chromium, or STUDIO_TEST_CHROMIUM (in the
// cloud container: /opt/pw-browsers/chromium). Without one the test is skipped, or fails when
// STUDIO_TEST_REQUIRE_BROWSER is set (as in CI), so it can't silently not run.
//   const page = await openPage(t, studio, '/output.html');   // null when skipped
// Requests anywhere but Studio (web fonts) are answered empty, so the tests never reach the internet.
// Everything is closed when the test ends.

'use strict';

const assert = require('node:assert/strict');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* not installed */ }

async function openBrowser(t) {
  let browser = null, why = 'playwright is not installed';
  if (chromium) {
    try { browser = await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined }); }
    catch (err) { why = err.message.split('\n')[0]; }
  }
  if (!browser) {
    if (process.env.STUDIO_TEST_REQUIRE_BROWSER) assert.fail(`no browser to test the pages in: ${why}`);
    t.skip(`no browser to test the pages in (${why}); run npx playwright install chromium`);
    return null;
  }
  t.after(() => browser.close());
  return browser;
}

// A page of Studio's in a 1600 x 1000 window, with its script errors collected in page.errors.
async function openPage(t, studio, path, { browser } = {}) {
  browser = browser || await openBrowser(t);
  if (!browser) return null;
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  t.after(() => context.close());
  await context.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '', contentType: 'text/css' }));
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', err => page.errors.push(err.message));
  await page.goto(studio.base + path, { waitUntil: 'load' });
  return page;
}

module.exports = { openBrowser, openPage };
