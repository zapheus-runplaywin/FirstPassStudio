// Fonts other than Montserrat measure like it (fonts.js normalise): font files are measured, every
// font's capitals are sized to Montserrat's (narrow fonts a little taller, and the setup's Text
// size on top) and sit in a line box as tall as Montserrat's, centred as Montserrat's are. The
// last test checks it in a real browser (Chromium, through Playwright), as pages.test.js does.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fonts = require('../fonts');
const { startStudio } = require('./support/studio');

const file = (id, name) => fs.readFileSync(path.join(fonts.VENDOR, id, name));
const near = (a, b, within, what) => assert.ok(Math.abs(a - b) <= within, `${what}: ${a} is not ${b} (±${within})`);
// The numbers in a font's normalising descriptors.
const descriptors = css => Object.fromEntries([...css.matchAll(/(size-adjust|ascent-override|descent-override|line-gap-override): ([\d.]+)%/g)].map(([, k, v]) => [k, v / 100]));

test('fonts: a font file\'s cap height, line box and capitals\' width are read from it', () => {
  const m = fonts.fileMetrics(file('montserrat', 'montserrat-latin-wght-normal.woff2'));
  assert.deepEqual({ capHeight: m.capHeight, ascent: m.ascent, descent: m.descent, lineGap: m.lineGap }, { capHeight: 0.7, ascent: 0.968, descent: 0.251, lineGap: 0 });
  assert.ok(m.capsWidth > 0.6 && m.capsWidth < 0.8, `Montserrat's capitals are wide (${m.capsWidth})`);
  assert.equal(fonts.fileMetrics(file('raleway', 'raleway-latin-wght-normal.woff2')).capHeight, 0.71);
  assert.equal(fonts.fileMetrics(Buffer.from('wOF2 not a font')), null, 'not a font: left as it is');
});

test('fonts: a font that unpacks to far more than any real font is left unmeasured, quickly', t => {
  const zlib = require('node:zlib');
  // 256 MB of nothing packs into a few hundred bytes, as a WOFF2 whose one table claims to be small...
  const huge = 256 * 1024 * 1024;
  const packed = zlib.brotliCompressSync(Buffer.alloc(huge), { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 1 } });
  const woff2 = (sfntSize, length) => {
    const head = Buffer.alloc(48);
    head.write('wOF2', 0, 'latin1');
    head.writeUInt32BE(0x00010000, 4);
    head.writeUInt16BE(3, 12);              // three tables
    head.writeUInt32BE(sfntSize, 16);       // what it says it unpacks to
    head.writeUInt32BE(packed.length, 20);
    // The tables measuring needs: head, hhea and OS/2 (flags 1, 2 and 6, untransformed), each its length in base 128.
    const b128 = [];
    for (let v = length; ; v = Math.floor(v / 128)) { b128.unshift(v % 128); if (v < 128) break; }
    const len = b128.map((b, i) => (i < b128.length - 1 ? b | 0x80 : b));
    const dir = Buffer.from([1, ...len, 2, ...len, 6, ...len]);
    return Buffer.concat([head, dir, packed]);
  };
  // Every unpacking is watched: how much it was let unpack to.
  const calls = [];
  for (const name of ['brotliDecompressSync', 'inflateSync']) {
    const real = zlib[name];
    zlib[name] = (data, opts) => { calls.push([name, opts && opts.maxOutputLength]); return real(data, opts); };
    t.after(() => { zlib[name] = real; });
  }
  for (const [what, buf, unpacked] of [['saying how big it is', woff2(huge, 54), 0], ['saying it is small', woff2(1000, 54), 1]]) {
    calls.length = 0;
    const t0 = Date.now();
    assert.equal(fonts.fileMetrics(buf), null, what);
    assert.ok(Date.now() - t0 < 1000, `${what}: took ${Date.now() - t0} ms`);
    assert.equal(calls.length, unpacked, `${what}: unpacked ${calls.length} times`);
    for (const [, max] of calls) assert.ok(max > 0 && max <= 64 * 1024 * 1024, `${what}: let unpack to ${max}`);
  }
  calls.length = 0;
  // A WOFF table that says it unpacks to 256 MB.
  const table = zlib.deflateSync(Buffer.alloc(huge, 0), { level: 1 });
  const woff = Buffer.alloc(44 + 3 * 20);
  woff.write('wOFF', 0, 'latin1');
  woff.writeUInt16BE(3, 12);
  ['head', 'hhea', 'OS/2'].forEach((tag, i) => {
    const at = 44 + i * 20;
    woff.write(tag, at, 'latin1');
    woff.writeUInt32BE(woff.length, at + 4); woff.writeUInt32BE(table.length, at + 8); woff.writeUInt32BE(huge, at + 12);
  });
  const t0 = Date.now();
  assert.equal(fonts.fileMetrics(Buffer.concat([woff, table])), null, 'WOFF');
  assert.ok(Date.now() - t0 < 1000, `WOFF: took ${Date.now() - t0} ms`);
  assert.equal(calls.length, 0, 'the WOFF table is never unpacked');
});

