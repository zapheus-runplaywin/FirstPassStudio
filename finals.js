// PlayHQ Graphics - finals formats.
//
// Each competition setup picks a finals format, and each division can have its own
// (setup page, Game rules). A format says which ladder places make the finals, what
// each place earns (marked on the ladder), and the games week by week.
//
// A team in a game is written as:
//   's3'            3rd on the ladder
//   'W:QF1'         the winner of QF1          'L:QF1'  its loser
//   'Wlow:EF1,EF2'  of the winners of EF1 and EF2, the one lower on the ladder
//   'Whigh:EF1,EF2' the one higher on the ladder
// Games are played in order, so a game only names games before it.
//
// What a place earns, shown on the ladder:
//   final   plays in the grand final (or for the title) straight away
//   double  a double chance: losing the first final doesn't knock them out
//   bye     a week off in the first week of finals
//   elim    an elimination final: lose and they're out
//   third   plays for third place
//   placing plays for a place lower down (every team plays on grand final day)
//
// A format with teams: 0 has every team on the ladder: sized() gives it its games for
// the number of teams the division has.

'use strict';

const MARKS = {
  final: 'Plays for the title',
  double: 'Double chance',
  bye: 'Week off',
  elim: 'Elimination final',
  third: 'Plays for third',
  placing: 'Plays for a place',
};

