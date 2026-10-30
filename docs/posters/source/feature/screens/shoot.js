// node shoot.js -> board-1..3.jpg (sponsor LED boards for the big screen photo)
const { chromium } = require('playwright'); const path = require('path');
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1600, height: 720 } });
  await p.goto('file://' + path.join(__dirname, 'boards.html'));
  for (const i of [1, 2, 3]) await (await p.$('#b' + i)).screenshot({ path: path.join(__dirname, `board-${i}.jpg`), quality: 95 });
  await b.close(); })();
