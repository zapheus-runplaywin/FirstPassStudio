// A phone as a backup commentator headset (phonemic.ts, commentator.html, scene.html): the phone's first offer adds a
// mic for it, Output 1's window answers and mixes what it sends and sends Output 1's sound back (without the phone's
// own voice), and a dropped connection says so on its card and the board. Chromium's stand-in microphone plays a beep; the "phone" here is this Mac (localhost is a secure page too).
// The browser: as in pages.test.mts (Playwright's own, or STUDIO_TEST_CHROMIUM).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startStudio, type Json } from './support/studio.mts';
import * as access from '../out/access.js';
import type { BrowserType } from 'playwright';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let chromium: BrowserType | null = null;
try { ({ chromium } = require('playwright') as typeof import('playwright')); } catch { /* not installed */ }

// A minute of a 440 Hz tone, for the music.
function toneWav(sec: number) {
  const rate = 48000, n = rate * sec, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * 12000), 44 + i * 2);
  return b;
}

const SDP = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n';

test('the hand-over: an offer adds the phone\'s mic once, Output 1 takes it and answers, the phone collects the answer', async t => {
  const studio = await startStudio(t);
  assert.equal((await studio.request('POST', '/api/phonemic/offer', { sdp: 'nonsense' })).status, 409);
  const first = await studio.post('/api/phonemic/offer', { sdp: SDP });
  assert.equal(first.mic, 'This Mac');
  const mics = (await studio.get('/api/scene')).mics.mics;
  assert.deepEqual(mics.map((m: Json) => [m.name, m.on, m.phone, m.channel]), [['This Mac', 'phone', 'this-mac', 'both']]);
  assert.match((await studio.get(`/api/phonemic/${first.session}`)).why, /Output 1/, 'says what it waits for');
  // Starting again replaces the offer, and doesn't add a second mic.
  const again = await studio.post('/api/phonemic/offer', { sdp: SDP });
  assert.equal((await studio.get('/api/scene')).mics.mics.length, 1);
  const offers = (await studio.get('/api/phonemic/offers')).offers;
  assert.deepEqual(offers.map((o: Json) => [o.session, o.mic]), [[again.session, mics[0].id]]);
  assert.equal((await studio.request('GET', `/api/phonemic/${first.session}`)).status, 404, 'the old one is gone');
  await studio.post(`/api/phonemic/${again.session}/answer`, { sdp: SDP.replace('o=- 1', 'o=- 9') });
  assert.match((await studio.get(`/api/phonemic/${again.session}`)).answer, /o=- 9/);
  assert.deepEqual((await studio.get('/api/phonemic/offers')).offers, []);
  // Any allowed device may start a phone mic; only this Mac sees the offers.
  assert.equal(access.refusal(false, 'POST', '/api/phonemic/offer', '192.168.1.50', new Set(['127.0.0.1']), 'scoring'), null);
  assert.match(access.refusal(false, 'POST', '/api/phonemic/offer', '192.168.1.50', new Set(['127.0.0.1']), null)!, /refused/);
  assert.match(access.notThisMac('GET', '/api/phonemic/offers', '192.168.1.50', new Set(['127.0.0.1']))!, /only be seen/);
});

