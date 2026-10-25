// Renders one poster: node render.js automation  ->  ../automation.pdf (A0) and ../automation-full.png (2x, 6358 x 8988)
const { chromium } = require('playwright'); const path = require('path');
const name = process.argv[2]; if (!name) { console.error('usage: node render.js <original|game-night|court|automation>'); process.exit(1); }
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 3179, height: 4494 }, deviceScaleFactor: 2 });
  await p.goto('file://' + path.join(__dirname, name + '.html'), { waitUntil: 'networkidle' });
  await p.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(i => i.decode().catch(() => {}))); });
  const missing = await p.evaluate(() => [...document.images].filter(i => !i.naturalWidth).map(i => i.src));
  if (missing.length) console.error('missing pictures:', missing);
  await p.screenshot({ path: path.join(__dirname, '..', name + '-full.png'), clip: { x: 0, y: 0, width: 3179, height: 4494 } });
  await p.emulateMedia({ media: 'screen' });
  await p.addStyleTag({ content: '@page { size: 841mm 1189mm; margin: 0 } html,body{margin:0;background:#0F172A}' });
  await p.pdf({ path: path.join(__dirname, '..', name + '.pdf'), width: '841mm', height: '1189mm', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 }, pageRanges: '1' });
  await b.close();
})();
