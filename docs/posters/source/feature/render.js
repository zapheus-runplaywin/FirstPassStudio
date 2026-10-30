// Renders the A3 landscape feature poster and its 16:9 display version:
// node render.js  ->  ../../feature.pdf (A3), feature.png (2480 x 1754), feature-full.png (4960 x 3508),
// feature-display.png (1920 x 1080) and feature-display-full.png (3840 x 2160) in docs/posters. The -full PNGs aren't committed.
// Run python3 composite.py first if you change a photo or a screen picture.
const { chromium } = require('playwright'); const path = require('path');
const page = 'file://' + path.join(__dirname, '..', 'feature.html'), out = n => path.join(__dirname, '..', '..', n);
async function ready(p) {
  await p.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(i => i.decode().catch(() => {}))); pins(); });
  const missing = await p.evaluate(() => [...document.images].filter(i => !i.naturalWidth).map(i => i.src));
  if (missing.length) console.error('missing pictures:', missing);
}
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 2480, height: 1754 }, deviceScaleFactor: 2 });
  await p.goto(page, { waitUntil: 'networkidle' }); await ready(p);
  await p.screenshot({ path: out('feature-full.png'), clip: { x: 0, y: 0, width: 2480, height: 1754 } });
  await p.addStyleTag({ content: '@page { size: 420mm 297mm; margin: 0 } html,body{margin:0;background:#0F172A}' });
  await p.pdf({ path: out('feature.pdf'), width: '420mm', height: '297mm', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 }, pageRanges: '1' });
  const one = await b.newPage({ viewport: { width: 2480, height: 1754 } });
  await one.goto(page, { waitUntil: 'networkidle' }); await ready(one);
  await one.screenshot({ path: out('feature.png') });
  for (const [name, scale] of [['feature-display-full.png', 3840 / 2480], ['feature-display.png', 1920 / 2480]]) {
    const w = await b.newPage({ viewport: { width: 2480, height: 1395 }, deviceScaleFactor: scale });
    await w.goto(page + '#wide', { waitUntil: 'networkidle' }); await ready(w);
    await w.screenshot({ path: out(name) });
  }
  await b.close();
})();
