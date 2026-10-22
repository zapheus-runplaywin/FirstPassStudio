// Sponsor spots on the existing graphics (public/sponsorspot.js): the naming rights sponsor on the scoreboard,
// title and countdown, the next sponsor in rotation in the stat card footers and the ticker, and the sponsor
// strip on the end of night card, each left off with ?sponsor=0 (?sponsors=0 for the strip), in a real browser.
// Skipped without one, like pages.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* not installed */ }

test('sponsors show on the graphics, and ?sponsor=0 leaves them off', async t => {
  let browser = null;
  if (chromium) {
    try { browser = await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined }); } catch { browser = null; }
  }
  if (!browser) {
    if (process.env.STUDIO_TEST_REQUIRE_BROWSER) assert.fail('no browser to test the pages in');
    t.skip('no browser to test the pages in; run npx playwright install chromium');
    return;
  }
  t.after(() => browser.close());
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const comp = (await studio.get('/api/sponsors')).competition.id;
  const add = (name, tier, extra = {}) => studio.post('/api/sponsors', { name, ...extra, competitions: { [comp]: { tier } } });
  await add('Golds Bakery', 'naming');
  await add('Surf Club', 'major', { tagline: 'Swim between the flags' });
  await studio.until(async () => (await studio.get('/api/scoreboard')).gameId);

  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  t.after(() => context.close());
  await context.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '', contentType: 'text/css' }));
  const text = async link => {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto(`${studio.base}/${link}`, { waitUntil: 'load' });
    await page.waitForTimeout(2000);
    const body = await page.evaluate(() => {
      // Only what's on show: hidden boxes are left out.
      const walk = n => n.nodeType === 3 ? n.textContent : n.nodeType === 1 && !n.hidden && getComputedStyle(n).display !== 'none' && n.tagName !== 'SCRIPT' && n.tagName !== 'STYLE'
        ? [...n.childNodes].map(walk).join(' ') : '';
      return walk(document.body).replace(/\s+/g, ' ');
    });
    await page.close();
    assert.deepEqual(errors, [], `${link} has no script errors`);
    return body;
  };

  for (const link of ['scoreboard.html', 'title.html', 'countdown.html']) {
    assert.match(await text(link), /Presented by Golds Bakery/i, `${link} shows the naming rights sponsor`);
    assert.doesNotMatch(await text(`${link}?sponsor=0`), /Golds Bakery/, `${link}?sponsor=0 leaves it off`);
  }
  assert.match(await text('scoreboard.html?sponsor=Surf%20Club'), /Presented by Surf Club/i, '?sponsor= fixes one sponsor');

  // The stat cards and ticker take turns from the rotation (Major and up for the cards, Partner and up for the ticker).
  const footers = [];
  for (let i = 0; i < 4; i++) footers.push((await text('gamestats.html')).match(/Presented by (Golds Bakery|Surf Club)/i)?.[1]);
  assert.deepEqual(new Set(footers), new Set(['Golds Bakery', 'Surf Club']), `the game stats footer goes round the sponsors: ${footers.join(', ')}`);
  assert.doesNotMatch(await text('gamestats.html?sponsor=0'), /Presented by/i);
  const ticker = await text('ticker.html?sponsor=Surf%20Club');
  assert.match(ticker, /Surf Club Swim between the flags/, 'the ticker leads with the sponsor and its tagline');

  const wrap = await text('upnext.html?wrap=1');
  assert.match(wrap, /Thanks to our sponsors Golds Bakery Surf Club/);
  assert.doesNotMatch(await text('upnext.html?wrap=1&sponsors=0'), /Thanks to our sponsors/);
});
