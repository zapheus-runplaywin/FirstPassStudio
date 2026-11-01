// The guide's Studio screenshots: each one's name (the picture's file name in docs/user-guide/img) and how to
// take it on the Elite Netball League night run.js sets up. A shot is the whole page or one part of it.

'use strict';

const JPEG = { type: 'jpeg', quality: 92 };

async function go(page, studio, url, ms = 2500) {
  await page.goto(studio.base + url, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(ms);
  // The data folder is a temporary one here: name the Mac's own instead.
  await page.evaluate(dir => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) if (n.nodeValue.includes(dir)) n.nodeValue = n.nodeValue.split(dir).join('~/Library/Application Support/FirstPass Studio');
  }, studio.dataDir);
}
const full = (page, out) => page.screenshot({ path: out, fullPage: true, ...JPEG });
// One element (or the area from one element to another), with a little of the page round it. The bar is
// made to scroll with the page first, so it never sits over the part.
async function part(page, locator, out, pad = 8, to = null) {
  await page.addStyleTag({ content: 'header.fp-bar { position: static !important; } .savebar { display: none !important; }' });
  await locator.first().waitFor();
  const rect = el => { const r = el.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }; };
  const a = await locator.first().evaluate(rect);
  const b = to ? await to.first().evaluate(rect) : a;
  const x = Math.max(0, Math.min(a.x, b.x) - pad), y = Math.max(0, Math.min(a.y, b.y) - pad);
  const right = Math.max(a.x + a.w, b.x + b.w) + pad, bottom = Math.max(a.y + a.h, b.y + b.h) + pad;
  await page.screenshot({ path: out, ...JPEG, fullPage: true, clip: { x, y, width: right - x, height: bottom - y } });
}
// A dialog: the window made tall enough for all of it first.
async function dialogShot(page, id, out) {
  await page.setViewportSize({ width: 1440, height: 2400 });
  await page.waitForTimeout(600);
  await part(page, page.locator(`dialog#${id}`), out, 0);
}
const section = (page, heading) => page.locator('section', { has: page.locator('h2', { hasText: new RegExp(`^\\s*${heading}`) }) }).last();
const setupSection = (page, heading) => page.locator('#editor section', { has: page.locator('h2', { hasText: new RegExp(`^\\s*${heading}\\s*$`) }) });