const FORMATS = [
  { id: 'top2-gf', teams: 2, name: 'Grand final', summary: '1 v 2, one game.',
    marks: ['final', 'final'], weeks: ['Grand final'],
    games: [{ id: 'GF', name: 'Grand final', week: 1, home: 's1', away: 's2' }] },

  { id: 'top2-best-of-3', teams: 2, name: 'Best of three', summary: '1 v 2, first to two wins. Game 3 only if needed.',
    marks: ['final', 'final'], weeks: ['Game 1', 'Game 2', 'Game 3'], series: true,
    games: [
      { id: 'G1', name: 'Game 1', week: 1, home: 's1', away: 's2' },
      { id: 'G2', name: 'Game 2', week: 2, home: 's2', away: 's1' },
      { id: 'G3', name: 'Game 3', week: 3, home: 's1', away: 's2', ifNeeded: true },
    ] },

  { id: 'top4-semis', teams: 4, name: 'Semis then grand final', summary: '1 v 4 and 2 v 3, and the winners play off.',
    marks: ['elim', 'elim', 'elim', 'elim'], weeks: ['Semi finals', 'Grand final'],
    games: [
      { id: 'SF1', name: 'Semi final 1', week: 1, home: 's1', away: 's4' },
      { id: 'SF2', name: 'Semi final 2', week: 1, home: 's2', away: 's3' },
      { id: 'GF', name: 'Grand final', week: 2, home: 'W:SF1', away: 'W:SF2' },
    ] },

  { id: 'top4-page', teams: 4, name: 'Page (double chance for 1 and 2)',
    summary: 'The 1 v 2 winner goes straight to the grand final and the loser gets another chance. The 3 v 4 loser is out. Then a preliminary final.',
    marks: ['double', 'double', 'elim', 'elim'], weeks: ['Semi finals', 'Preliminary final', 'Grand final'],
    games: [
      { id: 'MSF', name: 'Major semi final', week: 1, home: 's1', away: 's2' },
      { id: 'mSF', name: 'Minor semi final', week: 1, home: 's3', away: 's4' },
      { id: 'PF', name: 'Preliminary final', week: 2, home: 'L:MSF', away: 'W:mSF' },
      { id: 'GF', name: 'Grand final', week: 3, home: 'W:MSF', away: 'W:PF' },
    ] },

  { id: 'top4-placings', teams: 4, name: 'Placings day', summary: '1 v 2 for the title and 3 v 4 for third, one round.',
    marks: ['final', 'final', 'third', 'third'], weeks: ['Finals'],
    games: [
      { id: 'GF', name: 'Grand final', week: 1, home: 's1', away: 's2' },
      { id: 'P3', name: 'Third place play-off', week: 1, home: 's3', away: 's4', placing: 3 },
    ] },

  { id: 'top6-byes', teams: 6, name: 'Byes for 1 and 2',
    summary: '3 v 6 and 4 v 5 first while 1 and 2 have the week off. Then 1 plays the lower winner and 2 the higher, then the grand final.',
    marks: ['bye', 'bye', 'elim', 'elim', 'elim', 'elim'], weeks: ['Elimination finals', 'Semi finals', 'Grand final'],
    games: [
      { id: 'EF1', name: 'Elimination final 1', week: 1, home: 's3', away: 's6' },
      { id: 'EF2', name: 'Elimination final 2', week: 1, home: 's4', away: 's5' },
      { id: 'SF1', name: 'Semi final 1', week: 2, home: 's1', away: 'Wlow:EF1,EF2' },
      { id: 'SF2', name: 'Semi final 2', week: 2, home: 's2', away: 'Whigh:EF1,EF2' },
      { id: 'GF', name: 'Grand final', week: 3, home: 'W:SF1', away: 'W:SF2' },
    ] },

  { id: 'top6-double', teams: 6, name: 'Double chance for 1 and 2',
    summary: '1 v 2 (the winner goes to the grand final), 3 v 6 and 4 v 5 eliminations, then a semi final, a preliminary final and the grand final.',
    marks: ['double', 'double', 'elim', 'elim', 'elim', 'elim'], weeks: ['Qualifying and elimination finals', 'Semi final', 'Preliminary final', 'Grand final'],
    games: [
      { id: 'QF', name: 'Qualifying final', week: 1, home: 's1', away: 's2' },
      { id: 'EF1', name: 'Elimination final 1', week: 1, home: 's3', away: 's6' },
      { id: 'EF2', name: 'Elimination final 2', week: 1, home: 's4', away: 's5' },
      { id: 'SF', name: 'Semi final', week: 2, home: 'Whigh:EF1,EF2', away: 'Wlow:EF1,EF2' },
      { id: 'PF', name: 'Preliminary final', week: 3, home: 'L:QF', away: 'W:SF' },
      { id: 'GF', name: 'Grand final', week: 4, home: 'W:QF', away: 'W:PF' },
    ] },

  { id: 'top8-afl', teams: 8, name: 'AFL style',
    summary: '1 v 4 and 2 v 3 with a double chance, 5 v 8 and 6 v 7 elimination, then semi finals, preliminary finals and the grand final.',
    marks: ['double', 'double', 'double', 'double', 'elim', 'elim', 'elim', 'elim'],
    weeks: ['Qualifying and elimination finals', 'Semi finals', 'Preliminary finals', 'Grand final'],
    games: [
      { id: 'QF1', name: 'Qualifying final 1', week: 1, home: 's1', away: 's4' },
      { id: 'QF2', name: 'Qualifying final 2', week: 1, home: 's2', away: 's3' },
      { id: 'EF1', name: 'Elimination final 1', week: 1, home: 's5', away: 's8' },
      { id: 'EF2', name: 'Elimination final 2', week: 1, home: 's6', away: 's7' },
      { id: 'SF1', name: 'Semi final 1', week: 2, home: 'L:QF1', away: 'W:EF1' },
      { id: 'SF2', name: 'Semi final 2', week: 2, home: 'L:QF2', away: 'W:EF2' },
      { id: 'PF1', name: 'Preliminary final 1', week: 3, home: 'W:QF1', away: 'W:SF2' },
      { id: 'PF2', name: 'Preliminary final 2', week: 3, home: 'W:QF2', away: 'W:SF1' },
      { id: 'GF', name: 'Grand final', week: 4, home: 'W:PF1', away: 'W:PF2' },
    ] },

  { id: 'top8-knockout', teams: 8, name: 'Straight knockout', summary: '1 v 8, 2 v 7, 3 v 6, 4 v 5, then semi finals and the grand final.',
    marks: ['elim', 'elim', 'elim', 'elim', 'elim', 'elim', 'elim', 'elim'], weeks: ['Quarter finals', 'Semi finals', 'Grand final'],
    games: [
      { id: 'QF1', name: 'Quarter final 1', week: 1, home: 's1', away: 's8' },
      { id: 'QF2', name: 'Quarter final 2', week: 1, home: 's4', away: 's5' },
      { id: 'QF3', name: 'Quarter final 3', week: 1, home: 's2', away: 's7' },
      { id: 'QF4', name: 'Quarter final 4', week: 1, home: 's3', away: 's6' },
      { id: 'SF1', name: 'Semi final 1', week: 2, home: 'W:QF1', away: 'W:QF2' },
      { id: 'SF2', name: 'Semi final 2', week: 2, home: 'W:QF3', away: 'W:QF4' },
      { id: 'GF', name: 'Grand final', week: 3, home: 'W:SF1', away: 'W:SF2' },
    ] },

  { id: 'top8-placings', teams: 8, name: 'Carnival placings',
    summary: 'The straight knockout plus play-offs, so every team finishes with a place from 1 to 8.',
    marks: ['elim', 'elim', 'elim', 'elim', 'elim', 'elim', 'elim', 'elim'], weeks: ['Quarter finals', 'Semi finals and 5th to 8th', 'Placings'],
    games: [
      { id: 'QF1', name: 'Quarter final 1', week: 1, home: 's1', away: 's8' },
      { id: 'QF2', name: 'Quarter final 2', week: 1, home: 's4', away: 's5' },
      { id: 'QF3', name: 'Quarter final 3', week: 1, home: 's2', away: 's7' },
      { id: 'QF4', name: 'Quarter final 4', week: 1, home: 's3', away: 's6' },
      { id: 'SF1', name: 'Semi final 1', week: 2, home: 'W:QF1', away: 'W:QF2' },
      { id: 'SF2', name: 'Semi final 2', week: 2, home: 'W:QF3', away: 'W:QF4' },
      { id: 'PS1', name: '5th to 8th semi 1', week: 2, home: 'L:QF1', away: 'L:QF2' },
      { id: 'PS2', name: '5th to 8th semi 2', week: 2, home: 'L:QF3', away: 'L:QF4' },
      { id: 'GF', name: 'Grand final', week: 3, home: 'W:SF1', away: 'W:SF2' },
      { id: 'P3', name: 'Third place play-off', week: 3, home: 'L:SF1', away: 'L:SF2', placing: 3 },
      { id: 'P5', name: 'Fifth place play-off', week: 3, home: 'W:PS1', away: 'W:PS2', placing: 5 },
      { id: 'P7', name: 'Seventh place play-off', week: 3, home: 'L:PS1', away: 'L:PS2', placing: 7 },
    ] },

  { id: 'all-placings', teams: 0, all: true, name: 'Every team plays on grand final day',
    summary: '1 v 2 for the title, 3 v 4 for third, 5 v 6 for fifth and so on down the ladder, all on one day. Nobody is knocked out: every team plays for its final place. With an odd number of teams, the last one has no game.',
    marks: [], weeks: ['Grand final day'], games: [] },
];

