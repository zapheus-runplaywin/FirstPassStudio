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
  assert.deepEqual(s.settings, { mark: true, pivt: true, sponsor: { fixtures: true, matchup: true, onstream: true, commentators: true, polaroid: false, results: true, fulltime: true, ladder: true, topshooters: true, tournament: true, finalsbound: true, finalsdraw: true }, colours: 'competition', colourSets: [], template: 'default', favourites: [], favouritesOnly: false, movers: true });
  assert.deepEqual(s.nights.map(n => n.results), [4, 4, 0, 0], 'last two weeks played, tonight and next week to come');
  assert.equal(s.app, false, 'no Mac app around the helper here');
});

// PlayHQ calls the Socials tab makes; the scoreboard's own live score polling (spectator) runs alongside on its timer.
const asked = () => studio.calls().filter(c => !c.spectator).length;

test('a night has every game on every court, in time order, with logos, and asks PlayHQ nothing more', async () => {
  await studio.get('/api/socials/night'); // the season's rounds are read once, as for every other page
  const before = asked();
  const n = await studio.get(`/api/socials/night?date=${studio.world.today}`);
  assert.equal(asked(), before, 'answered from Studio\'s cache');
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
  assert.deepEqual(n.stream.slots.find(s => s.time === time).people, [{ name: 'Sam Lee', guest: false, headshot: null }]);

  // A headshot added on the Planner goes with them, for the Commentary team picture.
  const id = p.pool[0].id;
  const shot = await studio.request('POST', `/api/planner/headshot?id=${id}&ext=png`, PNG, { 'content-type': 'application/octet-stream' });
  assert.equal(shot.status, 200);
  assert.equal(shot.json.pool[0].headshotUrl, `/headshots/${id}.png`);
  const withShot = await studio.get(`/api/socials/night?date=${studio.world.today}`);
  assert.equal(withShot.stream.slots.find(s => s.time === time).people[0].headshot, `/headshots/${id}.png`);
  assert.equal((await studio.request('GET', `/headshots/${id}.png`)).status, 200);
  assert.equal((await studio.post('/api/planner/pool', { pool: [{ id, name: 'Sam Lee', guest: true }] })).pool[0].headshot, `${id}.png`, 'kept when the list is saved');
  assert.equal((await studio.request('POST', `/api/planner/headshot?id=${id}&ext=gif`, PNG)).status, 400, 'a photo type only');
  assert.equal((await studio.request('POST', '/api/planner/headshot?id=nobody&ext=png', PNG)).status, 400);
  await studio.del(`/api/planner/headshot?id=${id}`);
  assert.equal((await studio.request('GET', `/headshots/${id}.png`)).status, 404, 'removed');
  await studio.post('/api/planner/pool', { pool: [{ id, name: 'Sam Lee' }] });
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
  const before = asked();
  await studio.get(`/api/socials/night?date=${date}&with=ladders,shooters`);
  assert.equal(asked(), before, 'finished games\' line ups are read once and kept');
  // One division's top shooters, for the Socials tab's picture per division: only its games, from the same kept line ups.
  const teams = new Set(full.games.filter(g => g.finished && g.division === 'Division 2').flatMap(g => [g.home.name, g.away.name]));
  const div2 = (await studio.get(`/api/socials/night?date=${date}&with=shooters&division=Division%202`)).shooters;
  assert.equal(div2.gamesFinished, 2);
  assert.ok(div2.players.length && div2.players.every(p => teams.has(p.team)), 'only Division 2\'s shooters');
  assert.equal(asked(), before, 'still from the kept line ups');

  const old = await studio.get(`/api/socials/night?date=${(await studio.get('/api/socials')).nights[0].date}&with=ladders,shooters`);
  assert.deepEqual(old.ladders.map(l => l.after), ['', ''], 'an older night gets the ladder as it stands, not "after" its round');
  const none = await studio.get(`/api/socials/night?date=${studio.world.today}&with=shooters`);
  assert.deepEqual(none.shooters, { players: [], gamesRead: 0, gamesFinished: 0, superShots: false });
});

