// The tab bar on every Studio page comes from one list (public/studiobar.ts): each Studio page has
// the empty header and loads the script, the list is in Matt's keyboard order (⌘1 to ⌘0), the bar shows
// it in three groups (Run, Plan, Set up) with Docs apart, and the Mac app's Go menu reads the same list.
// The bar also carries the status chips from /api/health. The page test (pages.test.mts) checks the bar
// renders without errors.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startStudio } from './support/studio.mts';
import { openPage, openBrowser } from './support/browser.mts';

const PUBLIC = path.join(import.meta.dirname, '..', 'public');
// The bar's lists, as the Mac app's Go menu reads them (studiobar.js is a page script, so it has no types of its own).
interface Tab { href: string; label: string; group: string }
const { STUDIO_PAGES, GROUPS, PHONE_PAGES } = createRequire(import.meta.url)('../out/public/studiobar.js') as { STUDIO_PAGES: Tab[]; GROUPS: string[]; PHONE_PAGES: Tab[] };

test('the tabs are Output, Production Planner, Scoreboard control, Recordings, Socials, Competitions setup, Sponsors, Athletes, Devices, Docs', () => {
  assert.deepEqual(STUDIO_PAGES.map((p: Tab) => p.label), ['Output', 'Production Planner', 'Scoreboard control', 'Recordings', 'Socials', 'Competitions setup', 'Sponsors', 'Athletes', 'Devices', 'Docs']);
  // Docs is the user guide (docs/user-guide, served at /guide/).
  const file = (p: Tab) => p.href === '/guide/' ? path.join(import.meta.dirname, '..', 'docs', 'user-guide', 'index.html') : path.join(PUBLIC, p.href.slice(1));
  for (const p of STUDIO_PAGES) assert.ok(fs.existsSync(file(p)), `${p.href} exists`);
});

test('the bar groups the tabs: Run, Plan, Set up, and Docs on its own', () => {
  assert.deepEqual(GROUPS, ['Run', 'Plan', 'Set up']);
  const inGroup = (g: string) => STUDIO_PAGES.filter((p: Tab) => p.group === g).map((p: Tab) => p.label);
  assert.deepEqual(inGroup('Run'), ['Output', 'Scoreboard control']);
  assert.deepEqual(inGroup('Plan'), ['Production Planner', 'Socials']);
  assert.deepEqual(inGroup('Set up'), ['Recordings', 'Competitions setup', 'Sponsors', 'Athletes', 'Devices']);
  assert.deepEqual(inGroup('Docs'), ['Docs']);
  assert.ok(STUDIO_PAGES.every((p: Tab) => [...GROUPS, 'Docs'].includes(p.group)), 'every tab is in a group');
});

