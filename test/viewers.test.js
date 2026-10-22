// Live viewers (viewers.js): a competition's streams on YouTube and Facebook, read from stand-in APIs, added up,
// recorded while on air, and turned into viewer-minutes in the sponsor report (exposure.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

process.env.FIRSTPASS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-viewers-'));
process.env.FIRSTPASS_LOCAL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-viewers-local-'));

// Stand-in YouTube Data API and Facebook Graph API.
const calls = [];
const world = { ytLive: true, ytViewers: 150, fbLive: true, fbViewers: 54 };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  calls.push(u.pathname);
  const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (u.pathname.startsWith('/yt/')) {
    if (u.searchParams.get('key') !== 'yt-key') return json(400, { error: { message: 'API key not valid. Please pass a valid API key.' } });
    if (u.pathname === '/yt/channels') return json(200, { items: u.searchParams.get('forHandle') === '@pivt' ? [{ id: 'UCaaaaaaaaaaaaaaaaaaaaaa' }] : [] });
    if (u.pathname === '/yt/search') return json(200, { items: world.ytLive ? [{ id: { videoId: 'abcdefghijk' } }] : [] });
    if (u.pathname === '/yt/videos') return json(200, { items: [{ snippet: { title: 'Thunder League Round 6' },
      liveStreamingDetails: world.ytLive ? { concurrentViewers: String(world.ytViewers) } : { actualEndTime: '2026-10-24T10:00:00Z' } }] });
  }
  if (u.pathname === '/fb/thunderleague/live_videos') {
    if (u.searchParams.get('access_token') !== 'fb-token') return json(400, { error: { message: 'Invalid OAuth access token.' } });
    return json(200, { data: world.fbLive ? [{ id: '99', title: 'Live', live_views: world.fbViewers }] : [] });
  }
  json(404, { error: { message: 'Not found' } });
});

let competitions, viewers, exposure, comp;
test.before(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.FIRSTPASS_YOUTUBE_API = `${base}/yt`;
  process.env.FIRSTPASS_FACEBOOK_API = `${base}/fb`;
  competitions = require('../competitions');
  viewers = require('../viewers');
  exposure = require('../exposure');
  competitions.init(() => {});
  comp = competitions.create('Thunder League');
  competitions.setActive(comp);
});
test.after(() => server.close());

test('a YouTube "where" can be a channel ID, a handle or a video link', () => {
  assert.deepEqual(viewers.youtubeWhere('https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa'), { channel: 'UCaaaaaaaaaaaaaaaaaaaaaa' });
  assert.deepEqual(viewers.youtubeWhere('https://youtube.com/@pivt'), { handle: '@pivt' });
  assert.deepEqual(viewers.youtubeWhere('https://www.youtube.com/watch?v=abcdefghijk&t=3'), { video: 'abcdefghijk' });
  assert.deepEqual(viewers.youtubeWhere('https://youtu.be/abcdefghijk'), { video: 'abcdefghijk' });
  assert.deepEqual(viewers.youtubeWhere('https://www.youtube.com/live/abcdefghijk'), { video: 'abcdefghijk' });
  assert.equal(viewers.facebookPage('https://www.facebook.com/thunderleague/'), 'thunderleague');
  assert.equal(viewers.facebookPage('https://www.facebook.com/profile.php?id=1234'), '1234');
});

test('streams on several platforms are read and added up; keys stay on this Mac, out of the settings and templates', async () => {
  competitions.save(comp, { streams: [{ platform: 'youtube', name: 'PIVT YouTube', where: '@pivt' }, { platform: 'facebook', name: 'Thunder Facebook', where: 'facebook.com/thunderleague' }] });
  const ids = competitions.get(comp).streams.map(s => s.id);
  assert.deepEqual(ids, ['youtube-1', 'facebook-1']);

  let st = await viewers.check(comp);
  assert.deepEqual(st.streams.map(s => s.error), ['Add a YouTube API key', 'Add a Page access token']);
  assert.equal(st.total, 0);

  viewers.saveKeys(comp, { 'youtube-1': 'yt-key', 'facebook-1': 'fb-token', gone: 'x' });
  assert.ok(fs.existsSync(viewers.KEYS_FILE) && viewers.KEYS_FILE.startsWith(process.env.FIRSTPASS_LOCAL_DIR));
  assert.deepEqual(JSON.parse(fs.readFileSync(viewers.KEYS_FILE, 'utf8')), { [comp]: { 'youtube-1': 'yt-key', 'facebook-1': 'fb-token' } });
  assert.doesNotMatch(JSON.stringify(competitions.exportTemplate(comp)), /yt-key|fb-token/);

  calls.length = 0;
  st = await viewers.check(comp);
  assert.deepEqual(st.streams.map(s => [s.live, s.count, s.error, s.hasKey]), [[true, 150, '', true], [true, 54, '', true]]);
  assert.equal(st.total, 204);
  assert.equal(st.live, 2);
  assert.deepEqual(calls.sort(), ['/fb/thunderleague/live_videos', '/yt/channels', '/yt/search', '/yt/videos'].sort());

  calls.length = 0;
  world.ytViewers = 180;
  st = await viewers.check(comp);
  assert.equal(st.total, 234);
  assert.ok(!calls.includes('/yt/search'), 'the live video is remembered: only the cheap videos call each time');
});

