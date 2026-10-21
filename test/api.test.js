// The helper's API (server.js) for every graphic, run against the stand-in PlayHQ
// (test/support/playhq.js) with the Thunder League template imported: a season of two
// divisions, two rounds played, one being played today and one next week.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio');

let studio;
test.before(async () => {
  studio = await startStudio(null, { competition: 'Thunder League' });
  // Studio puts a game on at start up; wait for it rather than racing it.
  await studio.until(async () => (await studio.get('/api/scoreboard')).gameId);
});
test.after(() => studio && studio.stop());

const get = p => studio.get(p);
const names = games => games.map(g => `${g.home.name} v ${g.away.name}`);

test('structure: the competition, season and divisions found from the organisation link', async () => {
  const s = await get('/api/structure');
  assert.equal(s.competition, 'Thunder League');
  assert.equal(s.organisation, 'West Coast Mens and Mixed Netball Association');
  assert.equal(s.season.name, 'Spring 2026', 'the active season, not the finished one');
  assert.deepEqual(s.grades.map(g => [g.division, g.name, g.gender]), [[1, 'Division 1', ''], [2, 'Division 2', 'male']]);
  assert.deepEqual(s.otherCompetitions, ['Thunder League', 'Summer Social']);
  assert.equal(s.setup, 'Thunder League');
  assert.equal(s.rules.periods, 4);
  assert.equal(s.rules.periodMinutes, 10);
  assert.equal(s.rules.superShots, true);
  assert.equal(s.rules.finalsPlaces, 4);
  assert.match(s.rules.competitionLogo, /^\/brand\//);
});

test('ladder: sorted by points, with finals marks, for the game\'s division or ?division=', async () => {
  const l = await get('/api/ladder');
  assert.equal(l.division, 'Division 1');
  const rows = l.pools[0];
  assert.deepEqual(rows.map(r => r.position), [1, 2, 3, 4]);
  assert.equal(rows[0].team, 'Blizzardz');
  assert.equal(rows[0].played, 2);
  assert.equal(rows[0].points, 8);
  assert.ok(rows.every((r, i) => i === 0 || rows[i - 1].points >= r.points));
  assert.deepEqual(l.finals.marks, ['double', 'double', 'elim', 'elim']);
  assert.equal((await get('/api/ladder?division=2')).division, 'Division 2');
  assert.equal((await get('/api/ladder?division=division%202')).division, 'Division 2', 'a division by name');
  const missing = await studio.request('GET', '/api/ladder?division=Premier');
  assert.equal(missing.status, 404);
  assert.match(missing.json.error, /No division "Premier"\. This season has: Division 1, Division 2/);
});

test('rounds: this round is today\'s, and a round picked on the control page is used until set back to automatic', async () => {
  let r = await get('/api/rounds');
  assert.equal(r.auto, 'Round 3');
  assert.equal(r.choice, '');
  assert.deepEqual(r.rounds.map(x => x.key), ['1', '2', '3', '4']);
  assert.equal(r.rounds[2].date, studio.world.today);
  assert.deepEqual([...new Set((await get('/api/games')).map(g => g.round))], ['Round 3']);

  r = await studio.post('/api/rounds', { round: '2' });
  assert.equal(r.choice, '2');
  assert.deepEqual([...new Set((await get('/api/games')).map(g => g.round))], ['Round 2']);
  assert.equal((await get('/api/fixtures')).round, 'Round 2', 'every page follows the control page\'s round');

  r = await studio.post('/api/rounds', { round: '' });
  assert.equal(r.choice, '');
  assert.deepEqual([...new Set((await get('/api/games')).map(g => g.round))], ['Round 3']);
});

test('games: this round in every division, with division, court, time and venue', async () => {
  const games = await get('/api/games');
  assert.equal(games.length, 4);
  assert.deepEqual([...new Set(games.map(g => g.division))], ['Division 1', 'Division 2']);
  const live = games.find(g => g.id === studio.world.gameNow(0).id);
  assert.equal(live.status, 'IN_PROGRESS');
  assert.equal(live.court, 'Court 1');
  assert.equal(live.venue, 'Gold Netball Centre');
  assert.equal(live.date, studio.world.today);
});

test('fixtures: sorted by time then court, ?round= this, next, prev, +N, a number, ?division= and ?results', async () => {
  const f = await get('/api/fixtures');
  assert.equal(f.round, 'Round 3');
  assert.equal(f.venueName, 'Gold Netball Centre');
  assert.deepEqual(f.games.map(g => `${g.division} ${g.court}`), ['Division 1 Court 1', 'Division 1 Court 2', 'Division 2 Court 1', 'Division 2 Court 2']);
  assert.ok(f.games.every(g => g.home.logo && g.away.logo), 'team logos from the template');

  assert.equal((await get('/api/fixtures?round=next')).round, 'Round 4');
  assert.equal((await get('/api/fixtures?round=%2B1')).round, 'Round 4');
  assert.equal((await get('/api/fixtures?round=-2')).round, 'Round 1');
  assert.equal((await get('/api/fixtures?round=1')).round, 'Round 1');
  assert.equal((await get('/api/fixtures?round=Round%202')).round, 'Round 2');

  const prev = await get('/api/fixtures?round=prev&results=1');
  assert.equal(prev.round, 'Round 2');
  assert.equal(prev.games.length, 4);
  assert.ok(prev.games.every(g => g.status === 'FINAL' && Number.isInteger(g.home.score) && Number.isInteger(g.away.score)));
  assert.equal((await get('/api/fixtures?results=1')).games.length, 0, 'nothing finished yet today');

  const div2 = await get('/api/fixtures?division=2');
  assert.equal(div2.division, 'Division 2');
  assert.deepEqual(names(div2.games), ['Stormz v Semi Pro', 'Titans v Tsunamiz']);

  assert.match((await get('/api/fixtures?round=%2B9')).error, /No round "\+9"/);
  assert.match((await get('/api/fixtures?round=Grand%20Final')).error, /No round "Grand Final"/);
});

test('up next: the next game on the same court', async () => {
  const u = await get('/api/upnext');
  assert.equal(u.after.court, 'Court 1');
  assert.equal(u.court, 'Court 1');
  assert.equal(`${u.home.name} v ${u.away.name}`, 'Stormz v Semi Pro');
  assert.ok(u.logos.home && u.logos.away);
});

test('ladder bar, form and top shooters for the game on the scoreboard', async () => {
  const bar = await get('/api/ladderbar');
  assert.equal(bar.division, 'Division 1');
  assert.equal(bar.home.name, 'Blizzardz');
  assert.equal(bar.home.ladder.position, 1);
  assert.equal(bar.away.ladder.team, "Travis' Disciples");

  const form = await get('/api/form');
  assert.deepEqual(form.home.form.map(f => f.result), ['W', 'W']);
  assert.deepEqual(form.away.form.map(f => f.result), ['L', 'L']);
  assert.deepEqual(form.home.form.map(f => f.round), ['Round 1', 'Round 2']);
  assert.equal((await get('/api/form?count=1')).home.form.length, 1);

  const shooters = await get('/api/topshooters');
  assert.equal(shooters.division, 'Division 1');
  assert.equal(shooters.gamesFinished, 4);
  assert.equal(shooters.gamesRead, 4);
  assert.ok(shooters.points.length > 0);
  assert.ok(shooters.points.every((p, i, all) => i === 0 || all[i - 1].points >= p.points), 'most points first');
  assert.ok(shooters.points.every(p => /GS|GA/.test(p.name)), 'only players who scored');
  for (const p of shooters.points) assert.equal(p.points, p.goals + 2 * p.superGoals);
  assert.equal((await get('/api/topshooters?limit=2')).points.length, 2);
});

test('teams: line ups in position order with the live team totals', async () => {
  const t = await get('/api/teams');
  assert.equal(t.scoring, 'live');
  assert.deepEqual(t.home.players.map(p => p.position), ['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK']);
  assert.equal(t.home.players.find(p => p.position === 'WA').captain, true);
  assert.ok(t.home.totals, 'team totals from the live feed');
  assert.equal(t.home.name, 'Blizzardz');
});

test('countdown: the picked game\'s start from the board alone', async () => {
  const before = studio.calls().length;
  const c = await get('/api/countdown');
  const g = studio.world.gameNow(0);
  assert.equal(c.gameId, g.id);
  assert.equal(c.time, g.time);
  assert.equal(new Date(c.start).getTime(), c.start);
  assert.equal(studio.calls().length, before, 'no PlayHQ call');
});

test('ticker: the round\'s live and finished games except the one on the scoreboard, with live scores', async () => {
  const other = studio.world.games['game-d1-r3-2'];
  studio.world.live[other.id].home = 7;
  const t = await get('/api/ticker');
  assert.equal(t.speed, 120);
  assert.deepEqual(t.games.map(g => g.id), [other.id]);
  assert.equal(t.games[0].live, true);
  assert.equal(t.games[0].home.score, 7);
});

test('person lower third: an athlete from the register, a guest, and the suggestions', async () => {
  await get('/api/teams'); // the line ups fill the athlete register
  const a = await get('/api/lowerthird?name=blizzardz%20gs');
  assert.equal(a.athlete.name, 'Blizzardz GS');
  assert.equal(a.athlete.known, true);
  assert.equal(a.athlete.team, 'Blizzardz');
  assert.match(a.athlete.logo, /Blizzardz/);
  const guest = await get('/api/lowerthird?type=guest&name=Pat');
  assert.equal(guest.athlete, undefined);
  assert.ok(guest.competitionLogoLight);
  const unknown = await get('/api/lowerthird?name=Nobody%20Here');
  assert.equal(unknown.athlete.known, false);
  const list = await get('/api/lowerthird/athletes');
  assert.deepEqual(list.game.teams, ['Blizzardz', "Travis' Disciples"]);
  assert.ok(list.athletes.some(x => x.name === 'Blizzardz GS'));
});

test('finals: the format from the setup, the ladder\'s top four, and a winner entered by hand', async () => {
  let f = await get('/api/finals');
  assert.equal(f.format.id, 'top4-page');
  assert.equal(f.projected, true, 'the season isn\'t finished');
  assert.deepEqual(f.ladder.map(r => r.position), [1, 2, 3, 4]);
  const first = f.games[0];
  assert.ok(first.id);
  f = await studio.post('/api/finals/result', { division: '1', game: first.id, winner: first.home.name, homeScore: 30, awayScore: 20 });
  const g = f.games.find(x => x.id === first.id);
  assert.equal(g.winner, first.home.name);
  f = await studio.post('/api/finals/result', { division: '1', game: first.id, winner: '' });
  assert.ok(!f.games.find(x => x.id === first.id).winner, 'cleared');
  const bad = await studio.request('POST', '/api/finals/result', { division: '1', game: 'nope', winner: 'x' });
  assert.equal(bad.status, 502);
  assert.match(bad.json.error, /has no finals game nope/);
});

test('head to head: earlier finished games between the two teams on the scoreboard', async () => {
  const g = studio.world.divisions[0].rounds[3].games[0]; // Knights v Blizzardz next week; they met in round 1
  await studio.post('/api/scoreboard', { type: 'selectGame', game: { id: g.id, roundId: g.roundId, division: g.division, court: g.court, date: g.date, time: g.time, home: { name: g.home }, away: { name: g.away } } });
  const h = await get('/api/headtohead');
  assert.equal(h.games.length, 1);
  assert.equal(h.games[0].round, 'Round 1');
  assert.deepEqual(h.tally, { home: 0, away: 1, draws: 0 });
  // Back to the game being played.
  await studio.post('/api/scoreboard', { type: 'autoSelect', value: true });
  assert.equal((await get('/api/scoreboard')).gameId, studio.world.gameNow(0).id);
});

test('competition look: theme.css has the setup\'s colours and font, and logos are served', async () => {
  const css = await studio.request('GET', '/theme.css');
  assert.equal(css.status, 200);
  assert.match(css.type, /text\/css/);
  assert.match(css.text, /--purple: #7f4092;/i);
  assert.match(css.text, /--yellow: #ffcd00;/i);
  assert.match(css.text, /fonts\.googleapis\.com/);
  const logo = await studio.request('GET', '/logos/Blizzardz.png');
  assert.equal(logo.status, 200);
  assert.equal(logo.type, 'image/png');
  assert.equal((await studio.request('GET', '/logos/Nobody.png')).status, 404);
});
