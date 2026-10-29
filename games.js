// FirstPass Studio - the games: which game night and round are "this round", the fixture, up next and the
// end of night card, the intro and outro, the countdown, automatic game selection, and the
// season graphics (ladder bar, head to head, form, ticker, top shooters) and the finals.
// Moved out of server.js unchanged (review decision D6); create(deps) takes what it needs from there.

'use strict';

const { isFinished, startOf, localDate } = require('./playhq');

function create({ log, config, competitions, finals, playhq, board: theBoard, control, logoFor, colourFor, norm, sameTeam, courtPlan = async () => null }) {
  const { getStructure, getLadder, findGrade, getRounds, getRoundGames, readGame, eachLimited, PLAYHQ_AT_ONCE, getLive, liveScore, PERIOD_NUMBER } = playhq;
  const { board, applyAction, saveBoards, TICKER_SPEED } = theBoard;

  // ─── Which game night, and which round is "this round" ──────────────────────
  // The control page's game list is a game night: every division's games on one date, whatever
  // round each division is up to (one can be on Round 10 while another plays Finals Round 1).
  // Automatic is the first date any division plays in the next roundLookaheadDays days (default 5,
  // counting today, so a Tuesday night is picked from the Friday before), otherwise the last date
  // played. A night picked by hand on the control page is kept in control.json (blank means
  // automatic); each division's "this round" is then its round on that night.
  const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
  let nightChoice = isDate(control.get().night) ? control.get().night : '';
  if (control.get().round) {
    // Studio used to keep a round picked by hand; a round can be a different night in each division.
    log('info', 'round', `The round picked by hand (${control.get().round}) is now a game night: set back to automatic`);
    control.get().round = '';
    control.save();
  }
  // A night (a date), or for older callers a round's number or name, which means the date it is played
  // in the first division that has it. Blank means automatic.
  async function setNightChoice(value) {
    let night = String(value || '').trim();
    if (night && !isDate(night)) {
      const st = await getStructure();
      let found = '';
      for (const grade of st.grades) {
        const rounds = await getRounds(grade.id);
        const key = roundKeys(rounds);
        const hit = rounds.find(r => key(r) === night) || rounds.find(r => r.name.toLowerCase() === night.toLowerCase());
        if (hit) { found = (await roundDates(grade)).get(hit.id) || ''; break; }
      }
      if (!found) throw new Error(`No game night for round "${night}"`);
      night = found;
    }
    nightChoice = control.get().night = night;
    control.save();
    log('info', 'round', nightChoice ? `Game night picked by hand: ${nightChoice}` : 'Game night picked automatically by date');
  }
  let LOOKAHEAD_DAYS = 5;
  // A round's key in the round list: its number, or its name when the number isn't unique
  // (PlayHQ numbers finals rounds from 1 again, so "Grand Final" can share number 3 with Round 3).
  function roundKeys(rounds) {
    const count = {};
    for (const r of rounds) if (r.number != null) count[r.number] = (count[r.number] || 0) + 1;
    return r => (r.number != null && count[r.number] === 1 ? String(r.number) : r.name);
  }
  const dayDiff = (date, today) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  const roundDatesCache = new Map();
  // The first game date of each round in a division, and its first game's start time (kept for 30 minutes).
  async function roundDates(grade) {
    const hit = roundDatesCache.get(grade.id);
    if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit.dates;
    const dates = new Map(), starts = new Map();
    for (const r of await getRounds(grade.id)) {
      const games = (await getRoundGames(r.id, 30 * 60 * 1000)).filter(g => g.date).sort(byStart);
      if (!games.length) continue;
      dates.set(r.id, games[0].date);
      const first = games.map(g => startOf(g)).find(t => t !== null);
      if (first) starts.set(r.id, first);
    }
    dates.starts = starts;
    roundDatesCache.set(grade.id, { at: Date.now(), dates });
    return dates;
  }
  async function pickRound(grade, night = nightChoice) {
    const rounds = await getRounds(grade.id);
    if (!rounds.length) return null;
    if (night) {
      // The division's round on that night (none when it doesn't play then). A carnival plays several
      // rounds on one day: today, it's the last that has started (or is about to), else the first.
      const on = [];
      for (const g of await getSeasonGames(grade)) {
        if (g.date !== night) continue;
        const r = rounds.find(x => x.id === g.roundId);
        const start = startOf(g);
        const seen = on.find(x => x.r === r);
        if (!r) continue;
        if (!seen) on.push({ r, start });
        else if (start !== null && (seen.start === null || start < seen.start)) seen.start = start;
      }
      on.sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity));
      if (!on.length) return null;
      const started = night === localDate() ? on.filter(x => x.start !== null && x.start - AUTO_LEAD_MS <= Date.now()) : [];
      return (started.length ? started[started.length - 1] : on[0]).r;
    }
    try {
      const dates = await roundDates(grade);
      const today = localDate();
      const dated = rounds.filter(r => dates.has(r.id)).map(r => ({ r, diff: dayDiff(dates.get(r.id), today) }));
      // A carnival plays several rounds on one day: today, it's the last round that has started
      // (or is about to, autoSelectMinutesBefore ahead), else today's first round.
      const todays = dated.filter(x => x.diff === 0 && dates.starts && dates.starts.has(x.r.id)).sort((a, b) => dates.starts.get(a.r.id) - dates.starts.get(b.r.id));
      if (todays.length > 1) {
        const started = todays.filter(x => dates.starts.get(x.r.id) - AUTO_LEAD_MS <= Date.now());
        return (started.length ? started[started.length - 1] : todays[0]).r;
      }
      const soon = dated.filter(x => x.diff >= 0 && x.diff < LOOKAHEAD_DAYS).sort((a, b) => a.diff - b.diff);
      if (soon.length) return soon[0].r;
      const past = dated.filter(x => x.diff < 0).sort((a, b) => b.diff - a.diff);
      if (past.length) return past[0].r;
      const future = dated.sort((a, b) => a.diff - b.diff);
      if (future.length) return future[0].r;
    } catch (err) { log('warn', 'round', `Could not work out the round by date: ${err.message}`); }
    return rounds.find(r => r.current) || rounds[rounds.length - 1];
  }
  // Every date any division plays this season, with each division's round that night.
  async function gameNights() {
    const nights = new Map();
    for (const grade of (await getStructure()).grades) {
      for (const g of await getSeasonGames(grade)) {
        if (!g.date) continue;
        const night = nights.get(g.date) || nights.set(g.date, { date: g.date, rounds: [] }).get(g.date);
        if (!night.rounds.some(x => x.division === grade.name && x.round === g.round)) night.rounds.push({ division: grade.name, round: g.round });
      }
    }
    return [...nights.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
  // The night automatic picks: the first played in the next LOOKAHEAD_DAYS days, else the last played, else the first to come.
  function autoNight(nights) {
    const today = localDate();
    const dated = nights.map(n => ({ n, diff: dayDiff(n.date, today) }));
    const pick = dated.find(x => x.diff >= 0 && x.diff < LOOKAHEAD_DAYS) || dated.filter(x => x.diff < 0).pop() || dated[0];
    return pick ? pick.n.date : '';
  }
  // A night's rounds in a few words: "Round 10" when every division is on it, else each division's.
  function nightRounds(night) {
    const names = [...new Set(night.rounds.map(x => x.round))];
    return names.length === 1 ? names[0] : night.rounds.map(x => `${x.division} ${x.round}`).join(', ');
  }
  async function currentNight() {
    return nightChoice || autoNight(await gameNights());
  }
  // For the control page: the game nights, what's picked, and what automatic would pick.
  async function getRoundInfo() {
    const nights = await gameNights();
    const auto = autoNight(nights);
    const autoAt = nights.find(n => n.date === auto);
    return { choice: nightChoice, auto, autoRounds: autoAt ? nightRounds(autoAt) : '', lookaheadDays: LOOKAHEAD_DAYS,
      nights: nights.map(n => ({ ...n, summary: nightRounds(n) })) };
  }

  // Every division's games on this game night (whatever round each is on), for the control page's game picker.
  async function getCurrentGames() {
    const night = await currentNight();
    const out = [];
    if (!night) return out;
    for (const grade of (await getStructure()).grades) {
      for (const g of await getSeasonGames(grade)) if (g.date === night) out.push(g);
    }
    return out;
  }

  // The round a page asked for with ?round=: a number or name ("6", "Round 6", "Final"),
  // or one counted from this round (as the control page has it): "this", "next", "prev"
  // (or "previous", "last"), "+2", "-1". Blank means this round. Rounds are counted in
  // PlayHQ's order, so "next" from the last round finds nothing.
  const ROUND_STEPS = { '': 0, this: 0, current: 0, now: 0, next: 1, prev: -1, previous: -1, last: -1 };
  async function roundFor(grade, value) {
    const want = String(value || '').trim().toLowerCase().replace(/\s+/g, '');
    const rounds = await getRounds(grade.id);
    const step = want in ROUND_STEPS ? ROUND_STEPS[want] : /^[+-]\d+$/.test(want) ? Number(want) : null;
    if (step === null) {
      const name = String(value).trim().toLowerCase();
      return rounds.find(r => String(r.number) === name || r.name.toLowerCase() === name) || null;
    }
    const now = await pickRound(grade);
    if (!now || !step) return now;
    const at = rounds.findIndex(r => r.id === now.id);
    return at < 0 ? null : rounds[at + step] || null;
  }

  // A whole round for the fixture page: every division (or one), sorted by time then court.
  // ?round= picks the round (see roundFor); otherwise each division's current round.
  async function getFixtures(q) {
    const st = await getStructure();
    const grades = q.division ? [findGrade(st, q)].filter(Boolean) : st.grades;
    const games = [], roundNames = [];
    for (const grade of grades) {
      const round = await roundFor(grade, q.round);
      if (!round) {
        log('info', 'fixtures', `${grade.name}: no round "${q.round || 'this'}"`);
        continue;
      }
      roundNames.push(round.name);
      for (const game of await getRoundGames(round.id, 60 * 1000)) {
        if (q.results && !isFinished(game)) continue;
        games.push({ ...game, division: grade.name, round: round.name,
          home: { ...game.home, logo: logoFor(game.home.name) }, away: { ...game.away, logo: logoFor(game.away.name) } });
      }
    }
    const key = x => `${x.date || ''} ${String(x.time || '').padStart(5, '0')} ${x.court || ''}`;
    games.sort((a, b) => key(a).localeCompare(key(b), 'en', { numeric: true }));
    // One round name for the heading when every division is on it; divisions on different rounds the same
    // night (one on Round 10, another on Finals Round 1) have no one name, so each game shows its own.
    const names = [...new Set(roundNames)];
    const round = names.length === 1 ? names[0] : '';
    if (q.round && !roundNames.length) return { error: `No round "${q.round}" in ${q.division ? 'that division' : 'any division'}` };
    log('info', 'fixtures', `Fixture${q.results ? ' results' : ''} for ${names.join(', ') || 'no round'}${q.round ? ` (asked for round=${q.round})` : ''}: ${games.length} games`);
    return { competition: st.competition, rules: rules(q.division && grades[0] ? grades[0].name : undefined), venueName: config().venueName || (games[0] && games[0].venue) || '',
      division: q.division ? (grades[0] && grades[0].name) || '' : '', round, rounds: names, games };
  }

  // The game after the one on the scoreboard: the next timeslot on the same court
  // (any court if that court has nothing later). With no game picked, it assumes the
  // stream is on the first timeslot and shows the game after it. With { wrap: true }, when
  // there's no later game (or with { wrap: 'force' } always) it adds the end of night card's
  // details as wrap (see endOfNight).
  async function getUpNext({ wrap = false } = {}) {
    const b = board();
    const games = await getCurrentGames();
    const key = g => `${g.date || ''} ${String(g.time || '').padStart(5, '0')}`;
    games.sort((x, y) => key(x).localeCompare(key(y)));
    let current = games.find(g => g.id === b.gameId) || games[0];
    // A carnival day has several rounds: the next game may be in the next round, so add the rest of that day's games.
    if (current && current.date) {
      for (const grade of (await getStructure()).grades) {
        for (const g of await getSeasonGames(grade)) if (g.date === current.date && !games.some(x => x.id === g.id)) games.push(g);
      }
      games.sort((x, y) => key(x).localeCompare(key(y)));
      current = games.find(g => g.id === current.id);
    }
    if (!current) return { error: 'No games found in the current round' };
    const court = b.court || current.court;
    const later = games.filter(g => g.id !== current.id && key(g) > key(current));
    const next = later.find(g => court && g.court === court) || later[0];
    const out = { competition: competitionName(), venueName: config().venueName || current.venue || '',
      after: { home: current.home.name, away: current.away.name, court: current.court, time: current.time } };
    if (wrap && (!next || wrap === 'force')) {
      const w = await endOfNight(current);
      log('info', 'upnext', `End of night after ${current.home.name} v ${current.away.name} (${current.round}): ${w.next ? `next ${w.next.round} on ${w.next.date || 'a date not set yet'}` : w.finalsNext ? 'finals next' : 'end of the season'}`);
      return { ...out, ...(next ? { nextGame: { home: next.home.name, away: next.away.name, court: next.court, time: next.time } } : {}), wrap: w };
    }
    if (!next) return { ...out, error: 'No later game in this round' };
    return { ...out, ...next, logos: { home: logoFor(next.home.name), away: logoFor(next.away.name) } };
  }

  // The end of night card on Up next: the competition and organisation to thank, and when to come
  // back. The next round is the first round in any division dated after tonight (its name, date,
  // days away, and whether it's a finals round). Without one: finals are next when the round played
  // tonight wasn't a finals round and some division has a finals format (PlayHQ often adds finals
  // fixtures late), otherwise the season is over.
  async function endOfNight(current) {
    const st = await getStructure();
    let next = null, undated = null;
    for (const grade of st.grades) {
      const rounds = await getRounds(grade.id);
      const dates = await roundDates(grade).catch(() => new Map());
      const at = rounds.findIndex(r => r.name === current.round);
      rounds.forEach((r, i) => {
        const date = dates.get(r.id);
        if (date && current.date && date > current.date) {
          if (!next || date < next.date) next = { round: r.name, date };
        } else if (!date && at >= 0 && i > at && !undated) undated = { round: r.name, date: '' };
      });
    }
    next = next || undated;
    const r = rules();
    const finalsNext = !next && !FINALS_ROUND.test(current.round || '') && st.grades.some(g => finalsFor(g.name));
    return { competition: st.competition || competitionName() || '', organisation: st.organisation || '', season: (st.season && st.season.name) || '',
      competitionLogoLight: r.competitionLogoLight, competitionLogoDark: r.competitionLogoDark,
      round: current.round || '', date: current.date || '', finalRound: FINALS_ROUND.test(current.round || ''),
      next: next ? { ...next, days: next.date && current.date ? dayDiff(next.date, current.date) : null, finals: FINALS_ROUND.test(next.round) } : null,
      finalsNext, seasonOver: !next && !finalsNext };
  }

  // The intro and outro animations (introoutro.html): the competition, this round and the teams of a division
  // (?division=N, or the picked game's division; ?division=all for one team a club across the competition), and for
  // the outro, when to join again (endOfNight, as on Up next's end of night card).
  async function getIntroOutro(q = {}) {
    const st = await getStructure();
    const b = board();
    const games = await getCurrentGames();
    const key = g => `${g.date || ''} ${String(g.time || '').padStart(5, '0')}`;
    games.sort((x, y) => key(x).localeCompare(key(y)));
    const current = games.find(g => g.id === b.gameId) || games[0] || null;
    const all = String(q.division || '').toLowerCase() === 'all';
    const grades = all ? st.grades : [q.division ? findGrade(st, q) : st.grades.find(g => g.name === (b.division || (current && current.division))) || st.grades[0]].filter(Boolean);
    if (!grades.length) return { error: q.division ? `No division "${q.division}"` : 'This season has no divisions' };
    const seen = new Map();
    for (const grade of grades) {
      for (const g of await getSeasonGames(grade)) {
        for (const name of [g.home.name, g.away.name]) {
          if (!name || name === 'TBC' || /^bye$/i.test(name)) continue;
          const k = all ? norm(competitions.clubFor(config(), name)) : norm(name);
          if (!seen.has(k)) seen.set(k, all ? competitions.clubFor(config(), name) || name : name);
        }
      }
    }
    const teams = [...seen.values()].sort((a, c) => a.localeCompare(c)).map(name => ({ name, logo: logoFor(name), colour: colourFor(name) }));
    const r = rules();
    const round = current ? current.round : '';
    const out = { competition: st.competition || competitionName() || '', organisation: st.organisation || '', season: (st.season && st.season.name) || '',
      competitionLogoLight: r.competitionLogoLight, competitionLogoDark: r.competitionLogoDark,
      division: all ? '' : grades[0].name, round, date: current ? current.date || '' : '', venueName: config().venueName || (current && current.venue) || '',
      finalRound: FINALS_ROUND.test(round || ''), teams };
    if (q.type === 'outro' && current) out.wrap = await endOfNight(current);
    log('info', 'introoutro', `${q.type === 'outro' ? 'Outro' : 'Intro'} for ${out.division || 'every club'}: ${teams.length} teams${out.wrap ? `, ${out.wrap.next ? `next ${out.wrap.next.round}` : out.wrap.finalsNext ? 'finals next' : 'end of the season'}` : ''}`);
    return out;
  }

  // The countdown page: when the game picked on the scoreboard starts. Read from the board
  // alone (no PlayHQ call), so countdown.html can ask every few seconds to notice a new game.
  function getCountdown() {
    const b = board();
    if (!b.gameId) return { error: 'No game picked on the scoreboard control page' };
    const start = startOf(b);
    return { gameId: b.gameId, start, serverNow: Date.now(), date: b.date, time: b.time,
      competition: competitionName(), division: b.division, round: b.round, court: b.court, venueName: config().venueName || b.venue || '',
      home: { name: b.home.name, logo: logoFor(b.home.name), colour: colourFor(b.home.name) },
      away: { name: b.away.name, logo: logoFor(b.away.name), colour: colourFor(b.away.name) },
      ...(start === null ? { error: 'PlayHQ has no start time for the picked game' } : {}) };
  }


  // ─── Automatic game selection ───────────────────────────────────────────────
  // With autoSelect on, the board shows today's game on its court (autoCourt, default
  // defaultCourt in config.json): the first game of the day until the next one is due,
  // then each game from autoSelectMinutesBefore (default 10) minutes before its start, when
  // electronic scoring starts (the live feed isn't asked before then, see scoringNotYet).
  // With a game night picked by hand, that night's games on the court by their time: the
  // one due now, else the next to come, else (a night played already) its last.
  // A finals game is kept until PlayHQ says it is finished, because of extra time.
  // Picking a game by hand turns autoSelect off.
  // When the Production Planner has a court for the night (planner.js courtFor), that court is set here once when the
  // night arrives (and again if the plan's court changes), which also turns autoSelect on. A court or game picked by
  // hand afterwards stays: the Planner flags it rather than undoing it.
  let AUTO_LEAD_MS = 10 * 60 * 1000;
  const courtKey = c => String(c || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b0+(\d)/g, '$1').trim();
  function sameCourt(court, wanted) {
    const a = courtKey(court), w = courtKey(wanted);
    if (!w) return false;
    if (a === w) return true;
    // "1" or "court 1" matches "Indoor 01"
    const num = x => (x.match(/(\d+)\s*$/) || [])[1];
    const word = w.replace(/\s*\d+$/, '');
    return /^\d+$/.test(w) ? num(a) === w : !!num(a) && num(a) === num(w) && (word === 'court' || a.includes(word));
  }
  // The games to follow on a court, in date and time order: today's, or with a game night picked by hand
  // on the control page, that night's games on the court.
  async function todaysGames(court) {
    const st = await getStructure();
    const today = localDate();
    const games = [];
    if (nightChoice) games.push(...(await getCurrentGames()).filter(g => sameCourt(g.court, court)));
    else for (const grade of st.grades) {
      for (const g of await getSeasonGames(grade)) if (g.date === today && sameCourt(g.court, court)) games.push(g);
    }
    return games.filter(g => startOf(g) !== null).sort((a, b) => startOf(a) - startOf(b));
  }
  const isFinalsRound = g => /final/i.test(g.round || '');
  let autoBusy = false;
  // Put a game on the board, following PlayHQ, at Q1 with a full clock.
  function switchTo(b, pick, why) {
    log('info', 'auto', `${why} ${pick.home.name} v ${pick.away.name} (${pick.date} ${pick.time}, ${pick.court}, ${pick.division})`);
    applyAction(b, { type: 'selectGame', game: pick, auto: true });
    applyAction(b, { type: 'period', value: 1 });
    b.clock = { ...b.clock, lengthSec: b.clock.baseSec || theBoard.quarterSec(), elapsedMs: 0, running: false, startedAt: null };
    saveBoards();
  }
  const byStart = (x, y) => `${x.date || ''} ${String(x.time || '').padStart(8, '0')}`.localeCompare(`${y.date || ''} ${String(y.time || '').padStart(8, '0')}`);
  // The Production Planner's court for tonight (the game night picked by hand, else today), set once.
  async function followPlan(b) {
    const planned = await courtPlan(nightChoice || localDate());
    if (!planned || b.planCourt === planned.key) return;
    b.planCourt = planned.key;
    log('info', 'auto', `The Production Planner streams ${planned.court} tonight, so Scoreboard control follows it${b.autoCourt && !sameCourt(b.autoCourt, planned.court) ? ` (was ${b.autoCourt})` : ''}`);
    applyAction(b, { type: 'autoCourt', value: planned.court });
    saveBoards();
  }
  async function autoPick() {
    const b = board();
    if (autoBusy) return;
    autoBusy = true;
    try {
      try { await followPlan(b); } catch (err) { log('warn', 'auto', `Couldn't read the Production Planner's court: ${err.message}`); }
      // Runs while automatic selection is on, and whenever the board has no game at all.
      if (!b.autoSelect && b.gameId) return;
      const court = b.autoCourt || config().defaultCourt || '';
      const games = court && b.autoSelect ? await todaysGames(court) : [];
      if (!games.length) {
        // Not a game day on this court, no court set, or automatic selection is off with no game picked:
        // start on this game night's first game (on the court when it has games there), so a game is always on.
        const night = await getCurrentGames();
        const onCourt = court ? night.filter(g => sameCourt(g.court, court)) : [];
        const pool = (onCourt.length ? onCourt : night).slice().sort(byStart);
        if (!pool.length) { b.autoNote = 'PlayHQ has no games on this game night yet.'; return; }
        if (b.autoSelect) b.autoNote = !court ? `Set a court to follow its games through the night. Showing this game night's first game.`
          : `No games on ${court} ${nightChoice ? 'that night' : 'today'}. Showing this game night's first game${onCourt.length ? ` on ${court}` : ''}.`;
        if (!b.gameId || (b.autoSelect && !pool.some(g => g.id === b.gameId))) {
          switchTo(b, pool[0], !court ? 'no court set, so starting with this game night\'s first game:'
            : onCourt.length ? `no games on ${court} today, so starting with its first game this game night:` : `no games on ${court} this game night, so starting with its first game:`);
        }
        return;
      }
      const now = Date.now();
      const due = games.filter(g => startOf(g) - AUTO_LEAD_MS <= now);
      const pick = due.length ? due[due.length - 1] : games[0];
      const next = games[games.indexOf(pick) + 1];
      const today = localDate();
      const day = g => g.date === today ? '' : ` ${new Date(`${g.date}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}`;
      const at = g => new Date(startOf(g) - AUTO_LEAD_MS).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
      b.autoNote = next ? `Next: ${next.home.name} v ${next.away.name} (${next.time.slice(0, 5)}${day(next)}), switches at ${at(next)}${day(next)}.`
        : `Last game on this court ${nightChoice ? 'that night' : 'today'}.`;
      if (pick.id === b.gameId) { b.autoHold = ''; return; }
      // Keep a final on until PlayHQ says it is over (it may go to extra time).
      const current = games.find(g => g.id === b.gameId);
      if (current && isFinalsRound(current)) {
        let status = current.status;
        try { status = (await getLive(current.id, 20000)).status || status; } catch { /* use the fixture's status */ }
        if (!isFinished({ ...current, status })) {
          const hold = `Keeping the final on until PlayHQ marks it finished. To move on sooner, pick the next game from the list, then tick this again.`;
          if (b.autoHold !== hold) log('info', 'auto', hold);
          b.autoHold = hold; b.autoNote = hold;
          return;
        }
      }
      b.autoHold = '';
      switchTo(b, pick, 'switching to');
    } catch (err) {
      b.autoNote = `Couldn't pick a game from PlayHQ: ${err.message}${/setup page/.test(err.message) ? '' : ' Check the PlayHQ link and competition on the competition setup page.'}`;
      log('error', 'auto', b.autoNote);
    } finally { autoBusy = false; }
  }
  setInterval(autoPick, 15000);
  setTimeout(autoPick, 3000); // Studio starts with a game on, following PlayHQ

  // ─── Season graphics: results, ladder bar, head to head, form, ticker, shooters ─

  function isLive(g) { return /PROGRESS|LIVE|STARTED/i.test(g.status || ''); }
  function resultFor(g, teamName) {
    const mine = sameTeam(g.home.name, teamName) ? g.home : g.away;
    const theirs = mine === g.home ? g.away : g.home;
    const o = String(mine.outcome || '').toUpperCase();
    const r = /WIN|WON/.test(o) ? 'W' : /LOS/.test(o) ? 'L' : /DRAW/.test(o) ? 'D'
      : mine.score > theirs.score ? 'W' : mine.score < theirs.score ? 'L' : 'D';
    return { result: r, opponent: theirs.name, for: mine.score, against: theirs.score };
  }

  // Every game of a division this season (past rounds are kept for 10 minutes).
  async function getSeasonGames(grade) {
    const out = [];
    for (const r of await getRounds(grade.id)) {
      for (const g of await getRoundGames(r.id, r.current ? 60 * 1000 : 10 * 60 * 1000)) {
        out.push({ ...g, roundId: g.roundId || r.id, division: grade.name, round: r.name, roundNumber: r.number });
      }
    }
    const key = x => `${x.date || ''} ${String(x.time || '').padStart(5, '0')}`;
    return out.sort((a, b) => key(a).localeCompare(key(b)));
  }

  // The division of the game on the scoreboard (or ?division=).
  async function gradeFor(b, q) {
    const st = await getStructure();
    if (q && q.division) return findGrade(st, q);
    return st.grades.find(g => g.name === b.division) || st.grades.find(g => norm(g.name) === norm(b.division)) || null;
  }
  function teamsOf(b) {
    return { home: { name: b.home.name, logo: logoFor(b.home.name) }, away: { name: b.away.name, logo: logoFor(b.away.name) } };
  }
  function competitionName() { const st = playhq.structureNow(); return (st && st.competition) || config().displayName || config().competitionName; }
  // The competition's rules and look, for pages that change with them. With a division, super
  // shots are that division's (a competition can play them in some divisions only).
  function rules(division) {
    // Light and dark mode competition logos; when only one is set it is used for both.
    const brandUrl = f => f ? '/brand/' + encodeURIComponent(f) : null;
    const light = brandUrl(config().competitionLogo || config().competitionLogoDark), dark = brandUrl(config().competitionLogoDark || config().competitionLogo);
    return { periodType: config().periodType, periods: config().periodType === 'halves' ? 2 : 4, periodLabel: config().periodType === 'halves' ? 'H' : 'Q',
      periodMinutes: config().quarterMinutes, superShots: competitions.superShotsFor(config(), division), superShotMinutes: config().superShotMinutes ?? 3, finalsPlaces: (finals.byId(config().finalsFormat) || { teams: 0 }).teams,
      competitionLogo: light, competitionLogoLight: light, competitionLogoDark: dark,
      competitionName: competitionName() || '' };
  }

  // ─── Finals ─────────────────────────────────────────────────────────────────
  // Each division's finals format comes from the competition setup (finals.js has the formats).
  // The teams come from the ladder. PlayHQ often has no finals fixtures: when it does (rounds
  // with "final" or "play-off" in their name), their games, times, courts and scores are used;
  // otherwise winners are entered on the control page and kept in control.json.
  const FINALS_ROUND = /final|play.?off/i;
  const finalsKey = (division, format) => `${division}|${format.id}`;
  function finalsFor(division) { return finals.formatFor(config(), division); }
  function finalsGrade(st, q) { return findGrade(st, q.division ? q : { division: board().division || '1' }); }

  async function getFinals(q) {
    const st = await getStructure();
    const grade = finalsGrade(st, q);
    if (!grade) throw new Error(`No division "${q.division}". This season has: ${st.grades.map(g => g.name).join(', ')}`);
    let format = finalsFor(grade.name);
    const base = { organisation: st.organisation, competition: st.competition, season: st.season.name, division: grade.name, divisionNumber: grade.division, rules: rules(grade.name) };
    if (!format) return { ...base, format: null, games: [], error: `${grade.name} has no finals format. Pick one on the competition setup page.` };
    const ladder = await getLadder(grade.id);
    const rows = ladder.pools[0] || [];
    const seeds = rows.map(r => r.team);
    format = finals.sized(format, rows.length);
    // Only the finals rounds, and the last home and away round, are asked for (not the whole season),
    // and a round PlayHQ doesn't answer for (a 504) is left out rather than failing the page.
    const real = n => n && !/^(tbc|tba|bye)$/i.test(n);
    const rounds = await getRounds(grade.id);
    const finalsRounds = rounds.filter(r => FINALS_ROUND.test(r.name || ''));
    const lastRegular = rounds.filter(r => !FINALS_ROUND.test(r.name || '')).pop();
    const gamesOf = async r => {
      try { return await getRoundGames(r.id, r.current ? 60 * 1000 : 10 * 60 * 1000); }
      catch (err) { log('warn', 'finals', `${grade.name} ${r.name}: left out, PlayHQ didn't answer (${err.message})`); return null; }
    };
    const played = [];
    for (const [i, r] of finalsRounds.entries()) {
      for (const g of (await gamesOf(r)) || []) {
        if (real(g.home.name) && real(g.away.name)) played.push({ ...g, round: r.name, week: i + 1, finished: isFinished(g) });
      }
    }
    // Until the last home and away game is finished, the finals are "if the season ended today".
    const lastGames = lastRegular && !played.length ? (await gamesOf(lastRegular)) || [] : [];
    const projected = lastGames.some(g => real(g.home.name) && real(g.away.name) && !isFinished(g));
    const manual = (control.get().finals || {})[finalsKey(grade.name, format)] || {};
    const r = finals.resolve(format, seeds, played, manual);
    const withLogo = t => t.name ? { ...t, logo: logoFor(t.name), colour: colourFor(t.name) } : t;
    const marks = finals.ladderMarks(format);
    log('info', 'finals', `${grade.name}: ${format.name}, ${played.length} finals game${played.length === 1 ? '' : 's'} on PlayHQ, ${Object.keys(manual).length} entered by hand${projected ? ', season not finished' : ''}`);
    return { ...base,
      format: { id: format.id, name: format.name, summary: format.summary, teams: format.teams, all: !!format.all, weeks: format.weeks, series: !!format.series },
      projected, pools: ladder.pools.length, playhqFinals: played.length, finalsRounds: finalsRounds.map(r => r.name),
      ladder: rows.slice(0, format.teams).map((row, i) => ({ position: row.position, team: row.team, logo: logoFor(row.team), points: row.points, mark: marks.marks[i] })),
      legend: marks.legend,
      games: r.games.map(g => ({ ...g, home: withLogo(g.home), away: withLogo(g.away) })),
      champion: r.champion ? { name: r.champion, logo: logoFor(r.champion), colour: colourFor(r.champion) } : null };
  }

  // A finals winner entered by hand (winner blank clears it).
  async function setFinalsResult(body) {
    const st = await getStructure();
    const grade = finalsGrade(st, body);
    if (!grade) throw new Error(`No division "${body.division}"`);
    // A format for every team has as many games as the ladder has pairs.
    const format = finals.sized(finalsFor(grade.name), ((await getLadder(grade.id)).pools[0] || []).length);
    if (!format || !format.games.some(g => g.id === body.game)) throw new Error(`${grade.name} has no finals game ${body.game}`);
    const key = finalsKey(grade.name, format);
    const ctl = control.get();
    ctl.finals = ctl.finals || {};
    const all = ctl.finals[key] = ctl.finals[key] || {};
    const score = v => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? undefined : Math.max(0, Math.round(Number(v))));
    if (!body.winner) delete all[body.game];
    else all[body.game] = { winner: String(body.winner), homeScore: score(body.homeScore), awayScore: score(body.awayScore) };
    if (!Object.keys(all).length) delete ctl.finals[key];
    control.save();
    log('info', 'finals', `${grade.name} ${body.game}: ${body.winner ? `${body.winner} won${all[body.game].homeScore !== undefined ? ` ${all[body.game].homeScore}-${all[body.game].awayScore}` : ''}` : 'result cleared'} (entered by hand)`);
    return getFinals({ division: String(grade.division) });
  }

  async function getLadderBar() {
    const b = board();
    const grade = await gradeFor(b);
    if (!grade) throw new Error('Pick a PlayHQ game on the control page first.');
    const rows = (await getLadder(grade.id)).pools.flat();
    const row = name => rows.find(r => sameTeam(r.team, name)) || null;
    const t = teamsOf(b);
    return { competition: competitionName(), division: grade.name, teams: rows.length,
      home: { ...t.home, ladder: row(b.home.name) }, away: { ...t.away, ladder: row(b.away.name) } };
  }

  async function getHeadToHead() {
    const b = board();
    const grade = await gradeFor(b);
    if (!grade) throw new Error('Pick a PlayHQ game on the control page first.');
    const games = (await getSeasonGames(grade)).filter(g => g.id !== b.gameId && isFinished(g) &&
      ((sameTeam(g.home.name, b.home.name) && sameTeam(g.away.name, b.away.name)) || (sameTeam(g.home.name, b.away.name) && sameTeam(g.away.name, b.home.name))));
    const tally = { home: 0, away: 0, draws: 0 };
    for (const g of games) {
      const r = resultFor(g, b.home.name).result;
      if (r === 'W') tally.home++; else if (r === 'L') tally.away++; else tally.draws++;
    }
    return { competition: competitionName(), division: grade.name, ...teamsOf(b), tally,
      games: games.map(g => ({ round: g.round, date: g.date, home: g.home, away: g.away })) };
  }

  async function getForm(count) {
    const b = board();
    const grade = await gradeFor(b);
    if (!grade) throw new Error('Pick a PlayHQ game on the control page first.');
    const finished = (await getSeasonGames(grade)).filter(g => g.id !== b.gameId && isFinished(g));
    const n = Math.min(10, Math.max(1, Number(count) || 5));
    const form = name => finished.filter(g => sameTeam(g.home.name, name) || sameTeam(g.away.name, name)).slice(-n)
      .map(g => ({ round: g.round, ...resultFor(g, name) }));
    const t = teamsOf(b);
    return { competition: competitionName(), division: grade.name,
      home: { ...t.home, form: form(b.home.name) }, away: { ...t.away, form: form(b.away.name) } };
  }

  // The round fixture has no scores until a game is final, so live games are read one by one, through the live
  // feed's cache (playhq.js getLive): the ticker and the fixture board (planner.js) both read here, so a game read
  // for one is not asked again for the other within maxAgeMs. Sets home.score, away.score and period ('Q2') on
  // each live game in place.
  const TICKER_LIVE_MS = 20 * 1000;
  async function withLiveScores(games, maxAgeMs = TICKER_LIVE_MS) {
    await Promise.all(games.filter(isLive).map(async g => {
      try {
        const d = await liveScore(g, maxAgeMs);
        if (!d) return;
        g.home = { ...g.home, score: d.home }; g.away = { ...g.away, score: d.away };
        const p = d.live && d.live.period;
        if (PERIOD_NUMBER[p]) g.period = `${/HALF/.test(p) ? 'H' : 'Q'}${PERIOD_NUMBER[p]}`;
      } catch (err) { log('warn', 'ticker', `Live score for ${g.home.name} v ${g.away.name} failed: ${err.message}`); }
    }));
    return games;
  }

  // Live and finished scores from the current round, leaving out the game on the scoreboard.
  async function getTicker() {
    const b = board();
    const games = (await getCurrentGames()).filter(g => g.id !== b.gameId && (isLive(g) || isFinished(g) || (g.home.score !== null && g.away.score !== null)));
    await withLiveScores(games, TICKER_LIVE_MS);
    return { competition: competitionName(), speed: b.tickerSpeed || TICKER_SPEED, games: games.map(g => ({ ...g, live: isLive(g), finished: isFinished(g) })) };
  }

  // Season shooting totals from the Game Summary of every finished game in a division.
  // Finished games don't change, so their line ups are kept (see game-cache.json).
  async function getTopShooters(q) {
    const st = await getStructure();
    const grade = findGrade(st, q.division ? q : { division: board().division || '1' });
    if (!grade) throw new Error(`No division "${q.division}"`);
    const games = (await getSeasonGames(grade)).filter(isFinished);
    const players = new Map();
    let read = 0, failed = 0, lastError = '';
    const lineups = await eachLimited(games, PLAYHQ_AT_ONCE, g => readGame(g, 60 * 60 * 1000));
    for (const [i, g] of games.entries()) {
      if (lineups[i].error) { failed++; lastError = lineups[i].error.message; continue; }
      const parsed = lineups[i].value;
      read++;
      for (const side of ['home', 'away']) {
        for (const p of parsed[side].players) {
          const sh = p.shooting;
          if (p.private || (!sh.goals && !sh.superGoals)) continue; // "Private player" can't be told apart
          const team = parsed[side].name;
          const k = norm(p.name) + '|' + norm(team);
          const t = players.get(k) || { name: p.name, team, logo: logoFor(team), games: 0, goals: 0, superGoals: 0, shots: 0, points: 0 };
          t.games++; t.goals += sh.goals; t.superGoals += sh.superGoals; t.shots += sh.shots || 0; t.points += sh.points;
          players.set(k, t);
        }
      }
    }
    const limit = Math.min(20, Math.max(1, Number(q.limit) || 8));
    const all = [...players.values()];
    const by = f => [...all].sort((a, b) => f(b) - f(a) || a.name.localeCompare(b.name)).slice(0, limit);
    if (failed) log('warn', 'shooters', `${failed} of ${games.length} games could not be read: ${lastError}`);
    return { competition: competitionName(), rules: rules(grade.name), division: grade.name, gamesRead: read, gamesFinished: games.length,
      error: !read && failed ? lastError : undefined,
      points: by(p => p.points), goals: by(p => p.goals), superGoals: by(p => p.superGoals) };
  }


  // The competition setup changed (applyCompetition in server.js): its round lookahead and auto-select lead.
  function configure(c) {
    LOOKAHEAD_DAYS = c.roundLookaheadDays || 5;
    AUTO_LEAD_MS = (Number.isFinite(Number(c.autoSelectMinutesBefore)) ? Number(c.autoSelectMinutesBefore) : 10) * 60 * 1000;
  }
  function resetCaches() { roundDatesCache.clear(); }

  return { nightChoice: () => nightChoice, setNightChoice, leadMs: () => AUTO_LEAD_MS, configure, resetCaches, sameCourt,
    getRoundInfo, getCurrentGames, getFixtures, getUpNext, getIntroOutro, getCountdown, autoPick,
    getSeasonGames, competitionName, rules, finalsFor, getFinals, setFinalsResult, getLadderBar, getHeadToHead, getForm, getTicker, withLiveScores, isLive, getTopShooters };
}

module.exports = { create };
