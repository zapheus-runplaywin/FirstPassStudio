// Chroma key safe graphics (public/chroma.js): for the chroma output, every graphic goes out with nothing half
// see-through, so a key on a colour cuts it cleanly. It's on by default with Chroma picked, only overrides how
// pages draw (?chromaKey=true, or inside a chroma key safe scene), and never changes a saved setting.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startStudio, ROOT } = require('./support/studio');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* not installed */ }

process.env.FIRSTPASS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-chroma-'));
const outputs = require('../outputs');
let colours = [];
outputs.init(() => {}, { colours: () => colours });
outputs.message({ type: 'displays', displays: [{ id: 1, label: 'Built-in', primary: true }, { id: 2, label: 'HDMI' }] });

// The pages that are graphics (everything in public/ but Studio's own pages).
const APP_PAGES = ['api', 'athletes', 'control', 'devices', 'graphics', 'output', 'pair', 'preview', 'pvw', 'setup', 'sponsorreport', 'sponsors'];
const graphicsPages = () => fs.readdirSync(path.join(ROOT, 'public')).filter(n => n.endsWith('.html') && !APP_PAGES.includes(n.replace('.html', '')));

test('chroma key safe is on with Chroma picked, and only for the outputs keyed on a colour', () => {
  outputs.apply({ mode: 'chroma', chromaDisplay: '2', on: true });
  assert.equal(outputs.state().chromaSafe, true, 'ticked unless it is unticked');
  assert.equal(outputs.state().chromaSafeNow, true);
  assert.equal(outputs.windows()[0].safe, true);

  outputs.apply({ chromaSafe: false });
  assert.equal(outputs.windows()[0].safe, false, 'unticked: the chroma output draws as usual');
  outputs.apply({ chromaSafe: true });

  // NDI: only its chroma signal.
  outputs.message({ type: 'ndi', ok: true, version: 'test' });
  outputs.apply({ mode: 'ndi', ndiSignal: 'fillkey' });
  assert.equal(outputs.state().chromaSafeNow, false);
  assert.equal(outputs.windows()[0].safe, false);
  outputs.apply({ ndiSignal: 'chroma' });
  assert.equal(outputs.windows()[0].safe, true);
  outputs.apply({ ndiSignal: 'alpha' });
  assert.equal(outputs.windows()[0].safe, false, 'with transparency keeps soft edges');

  outputs.apply({ mode: 'fillkey', fillDisplay: '2' });
  assert.equal(outputs.state().chromaSafeNow, false, 'fill and key keep every soft edge');
  outputs.apply({ mode: 'off' });
});

test('picking Chroma and going back changes nothing else', () => {
  outputs.apply({ mode: 'fillkey', fillDisplay: '2', on: false });
  const before = { ...outputs.state() };
  outputs.apply({ mode: 'chroma', chromaDisplay: '2' });
  outputs.apply({ mode: 'fillkey' });
  const after = outputs.state();
  for (const k of ['mode', 'on', 'fillDisplay', 'keyDisplay', 'chromaColor', 'chromaSafe', 'ndiSignal']) assert.deepEqual(after[k], before[k], k);
  outputs.apply({ mode: 'off' });
});

test('colours close to the key colour are listed', () => {
  colours = [{ name: 'Main colour', hex: '#7f4092' }, { name: 'Highlight', hex: '#ffcd00' }, { name: 'Netball WA green', hex: '#37ab39' },
    { name: 'Panels', hex: '#0f2a12' }, { name: 'Mint', hex: '#cfe8d2' }];
  outputs.apply({ chromaColor: '#00b140' });
  assert.deepEqual(outputs.state().nearKey.map(c => c.name), ['Netball WA green'], 'a strong green; not the dark or pale ones');
  outputs.apply({ chromaColor: '#0047bb' });
  assert.deepEqual(outputs.state().nearKey, [], 'nothing near blue');
  colours = [];
  outputs.apply({ chromaColor: '#00b140' });
});

test('every graphics page loads chroma.js, and the scene filters its frame rather than its key colour', () => {
  const missing = graphicsPages().filter(n => !fs.readFileSync(path.join(ROOT, 'public', n), 'utf8').includes('<script src="chroma.js"></script>'));
  assert.deepEqual(missing, []);
  assert.match(fs.readFileSync(path.join(ROOT, 'public', 'scene.html'), 'utf8'), /<html lang="en" data-chroma-alpha="#stage">/);
});

test('the Mac app opens the chroma outputs chroma key safe', () => {
  const src = fs.readFileSync(path.join(ROOT, 'desktop', 'outputs.js'), 'utf8');
  assert.match(src, /if \(w\.safe\) q\.set\('chromaKey', 'true'\)/);
  assert.match(fs.readFileSync(path.join(ROOT, 'desktop', 'ndi.js'), 'utf8'), /chromaKey: !!w\.safe/);
  assert.match(fs.readFileSync(path.join(ROOT, 'desktop', 'scenewindow.js'), 'utf8'), /chromaKey \? '&chromaKey=true' : ''/);
});

async function launch() {
  if (!chromium) return null;
  try { return await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined }); }
  catch (err) { return { error: err.message.split('\n')[0] }; }
}

// How many pixels of a transparent screenshot are partly see-through, and how many show at all.
const ALPHA_COUNT = `async png => {
  const img = await createImageBitmap(await (await fetch('data:image/png;base64,' + png)).blob());
  const c = new OffscreenCanvas(img.width, img.height), g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, img.width, img.height).data;
  let partly = 0, shown = 0;
  for (let i = 3; i < d.length; i += 4) { if (d[i] > 0) shown++; if (d[i] > 0 && d[i] < 255) partly++; }
  return { partly, shown };
}`;