test('fonts: normalising sizes capitals to Montserrat\'s and centres them in Montserrat\'s line box', () => {
  const ref = { capHeight: 0.7, ascent: 0.968, descent: 0.251, lineGap: 0 };
  // A font with small capitals and a deep descent, like Teko.
  const teko = { capHeight: 0.626, ascent: 0.958, descent: 0.475, lineGap: 0 };
  for (const size of [1, 1.2]) {
    const d = descriptors(fonts.normalise(teko, size)), scale = d['size-adjust'];
    near(teko.capHeight * scale, ref.capHeight * size, 0.001, 'cap height');
    // The overrides are scaled by size-adjust, so what the browser uses is override x size-adjust.
    const ascent = d['ascent-override'] * scale, descent = d['descent-override'] * scale;
    near(ascent + descent, ref.ascent + ref.descent, 0.001, 'line box as tall as Montserrat\'s');
    near((ascent - descent - teko.capHeight * scale) / 2, (ref.ascent - ref.descent - ref.capHeight) / 2, 0.001, 'capitals centred as Montserrat\'s are');
    assert.equal(d['line-gap-override'], 0);
  }
  assert.equal(fonts.normalise(null), '', 'not measured: left as it is');
  assert.equal(fonts.normalise({ capHeight: 0 }), '');
});

test('fonts: a narrow font stands taller, by up to a fifth; a wide one doesn\'t', () => {
  assert.equal(fonts.narrowBoost([{ weight: 400, metrics: { capHeight: 0.7, capsWidth: 0.39 } }]), 1.2, 'Bebas Neue');
  assert.equal(fonts.narrowBoost([{ weight: 400, metrics: { capHeight: 0.7, capsWidth: 0.9 } }]), 1, 'wider than Montserrat');
  const oswald = fonts.narrowBoost([{ weight: 400, metrics: { capHeight: 0.81, capsWidth: 0.6 } }]);
  assert.ok(oswald > 1 && oswald < 1.2, String(oswald));
  // The face nearest Regular decides, so every weight of a family is boosted alike.
  assert.equal(fonts.narrowBoost([{ weight: 700, metrics: { capHeight: 0.7, capsWidth: 0.9 } }, { weight: 400, metrics: { capHeight: 0.7, capsWidth: 0.39 } }]), 1.2);
  assert.equal(fonts.narrowBoost([{ weight: 400, metrics: null }]), 1, 'not measured');
});

