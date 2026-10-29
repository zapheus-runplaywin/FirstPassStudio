// Every page in public/ opens in a real browser (Chromium, through Playwright) without a script
// error, a console error or a failed request, with Studio running against the stand-in PlayHQ
// (test/support/playhq.js) and the Thunder League template in use, a game being played.
// Requests off this computer (Google Fonts) are answered empty, so nothing leaves it.
// The browser: Playwright's own (npx playwright install chromium), or STUDIO_TEST_CHROMIUM.
// Without one the test is skipped, saying so (except in the Tests check, see below).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startStudio, ROOT } = require('./support/studio');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* not installed */ }

// Extra page links to open too: options that change what a page asks for or shows.
const VARIANTS = ['social.html?kind=matchup&size=portrait', 'social.html?kind=polaroid&size=story', 'social.html?kind=onstream&size=story&sponsor=1&mark=0', 'social.html?kind=results&size=story', 'social.html?kind=fixtures&colours=highlight-ground', 'social.html?kind=polaroid&colours=day', ...['fun', 'dynamic', 'junior', 'retro', 'futuristic', 'professional', 'thunder', 'geometric', 'gradient', 'striped', 'highcontrast', '3d', 'neon', 'poster', 'splash'].map(t => `social.html?kind=fixtures&template=${t}`), 'social.html?kind=matchup&template=poster&size=story', 'social.html?kind=results&template=arena&size=square', 'social.html?kind=fulltime&template=gameday&size=portrait', 'social.html?kind=fixtures&template=final&size=square', 'social.html?kind=ladder&template=hero&size=story', 'social.html?kind=matchup&template=court&size=square', 'social.html?kind=fulltime&template=bib&size=story', 'social.html?kind=topshooters&template=goal&size=portrait', 'social.html?kind=ladder&template=3d&size=story', 'social.html?kind=matchup&template=thunder&colours=day', 'social.html?kind=commentators&size=story', 'social.html?kind=commentators&part=2', 'social.html?kind=fulltime', 'social.html?kind=ladder&size=portrait&division=Division%202', 'social.html?kind=topshooters&size=story', 'fixtures.html?round=prev', 'results.html?round=prev', 'ladder.html?division=2', 'title.html?logo=show&emoji=%E2%9A%A1',
  'branding.html?mode=light', 'clash.html?word=Battle', 'winner.html?winner=home', 'lowerthird.html?name=Blizzardz%20GS',
  'lowerthird.html?type=guest&name=Pat&title=Commentator', 'commentators.html?name=Pat&name2=Sam', 'commentators.html?style=box&label=Special%20guest%20commentators&name=Pat&name2=Sam&name3=Jo', 'scoreboard.html?position=top-center', 'matchup.html?form=0&h2h=0',
  'topshooters.html?division=2', 'finals.html?division=2', 'streak.html', 'supershot.html', 'gamestats.html?quarters=0&runs5=0', 'commentator.html?refresh=0', 'goals.html?layout=vertical&fill=1&run=0', 'goals.html?fill=1&run=0', 'worm.html?leads=0&colours=0&draw=0', 'pvw.html?src=%2Fladder.html&name=Ladder', 'pvw.html?src=%2Fscene.html', 'upnext.html?wrap=1&mode=dark', ...['parade', 'tiles', 'spotlight', 'court', 'blueprint'].map(st => `introoutro.html?style=${st}&division=all`), 'introoutro.html?type=outro&fit=1&bg=gradient', 'introoutro.html?style=court&sfx=0&sound=0', 'introoutro.html?style=spotlight&theme=Theme.wav&themefit=stretch&sound=0'];
