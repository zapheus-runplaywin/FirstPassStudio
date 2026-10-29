// The Socials tab (socials.js, socials.html, social.html): the season's game nights, one night's pictures made from
// the fixture Studio already has (every court), its results, ladders and top shooters, the Production Planner's court and commentators, the sponsor strip
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
  assert.deepEqual(s.settings, { mark: true, pivt: true, sponsor: { fixtures: true, matchup: true, onstream: true, polaroid: false, results: true, fulltime: true, ladder: true, topshooters: true }, colours: 'competition', colourSets: [], template: 'default' });
  assert.deepEqual(s.nights.map(n => n.results), [4, 4, 0, 0], 'last two weeks played, tonight and next week to come');
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

test('a played night has each result and winner; the ladders and top shooters come only when asked, then from the cache', async () => {
  const date = (await studio.get('/api/socials')).nights[1].date;
  const n = await studio.get(`/api/socials/night?date=${date}`);
  assert.ok(n.games.every(g => g.finished));
  const g = n.games.find(x => x.id === 'game-d1-r2-1');
  assert.deepEqual([g.home.name, g.home.score, g.away.name, g.away.score, g.winner], ['Blizzardz', 31, 'Mavericks', 26, 'home']);
  assert.equal(n.ladders, undefined);
  assert.equal(n.shooters, undefined);
  const tonight = await studio.get(`/api/socials/night?date=${studio.world.today}`);
  assert.ok(tonight.games.every(x => !x.finished && x.winner === null), 'the game being scored has no result until PlayHQ finalises it');

  const full = await studio.get(`/api/socials/night?date=${date}&with=ladders,shooters`);
  assert.deepEqual(full.ladders.map(l => [l.division, l.after]), [['Division 1', 'Round 2'], ['Division 2', 'Round 2']], 'its latest night with results');
  assert.deepEqual(full.ladders[1].rows.map(r => r.team), ['Stormz', 'Titans', 'Tsunamiz', 'Semi Pro']);
  assert.ok(full.ladders[0].rows.every(r => r.logo && r.points !== undefined));
  assert.equal(full.shooters.gamesRead, 4);
  assert.equal(full.shooters.superShots, true);
  assert.equal(full.shooters.players.length, 6);
  assert.deepEqual(full.shooters.players.map(p => p.points), [...full.shooters.players.map(p => p.points)].sort((a, b) => b - a), 'most points first');
  const before = studio.calls().length;
  await studio.get(`/api/socials/night?date=${date}&with=ladders,shooters`);
  assert.equal(studio.calls().length, before, 'finished games\' line ups are read once and kept');

  const old = await studio.get(`/api/socials/night?date=${(await studio.get('/api/socials')).nights[0].date}&with=ladders,shooters`);
  assert.deepEqual(old.ladders.map(l => l.after), ['', ''], 'an older night gets the ladder as it stands, not "after" its round');
  const none = await studio.get(`/api/socials/night?date=${studio.world.today}&with=shooters`);
  assert.deepEqual(none.shooters, { players: [], gamesRead: 0, gamesFinished: 0, superShots: false });
});

test('the sponsor strip and the Studio mark are kept per competition', async () => {
  const r = await studio.post('/api/socials/settings', { mark: false, sponsor: { polaroid: true, fixtures: false, nonsense: true } });
  assert.deepEqual(r.settings, { mark: false, pivt: true, sponsor: { fixtures: false, matchup: true, onstream: true, polaroid: true, results: true, fulltime: true, ladder: true, topshooters: true }, colours: 'competition', colourSets: [], template: 'default' });
  assert.deepEqual((await studio.get('/api/socials')).settings, r.settings);
  assert.equal((await studio.post('/api/socials/settings', { pivt: false })).settings.pivt, false, 'the PIVT logo is optional too');
  await studio.post('/api/socials/settings', { mark: true, pivt: true });
  assert.equal((await studio.get('/api/socials/night')).settings.mark, true);
});