test('fonts: theme.css normalises a bundled font, an added font file and a Mac font, but not Montserrat', () => {
  assert.doesNotMatch(fonts.css('Montserrat'), /@font-face/, 'Montserrat is the measure');
  const raleway = fonts.css('Raleway');
  assert.match(raleway, /^@import url\("\/vendor\/fonts\/montserrat\/montserrat\.css"\);$/m);
  assert.match(raleway, /font-family: 'Raleway';[^}]*src: url\("\/vendor\/fonts\/raleway\/raleway-latin-wght-normal\.woff2"\)[^}]*size-adjust: [\d.]+%; ascent-override/);
  // An added font file, by its path, is measured; the Text size makes it bigger.
  const added = path.join(fonts.VENDOR, 'raleway', 'raleway-latin-wght-normal.woff2');
  const at100 = descriptors(fonts.faces('raleway', [added], f => '/fonts/' + path.basename(f)));
  const at120 = descriptors(fonts.faces('raleway', [added], f => '/fonts/' + path.basename(f), 1.2));
  near(at120['size-adjust'] / at100['size-adjust'], 1.2, 0.001, 'Text size 120%');
  // A Mac font gets faces of its own (found by PostScript name), named apart from the font itself,
  // which comes next in the font list in case a face isn't found.
  const mac = [{ name: 'Gotham-Bold', weight: 700, italic: false, capHeight: 0.66, ascent: 0.95, descent: 0.25, lineGap: 0, capsWidth: 0.7 }];
  const css = fonts.css('Gotham', [], undefined, { mac });
  assert.match(css, /@font-face { font-family: "Studio Gotham"; font-style: normal; font-weight: 700; font-display: block; src: local\("Gotham-Bold"\); size-adjust: /);
  assert.equal(fonts.stack('Gotham', mac), '"Studio Gotham", "Gotham", "Montserrat", "Segoe UI", "Helvetica Neue", Arial, sans-serif');
  assert.equal(fonts.stack('Gotham'), '"Gotham", "Montserrat", "Segoe UI", "Helvetica Neue", Arial, sans-serif');
});

test('fonts: the Mac measures its own fonts', { skip: process.platform !== 'darwin' && 'only on a Mac' }, async () => {
  const faces = await fonts.macFaces('Helvetica Neue');
  assert.ok(faces.length > 0, 'Helvetica Neue has faces');
  for (const f of faces) {
    assert.ok(f.name && !/["\\]/.test(f.name), f.name);
    assert.ok(f.capHeight > 0.5 && f.capHeight < 0.9 && f.ascent > 0.5 && f.descent > 0, JSON.stringify(f));
  }
  assert.ok(faces.some(f => f.weight === 700 && !f.italic), 'a bold face');
  assert.deepEqual(await fonts.macFaces('Montserrat'), [], 'Montserrat is bundled');
});

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* not installed */ }

test('fonts: in the browser, another font\'s capitals and line box match Montserrat\'s', async t => {
  let browser = null;
  try { browser = chromium && await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined }); } catch { /* none */ }
  if (!browser) {
    if (process.env.STUDIO_TEST_REQUIRE_BROWSER) assert.fail('no browser to test the fonts in');
    t.skip('no browser to test the fonts in; run npx playwright install chromium');
    return;
  }
  t.after(() => browser.close());
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const id = studio.competition.id;
  const page = await browser.newPage();
  await page.goto(studio.base + '/testpattern.html');
  const measure = () => page.evaluate(async () => {
    const theme = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/theme.css?' + Date.now() });
    await new Promise(r => { theme.onload = r; document.head.append(theme); });
    document.body.innerHTML = '<span id="m" style="font: 800 200px Montserrat; line-height: normal">H</span>' +
      '<span id="f" style="font-family: var(--font); font-weight: 800; font-size: 200px; line-height: normal">H</span>';
    const family = getComputedStyle(document.getElementById('f')).fontFamily;
    await document.fonts.load('800 200px Montserrat'); await document.fonts.load(`800 200px ${family}`);
    const cap = font => { const c = document.createElement('canvas').getContext('2d'); c.font = font; return c.measureText('H').actualBoundingBoxAscent; };
    const box = s => document.getElementById(s).getBoundingClientRect().height;
    return { montserrat: { cap: cap('800 200px Montserrat'), box: box('m') }, font: { cap: cap(`800 200px ${family}`), box: box('f') } };
  });
  for (const [font, fontSize] of [['Raleway', 100], ['Raleway', 120]]) {
    await studio.post(`/api/setup/${id}`, { ...(await studio.get(`/api/setup/${id}`)).settings, font, fontSize });
    const m = await measure();
    const boost = fonts.narrowBoost([{ weight: null, metrics: fonts.fileMetrics(file('raleway', 'raleway-latin-wght-normal.woff2')) }]);
    near(m.font.box, m.montserrat.box, 1, `${font} ${fontSize}%: line box`);
    near(m.font.cap, m.montserrat.cap * boost * fontSize / 100, 2, `${font} ${fontSize}%: capitals`);
  }
});