// What a few pages show once they've read their data from PlayHQ (the stand-in's season).
const SHOWS = {
  'scoreboard.html': ['Blizzardz', "Travis' Disciples"],
  'ladder.html': ['Blizzardz', 'Mavericks', 'Knights'],
  'ladder.html?division=2': ['Stormz', 'Tsunamiz'],
  'fixtures.html': ['Stormz', 'Semi Pro', 'Court 2'],
  'upnext.html': ['Stormz', 'Semi Pro'],
  'introoutro.html': ['Welcome to', 'Thunder League', 'Round 3', 'Blizzardz'],
  'introoutro.html?type=outro&fit=1&bg=gradient': ['last game of the night', 'Join us again next week'],
  'introoutro.html?style=blueprint&division=all': ['Stormz', 'bp-card'],
  'upnext.html?wrap=1&mode=dark': ['last game of the night', 'Thunder League', 'Join us again next week', 'Round 4'],
  'ladderbar.html': ['Blizzardz'],
  'commentators.html?name=Pat&name2=Sam': ['Commentators', 'Pat', 'Sam'],
  'commentators.html?style=box&label=Special%20guest%20commentators&name=Pat&name2=Sam&name3=Jo': ['Special guest commentators', 'Jo'],
  'topshooters.html': ['Blizzardz GS'],
  'teamlist.html': ['Blizzardz GS'],
  'control.html': ['Blizzardz'],
  'gamestats.html': ['Blizzardz', 'Game stats'],
  'commentator.html?refresh=0': ['Blizzardz', 'Game stats', 'Shooting', 'Lead changes', 'Blizzardz GS', 'games', 'Moments', 'Score worm'],
  'worm.html': ['Blizzardz', 'Score worm', 'Lead changes'],
  'social.html': ['Game night', 'Blizzardz', 'Court 2'],
  'socials.html': ['Game night fixture', 'Polaroid', 'Match up Blizzardz', 'Select all', 'Select none'],
  'social.html?kind=ladder&size=portrait&division=Division%202': ['Ladder', 'Division 2', 'Stormz', 'Pts'],
};
// How long each page gets to load its data and draw.
const SETTLE_MS = 2500;
const AT_ONCE = 6;

async function launch() {
  if (!chromium) return null;
  const executablePath = process.env.STUDIO_TEST_CHROMIUM || undefined;
  try { return await chromium.launch({ executablePath, args: ['--autoplay-policy=no-user-gesture-required'] }); }
  catch (err) { return { error: err.message.split('\n')[0] }; }
}

test('every page loads without errors', async t => {
  const browser = await launch();
  if (!browser || browser.error) {
    // The Tests check on pull requests sets STUDIO_TEST_REQUIRE_BROWSER, so there it fails instead.
    if (process.env.STUDIO_TEST_REQUIRE_BROWSER) assert.fail(`no browser to test the pages in: ${browser ? browser.error : 'playwright is not installed'}`);
    t.skip(`no browser to test the pages in (${browser ? browser.error : 'playwright is not installed'}); run npx playwright install chromium`);
    return;
  }
  t.after(() => browser.close());
  const studio = await startStudio(t, { competition: 'Thunder League' });
  await studio.until(async () => (await studio.get('/api/scoreboard')).gameId);
  // A theme for the intro: 2 seconds of quiet as a WAV.
  const rate = 8000, bytes = rate * 2 * 2, wav = Buffer.alloc(44 + bytes);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + bytes, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(bytes, 40);
  fs.mkdirSync(path.join(studio.dataDir, 'media'), { recursive: true });
  fs.writeFileSync(path.join(studio.dataDir, 'media', 'Theme.wav'), wav);

  const pages = fs.readdirSync(path.join(ROOT, 'public')).filter(n => n.endsWith('.html')).sort();
  const links = [...pages, ...VARIANTS];
  const problems = [];
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  t.after(() => context.close());
  await context.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '', contentType: 'text/css' }));

  const open = async link => {
    const page = await context.newPage();
    const found = [];
    page.on('pageerror', err => found.push(`script error: ${err.message}`));
    page.on('console', m => { if (m.type() === 'error') found.push(`console error: ${m.text()}`); });
    page.on('requestfailed', r => { if (!/ERR_ABORTED/.test(r.failure()?.errorText || '')) found.push(`request failed: ${r.url()} ${r.failure()?.errorText}`); });
    page.on('response', r => { if (r.status() >= 400 && r.url().startsWith(studio.base)) found.push(`${r.status()} for ${r.url().slice(studio.base.length)}`); });
    try {
      const res = await page.goto(`${studio.base}/${link}`, { waitUntil: 'load', timeout: 15000 });
      if (!res || res.status() !== 200) found.push(`page answered ${res && res.status()}`);
      await page.waitForTimeout(SETTLE_MS);
      const html = await page.content();
      for (const text of SHOWS[link] || []) if (!html.includes(text.replace(/'/g, '&#39;')) && !html.includes(text)) found.push(`doesn't show ${text}`);
    } catch (err) { found.push(`did not load: ${err.message.split('\n')[0]}`); }
    await page.close();
    for (const f of found) problems.push(`${link}: ${f}`);
  };
  const queue = [...links];
  await Promise.all(Array.from({ length: AT_ONCE }, async () => { while (queue.length) await open(queue.shift()); }));

  // Pages report their own errors to the helper's log too (log.js).
  const pageErrors = studio.log().split('\n').filter(l => /^\S+ ERROR \[page /.test(l));
  assert.deepEqual([...problems, ...pageErrors], [], `${links.length} pages opened`);
});