test('the Commentator page sends the phone\'s mic to Output 1, which mixes it; a dropped phone says so', async t => {
  let browser = null, why = 'playwright is not installed';
  if (chromium) {
    try {
      browser = await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined,
        args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
    } catch (err) { why = (err as Error).message.split('\n')[0]; }
  }
  if (!browser) {
    if (process.env.STUDIO_TEST_REQUIRE_BROWSER) assert.fail(`no browser to test the pages in: ${why}`);
    t.skip(`no browser to test the pages in (${why}); run npx playwright install chromium`);
    return;
  }
  t.after(() => browser.close());
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-phone-'));
  fs.mkdirSync(path.join(dataDir, 'media'));
  fs.writeFileSync(path.join(dataDir, 'media', 'Tone.wav'), toneWav(60));
  fs.writeFileSync(path.join(dataDir, 'media', 'Short.wav'), toneWav(3));
  const studio = await startStudio(t, { dataDir, removeDataDir: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  t.after(() => context.close());
  await context.grantPermissions(['microphone'], { origin: studio.base });
  await context.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '', contentType: 'text/css' }));

  const output = await context.newPage();
  await output.goto(`${studio.base}/scene.html?fit=1&bg=000000`, { waitUntil: 'load' });
  const phone = await context.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.goto(`${studio.base}/commentator.html`);
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth), 390, 'nothing sticks out sideways');
  assert.equal(await phone.isHidden('#err'), true, 'a secure page: no warning');
  await phone.click('#start');
  await phone.waitForFunction(() => document.getElementById('word')!.textContent === 'On air', null, { timeout: 15000 });
  assert.match((await phone.textContent('#why'))!, /Studio hears you as This Mac/);

  // Output 1 mixes it: the beep comes through to its meter.
  const id = (await studio.get('/api/scene')).mics.mics[0].id; // the phone's
  const heard = await studio.until(async () => { const l = await studio.get('/api/scene/mics/live'); return l.levels[id] > -60 && l; }, 15000);
  assert.equal(heard.problems[id], undefined);
  assert.equal(await output.evaluate(m => sceneSound().micChains.has(m), id), true);

  // Muted on the Mac: the phone says so.
  await studio.post('/api/scene', { type: 'micMute', mic: id, value: 'on' });
  await phone.waitForFunction(() => document.getElementById('word')!.textContent === 'Muted in Studio', null, { timeout: 5000 });
  await studio.post('/api/scene', { type: 'micMute', mic: id, value: 'off' });

  // Hear Studio: the phone hears Output 1 back, never its own voice. Alone, nothing comes back; a mic on the Mac does.
  await phone.waitForFunction(() => typeof backLevel === 'function' && document.getElementById('hearOn')!.getAttribute('aria-pressed') === 'true');
  // The stand-in mic beeps once a second: listen for the loudest moment over a few seconds.
  const loudest = () => phone.evaluate(() => new Promise<number>(r => { let max = -100; const t = setInterval(() => { max = Math.max(max, backLevel()); }, 5); setTimeout(() => { clearInterval(t); r(max); }, 3000); }));
  await phone.waitForTimeout(1000);
  assert.ok(await loudest() < -60, 'its own voice doesn\'t come back');
  // It plays straight to the phone's output (no mixer on the page), so the phone's volume buttons set it.
  assert.deepEqual(await phone.evaluate(() => { const a = document.querySelector('audio'); return a && [!!a.srcObject, a.muted, a.paused]; }), [true, false, false]);
  assert.match((await phone.textContent('#hearPct'))!, /volume buttons/);
  // It asks for Studio's sound as music (stereo, full bandwidth, 128 kb/s, nothing dropped in the quiet), not as a call.
  const opus = (await output.evaluate(() => [...sceneSound().phones.values()][0].pc.remoteDescription.sdp)).match(/a=fmtp:\d+ ([^\r\n]*useinbandfec=1[^\r\n]*)/)[1].split(';');
  for (const want of ['stereo=1', 'maxaveragebitrate=128000', 'maxplaybackrate=48000', 'usedtx=0']) assert.ok(opus.includes(want), `${want} in ${opus.join(';')}`);
  // The music comes back, and goes on coming back as a playlist moves to its next song (on 9 Nov the next song went
  // missing on the phone, and played twice on the Mac's speakers).
  await studio.post('/api/scene', { type: 'playlistAdd', changes: { name: 'Night', tracks: ['Short.wav', 'Tone.wav'] } });
  await studio.post('/api/scene', { type: 'musicPlaylist', playlist: 'Night', play: true, fade: 0 });
  await studio.until(async () => await loudest() > -60, 20000, 0);
  await output.waitForFunction(() => musicPlayers().music.src === 'Tone.wav' && musicPlayers().music.playing, null, { timeout: 15000 });
  await phone.waitForTimeout(500);
  assert.ok(await loudest() > -60, 'the next song comes back too');
  await studio.post('/api/scene', { type: 'musicStop', fade: 0 });
  await studio.until(async () => await loudest() < -60, 20000, 0);
  // And so does a mic on the Mac.
  await studio.post('/api/scene', { type: 'micAdd', changes: { name: 'Court mic', device: '' } });
  await studio.until(async () => await loudest() > -60, 20000, 0);
  // Off mutes it.
  await phone.click('#hearOff');
  assert.equal(await phone.textContent('#hearPct'), 'Off');
  assert.equal(await phone.evaluate(() => document.querySelector('audio')!.muted), true);
  await phone.click('#hearOn');
  assert.equal(await phone.evaluate(() => document.querySelector('audio')!.muted), false);

  // The Output page: the phone's card, and + Phone mic's QR code (which warns that it needs the secure link here, on http).
  const page = await context.newPage();
  await page.goto(`${studio.base}/output.html`);
  await page.waitForSelector(`[data-mic="${id}"]`);
  await page.waitForFunction(m => /phone \(backup\)/.test(document.querySelector(`[data-mic="${m}"] .where`)!.textContent), id, { timeout: 5000 });
  await page.click('#mxPhone');
  await page.waitForSelector('#pmDialog[open] #pmCode svg');
  assert.match((await page.textContent('#pmLink'))!, /\/pair\.html\?then=%2Fcommentator\.html$/);
  assert.match((await page.textContent('#pmSecure'))!, /Secure phone link/);
  await page.click('#pmDone');

  // The phone goes away: Output 1 says it dropped, on the card and the board.
  await phone.close();
  const dropped = await studio.until(async () => { const l = await studio.get('/api/scene/mics/live'); return /^Dropped/.test(l.problems[id] || '') && l; }, 30000);
  assert.match(dropped.problems[id], /phone lost Studio/);
  await page.waitForFunction(m => /^Dropped/.test(document.querySelector(`[data-mic="${m}"] .where`)!.textContent), id, { timeout: 5000 });
});
