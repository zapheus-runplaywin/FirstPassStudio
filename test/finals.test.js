// Finals formats (finals.js): every format holds together, plays through to a champion, and
// works out the games from PlayHQ's finals fixtures or winners entered on the control page.
const test = require('node:test');
const assert = require('node:assert/strict');
const finals = require('../finals');

const SEEDS = ['Blizzardz', 'Knights', 'Mavericks', "Travis' Disciples", 'Stormz', 'Titans', 'Tsunamiz', 'Semi Pro', 'Saddle Up', 'NDNC'];
const sizedFor = f => finals.sized(f, f.all ? 8 : f.teams);

test('every format holds together: places, marks, weeks, and games that only name earlier games', () => {
  for (const f of finals.FORMATS) {
    const s = sizedFor(f);
    assert.equal(s.marks.length, s.teams, `${f.id}: a mark for every finals place`);
    for (const m of s.marks) assert.ok(finals.MARKS[m], `${f.id}: mark ${m} has words`);
    const seen = new Set();
    for (const g of s.games) {
      assert.ok(!seen.has(g.id), `${f.id}: ${g.id} is used once`);
      assert.ok(g.week >= 1 && g.week <= s.weeks.length, `${f.id}: ${g.id} is in a named week`);
      for (const slot of [g.home, g.away]) {
        const m = slot.match(/^s(\d+)$/);
        if (m) { assert.ok(Number(m[1]) <= s.teams, `${f.id}: ${g.id} ${slot} is a finals place`); continue; }
        const [kind, ids] = slot.split(':');
        assert.ok(['W', 'L', 'Wlow', 'Whigh'].includes(kind), `${f.id}: ${g.id} ${slot}`);
        for (const id of ids.split(',')) assert.ok(seen.has(id), `${f.id}: ${g.id} names ${id} before it is played`);
      }
      seen.add(g.id);
    }
    assert.ok(s.series || seen.has('GF'), `${f.id} has a grand final`);
  }
});

test('every format plays through to a champion with winners entered by hand', () => {
  for (const f of finals.FORMATS) {
    const s = sizedFor(f);
    const seeds = SEEDS.slice(0, s.teams);
    const manual = {};
    // The higher team on the ladder wins every game; each round works out the next games' teams.
    for (let pass = 0; pass < s.games.length + 1; pass++) {
      for (const g of finals.resolve(s, seeds, [], manual).games) {
        if (g.notNeeded || manual[g.id] || !g.home.name || !g.away.name) continue;
        manual[g.id] = { winner: g.home.seed < g.away.seed ? g.home.name : g.away.name, homeScore: 30, awayScore: 20 };
      }
    }
    const r = finals.resolve(s, seeds, [], manual);
    assert.equal(r.champion, 'Blizzardz', `${f.id}: the top team wins when the higher team wins every game`);
    assert.ok(r.games.every(g => g.notNeeded || (g.winner && g.loser)), `${f.id}: every game decided`);
  }
});

test('page system: the 1 v 2 loser gets another chance and the 3 v 4 loser is out', () => {
  const f = finals.byId('top4-page');
  const seeds = SEEDS.slice(0, 4);
  // Knights beat Blizzardz in the first semi, Mavericks beat Travis' Disciples.
  let r = finals.resolve(f, seeds, [], { [f.games[0].id]: { winner: 'Knights' }, [f.games[1].id]: { winner: 'Mavericks' } });
  const names = g => [g.home.name, g.away.name].sort();
  const prelim = r.games.find(g => g.week === 2);
  assert.deepEqual(names(prelim), ['Blizzardz', 'Mavericks'], 'the 1 v 2 loser plays the 3 v 4 winner');
  const gf = r.games.find(g => g.id === 'GF');
  assert.equal(gf.home.name, 'Knights');
  assert.equal(gf.away.name, null);
  assert.match(gf.away.placeholder, /^Winner /);
  assert.equal(r.champion, null);
  r = finals.resolve(f, seeds, [], { [f.games[0].id]: { winner: 'Knights' }, [f.games[1].id]: { winner: 'Mavericks' }, [prelim.id]: { winner: 'Blizzardz' }, GF: { winner: 'Blizzardz', homeScore: 40, awayScore: 38 } });
  assert.equal(r.champion, 'Blizzardz');
  assert.equal(r.games.find(g => g.id === 'GF').source, 'manual');
});

