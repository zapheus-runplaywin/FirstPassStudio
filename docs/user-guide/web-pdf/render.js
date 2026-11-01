const { chromium } = require('playwright');
const path = require('path'); const fs = require('fs');
const HERE = __dirname; const OUT = path.join(HERE, 'out'); fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined });
  const p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
  p.on('console', m => console.log('page:', m.type(), m.text()));
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('file://' + path.join(HERE, 'web.html'), { waitUntil: 'networkidle' });
  await p.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60000 });
  await p.emulateMedia({ media: 'screen' });
  const pages = await p.evaluate(() => [...document.querySelectorAll('.page')].map((e, i) => ({ i, title: e.dataset.title, ch: +e.dataset.ch || 0, h: Math.ceil(e.getBoundingClientRect().height) })));
  console.log(JSON.stringify(pages));
  if (process.argv[2] === 'shots') {
    for (const pg of pages) { const e = (await p.$$('.page'))[pg.i]; await e.screenshot({ path: path.join(OUT, `p${String(pg.i).padStart(2,'0')}.png`) }); }
  } else {
    // pictures at 1.6x the size they are shown, to keep the PDF small
    const sizes = await p.evaluate(() => { const o = {}; document.querySelectorAll('img').forEach(i => { const s = i.getAttribute('src'); o[s] = Math.max(o[s] || 0, i.getBoundingClientRect().width); }); return o; });
    fs.writeFileSync(path.join(OUT, 'sizes.json'), JSON.stringify(sizes));
    require('child_process').execSync('python3 ' + path.join(HERE, 'shrink.py'), { stdio: 'inherit' });
    const map = JSON.parse(fs.readFileSync(path.join(OUT, 'shrunk.json'), 'utf8'));
    await p.evaluate(map => Promise.all([...document.querySelectorAll('img')].map(i => { const n = map[i.getAttribute('src')]; if (!n) return; i.src = n; return i.decode().catch(() => {}); })), map);
    // Shadows print as huge bitmaps; drop them. Then one PDF per page at that page's own size (a single PDF
    // with named page sizes comes out slightly shrunk in Chromium); merge.py joins them.
    await p.addStyleTag({ content: '*, *::before, *::after { box-shadow: none !important; text-shadow: none !important; } .win, .mon { outline: 1px solid rgba(255,255,255,.06); outline-offset: 3px; }' });
    for (const pg of pages) {
      await p.evaluate(i => document.querySelectorAll('.page').forEach((e, k) => e.style.display = k === i ? '' : 'none'), pg.i);
      await p.pdf({ path: path.join(OUT, `p${String(pg.i).padStart(2, '0')}.pdf`), width: '1280px', height: pg.h + 'px', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 }, pageRanges: '1' });
    }
    fs.writeFileSync(path.join(OUT, 'pages.json'), JSON.stringify(pages));
  }
  await b.close();
})();