test('a stream that ends stops counting, and its channel is only searched again 5 minutes later', async () => {
  world.ytLive = false;
  let st = await viewers.check(comp);
  assert.deepEqual([st.streams[0].live, st.total], [false, 54]);
  calls.length = 0;
  world.ytLive = true;
  st = await viewers.check(comp);
  assert.ok(!calls.includes('/yt/search'), 'not searched again straight away (100 units a search)');
  st = await viewers.check(comp, Date.now() + 5 * 60 * 1000 + 1);
  assert.equal(st.total, 234);
});

test('a bad key says so, and the other streams still count', async () => {
  viewers.saveKeys(comp, { 'facebook-1': 'wrong' });
  const st = await viewers.check(comp);
  assert.equal(st.streams[1].error, 'Invalid OAuth access token.');
  assert.equal(st.total, 180);
  viewers.saveKeys(comp, { 'facebook-1': 'fb-token' });
});

test('readings are only taken on air, and give each sponsor viewer-minutes in the report', async () => {
  const sponsors = require('../sponsors');
  const recorded = [];
  let air = false;
  viewers.init(() => {}, { onAir: () => air, record: s => recorded.push(s.total), every: 0 });
  await viewers.tick();
  assert.deepEqual(recorded, [], 'off air: PlayHQ-style quiet, no calls');
  air = true;
  await viewers.tick();
  assert.deepEqual(recorded, [234]);

  // 200 watching for 2 minutes, then 300 for 1 minute, while Golds is on screen for all 3 minutes.
  const golds = sponsors.save({ name: 'Golds Bakery', competitions: { [comp]: { tier: 'naming' } } });
  const t0 = new Date(2026, 9, 24, 19, 0, 0).getTime();
  const reading = (at, n) => exposure.viewers({ competition: comp, total: n, streams: [{ id: 'youtube-1', live: true, count: n }] }, at);
  for (let s = 0; s < 120; s += 30) reading(t0 + s * 1000, 200);
  for (let s = 120; s < 180; s += 30) reading(t0 + s * 1000, 300);
  fs.appendFileSync(path.join(exposure.DIR, '2026-10-24.jsonl'), JSON.stringify({ t: 'seen', s: golds.id, c: comp, p: 'scoreboard', src: 'Scoreboard', from: t0, to: t0 + 180000, air: true, qr: false }) + '\n');
  const r = exposure.report({ nights: ['2026-10-24'], competition: comp });
  assert.equal(r.sponsors.find(s => s.name === 'Golds Bakery').viewerMinutes, 700);
  assert.deepEqual(r.viewers, { peak: 300, average: 233, readings: 6 });
});

test('the viewers graphic shows the total over the minimum, hides under it, and shows tonight\'s peak', async t => {
  let chromium = null, browser = null;
  try { ({ chromium } = require('playwright')); browser = await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined }); } catch { browser = null; }
  if (!browser) {
    if (process.env.STUDIO_TEST_REQUIRE_BROWSER) assert.fail('no browser to test the pages in');
    t.skip('no browser to test the pages in; run npx playwright install chromium');
    return;
  }
  t.after(() => browser.close());
  const { startStudio } = require('./support/studio');
  const studio = await startStudio(t, { competition: 'Thunder League', env: { FIRSTPASS_YOUTUBE_API: process.env.FIRSTPASS_YOUTUBE_API, FIRSTPASS_FACEBOOK_API: process.env.FIRSTPASS_FACEBOOK_API } });
  const id = (await studio.get('/api/sponsors')).competition.id;
  const setup = await studio.get(`/api/setup/${id}`);
  await studio.post(`/api/setup/${id}`, { ...setup.settings, streams: [{ platform: 'youtube', name: 'PIVT', where: '@pivt' }], viewersMinimum: 100 });
  await studio.post('/api/viewers/keys', { competition: id, keys: { 'youtube-1': 'yt-key' } });
  world.ytLive = true; world.ytViewers = 150;
  const v = await studio.get('/api/viewers?check=1');
  assert.deepEqual([v.total, v.minimum, v.peak.n], [150, 100, 150]);

  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.route(url => !String(url).startsWith(studio.base), route => route.fulfill({ status: 200, body: '' }));
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  const look = async link => {
    await page.goto(`${studio.base}/${link}`);
    await page.waitForTimeout(1800);
    return page.evaluate(() => ({ now: document.getElementById('now').classList.contains('on') ? document.getElementById('nowN').textContent : '',
      peak: document.getElementById('peak').hidden ? '' : document.getElementById('peakN').textContent + ' ' + document.getElementById('peakSub').textContent }));
  };
  assert.deepEqual(await look('viewers.html'), { now: '150', peak: '' });
  assert.deepEqual(await look('viewers.html?min=200'), { now: '', peak: '' }, 'under the minimum: hidden');
  assert.deepEqual(await look('viewers.html?show=peak'), { now: '', peak: '150 watching live on YouTube' });
  assert.deepEqual(errors, []);
});
