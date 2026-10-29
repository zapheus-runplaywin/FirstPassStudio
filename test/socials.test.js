// The Socials tab (socials.js, socials.html, social.html): the season's game nights, one night's pictures made from
// the fixture Studio already has (every court), the Production Planner's court and commentators, the sponsor strip
// and Studio mark settings kept per competition, photos for the polaroid, and saving, which needs the Mac app
// (app.test.js saves real PNGs).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio');
const { createWorld } = require('./support/playhq');

let studio;
test.before(async () => {
  studio = await startStudio(null, { competition: 'Thunder League', world: createWorld() });
  await studio.until(async () => (await studio.get('/api/scoreboard')).gameId);
});
test.after(() => studio && studio.stop());

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

test('the tab lists every game night, opens on the next, and knows saving needs the app', async () => {
  const s = await studio.get('/api/socials');
  assert.equal(s.nights.length, 4);
  assert.equal(s.next, studio.world.today);
  assert.deepEqual(Object.keys(s.sizes), ['square', 'portrait', 'story']);
  assert.deepEqual(s.sizes.story, { width: 1080, height: 1920, label: 'Story' });
  assert.deepEqual(s.settings, { mark: true, sponsor: { fixtures: true, matchup: true, onstream: true, polaroid: false } });
  assert.equal(s.app, false, 'no Mac app around the helper here');
});

test('a night has every game on every court, in time order, with logos, and asks PlayHQ nothing more', async () => {
  await studio.get('/api/socials/night'); // the season's rounds are read once, as for every other page
  const before = studio.calls().length;
  const n = await studio.get(`/api/socials/night?date=${studio.world.today}`);
  assert.equal(studio.calls().length, before, 'answered from Studio\'s cache');
  assert.equal(n.competition, 'Thunder League');
  assert.equal(n.games.length, 4);
  assert.deepEqual([...new Set(n.games.map(g => g.court))].sort(), ['Court 1', 'Court 2']);
  assert.deepEqual(n.games.map(g => g.time), [...n.games.map(g => g.time)].sort());
  assert.ok(n.games.every(g => g.home.logo && g.away.name));
  assert.equal(n.stream, null, 'no plan yet, so nothing for On the stream');
});

test('On the stream comes from the Production Planner', async () => {
  const p = await studio.post('/api/planner/pool', { pool: [{ name: 'Sam Lee' }] });
  const night = p.nights.find(x => x.date === studio.world.today);
  const time = night.games.find(g => g.court === 'Court 2').time;
  await studio.post('/api/planner/night', { date: studio.world.today, court: 'Court 2', slots: { [time]: [p.pool[0].id] } });
  const n = await studio.get(`/api/socials/night?date=${studio.world.today}`);
  assert.equal(n.stream.court, 'Court 2');
  assert.equal(n.stream.slots.length, 2);
  assert.deepEqual(n.stream.slots.find(s => s.time === time).people, [{ name: 'Sam Lee', guest: false }]);
});

test('the sponsor strip and the Studio mark are kept per competition', async () => {
  const r = await studio.post('/api/socials/settings', { mark: false, sponsor: { polaroid: true, fixtures: false, nonsense: true } });
  assert.deepEqual(r.settings, { mark: false, sponsor: { fixtures: false, matchup: true, onstream: true, polaroid: true } });
  assert.deepEqual((await studio.get('/api/socials')).settings, r.settings);
  await studio.post('/api/socials/settings', { mark: true });
  assert.equal((await studio.get('/api/socials/night')).settings.mark, true);
});

test('a polaroid photo is kept on this Mac and served as a plain file; anything but a photo is refused', async () => {
  const r = await studio.request('POST', '/api/socials/photo?name=match.png', PNG);
  assert.equal(r.status, 200);
  assert.match(r.json.photo, /^[a-f0-9]{20}\.png$/);
  const got = await studio.request('GET', `/socials/photos/${r.json.photo}`);
  assert.equal(got.status, 200);
  assert.equal(got.type, 'image/png');
  assert.equal((await studio.request('POST', '/api/socials/photo?name=match.jpg', PNG)).status, 400, 'a PNG called .jpg');
  assert.equal((await studio.request('POST', '/api/socials/photo?name=page.html', '<html>')).status, 400);
  assert.equal((await studio.request('GET', '/socials/photos/..%2Fconfig.json')).status, 404);
});

test('saving says it needs the Mac app when Studio runs without it', async () => {
  const r = await studio.request('POST', '/api/socials/export', { date: studio.world.today, items: [{ name: 'Game night fixture', link: '/social.html?kind=fixtures&size=square', size: 'square' }] });
  assert.equal(r.status, 501);
  assert.match(r.json.error, /needs the FirstPass Studio app/);
});