test('tournament top shooters: a division\'s totals so far, as at a time that night, and each one\'s move since the night before', async () => {
  const nights = (await studio.get('/api/socials')).nights.filter(n => n.results);
  const [first, second] = nights.map(n => n.date);
  const t = (date, extra = '') => studio.get(`/api/socials/night?date=${date}&with=tournament&division=Division%201${extra}`).then(n => n.tournament);
  const one = await t(first), two = await t(second);
  assert.equal(one.round, 'Round 1');
  assert.equal(one.compared, false, 'nothing to compare on the division\'s first night');
  assert.ok(one.players.every(p => p.moved === undefined && !p.fresh));
  assert.equal(two.round, 'Round 2');
  assert.equal(two.gamesFinished, 4, 'both nights\' games');
  assert.ok(two.players.length <= 8 && two.players.every(p => p.games === 2));
  assert.deepEqual(two.players.map(p => p.points), [...two.players.map(p => p.points)].sort((a, b) => b - a), 'most points first');
  // Each move is the place after the round before (round 1) less the place now; anyone who wasn't in round 1's top 8 is new.
  const was = one.players.map(p => p.name);
  for (const [i, p] of two.players.entries()) {
    if (was.includes(p.name)) assert.equal(p.moved, was.indexOf(p.name) - i, p.name);
    else assert.equal(p.fresh, true, p.name);
  }
  assert.equal(two.compared, true);
  // The test fixture runs four weeks, so it's Season top shooters unless the competition setup says otherwise.
  assert.equal((await studio.get(`/api/socials/night?date=${second}`)).running, 'Season');
  const id = studio.competition.id || 'thunder-league';
  await studio.post(`/api/setup/${id}`, { runningShooters: 'tournament' });
  assert.equal((await studio.get(`/api/socials/night?date=${second}`)).running, 'Tournament', 'as the competition setup says');
  await studio.post(`/api/setup/${id}`, { runningShooters: '' });
  // As at a time that night: only the games starting by then, so before the first game it's round 1's totals.
  const times = (await studio.get(`/api/socials/night?date=${second}`)).games.filter(g => g.division === 'Division 1').map(g => g.time).sort();
  const early = await t(second, `&after=${times[0]}`);
  assert.equal(early.gamesFinished, 3);
  assert.equal(early.round, 'Round 2', 'after the latest round counted');
  assert.equal(early.compared, true, 'compared with the round before');
  const before = await t(second, '&after=00:00');
  assert.deepEqual(before.players.map(p => [p.name, p.points]), one.players.map(p => [p.name, p.points]));
  assert.equal(before.compared, false);
  assert.equal((await t(second, '&after=junk')).gamesFinished, 4, 'a time like 14:00 or none');
  // Movers are on to start with, and kept for the competition.
  assert.equal((await studio.post('/api/socials/settings', { movers: false })).settings.movers, false);
  assert.equal((await studio.get('/api/socials')).settings.movers, false);
  await studio.post('/api/socials/settings', { movers: true });
});

test('tournament top shooters on a carnival day compare round by round, and As at picks a round', async t => {
  const world = createWorld();
  const div1 = Object.values(world.games).filter(g => g.division === 'Division 1');
  const r1 = div1.filter(g => g.roundId.endsWith('-r1')), r2 = div1.filter(g => g.roundId.endsWith('-r2'));
  r1.forEach((g, i) => { g.date = r2[0].date; g.time = `0${8 + i}:00:00`; }); // round 1 that morning, round 2 after
  const carnival = await startStudio(t, { competition: 'Thunder League', world });
  const day = n => carnival.get(`/api/socials/night?date=${r2[0].date}&with=tournament&division=Division%201${n}`).then(x => x.tournament);
  const all = await day('');
  assert.equal(all.round, 'Round 2');
  assert.equal(all.compared, true, 'round 2 against round 1, the same day');
  assert.ok(all.players.some(p => p.moved), 'someone moved');
  const morning = await day('&after=09:00');
  assert.equal(morning.round, 'Round 1');
  assert.equal(morning.gamesFinished, 2);
  assert.equal(morning.compared, false, 'nothing before round 1');
});