// Every team plays: 1 v 2 in the grand final, then 3 v 4, 5 v 6... for the places below.
const PLACE_WORDS = { 3: 'Third', 5: 'Fifth', 7: 'Seventh', 9: 'Ninth', 11: 'Eleventh', 13: 'Thirteenth', 15: 'Fifteenth', 17: 'Seventeenth', 19: 'Nineteenth' };
function sized(format, count) {
  if (!format || !format.all) return format;
  const n = Math.max(2, (Number(count) || 0) - ((Number(count) || 0) % 2));
  const games = [], marks = [];
  for (let p = 1; p < n; p += 2) {
    games.push(p === 1 ? { id: 'GF', name: 'Grand final', week: 1, home: 's1', away: 's2' }
      : { id: `P${p}`, name: `${PLACE_WORDS[p] || ordinal(p)} place play-off`, week: 1, home: `s${p}`, away: `s${p + 1}`, placing: p });
    marks.push(...(p === 1 ? ['final', 'final'] : ['placing', 'placing']));
  }
  return { ...format, teams: n, marks, games };
}

const byId = id => FORMATS.find(f => f.id === id) || null;

// The nearest format for a setup saved with only a number of finals places.
function fromPlaces(n) {
  n = Number(n) || 0;
  if (n <= 0) return '';
  if (n <= 2) return 'top2-gf';
  if (n <= 4) return 'top4-page';
  if (n <= 6) return 'top6-byes';
  return 'top8-afl';
}

