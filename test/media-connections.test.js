// Videos and sound share the browser's six connections to Studio with every page and request (scene.js sendMedia).
// A file is sent in pieces, so a video waiting to play gives its connection back: several scene windows, each with a
// few videos ready, used to hold all six, and the Output page's Next and Play waited 15 s or more behind them.
// The browser: as in pages.test.js (Playwright's own, or STUDIO_TEST_CHROMIUM).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startStudio } = require('./support/studio');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* not installed */ }

async function launch(t) {
  let browser = null, why = 'playwright is not installed';
  if (chromium) {
    try { browser = await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined, args: ['--autoplay-policy=no-user-gesture-required'] }); }
    catch (err) { why = err.message.split('\n')[0]; }
  }
  if (!browser) {
    if (process.env.STUDIO_TEST_REQUIRE_BROWSER) assert.fail(`no browser to test the pages in: ${why}`);
    t.skip(`no browser to test the pages in (${why}); run npx playwright install chromium`);
    return null;
  }
  t.after(() => browser.close());
  return browser;
}

// sec seconds of quiet as a WAV, at CD quality so it's a big file like a video.
function quiet(sec) {
  const rate = 44100, bytes = Math.round(rate * sec) * 4, wav = Buffer.alloc(44 + bytes);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + bytes, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(bytes, 40);
  return wav;
}

test('scene windows full of videos leave connections for the Output page', async t => {
  const browser = await launch(t);
  if (!browser) return;
  const studio = await startStudio(t);
  fs.mkdirSync(path.join(studio.dataDir, 'media'), { recursive: true });
  const names = ['Ad 1.wav', 'Ad 2.wav', 'Ad 3.wav'];
  const wav = quiet(240); // about 42 MB
  for (const n of names) fs.writeFileSync(path.join(studio.dataDir, 'media', n), wav);
  const r = await studio.request('POST', '/api/scene', { type: 'add', sources: names.map(n => ({ type: 'video', name: n, file: n, loop: true })) });
  assert.equal(r.status, 200, JSON.stringify(r.json));

  // Four outputs, each with its three videos loaded and waiting (as on Matt's Mac: 3 NDI and a chroma key display),
  // all in one browser, as the Mac app's windows are.
  const context = await browser.newContext();
  t.after(() => context.close());
  for (let i = 0; i < 4; i++) {
    const page = await context.newPage();
    await page.goto(`${studio.base}/scene.html?mute=1`);
    await page.waitForFunction(() => document.querySelectorAll('video').length === 3 && [...document.querySelectorAll('video')].every(v => v.readyState >= 1));
  }
  const output = await context.newPage();
  await output.goto(`${studio.base}/api/version`, { timeout: 5000 });
  const took = await output.evaluate(async () => {
    const times = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      await Promise.race([fetch('/api/health', { cache: 'no-store' }), new Promise((_, no) => setTimeout(() => no(new Error('waited 5 s')), 5000))]);
      times.push(Math.round(performance.now() - t0));
    }
    return times;
  });
  assert.ok(Math.max(...took) < 1000, `requests took ${took.join(', ')} ms`);
});

test('a media file comes in pieces of at most 2 MB, and asked-for ranges still come back as asked', async t => {
  const studio = await startStudio(t);
  fs.mkdirSync(path.join(studio.dataDir, 'media'), { recursive: true });
  const size = 5 * 1024 * 1024;
  fs.writeFileSync(path.join(studio.dataDir, 'media', 'Clip.mp4'), Buffer.alloc(size, 7));
  const get = async range => {
    const r = await fetch(`${studio.base}/media/Clip.mp4`, { headers: range ? { range } : {} });
    return { status: r.status, range: r.headers.get('content-range'), bytes: (await r.arrayBuffer()).byteLength };
  };
  const MB2 = 2 * 1024 * 1024;
  assert.deepEqual(await get(''), { status: 200, range: null, bytes: size }, 'no range: the whole file (a download)');
  assert.deepEqual(await get('bytes=0-'), { status: 206, range: `bytes 0-${MB2 - 1}/${size}`, bytes: MB2 });
  assert.deepEqual(await get(`bytes=${MB2}-`), { status: 206, range: `bytes ${MB2}-${2 * MB2 - 1}/${size}`, bytes: MB2 });
  assert.deepEqual(await get(`bytes=${2 * MB2}-`), { status: 206, range: `bytes ${2 * MB2}-${size - 1}/${size}`, bytes: size - 2 * MB2 }, 'the last piece');
  assert.deepEqual(await get('bytes=100-199'), { status: 206, range: `bytes 100-199/${size}`, bytes: 100 });
  assert.deepEqual(await get('bytes=-10'), { status: 206, range: `bytes ${size - 10}-${size - 1}/${size}`, bytes: 10 });
  assert.equal((await get(`bytes=${size}-`)).status, 416);
});
