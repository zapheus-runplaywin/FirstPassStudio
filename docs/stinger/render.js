// FirstPass Studio - renders the stinger (public/stinger.html) to a 1080p ProRes 4444 file with alpha, for a switcher
// or player that plays stingers from a file.
//
// Run from the repository:  node docs/stinger/render.js "Thunder League" [out.mov] [--fps 50] [--length 1] [--logo 0]
// The competition is a template in templates/. Studio is started in a folder of its own for the run (against the
// stand-in PlayHQ the tests use), the page is opened in Chromium and each frame is drawn by seeking its animations,
// so every frame is exact whatever the machine's speed. Needs ffmpeg with the prores_ks encoder on the PATH (or
// FFMPEG=), and Chromium from Playwright (STUDIO_TEST_CHROMIUM= for another one).
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { chromium } = require('playwright');
const { startStudio } = require('../../test/support/studio');

const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf('--' + name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
const fps = Number(flag('fps', 50));
const length = Number(flag('length', 1));
const logo = flag('logo', '1');
const [competition, outArg] = args;
if (!competition) { console.error('Usage: node docs/stinger/render.js "<template name>" [out.mov] [--fps 50] [--length 1] [--logo 0]'); process.exit(1); }
const out = path.resolve(outArg || path.join(__dirname, `${competition} stinger.mov`));
const ffmpeg = process.env.FFMPEG || 'ffmpeg';

(async () => {
  const studio = await startStudio(null, { competition });
  const frames = fs.mkdtempSync(path.join(os.tmpdir(), 'stinger-frames-'));
  let browser;
  try {
    browser = await chromium.launch(process.env.STUDIO_TEST_CHROMIUM ? { executablePath: process.env.STUDIO_TEST_CHROMIUM } : {});
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const q = new URLSearchParams({ length: String(length), sfx: '0', ...(logo === '0' ? { logo: '0' } : {}) });
    await page.goto(`${studio.base}/stinger.html?${q}`);
    await page.waitForSelector('.stage.go', { state: 'attached' });
    await page.evaluate(() => document.getAnimations().forEach(a => a.pause()));
    const count = Math.round(length * fps);
    for (let i = 0; i < count; i++) {
      // Animation time runs at playbackRate, so real time t is t * rate on each animation's own clock.
      await page.evaluate(ms => document.getAnimations().forEach(a => { a.currentTime = ms * a.playbackRate; }), i * 1000 / fps);
      await page.screenshot({ path: path.join(frames, `f${String(i).padStart(4, '0')}.png`), omitBackground: true });
    }
    const cover = await page.evaluate(() => window.stingerCover);
    const r = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(frames, 'f%04d.png'),
      '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-alpha_bits', '16', '-vendor', 'apl0',
      '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', out], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('ffmpeg failed' + (r.error ? `: ${r.error.message}` : ''));
    console.log(`Saved ${out}: ${count} frames at ${fps} fps, frame covered from ${cover[0].toFixed(2)} s to ${cover[1].toFixed(2)} s ` +
      `(frames ${Math.ceil(cover[0] * fps)} to ${Math.floor(cover[1] * fps)})`);
  } finally {
    if (browser) await browser.close();
    fs.rmSync(frames, { recursive: true, force: true });
    await studio.stop();
  }
})().catch(err => { console.error(err.message || err); process.exitCode = 1; });