test('colour sets are made from the competition\'s colours, your own are kept, and a picture takes either', async () => {
  const s = await studio.get('/api/socials');
  assert.deepEqual(s.colourSets.map(c => c.id), ['competition', 'accent-first', 'highlight-ground', 'accent-ground', 'night', 'day', 'two-colours']);
  const thunder = { ground: '#7f4092', highlight: '#ffcd00', accent: '#e6007e' };
  const pick = (c) => ({ ground: c.ground, highlight: c.highlight, accent: c.accent });
  assert.deepEqual(pick(s.colourSets[0]), thunder, 'the competition\'s main, highlight and accent');
  assert.deepEqual(pick(s.colourSets[2]), { ground: '#ffcd00', highlight: '#7f4092', accent: '#e6007e' });
  assert.ok(s.colourSets.find(c => c.id === 'accent-first').contrast < 3, 'pink titles on purple are flagged');

  const own = await studio.post('/api/socials/settings', { colourSets: [{ name: 'Finals night', ground: '#101820', highlight: '#f2aa4c', accent: '#2bae66' }] });
  const finals = own.colourSets.find(c => c.own);
  assert.match(finals.id, /^own-\d+$/);
  assert.equal(finals.name, 'Finals night');
  assert.equal((await studio.post('/api/socials/settings', { colours: finals.id })).settings.colours, finals.id);
  assert.equal((await studio.request('POST', '/api/socials/settings', { colourSets: [{ name: 'x', ground: 'red', highlight: '#000000', accent: '#ffffff' }] })).status, 400);
  assert.equal((await studio.request('POST', '/api/socials/settings', { colours: 'nonsense' })).status, 400);

  const picked = await studio.get('/api/socials/night');
  assert.equal(picked.look.colours, finals.id);
  assert.equal(picked.look.vars['--yellow'], '#f2aa4c', 'its highlight takes the highlight\'s place');
  assert.equal(picked.look.vars['--pink'], '#2bae66');
  const day = await studio.get('/api/socials/night?colours=day');
  assert.equal(day.look.light, true, 'a pale ground takes dark text and the dark-ink mark');
  assert.notEqual(day.look.vars['--text'], '#ffffff');
  assert.equal((await studio.get('/api/socials/night?colours=competition')).look.vars, null, 'the competition\'s own look, exactly as on the stream');

  // Removing your set goes back to the competition's colours.
  const back = await studio.post('/api/socials/settings', { colourSets: [] });
  assert.equal(back.settings.colours, 'competition');
});

test('template sets: each has its own face, one is kept for every picture, and a picture can ask for another', async () => {
  const s = await studio.get('/api/socials');
  assert.deepEqual(s.templates.map(t => t.id), ['default', 'fun', 'dynamic', 'junior', 'retro', 'futuristic', 'professional', 'thunder', 'geometric', 'gradient', 'striped', 'highcontrast', '3d']);
  for (const t of s.templates.filter(x => x.font)) {
    const css = await studio.request('GET', `/${t.fontCss}`);
    assert.equal(css.status, 200, `${t.name}'s face is bundled, so it draws with no internet`);
    assert.match(css.text, new RegExp(`font-family: '${t.font}'`));
  }
  assert.equal((await studio.get('/api/socials/night')).look.template.id, 'default');
  assert.equal((await studio.post('/api/socials/settings', { template: 'retro' })).settings.template, 'retro');
  const retro = (await studio.get('/api/socials/night')).look.template;
  assert.deepEqual([retro.id, retro.font, retro.mark], ['retro', 'Bungee', 'light'], 'a pale paper ground takes the dark-ink mark');
  const asked = await studio.get('/api/socials/night?template=3d&colours=night');
  assert.deepEqual([asked.look.template.id, asked.look.colours], ['3d', 'night'], 'template and colours mix freely');
  assert.equal((await studio.get('/api/socials/night?template=nonsense')).look.template.id, 'retro', 'an unknown one keeps the picked one');
  assert.equal((await studio.request('POST', '/api/socials/settings', { template: 'nonsense' })).status, 400);
  assert.equal((await studio.post('/api/socials/settings', { template: 'default' })).settings.template, 'default');
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
