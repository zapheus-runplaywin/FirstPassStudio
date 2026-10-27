// Proof of play (exposure.js): which sponsor each graphic was given, how long it was on screen in the scene,
// on air or not, the QR time and the ad plays, added up by the report (/api/sponsors/report, sponsorreport.html).
const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startStudio } = require('./support/studio');

process.env.FIRSTPASS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-exposure-'));
// 7 pm local on a Saturday: the night is that day's date.
const START = new Date(2026, 9, 24, 19, 0, 0).getTime();
mock.timers.enable({ apis: ['setTimeout', 'Date'], now: START });
const competitions = require('../competitions');
const sponsors = require('../sponsors');
const scene = require('../scene');
const exposure = require('../exposure');
competitions.init(() => {});
const comp = competitions.create('Thunder League');
competitions.setActive(comp);
scene.init(() => {});
let air = true;
exposure.init(() => {}, { showing: scene.showing, onAir: () => air, every: 0 });

const ok = a => assert.equal(scene.apply(a), null, JSON.stringify(a));
const src = name => scene.state().sources.find(s => s.name === name);
const page = link => ({ headers: { referer: `http://studio.local:8080/${link}` } });
// n seconds pass, ticking each second as the helper does.
const pass = n => { for (let i = 0; i < n; i++) { mock.timers.tick(1000); exposure.tick(); } };
const row = (r, name) => r.sponsors.find(s => s.name === name);

const golds = sponsors.save({ name: 'Golds Bakery', website: 'goldsbakery.com.au', targetSeconds: 120, targetPlays: 2, competitions: { [comp]: { tier: 'naming' } } });
const wave = sponsors.save({ name: 'Wave Physio', competitions: { [comp]: { tier: 'major' } } });
ok({ type: 'add', sources: [{ type: 'browser', name: 'Scoreboard', url: 'scoreboard.html' }, { type: 'browser', name: 'Sponsor card', url: 'sponsor.html?title=Thanks' },
  { type: 'browser', name: 'Wall', url: 'sponsorwall.html' }, { type: 'browser', name: 'Game stats', url: 'gamestats.html' }] });

test('a sponsor counts while its graphic is on in the scene, on air; overlapping places count once', () => {
  exposure.gave(page('scoreboard.html'), [golds], 'scoreboard');
  exposure.gave(page('gamestats.html'), [wave], 'stats');
  exposure.gave(page('sponsorwall.html'), [golds, wave], 'wall');
  ok({ type: 'show', id: src('Scoreboard').id });
  pass(90);
  ok({ type: 'show', id: src('Wall').id });
  pass(30);
  ok({ type: 'hide', id: src('Wall').id });
  ok({ type: 'show', id: src('Game stats').id });
  pass(10);
  ok({ type: 'hide', id: src('Game stats').id });
  air = false;            // the video output goes off: not counted
  pass(60);
  ok({ type: 'hide', id: src('Scoreboard').id });
  pass(2);
  air = true;

  const r = exposure.report();
  assert.equal(r.competition.id, comp);
  assert.deepEqual(r.nights, ['2026-10-24']);
  const g = row(r, 'Golds Bakery'), w = row(r, 'Wave Physio');
  assert.equal(g.seconds, 130, 'the scoreboard and the wall at the same time count once');
  assert.deepEqual(g.places, { scoreboard: 130, wall: 30 });
  assert.equal(w.seconds, 40);
  assert.deepEqual(w.places, { wall: 30, stats: 10 });
  assert.deepEqual(g.target, { seconds: 120, plays: 2 });
  assert.equal(r.sponsors[0].name, 'Golds Bakery', 'naming rights first');
  assert.deepEqual(g.showings.map(s => [s.place, s.source, s.seconds]), [['scoreboard', 'Scoreboard', 130], ['wall', 'Wall', 30]], 'stretches saved each minute join up again');

  const all = row(exposure.report({ offAir: true }), 'Golds Bakery');
  assert.equal(all.seconds, 190, 'with off-air time too');
});

test('the sponsor card counts its QR time, and a new sponsor on reload takes over', () => {
  exposure.gave(page('sponsor.html?title=Thanks'), [golds], 'card', { qr: true });
  ok({ type: 'show', id: src('Sponsor card').id });
  pass(20);
  exposure.gave(page('sponsor.html?title=Thanks'), [wave], 'card', { qr: false });
  pass(15);
  ok({ type: 'hide', id: src('Sponsor card').id });
  pass(1);
  const r = exposure.report();
  assert.equal(row(r, 'Golds Bakery').places.card, 20);
  assert.equal(row(r, 'Golds Bakery').qrSeconds, 20);
  assert.equal(row(r, 'Wave Physio').places.card, 15);
  assert.equal(row(r, 'Wave Physio').qrSeconds, 0);
});