test('the sponsor strip and the Studio mark are kept per competition', async () => {
  const r = await studio.post('/api/socials/settings', { mark: false, sponsor: { polaroid: true, fixtures: false, nonsense: true } });
  assert.deepEqual(r.settings, { mark: false, pivt: true, sponsor: { fixtures: false, matchup: true, onstream: true, commentators: true, polaroid: true, results: true, fulltime: true, ladder: true, topshooters: true, tournament: true, finalsbound: true, finalsdraw: true }, colours: 'competition', colourSets: [], template: 'default', favourites: [], favouritesOnly: false, movers: true });
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
  assert.deepEqual(s.templates.map(t => t.id), ['default', 'dynamic', 'junior', 'retro', 'professional', 'thunder', 'gradient', 'highcontrast', 'neon', 'poster', 'splash', 'gameday', 'hero', 'final', 'court', 'bib', 'goal', 'bottle', 'cones', 'sneakers', 'stadium', 'locker']);
  for (const t of s.templates.filter(x => x.font)) {
    const css = await studio.request('GET', `/${t.fontCss}`);
    assert.equal(css.status, 200, `${t.name}'s face is bundled, so it draws with no internet`);
    assert.match(css.text, new RegExp(`font-family: '${t.font}'`));
  }
  assert.equal((await studio.get('/api/socials/night')).look.template.id, 'default');
  assert.equal((await studio.post('/api/socials/settings', { template: 'retro' })).settings.template, 'retro');
  const retro = (await studio.get('/api/socials/night')).look.template;
  assert.deepEqual([retro.id, retro.font, retro.mark], ['retro', 'Bungee', 'light'], 'a pale paper ground takes the dark-ink mark');
  const asked = await studio.get('/api/socials/night?template=neon&colours=night');
  assert.deepEqual([asked.look.template.id, asked.look.colours], ['neon', 'night'], 'template and colours mix freely');
  // A set no longer on the list is drawn as the closest one kept, from an old link or a saved choice.
  assert.equal((await studio.get('/api/socials/night?template=3d')).look.template.id, 'neon');
  assert.equal((await studio.get('/api/socials/night?template=nonsense')).look.template.id, 'retro', 'an unknown one keeps the picked one');
  assert.equal((await studio.request('POST', '/api/socials/settings', { template: 'nonsense' })).status, 400);
  assert.equal((await studio.post('/api/socials/settings', { template: 'arena' })).settings.template, 'highcontrast');
  assert.equal((await studio.post('/api/socials/settings', { template: 'default' })).settings.template, 'default');
  // Favourites: starred sets kept in the list's order, a retired one counted as the set it is drawn as, and a tick to list only those.
  assert.deepEqual([s.settings.favourites, s.settings.favouritesOnly], [[], false], 'none starred at first');
  const fav = (await studio.post('/api/socials/settings', { favourites: ['stadium', 'court', 'arena', 'court'], favouritesOnly: true })).settings;
  assert.deepEqual([fav.favourites, fav.favouritesOnly], [['highcontrast', 'court', 'stadium'], true]);
  assert.equal((await studio.request('POST', '/api/socials/settings', { favourites: ['nonsense'] })).status, 400);
  assert.deepEqual((await studio.get('/api/socials')).settings.favourites, ['highcontrast', 'court', 'stadium'], 'kept');
  const off = (await studio.post('/api/socials/settings', { favourites: [], favouritesOnly: false })).settings;
  assert.deepEqual([off.favourites, off.favouritesOnly], [[], false]);
});

test('athletes\' photos: only those who approved their use, matched to the top shooters by name or picked for a picture', async () => {
  const s = await studio.get('/api/socials');
  const date = s.nights[1].date;
  const top = (await studio.get(`/api/socials/night?date=${date}&with=shooters`)).shooters.players[0];
  assert.equal(top.photo, null, 'no photo yet');
  const up = await studio.request('POST', `/api/athletes/photo?athlete=${encodeURIComponent(top.name)}&ext=png`, PNG, { 'content-type': 'application/octet-stream' });
  assert.equal(up.status, 200);
  assert.equal((await studio.get(`/api/socials/night?date=${date}&with=shooters`)).shooters.players[0].photo, null, 'a photo not approved stays off');
  assert.deepEqual((await studio.get('/api/socials/athletes')).athletes, [], 'nobody to pick until approved');
  assert.deepEqual((await studio.get(`/api/socials/night?date=${date}&home=${encodeURIComponent(top.name)}`)).picked, {}, 'picking one not approved draws without');
  await studio.post('/api/athletes/approval', { athletes: [top.name], approved: true });
  assert.match((await studio.get(`/api/socials/night?date=${date}&with=shooters`)).shooters.players[0].photo, /^\/photos\//);
  const list = (await studio.get('/api/socials/athletes')).athletes;
  assert.deepEqual(list.map(a => a.name), [top.name]);
  assert.ok(list[0].teams.length && list[0].teams[0].division, 'with their teams and divisions to filter by');
  const picked = await studio.get(`/api/socials/night?date=${date}&home=${encodeURIComponent(top.name)}&athlete=${encodeURIComponent(top.name)}`);
  assert.deepEqual(Object.keys(picked.picked), ['home', 'athlete']);
  assert.equal(picked.picked.home.name, top.name);
  await studio.post('/api/athletes/approval', { athletes: [top.name], approved: false });
  assert.deepEqual((await studio.get(`/api/socials/night?date=${date}&home=${encodeURIComponent(top.name)}`)).picked, {});
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
