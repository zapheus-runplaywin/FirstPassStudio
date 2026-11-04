// FirstPass Studio - what the Socials tab's pictures work out from the season's fixture, results and ladders (socials.js
// gathers them; nothing here asks PlayHQ). Each takes the season as Studio already has it:
//   season   every game of the season, in date and time order: { id, date, time, division, round, home: { name, score },
//            away, finished } (socials.js seasonOf; finished once PlayHQ has its final score)
//   rows     a division's ladder rows from PlayHQ: { position, team, played, won, lost, drawn, byes, points, pointsFor,
//            pointsAgainst }
// placesBefore and review: each team's place before a night, and Round in review (biggest win, closest game, upsets).
// formOf: a game's two teams' last results and their meetings this season (Form guide). preview: a division's games that
// night with each team's place and what a win could do (Round preview). byes: who isn't playing. race: a division's
// finals race (in, out, still a chance). countdown: how close the finals or the grand final are. draw: a team's season.
// Results: numbers (Night in numbers), clubs (Club round up), streaks (Still unbeaten), teamCard (Team season card),
// biggestWin and lastNights (Season wrap).

'use strict';

const { ROUND: FINALS_ROUND } = require('./finals');

const sameName = (a, b) => String(a || '').toLowerCase().replace(/[^a-z0-9]/g, '') === String(b || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const plays = (g, team) => sameName(g.home.name, team) || sameName(g.away.name, team);
const regular = g => !FINALS_ROUND.test(g.round || '');
const FORM_SHOWN = 5;
const UPSET_MOST = 4;
const RACE_ROUNDS = 3; // the finals race shows once a division has this many rounds or fewer left, tonight's included
const COUNTDOWN_ROUNDS = 4;

// What a win is worth on a ladder: PlayHQ doesn't say, so it's points over wins for the teams with no draws or byes (the
// middle one), 4 when no team shows it. A draw is half that.
function winPoints(rows) {
  const each = rows.filter(r => r.won > 0 && !r.drawn && !r.byes && Number.isFinite(r.points)).map(r => r.points / r.won).sort((a, b) => a - b);
  return each.length ? each[Math.floor(each.length / 2)] : 4;
}

// Where each team stood before the games given (a night's finished games in one division), from PlayHQ's ladder after
// them: each game taken back off (played, scores for and against, and the points it earned), then ranked again by points
// and percentage, ties as PlayHQ has them. A Map of team to place, or null when nobody had played before. A bye's points
// that night aren't known, so they stay on.
function placesBefore(rows, played) {
  if (!rows.length || !played.length) return null;
  const win = winPoints(rows);
  const back = rows.map(r => {
    let [p, points, pf, pa] = [r.played, r.points, r.pointsFor, r.pointsAgainst].map(v => Number(v) || 0);
    for (const g of played) {
      const side = sameName(g.home.name, r.team) ? 'home' : sameName(g.away.name, r.team) ? 'away' : null;
      if (!side) continue;
      const us = g[side].score, them = g[side === 'home' ? 'away' : 'home'].score;
      p--; pf -= us; pa -= them; points -= us > them ? win : us === them ? win / 2 : 0;
    }
    return { team: r.team, position: r.position, played: p, points, pct: pa > 0 ? pf / pa : 0 };
  });
  if (!back.some(r => r.played > 0)) return null;
  back.sort((a, b) => b.points - a.points || b.pct - a.pct || a.position - b.position);
  return new Map(back.map((r, i) => [r.team, i + 1]));
}

// Round in review: the night's biggest win and closest game (a draw is the closest), and every upset: a winner that stood
// at least half the ladder lower before the night, or 4 places, whichever is fewer (2 places in a ladder of 4, 3 in 6, 4
// in 10), biggest gap first. Upsets need the places before the night (the ladders' before), so an older night has none.
function review(games, ladders) {
  const done = games.filter(g => g.finished);
  const margin = g => Math.abs(g.home.score - g.away.score);
  const biggest = [...done].sort((a, b) => margin(b) - margin(a))[0] || null;
  const closest = done.filter(g => g !== biggest).sort((a, b) => margin(a) - margin(b))[0] || null;
  const upsets = [];
  for (const g of done.filter(x => x.winner === 'home' || x.winner === 'away')) {
    const l = ladders.find(x => x.division === g.division);
    if (!l || !l.movers) continue;
    const place = t => (l.rows.find(r => sameName(r.team, t.name)) || {}).before;
    const [w, lo] = g.winner === 'home' ? [g.home, g.away] : [g.away, g.home];
    const gap = place(w) - place(lo);
    if (gap >= Math.min(Math.ceil(l.rows.length / 2), UPSET_MOST)) upsets.push({ id: g.id, winnerWas: place(w), loserWas: place(lo), gap });
  }
  upsets.sort((a, b) => b.gap - a.gap);
  return { biggest: biggest && biggest.id, closest: closest && closest.id, upsets };
}

// One team's result in a finished game: W, L or D, against whom and the score from its side.
function resultOf(g, team) {
  const [us, them] = sameName(g.home.name, team) ? [g.home, g.away] : [g.away, g.home];
  return { result: us.score > them.score ? 'W' : us.score < them.score ? 'L' : 'D', opponent: them.name, for: us.score, against: them.score,
    round: g.round || '', date: g.date };
}
// Form guide for a game: each team's last five results in its division before the night (oldest first), and the two
// teams' meetings this season (wins: how many each has won).
function formOf(season, date, g) {
  const past = season.filter(x => x.finished && x.date < date && x.division === g.division);
  const of = team => past.filter(x => plays(x, team)).slice(-FORM_SHOWN).map(x => resultOf(x, team));
  const met = past.filter(x => plays(x, g.home.name) && plays(x, g.away.name)).map(x => resultOf(x, g.home.name));
  return { id: g.id, home: of(g.home.name), away: of(g.away.name), meetings: met,
    wins: { home: met.filter(m => m.result === 'W').length, away: met.filter(m => m.result === 'L').length, draws: met.filter(m => m.result === 'D').length } };
}

// Round preview for a division: its games that night, each team's place and points on the ladder as it stands, the game
// of the round (the two best placed teams, called top of the table when it's 1st v 2nd), and what a win can do: a team
// outside the finals places that would reach the points of the team in the last of them.
function preview(games, division, rows, finalsPlaces) {
  const mine = games.filter(g => g.division === division);
  const placed = rows.some(r => r.played > 0);
  const row = t => (placed && rows.find(r => sameName(r.team, t.name))) || null;
  const win = winPoints(rows);
  const cut = finalsPlaces && rows.length > finalsPlaces ? rows.find(r => r.position === finalsPlaces) : null;
  const out = mine.map(g => {
    const [h, a] = [row(g.home), row(g.away)];
    const climbs = [g.home, g.away].filter((t, i) => { const r = [h, a][i]; return cut && r && r.position > finalsPlaces && (r.points || 0) + win >= (cut.points || 0); })
      .map(t => t.name);
    return { id: g.id, home: h ? { place: h.position, points: h.points || 0 } : null, away: a ? { place: a.position, points: a.points || 0 } : null, climbs };
  });
  const best = out.filter(x => x.home && x.away).sort((x, y) => (x.home.place + x.away.place) - (y.home.place + y.away.place))[0];
  return { division, finalsPlaces: cut ? finalsPlaces : 0, games: out, pick: best ? best.id : null,
    topOfTable: !!best && [best.home.place, best.away.place].sort().join() === '1,2' };
}

// The teams of each division playing that night that aren't: every team in the division's season fixture, less tonight's.
function byes(season, games) {
  const out = [];
  for (const division of [...new Set(games.map(g => g.division).filter(Boolean))]) {
    const teams = [...new Set(season.filter(g => g.division === division && regular(g)).flatMap(g => [g.home.name, g.away.name]).filter(Boolean))];
    const off = teams.filter(t => !games.some(g => g.division === division && plays(g, t))).sort((a, b) => a.localeCompare(b));
    if (off.length && !games.filter(g => g.division === division).some(g => !regular(g))) out.push({ division, teams: off });
  }
  return out;
}

// The divisions whose finals race is on that night: with a finals format, and RACE_ROUNDS or fewer nights of regular
// games left from that night on (left: how many).
function raceOn(season, date, divisions) {
  return divisions.map(division => {
    const nights = new Set(season.filter(g => g.division === division && regular(g) && g.date >= date).map(g => g.date));
    return { division, left: nights.size };
  }).filter(x => x.left >= 1 && x.left <= RACE_ROUNDS);
}
// A division's finals race: each team on the ladder as it stands with its regular games left, and where it stands: in
// (fewer teams than the finals places could still reach its points), out (can't reach the points of the team in the last
// finals place, even winning every game left), or a chance.
function race(season, date, division, rows, finalsPlaces) {
  const win = winPoints(rows);
  const left = team => season.filter(g => g.division === division && regular(g) && !g.finished && g.date >= date && plays(g, team)).length;
  const all = rows.map(r => ({ team: r.team, position: r.position, points: Number(r.points) || 0, left: left(r.team) }))
    .map(r => ({ ...r, most: r.points + r.left * win }));
  const cut = all.find(r => r.position === finalsPlaces);
  return { division, finalsPlaces, rows: all.map(r => {
    const chasers = all.filter(o => o !== r && o.most >= r.points).length;
    const status = !cut || all.length <= finalsPlaces ? 'in' : chasers < finalsPlaces ? 'in' : r.most < cut.points ? 'out' : 'chance';
    return { team: r.team, position: r.position, points: r.points, left: r.left, status };
  }) };
}

// How close the finals are that night, over the divisions with a finals format: rounds: the nights of regular games left
// from that night on (1 is the last before the finals), shown once there are COUNTDOWN_ROUNDS or fewer; or on a finals
// night, days to the grand final's night (0 on the night). null when neither.
function countdown(season, date, divisions) {
  const mine = season.filter(g => divisions.includes(g.division));
  if (!mine.length) return null;
  const tonight = mine.filter(g => g.date === date);
  if (tonight.length && tonight.every(g => !regular(g))) {
    const gf = mine.filter(g => /grand/i.test(g.round || '') && g.date >= date).map(g => g.date).sort()[0];
    return gf ? { grandFinal: Math.round((Date.parse(`${gf}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 864e5) } : null;
  }
  const rounds = new Set(mine.filter(g => regular(g) && g.date >= date).map(g => g.date)).size;
  return tonight.length && rounds >= 1 && rounds <= COUNTDOWN_ROUNDS ? { rounds } : null;
}

// A team's season in one division: every game, in order, with whether it's at home, the opponent, and the result once
// played (W 31-26).
function draw(season, division, team) {
  return season.filter(g => g.division === division && plays(g, team)).map(g => {
    const home = sameName(g.home.name, team);
    return { id: g.id, date: g.date, time: g.time, court: g.court || '', round: g.round || '', home, opponent: (home ? g.away : g.home).name,
      ...(g.finished ? { result: resultOf(g, team) } : {}) };
  });
}
// Night in numbers: the night's finished games added up. close: games decided by CLOSE goals or fewer (a draw included).
const CLOSE = 3;
function numbers(games) {
  const done = games.filter(g => g.finished);
  const margin = g => Math.abs(g.home.score - g.away.score);
  const top = [...done].sort((a, b) => Math.max(b.home.score, b.away.score) - Math.max(a.home.score, a.away.score))[0];
  return { games: done.length, points: done.reduce((n, g) => n + g.home.score + g.away.score, 0), close: done.filter(g => margin(g) <= CLOSE).length,
    draws: done.filter(g => !margin(g)).length, biggest: done.length ? Math.max(...done.map(margin)) : 0,
    highest: top ? { team: top.home.score >= top.away.score ? top.home.name : top.away.name, score: Math.max(top.home.score, top.away.score) } : null, closeMargin: CLOSE };
}

// The clubs with teams in more than one finished game that night (clubOf: the club a team belongs to, from Competitions
// setup), each with those games' ids.
function clubs(games, clubOf) {
  const by = new Map();
  for (const g of games.filter(x => x.finished)) {
    for (const t of [g.home.name, g.away.name]) {
      const c = clubOf(t);
      if (!c) continue;
      const list = by.get(c) || [];
      if (!list.includes(g.id)) list.push(g.id);
      by.set(c, list);
    }
  }
  return [...by].filter(([, ids]) => ids.length > 1).map(([club, games]) => ({ club, games })).sort((a, b) => a.club.localeCompare(b.club));
}

// A team's results this season in one division up to and including a night, oldest first.
const resultsTo = (season, date, division, team) => season.filter(g => g.finished && g.date <= date && g.division === division && plays(g, team)).map(g => resultOf(g, team));
// Its current run: the same result over its latest games (wins, losses or draws) and how many.
function runOf(results) {
  const last = results[results.length - 1];
  if (!last) return null;
  let n = 0;
  for (let i = results.length - 1; i >= 0 && results[i].result === last.result; i--) n++;
  return { result: last.result, games: n };
}
// The teams of the divisions playing that night on a run once that night's results are in: unbeaten all season (STREAK
// games or more), or STREAK wins or more in a row; longest first.
const STREAK = 3;
function streaks(season, date, games) {
  const out = [];
  for (const division of [...new Set(games.filter(g => g.finished).map(g => g.division).filter(Boolean))]) {
    const teams = [...new Set(season.filter(g => g.division === division).flatMap(g => [g.home.name, g.away.name]))];
    for (const team of teams) {
      const r = resultsTo(season, date, division, team);
      const run = runOf(r);
      const unbeaten = r.length >= STREAK && !r.some(x => x.result === 'L');
      if (unbeaten || (run && run.result === 'W' && run.games >= STREAK)) {
        out.push({ division, team, played: r.length, won: r.filter(x => x.result === 'W').length, drawn: r.filter(x => x.result === 'D').length,
          unbeaten, run: run.result === 'W' ? run.games : 0 });
      }
    }
  }
  return out.sort((a, b) => b.run - a.run || b.played - a.played || a.team.localeCompare(b.team));
}

// A team's season card up to a night: played, won, lost, drawn, scores for and against, its ladder place (rows), its
// current run and its biggest win.
function teamCard(season, date, division, team, rows) {
  const r = resultsTo(season, date, division, team);
  const count = k => r.filter(x => x.result === k).length;
  const pf = r.reduce((n, x) => n + x.for, 0), pa = r.reduce((n, x) => n + x.against, 0);
  const wins = r.filter(x => x.result === 'W').sort((a, b) => (b.for - b.against) - (a.for - a.against));
  const row = rows.find(x => sameName(x.team, team));
  return { division, team, played: r.length, won: count('W'), lost: count('L'), drawn: count('D'), for: pf, against: pa,
    percentage: pa ? Math.round(pf / pa * 1000) / 10 : null, place: row ? row.position : null, points: row ? row.points : null,
    run: runOf(r), biggestWin: wins[0] || null, results: r };
}

// The biggest win of a division's season up to a night.
function biggestWin(season, date, division) {
  const done = season.filter(g => g.finished && g.date <= date && g.division === division && g.home.score !== g.away.score);
  const g = [...done].sort((a, b) => Math.abs(b.home.score - b.away.score) - Math.abs(a.home.score - a.away.score))[0];
  return g ? { id: g.id, date: g.date, round: g.round, home: g.home, away: g.away } : null;
}
// The divisions ending their season that night: no games of theirs after it.
const lastNights = (season, date) => [...new Set(season.filter(g => g.date === date).map(g => g.division))]
  .filter(d => d && !season.some(g => g.division === d && g.date > date));

// The divisions starting their season that night: their first night of games is this one.
const firstNights = (season, date) => [...new Set(season.filter(g => g.date === date).map(g => g.division))]
  .filter(d => d && !season.some(g => g.division === d && g.date < date));

module.exports = { sameName, winPoints, placesBefore, review, formOf, preview, byes, raceOn, race, countdown, draw, firstNights, lastNights, numbers, clubs, streaks,
  teamCard, biggestWin, FORM_SHOWN, STREAK };