// The format a division uses: its own, else the competition's. With the number of teams
// on its ladder, a format for every team gets its games.
function formatFor(settings, division, count) {
  const own = (settings.divisionFinals || {})[division];
  if (own === 'none') return null;
  const f = byId(own) || byId(settings.finalsFormat) || null;
  return count === undefined ? f : sized(f, count);
}

// For the setup page (a format for every team is shown with 8).
function list() {
  return FORMATS.map(f => ({ id: f.id, teams: f.teams, all: !!f.all, name: f.name, summary: f.summary, marks: sized(f, 8).marks, weeks: f.weeks }));
}

// For the ladder: what each place earns, and the words for each.
function ladderMarks(format) {
  if (!format) return { places: 0, marks: [], legend: [] };
  const kinds = [...new Set(format.marks)];
  return { places: format.teams, marks: format.marks, legend: kinds.map(k => ({ mark: k, label: MARKS[k] })) };
}

// Words for a team not known yet.
function placeholder(slot, gameName) {
  const [kind, rest] = String(slot).split(':');
  if (/^s\d+$/.test(slot)) return `${ordinal(Number(slot.slice(1)))} on the ladder`;
  const ids = (rest || '').split(',');
  if (kind === 'W') return `Winner ${gameName(ids[0])}`;
  if (kind === 'L') return `Loser ${gameName(ids[0])}`;
  if (kind === 'Wlow') return `Lower winner ${ids.join(' / ')}`;
  if (kind === 'Whigh') return `Higher winner ${ids.join(' / ')}`;
  return 'TBC';
}
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Works out every finals game: who plays, the score and who won.
//   seeds    team names in ladder order
//   played   PlayHQ's finals games: [{ week, home: { name, score, outcome }, away, finished, date, time, court, status, id }]
//   manual   { gameId: { winner, homeScore, awayScore } } entered on the control page
// A PlayHQ game counts when it has the same two teams (either way round), or, while one
// team isn't known yet, when it's the same finals week and has the team that is known.
function resolve(format, seeds, played = [], manual = {}) {
  const done = new Map(); // id -> game
  const seedOf = name => { const i = seeds.findIndex(s => norm(s) === norm(name)); return i < 0 ? 99 : i + 1; };
  const used = new Set();
  const gameName = id => String((format.games.find(g => g.id === id) || {}).name || id).toLowerCase();
  const team = slot => {
    if (/^s\d+$/.test(slot)) return seeds[Number(slot.slice(1)) - 1] || null;
    const [kind, rest] = slot.split(':');
    const ids = rest.split(',');
    const games = ids.map(id => done.get(id));
    if (games.some(g => !g || !g.winner)) return null;
    if (kind === 'W') return games[0].winner;
    if (kind === 'L') return games[0].loser;
    const winners = games.map(g => g.winner).sort((a, b) => seedOf(a) - seedOf(b));
    return kind === 'Whigh' ? winners[0] : winners[winners.length - 1];
  };
  const out = [];
  let series = null;
  for (const def of format.games) {
    const g = { id: def.id, name: def.name, week: def.week, weekName: format.weeks[def.week - 1] || `Week ${def.week}`, placing: def.placing || (def.id === 'GF' ? 1 : null),
      ifNeeded: !!def.ifNeeded, home: { name: team(def.home), slot: def.home }, away: { name: team(def.away), slot: def.away },
      winner: null, loser: null, source: null };
    g.home.placeholder = placeholder(def.home, gameName);
    g.away.placeholder = placeholder(def.away, gameName);
    if (g.home.name) g.home.seed = seedOf(g.home.name);
    if (g.away.name) g.away.seed = seedOf(g.away.name);
    // A best of three is over after two wins: game 3 isn't needed.
    if (format.series && def.ifNeeded && series && Object.values(series).some(w => w >= 2)) { g.notNeeded = true; out.push(g); done.set(def.id, g); continue; }

    const known = [g.home.name, g.away.name].filter(Boolean);
    const both = known.length === 2;
    let ph = played.find(p => !used.has(p) && both && ((norm(p.home.name) === norm(g.home.name) && norm(p.away.name) === norm(g.away.name)) ||
      (norm(p.home.name) === norm(g.away.name) && norm(p.away.name) === norm(g.home.name))) && (!format.series || p.week === def.week));
    if (!ph && known.length === 1) ph = played.find(p => !used.has(p) && p.week === def.week && [p.home.name, p.away.name].some(n => norm(n) === norm(known[0])));
    if (ph) {
      used.add(ph);
      // Keep our home and away; take PlayHQ's names (they may fill in a team we didn't know yet).
      const flip = (g.home.name && norm(ph.away.name) === norm(g.home.name)) || (g.away.name && norm(ph.home.name) === norm(g.away.name));
      const [h, a] = flip ? [ph.away, ph.home] : [ph.home, ph.away];
      g.home = { ...g.home, name: h.name, seed: seedOf(h.name), score: h.score, outcome: h.outcome };
      g.away = { ...g.away, name: a.name, seed: seedOf(a.name), score: a.score, outcome: a.outcome };
      Object.assign(g, { playhqId: ph.id, date: ph.date, time: ph.time, court: ph.court, status: ph.status, round: ph.round, source: 'playhq' });
      if (ph.finished) g.winner = winnerOf(g);
    }
    const m = manual[def.id];
    if (!g.winner && m && g.home.name && g.away.name && [g.home.name, g.away.name].some(n => norm(n) === norm(m.winner))) {
      g.winner = norm(m.winner) === norm(g.home.name) ? g.home.name : g.away.name;
      if (Number.isFinite(m.homeScore) && g.home.score == null) g.home.score = m.homeScore;
      if (Number.isFinite(m.awayScore) && g.away.score == null) g.away.score = m.awayScore;
      g.source = g.source || 'manual';
      g.manual = true;
    }
    if (g.winner) {
      g.loser = norm(g.winner) === norm(g.home.name) ? g.away.name : g.home.name;
      if (format.series) { series = series || {}; series[g.winner] = (series[g.winner] || 0) + 1; }
    }
    done.set(def.id, g);
    out.push(g);
  }
  // The champion: the grand final's winner, or two wins in a best of three.
  let champion = null;
  if (format.series && series) champion = Object.keys(series).find(t => series[t] >= 2) || null;
  else { const gf = done.get('GF'); champion = gf && gf.winner || null; }
  return { games: out, champion };
}

// The winner from the score, or PlayHQ's outcome when the score is level (a forfeit, extra time).
function winnerOf(g) {
  const o = side => String(g[side].outcome || '').toUpperCase();
  if (/WIN|WON/.test(o('home'))) return g.home.name;
  if (/WIN|WON/.test(o('away'))) return g.away.name;
  if (g.home.score != null && g.away.score != null && g.home.score !== g.away.score) return g.home.score > g.away.score ? g.home.name : g.away.name;
  return null;
}

module.exports = { FORMATS, MARKS, byId, sized, fromPlaces, formatFor, list, ladderMarks, resolve, ordinal };
