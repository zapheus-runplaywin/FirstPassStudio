// A graphic shown in a frame on a Studio page keeps its see-through parts in the dark theme. Chromium paints a frame
// solid white when the page in it and the frame differ in colour scheme, which turned Scoreboard control's preview
// white in dark mode (after the Output page's Scene View, PR #435); studio.css makes every frame on a Studio page light.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startStudio } = require('./support/studio');
const { openPage } = require('./support/browser');

// The share of a PNG's pixels that are near white, worked out in the browser (no PNG reader in the tests).
const WHITE_SHARE = `async png => {
  const img = await createImageBitmap(await (await fetch('data:image/png;base64,' + png)).blob());
  const c = new OffscreenCanvas(img.width, img.height), g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, img.width, img.height).data;
  let white = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) white++;
  return white / (d.length / 4);
}`;

test('studio.css makes every frame on a Studio page light, and no page undoes it', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'studio.css'), 'utf8');
  assert.match(css, /:where\(body\.fp\) iframe \{ color-scheme: light; \}/);
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'public')).filter(n => n.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
    if (html.includes('class="fp-bar"')) assert.doesNotMatch(html, /iframe[^{]*\{[^}]*color-scheme: dark/, `${f} keeps its frames light`);
  }
});

test('in the dark theme, Scoreboard control\'s preview and the Output page\'s Scene View show the page behind, not white', async t => {
  const studio = await startStudio(t, { competition: 'Thunder League' });
  await studio.until(async () => (await studio.get('/api/scoreboard')).gameId);
  for (const [page, frame] of [['/control.html', '#preview'], ['/output.html', '#previewFrame']]) {
    const p = await openPage(t, studio, page);
    if (!p) return;
    await p.emulateMedia({ colorScheme: 'dark' });
    await p.waitForTimeout(1500);
    const box = p.locator(frame).first();
    await box.scrollIntoViewIfNeeded();
    const png = (await box.screenshot()).toString('base64');
    const share = await p.evaluate(`(${WHITE_SHARE})(${JSON.stringify(png)})`);
    assert.ok(share < 0.3, `${page} ${frame} is ${Math.round(share * 100)}% white`);
    assert.deepEqual(p.errors, []);
  }
});