test('PlayHQ\'s finals games are matched either way round, with their scores, and win over a hand entry', () => {
  const f = finals.byId('top4-semis');
  const seeds = SEEDS.slice(0, 4);
  const played = [
    { id: 'p1', week: 1, finished: true, home: { name: 'travis disciples', score: 20 }, away: { name: 'Blizzardz', score: 31 }, court: 'Court 1', date: '2026-11-01', time: '18:00' },
    { id: 'p2', week: 1, finished: false, status: 'IN_PROGRESS', home: { name: 'Knights', score: 12 }, away: { name: 'Mavericks', score: 14 } },
  ];
  const r = finals.resolve(f, seeds, played, { SF1: { winner: "Travis' Disciples" } });
  const sf1 = r.games.find(g => g.id === 'SF1');
  assert.equal(sf1.home.name, 'Blizzardz', 'kept the right way round');
  assert.equal(sf1.home.score, 31);
  assert.equal(sf1.away.score, 20);
  assert.equal(sf1.winner, 'Blizzardz', 'PlayHQ\'s finished result wins over the hand entry');
  assert.equal(sf1.source, 'playhq');
  assert.equal(sf1.court, 'Court 1');
  const sf2 = r.games.find(g => g.id === 'SF2');
  assert.equal(sf2.winner, null, 'not finished, no winner yet');
  assert.equal(sf2.status, 'IN_PROGRESS');
  assert.equal(r.games.find(g => g.id === 'GF').home.name, 'Blizzardz');
});

test('a level score with PlayHQ\'s outcome (extra time, forfeit) still has a winner', () => {
  const f = finals.byId('top2-gf');
  const r = finals.resolve(f, SEEDS.slice(0, 2), [{ id: 'gf', week: 1, finished: true, home: { name: 'Blizzardz', score: 30, outcome: 'LOST' }, away: { name: 'Knights', score: 30, outcome: 'WON' } }]);
  assert.equal(r.champion, 'Knights');
});

test('best of three: game 3 is only needed at one win each', () => {
  const f = finals.byId('top2-best-of-3');
  const seeds = SEEDS.slice(0, 2);
  let r = finals.resolve(f, seeds, [], { G1: { winner: 'Blizzardz' }, G2: { winner: 'Blizzardz' } });
  assert.equal(r.champion, 'Blizzardz');
  assert.equal(r.games.find(g => g.id === 'G3').notNeeded, true);
  r = finals.resolve(f, seeds, [], { G1: { winner: 'Blizzardz' }, G2: { winner: 'Knights' } });
  assert.equal(r.champion, null);
  assert.ok(!r.games.find(g => g.id === 'G3').notNeeded);
  r = finals.resolve(f, seeds, [], { G1: { winner: 'Blizzardz' }, G2: { winner: 'Knights' }, G3: { winner: 'Knights' } });
  assert.equal(r.champion, 'Knights');
});

test('every team plays: games and marks sized to the ladder, the odd team out has no game', () => {
  const f = finals.byId('all-placings');
  const seven = finals.sized(f, 7);
  assert.equal(seven.teams, 6);
  assert.deepEqual(seven.games.map(g => `${g.id} ${g.home} v ${g.away}`), ['GF s1 v s2', 'P3 s3 v s4', 'P5 s5 v s6']);
  assert.deepEqual(seven.games.map(g => g.name), ['Grand final', 'Third place play-off', 'Fifth place play-off']);
  assert.deepEqual(seven.marks, ['final', 'final', 'placing', 'placing', 'placing', 'placing']);
  assert.equal(finals.sized(f, 0).teams, 2, 'at least a grand final');
  assert.equal(finals.sized(finals.byId('top4-page'), 10), finals.byId('top4-page'), 'other formats are fixed');
});

test('the format for a division: its own, none, or the competition\'s', () => {
  const settings = { finalsFormat: 'top4-page', divisionFinals: { 'Division 2': 'top2-gf', 'Division 3': 'none', 'Division 4': 'all-placings' } };
  assert.equal(finals.formatFor(settings, 'Division 1').id, 'top4-page');
  assert.equal(finals.formatFor(settings, 'Division 2').id, 'top2-gf');
  assert.equal(finals.formatFor(settings, 'Division 3'), null);
  assert.equal(finals.formatFor(settings, 'Division 4', 5).teams, 4);
  assert.equal(finals.formatFor({ finalsFormat: '' }, 'Division 1'), null);
});

test('older setups\' number of finals places becomes the nearest format', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 8, 10].map(finals.fromPlaces), ['', 'top2-gf', 'top2-gf', 'top4-page', 'top4-page', 'top6-byes', 'top6-byes', 'top8-afl', 'top8-afl']);
  for (const id of ['top2-gf', 'top4-page', 'top6-byes', 'top8-afl']) assert.ok(finals.byId(id), id);
});

test('ladder marks, the setup page\'s list, and place words', () => {
  const m = finals.ladderMarks(finals.byId('top4-page'));
  assert.equal(m.places, 4);
  assert.deepEqual(m.legend.map(l => l.mark), ['double', 'elim']);
  assert.deepEqual(finals.ladderMarks(null), { places: 0, marks: [], legend: [] });
  const list = finals.list();
  assert.equal(list.length, finals.FORMATS.length);
  assert.equal(list.find(f => f.id === 'all-placings').marks.length, 8);
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(finals.ordinal),
    ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th']);
});