test('chroma key safe graphics have nothing half see-through, and the normal ones are unchanged', async t => {
  const browser = await launch();
  if (!browser || browser.error) { t.skip(`no browser (${browser ? browser.error : 'playwright is not installed'})`); return; }
  t.after(() => browser.close());
  const studio = await startStudio(t, { competition: 'Thunder League' });
  await studio.until(async () => (await studio.get('/api/scoreboard')).gameId);
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await context.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '', contentType: 'text/css' }));
  const counter = await context.newPage();
  await counter.goto(`${studio.base}/testpattern.html`);
  const count = async page => counter.evaluate(`(${ALPHA_COUNT})(${JSON.stringify((await page.screenshot({ omitBackground: true })).toString('base64'))})`);

  for (const link of ['title.html', 'ladder.html', 'matchup.html', 'winner.html?winner=home', 'supershot.html?team=home', 'streak.html?play=fire', 'logo.html?out=0']) {
    const sep = link.includes('?') ? '&' : '?';
    const plain = await context.newPage();
    const safe = await context.newPage();
    const errors = [];
    safe.on('pageerror', e => errors.push(e.message));
    await Promise.all([plain.goto(`${studio.base}/${link}`), safe.goto(`${studio.base}/${link}${sep}chromaKey=true`)]);
    // Animations come and go, and pages take longer on a busy machine: look a few times.
    let seen = false;
    for (let i = 0; i < 4 && !seen; i++) {
      await Promise.all([plain.waitForTimeout(800), safe.waitForTimeout(800)]);
      const [a, b] = [await count(plain), await count(safe)];
      assert.equal(b.partly, 0, `${link} chroma key safe has no partly see-through pixels`);
      seen = a.partly > 1000 && b.shown > 5000;
    }
    assert.deepEqual(errors, [], link);
    assert.ok(seen, `${link} shows its graphic, with soft edges normally and none chroma key safe`);
    assert.equal(await plain.evaluate(() => document.documentElement.classList.contains('chroma-safe')), false);
    await plain.close();
    await safe.close();
  }

  // Shadows and glows: soft ones go, hard ones stay made solid; glows that fade out go.
  const page = await context.newPage();
  await page.goto(`${studio.base}/title.html?chromaKey=true`);
  const fixes = await page.evaluate(() => {
    const { solidShadows, solidFilter, noGlows } = window.studioChromaSafe;
    return {
      soft: solidShadows('0 6px 16px rgba(0,0,0,.45)'),
      hard: solidShadows('rgba(0, 0, 0, 0.5) 8px 8px 0px, 0 0 30px red'),
      filter: solidFilter('drop-shadow(8px 8px 0 rgba(0, 0, 0, .5)) drop-shadow(0 0 30px rgba(255, 120, 0, .55)) brightness(1.2)'),
      varColour: solidShadows('4px 4px 0 rgba(var(--yellow-rgb), .3)'),
      outline: solidShadows('0 0 0 3px var(--yellow)'),
      glow: noGlows('radial-gradient(circle, rgba(var(--yellow-rgb), .45), rgba(var(--yellow-rgb), 0) 65%)'),
      solidGradient: noGlows('radial-gradient(circle at 50% 45%, var(--purple) 0%, var(--purple-dark) 75%)'),
      panel: getComputedStyle(document.documentElement).getPropertyValue('--purple-deep').trim(),
      shadow: getComputedStyle(document.querySelector('.title')).filter,
    };
  });
  assert.equal(fixes.soft, 'none');
  assert.equal(fixes.hard, '8px 8px 0px rgb(0, 0, 0)');
  assert.equal(fixes.filter, 'drop-shadow(8px 8px 0 rgb(0, 0, 0)) brightness(1.2)');
  assert.equal(fixes.varColour, '4px 4px 0 rgb(var(--yellow-rgb))');
  assert.equal(fixes.outline, '0 0 0 3px var(--yellow)', "a hard outline (the finals' grand final) stays");
  assert.equal(fixes.glow, 'none');
  assert.equal(fixes.solidGradient, 'radial-gradient(circle at 50% 45%, var(--purple) 0%, var(--purple-dark) 75%)', 'a solid gradient stays');
  assert.match(fixes.panel, /^rgb\(/, 'panels are solid');
  assert.equal(fixes.shadow, 'none', "the title's soft shadow is gone");
  await page.close();

  // In a chroma key safe scene, its pages are chroma key safe too, and the scene cuts its frame once.
  await studio.post('/api/scene', { type: 'add', sources: [{ type: 'browser', name: 'Title', url: 'title.html' }] });
  await studio.post('/api/scene', { type: 'show', name: 'Title' });
  const scene = await context.newPage();
  await scene.goto(`${studio.base}/scene.html?chromaKey=true&bg=00b140`);
  await scene.waitForSelector('iframe');
  await scene.waitForTimeout(1500);
  const inScene = await scene.evaluate(() => ({
    stage: getComputedStyle(document.getElementById('stage')).filter,
    root: getComputedStyle(document.documentElement).filter,
    fade: getComputedStyle(document.querySelector('.layer')).transitionDuration,
    page: document.querySelector('iframe').contentDocument.documentElement.classList.contains('chroma-safe'),
    pageFilter: getComputedStyle(document.querySelector('iframe').contentDocument.documentElement).filter,
  }));
  assert.match(inScene.stage, /url\(.*studio-chroma-alpha/);
  assert.equal(inScene.root, 'none', 'not the key colour behind it');
  assert.equal(inScene.fade, '0s', 'sources cut');
  assert.equal(inScene.page, true);
  assert.equal(inScene.pageFilter, 'none', 'the scene cuts the frame, not each page');
  await scene.close();
  await context.close();
});