test('a place named like a built-in (__proto__) neither breaks the report nor is kept as given', () => {
  // Saved in an older night's file before this was checked, as anyone on the network could ask for it.
  fs.mkdirSync(exposure.DIR, { recursive: true });
  const at = Date.parse('2026-10-20T20:00:00');
  fs.appendFileSync(path.join(exposure.DIR, '2026-10-20.jsonl'), [
    { t: 'seen', s: golds.id, c: comp, p: '__proto__', src: 'Scoreboard', air: true, qr: false, from: at, to: at + 5000 },
    { t: 'seen', s: golds.id, c: comp, p: 'constructor', src: 'Scoreboard', air: true, qr: false, from: at + 5000, to: at + 8000 },
    { t: 'play', s: golds.id, c: comp, file: '__proto__', air: true, from: at, to: at + 1000 },
  ].map(r => JSON.stringify(r)).join('\n') + '\n');
  const g = row(exposure.report({ nights: ['2026-10-20'] }), 'Golds Bakery');
  assert.equal(g.seconds, 8);
  assert.equal(g.places.__proto__, 5);
  assert.equal(g.places.constructor, 3);
  assert.equal(g.adFiles.__proto__, 1);
  // Given now, it is kept as a plain 'graphic'.
  exposure.gave(page('gamestats.html'), [wave], '__proto__');
  ok({ type: 'show', id: src('Game stats').id });
  pass(4);
  ok({ type: 'hide', id: src('Game stats').id });
  pass(1);
  const places = row(exposure.report(), 'Wave Physio').places;
  assert.ok(Object.keys(places).includes('graphic'), JSON.stringify(places));
  assert.ok(!Object.keys(places).includes('__proto__'), JSON.stringify(places));
  fs.rmSync(path.join(exposure.DIR, '2026-10-20.jsonl'));
});

test('sponsor ads count as plays and as time on screen', () => {
  fs.mkdirSync(scene.MEDIA_DIR, { recursive: true });
  fs.writeFileSync(path.join(scene.MEDIA_DIR, 'golds.png'), 'x');
  sponsors.save({ ...sponsors.byId(golds.id), ads: [{ file: 'golds.png', seconds: 6 }] });
  ok({ type: 'seqAdd', changes: { name: 'Break', steps: [{ kind: 'ads', count: 2, house: false }] } });
  ok({ type: 'seqPlay', sequence: 'Break' });
  pass(13);
  assert.equal(scene.state().playing, null);
  const g = row(exposure.report(), 'Golds Bakery');
  assert.equal(g.plays, 2);
  assert.deepEqual(g.adFiles, { 'golds.png': 2 });
  assert.ok(g.places.ad >= 11 && g.places.ad <= 12, `two 6 second stills, to the second the helper looks: ${g.places.ad}`);
});

test('nights run to 4 am and are listed newest first; another night is reported on its own', () => {
  mock.timers.tick(8 * 3600 * 1000);   // 3 am: still Saturday night
  exposure.tick();
  ok({ type: 'show', id: src('Scoreboard').id });
  pass(10);
  ok({ type: 'hide', id: src('Scoreboard').id });
  pass(1);
  assert.equal(row(exposure.report(), 'Golds Bakery').places.scoreboard, 140);
  mock.timers.tick(2 * 3600 * 1000);   // 5 am Sunday: a new night
  ok({ type: 'show', id: src('Scoreboard').id });
  pass(5);
  ok({ type: 'hide', id: src('Scoreboard').id });
  pass(1);
  assert.deepEqual(exposure.nights(), ['2026-10-25', '2026-10-24']);
  assert.equal(row(exposure.report(), 'Golds Bakery').seconds, 5);
  const both = row(exposure.report({ nights: ['2026-10-24', '2026-10-25'] }), 'Golds Bakery');
  assert.equal(both.places.scoreboard, 145);
  assert.deepEqual(both.target, { seconds: 240, plays: 4 }, 'targets are per stream');
});

test('the helper learns each page\'s sponsor from its request, and reports it', async t => {
  mock.timers.reset();
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const id = (await studio.get('/api/sponsors')).competition.id;
  await studio.post('/api/sponsors', { name: 'Surf Club', website: 'surf.com.au', competitions: { [id]: { tier: 'naming' } } });
  await studio.post('/api/scene', { type: 'add', sources: [{ type: 'browser', name: 'Card', url: 'sponsor.html', visible: true }] });
  const card = (await studio.get('/api/scene')).sources.find(s => s.name === 'Card');
  await studio.post('/api/scene', { type: 'show', id: card.id });
  const r = await fetch(`${studio.base}/api/sponsors/next?place=card`, { headers: { referer: `${studio.base}/sponsor.html` } });
  assert.equal((await r.json()).sponsor.name, 'Surf Club');
  await new Promise(res => setTimeout(res, 2500));
  const rep = await studio.get(`/api/sponsors/report?offair=1&competition=${id}`);
  const s = rep.sponsors.find(x => x.name === 'Surf Club');
  assert.ok(s && s.seconds >= 1, JSON.stringify(rep));
  assert.ok(s.qrSeconds >= 1, 'the card shows its QR code');
  assert.equal((await studio.get(`/api/sponsors/report?competition=${id}`)).sponsors.length, 0, 'no video output on: not on air');
  const n = await studio.get('/api/sponsors/nights');
  assert.ok(n.nights.includes(n.tonight) || n.nights.length === 0);
});