const SHOTS = [
  // ─── Output ───────────────────────────────────────────────────────────
  { name: 's-output', async take({ page, studio, out }) { await go(page, studio, '/output.html', 4000); await full(page, out); } },
  { name: 's-bar', async take({ page, studio, out }) { await go(page, studio, '/output.html', 4000); await part(page, page.locator('header.fp-bar'), out, 0); } },
  { name: 's-output-top', async take({ page, studio, out }) {
    await go(page, studio, '/output.html', 4000);
    await page.screenshot({ path: out, ...JPEG, clip: { x: 0, y: 0, width: 1440, height: 760 } });
  } },
  { name: 's-output-sources', async take({ page, studio, out }) { await go(page, studio, '/output.html'); await part(page, page.locator('#sourcesSection'), out); } },
  { name: 's-output-source-settings', async take({ page, studio, out }) {
    await go(page, studio, '/output.html');
    const row = page.locator('#sources li', { has: page.locator('.name', { hasText: /^Title/ }) });
    await row.locator('.edit').click();
    await page.waitForTimeout(800);
    await part(page, row, out, 8, page.locator('#sources li.editor'));
  } },
  { name: 's-output-runorder', async take({ page, studio, out }) { await go(page, studio, '/output.html'); await part(page, page.locator('#roSection'), out); } },
  { name: 's-output-scenes', async take({ page, studio, out }) { await go(page, studio, '/output.html'); await part(page, page.locator('#scenesSection'), out); } },
  { name: 's-output-scenes-edit', async take({ page, studio, out }) {
    await go(page, studio, '/output.html');
    await page.click('#editScenes');
    await page.waitForTimeout(800);
    await part(page, page.locator('#scenesSection'), out);
  } },
  { name: 's-output-sequences', async take({ page, studio, out }) { await go(page, studio, '/output.html'); await part(page, page.locator('#seqSection'), out); } },
  { name: 's-sequence-editor-halftime', async take({ page, studio, out }) {
    await go(page, studio, '/output.html');
    await page.locator('#seqs .seq', { has: page.locator('b', { hasText: /^Half time$/ }) }).locator('.edit').click();
    await page.waitForTimeout(800);
    await dialogShot(page, 'seqDialog', out);
  } },
  { name: 's-output-sequence-playing', async take({ page, studio, out }) {
    await studio.post('/api/scene', { type: 'seqPlay', sequence: 'Half time' });
    try {
      await go(page, studio, '/output.html', 9000);
      await part(page, page.locator('#seqSection'), out);
    } finally {
      await studio.post('/api/scene', { type: 'seqStop' });
      await studio.post('/api/scene', { type: 'sceneGo', scene: 'Live game' });
      // Back to tonight's run order as it was.
      const sc = await studio.get('/api/scene');
      await studio.post('/api/scene', { type: 'roClear' });
      for (const n of ['Sponsor break', 'Walk out']) await studio.post('/api/scene', { type: 'roAdd', kind: 'sequence', id: sc.sequences.find(x => x.name === n).id });
    }
  } },
  { name: 's-output-music', async take({ page, studio, out }) {
    await studio.post('/api/scene', { type: 'musicPlaylist', playlist: 'Pre-game warm up', play: true });
    try {
      await go(page, studio, '/output.html', 6000);
      await part(page, page.locator('#musicSection'), out);
    } finally { await studio.post('/api/scene', { type: 'musicStop' }); }
  } },
  { name: 's-playlist-editor', async take({ page, studio, out }) {
    await go(page, studio, '/output.html');
    await page.locator('#playlists .seq', { has: page.locator('b', { hasText: /^Pre-game warm up$/ }) }).locator('.edit').click();
    await page.waitForTimeout(800);
    await dialogShot(page, 'plDialog', out);
  } },
  { name: 's-output-sceneview', async take({ page, studio, out }) { await go(page, studio, '/output.html', 5000); await part(page, page.locator('#viewSection'), out); } },

  // ─── Planner, Scoreboard ──────────────────────────────────────────────
  { name: 's-planner', async take({ page, studio, out }) { await go(page, studio, '/planner.html', 3500); await full(page, out); } },
  { name: 's-control', async take({ page, studio, out }) { await go(page, studio, '/control.html', 3500); await full(page, out); } },
  { name: 's-control-score', async take({ page, studio, out }) {
    await go(page, studio, '/control.html', 3500);
    await part(page, page.locator('.board'), out);
  } },
  { name: 's-control-clock', async take({ page, studio, out }) {
    await go(page, studio, '/control.html', 3500);
    await part(page, page.locator('section.clock'), out);
  } },
  { name: 's-control-finals', async take({ page, studio, out }) {
    await go(page, studio, '/control.html', 3000);
    await page.click('#ctlTabs button[data-tab="finals"]');
    await page.waitForTimeout(1500);
    await part(page, page.locator('#ctlTabs').locator('..'), out);
  } },

  // ─── Competitions setup ───────────────────────────────────────────────
  ...[['s-setup-competitions', 'Competitions'], ['s-setup-playhq', 'PlayHQ'], ['s-setup-names', 'Names on the graphics'], ['s-setup-rules', 'Game rules'],
    ['s-setup-finals', 'Finals'], ['s-setup-gameday', 'Game night'], ['s-setup-colours', 'Colours and font'], ['s-setup-logo', 'Competition logo'],
    ['s-setup-teamlogos', 'Team logos'], ['s-setup-viewers', 'Live viewers'], ['s-setup-more', 'More']].map(([name, heading]) => ({ name, async take({ page, studio, out }) {
    await go(page, studio, '/setup.html', 3500);
    const sec = heading === 'Competitions' ? section(page, heading) : setupSection(page, heading);
    await part(page, sec, out);
  } })),

  // ─── Sponsors, Athletes, Devices, Docs ────────────────────────────────
  { name: 's-sponsors', async take({ page, studio, out }) { await go(page, studio, '/sponsors.html', 3000); await full(page, out); } },
  { name: 's-sponsor-editor', async take({ page, studio, out }) {
    await go(page, studio, '/sponsors.html', 3000);
    await page.locator('.sponsor, .sp, [data-sponsor]', { hasText: 'Summit Sportswear' }).first().locator('button').first().click();
    await page.waitForTimeout(1000);
    await dialogShot(page, 'editor', out);
  } },
  { name: 's-sponsorreport', async take({ page, studio, out }) { await go(page, studio, '/sponsorreport.html', 3500); await full(page, out); } },
  { name: 's-athletes', async take({ page, studio, out }) { await go(page, studio, '/athletes.html', 4000); await full(page, out); } },
  { name: 's-athlete-games', async take({ page, studio, out }) {
    await go(page, studio, '/athletes.html', 4000);
    await page.locator('button', { hasText: /^Games$/ }).first().click();
    await page.waitForTimeout(1000);
    await dialogShot(page, 'statsDialog', out);
  } },
  { name: 's-devices', async take({ page, studio, out }) {
    await go(page, studio, '/api.html', 3000);
    await page.screenshot({ path: out, ...JPEG, clip: { x: 0, y: 0, width: 1440, height: 1900 }, fullPage: true });
  } },
  { name: 's-docs', async take({ page, studio, out }) {
    await go(page, studio, '/graphics.html', 3000);
    await page.screenshot({ path: out, ...JPEG, clip: { x: 0, y: 0, width: 1440, height: 1700 }, fullPage: true });
  } },
];

module.exports = { SHOTS };