test('the bar draws the brand, the grouped tabs and the status chips, and the chips follow /api/health', async t => {
  const studio = await startStudio(t, { competition: 'Thunder League' });
  await studio.until(async () => (await studio.get('/api/scoreboard')).gameId);
  const page = await openPage(t, studio, '/sponsors.html');
  if (!page) return;
  assert.equal(await page.$eval('.fp-bar .fp-brand img.fp-word', i => i.getAttribute('src')), '/studio/firstpass-studio.svg');
  // The 1P mark is its own file shown whole, not a crop of the full logo (which cut off the top of the 1P).
  const mark = await page.$eval('.fp-bar .fp-brand img.fp-mark', i => ({ src: i.getAttribute('src'), w: i.getBoundingClientRect().width, h: i.getBoundingClientRect().height, clip: getComputedStyle(i.parentElement!).overflow }));
  assert.equal(mark.src, '/studio/1p-mark-dark.svg');
  assert.equal(mark.clip, 'visible');
  assert.ok(Math.abs(mark.w / mark.h - 404 / 284) < 0.02, `the mark keeps its shape (${mark.w}×${mark.h})`);
  assert.deepEqual(await page.$$eval('.fp-bar nav:not(.fp-docs) .fp-grp', els => els.map(e => e.textContent)), ['Run', 'Plan', 'Set up']);
  assert.deepEqual(await page.$$eval('.fp-bar nav:not(.fp-docs) a', els => els.map(e => e.textContent)),
    ['Output', 'Scoreboard', 'Planner', 'Socials', 'Recordings', 'Competitions', 'Sponsors', 'Athletes', 'Devices']);
  assert.equal(await page.$eval('.fp-bar nav a[aria-current="page"]', a => a.textContent), 'Sponsors');
  assert.equal(await page.$eval('.fp-bar .fp-docs a', a => a.textContent), 'Docs');
  await page.waitForFunction(() => document.querySelector('.fp-chips .chip.game') && !/No game/.test(document.querySelector('.fp-chips .chip.game')!.textContent), null, { timeout: 8000 });
  assert.equal(await page.$eval('.fp-chips .chip:first-child', c => c.textContent), 'Off air');
  assert.match(await page.$eval('.fp-chips .chip.game', c => c.textContent), / v .* · Court 1$/);
  assert.match(await page.$eval('.fp-chips .chip.playhq', c => c.textContent), /^PlayHQ · Q1 \d+:\d\d$/);
  assert.equal(await page.$('.fp-chips .chip.seq'), null, 'no sequence chip while nothing plays');
  // The practice strip and the refused banner keep their places under the bar.
  assert.equal(await page.$eval('header.fp-bar', h => h.nextElementSibling!.className), 'fp-practice');
  assert.deepEqual(page.errors, []);
});

test('on a phone the bar is Socials, Remote and Commentator, and Studio\'s own link opens Socials; the Remote and Commentator link to the other two', async t => {
  assert.deepEqual(PHONE_PAGES.map((p: Tab) => p.label), ['Socials', 'Remote', 'Commentator']);
  const browser = await openBrowser(t);
  if (!browser) return;
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  t.after(() => context.close());
  await context.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '' }));
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.goto(`${studio.base}/`);
  await page.waitForURL(/\/socials\.html$/);
  await page.waitForSelector('.fp-bar.fp-phone nav a');
  assert.deepEqual(await page.$$eval('.fp-bar nav a', els => els.map(e => e.textContent)), ['Socials', 'Remote', 'Commentator']);
  assert.equal(await page.$eval('.fp-bar nav a[aria-current="page"]', a => a.textContent), 'Socials');
  assert.equal(await page.$('.fp-bar .fp-grp, .fp-bar .fp-chips, .fp-bar .fp-docs'), null, 'no groups, chips or Docs on a phone');
  assert.equal(await page.$eval('.fp-bar .fp-brand', a => a.getAttribute('href')), '/socials.html');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390, 'the bar fits the phone');
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  // Another page at its own link still opens, with the phone bar.
  await page.goto(`${studio.base}/control.html`);
  assert.deepEqual(await page.$$eval('.fp-bar nav a', els => els.map(e => e.textContent)), ['Socials', 'Remote', 'Commentator']);
  for (const [path, links] of [['/remote.html', ['/socials.html', '/commentator.html']], ['/commentator.html', ['/socials.html', '/remote.html']]] as const) {
    await page.goto(studio.base + path);
    assert.deepEqual(await page.$$eval('.top nav a', els => els.map(e => e.getAttribute('href'))), links, path);
  }
  assert.deepEqual(errors, []);
});

test('every Studio page has the empty bar and loads studiobar.js straight after it, and no page keeps a copy of the tabs', () => {
  const studioPages = fs.readdirSync(PUBLIC).filter(n => n.endsWith('.html') && fs.readFileSync(path.join(PUBLIC, n), 'utf8').includes('class="fp-bar"'));
  assert.ok(studioPages.length >= 8, `${studioPages.length} pages have the bar`);
  for (const n of studioPages) {
    const html = fs.readFileSync(path.join(PUBLIC, n), 'utf8');
    assert.match(html, /<header class="fp-bar"><\/header><script src="studiobar\.js"><\/script>/, `${n} has the empty bar and the script`);
    assert.doesNotMatch(html, /class="fp-logo"/, `${n} doesn't carry its own copy of the wordmark`);
  }
});
