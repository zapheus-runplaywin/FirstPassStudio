// FirstPass Studio - the board: the scoreboard Studio runs for the game on the stream.
//
// Scores, the clock and the period, by hand from the control page and the Stream Deck or following
// PlayHQ's live feed (refreshFromPlayhq, followClock); the goal order the last goals and the score
// worm are drawn from; super shots; hot streaks and game moments; the game stats card. Kept in
// scoreboard-state.json so a restart mid-game keeps the score, with the lasting settings (auto
// select, the court, refresh seconds, the clock following, the ticker speed) also in control.json.
//
// create(deps) gives the one board. deps:
//   log(level, source, message, detail)   the debug log
//   datadir, savefile                      where the state file lives; atomic writes
//   machine                                config.json's machine settings (playhqRefreshSeconds)
//   config()                               the competition setup in use (CONFIG in server.js)
//   competitions                           competitions.js (super shots per division)
//   scene                                  scene.js (publishBoard: the board over the scene socket)
//   playhq                                 the PlayHQ client (getLive, liveScore, scoringNotYet, PERIOD_NUMBER, getRoundGames)
//   control                                control.json: get(), save(), LASTING, exists(), markUnsaved()
//   logoFor(name), colourFor(name), rules(division), competitionName(), warmTeamLists(why)   from server.js
//   record                                 recorder.js (record.action: each action, for the game recording)
const fs = require('fs');
const path = require('path');
const { isFinished } = require('./playhq');

function create({ log, datadir, savefile, machine, config, competitions, scene, playhq, control: controlFile, logoFor, colourFor, rules, competitionName, warmTeamLists, record = { action() {} } }) {
  const { getRoundGames, liveScore, scoringNotYet, PERIOD_NUMBER } = playhq;
  const MACHINE = machine;
  const { LASTING } = controlFile;
  const saveControl = () => controlFile.save();

  // ─── Scoreboard state (set from control.html, shown by scoreboard.html) ─────
  // Kept in scoreboard-state.json so a restart mid-game keeps the score. The lasting
  // settings (LASTING) also go to control.json, which wins when both have them. Studio runs one
  // scoreboard (one Studio per court); both files keep it under "1", as when there could be more.
  const STATE_FILE = datadir.local('scoreboard-state.json');
  let boards = savefile.readJson(STATE_FILE, {}, (err, movedTo) => log('warn', 'scoreboard', `Could not read scoreboard-state.json, starting fresh: ${err.message}${movedTo ? ` (moved to ${path.basename(movedTo)})` : ''}`));
  boards = boards['1'] ? { 1: boards['1'] } : {}; // one scoreboard: drop any old second board
  // The scoreboard as the pages see it (GET /api/scoreboard, and the board message on the scene socket).
  function scoreboardJson(b = board()) {
    const logos = { home: logoFor(b.home.name), away: logoFor(b.away.name) };
    const teamColours = { home: colourFor(b.home.name), away: colourFor(b.away.name) };
    const venueName = config().venueName || b.venue || '';
    const r = rules(b.division);
    return { ...b, periodLabel: r.periodLabel, rules: r, competition: competitionName(), competitionSetup: config().name, venueName, logos, teamColours,
      clockElapsedMs: clockElapsed(b.clock), serverNow: Date.now() };
  }
  // Pushes the board to the pages following it (scene.js), once the current change has finished.
  let boardPushTimer = null;
  function pushBoard() {
    if (boardPushTimer) return;
    boardPushTimer = setImmediate(() => { boardPushTimer = null; try { scene.publishBoard(); } catch (err) { log('warn', 'scoreboard', `Board not pushed: ${err.message}`); } });
  }
  function saveBoards() {
    pushBoard();
    savefile.writeFile(STATE_FILE, JSON.stringify(boards, null, 2), err => { if (err) log('warn', 'scoreboard', `scoreboard-state.json not saved: ${err.message}`); });
    if (boards['1']) controlFile.get().boards['1'] = Object.fromEntries(LASTING.map(k => [k, boards['1'][k]]));
    saveControl();
  }

  const DEFAULT_REFRESH_SEC = Math.max(1, Number(MACHINE.playhqRefreshSeconds) || 5);
  let QUARTER_SEC = 600;
  // The ticker's scroll speed in pixels per second: the default, the limits and one Faster / Slower step.
  const TICKER_SPEED = 120, TICKER_MIN = 20, TICKER_MAX = 600, TICKER_STEP = 20;
  const tickerSpeed = v => Math.max(TICKER_MIN, Math.min(TICKER_MAX, Math.round(Number(v) || TICKER_SPEED)));

  function newBoard() {
    return {
      source: 'manual',          // 'playhq' = scores follow PlayHQ, 'manual' = scores from the control page
      gameId: null, roundId: null,
      division: '', court: '', round: '', date: '', time: '', venue: '',
      home: { name: 'Home', score: 0 },
      away: { name: 'Away', score: 0 },
      period: 1, periodLabel: 'Q',
      clock: { lengthSec: QUARTER_SEC, elapsedMs: 0, running: false, startedAt: null },
      showClock: true,
      followPlayhqClock: false,  // true = the clock follows the PlayHQ scorer's game clock (while following PlayHQ); matches source when that changes
      autoSelect: config().autoSelectGame !== undefined ? !!config().autoSelectGame : !!config().defaultCourt, // pick the game from the court and the time
      autoCourt: config().defaultCourt || '',
      playhqRefreshSec: DEFAULT_REFRESH_SEC,
      tickerSpeed: TICKER_SPEED,  // how fast ticker.html scrolls, in pixels per second
      updatedAt: Date.now(),
    };
  }
  function board() {
    if (!boards['1']) boards['1'] = { ...newBoard(), ...pickKeys(controlFile.get().boards['1'], LASTING) };
    const b = boards['1'];
    if (b.autoSelect === undefined) { const n = newBoard(); b.autoSelect = n.autoSelect; b.autoCourt = n.autoCourt; } // saved before these existed
    return b;
  }

  const pickKeys = (o, keys) => Object.fromEntries(keys.filter(k => o && o[k] !== undefined).map(k => [k, o[k]]));
  if (boards['1']) Object.assign(boards['1'], pickKeys(controlFile.get().boards['1'], LASTING));
  if (!controlFile.exists()) { controlFile.markUnsaved(); saveBoards(); } // none yet: write it from what was in use

  function clockElapsed(c) { return c.elapsedMs + (c.running && c.startedAt ? Date.now() - c.startedAt : 0); }

  // Clock buttons pressed by a person stop the clock following PlayHQ (like score buttons do for the score).
  const MANUAL_CLOCK = new Set(['clockStart', 'clockStop', 'clockToggle', 'clockReset', 'clockSet', 'clockAdjust']);
  // The clock matches the scores: whenever scoring switches between Follow PlayHQ and Manual
  // (the buttons, the Stream Deck, a score press, or a game being picked), following the
  // PlayHQ scorer's clock is switched to match. Changing the clock afterwards still wins.
  const SETS_SOURCE = new Set(['source', 'selectGame']);
  function applyAction(b, a) {
    record.action(a);
    const sourceBefore = b.source;
    applyOne(b, a);
    if (b.source === sourceBefore && !SETS_SOURCE.has(a.type)) return;
    const follow = b.source === 'playhq';
    if (b.followPlayhqClock === follow) return;
    b.followPlayhqClock = follow;
    b.playhqClockKey = null; // apply the next PlayHQ reading straight away
    b.clockMatchedAt = Date.now();
    log('info', 'scoreboard', `Scores now ${follow ? 'follow PlayHQ' : 'manual'} (${a.type}), so the clock ${follow ? 'follows the PlayHQ scorer' : 'is manual'} too`);
  }
  // ─── Super shots (for supershot.html) ───────────────────────────────────────
  // Each super shot bumps b.superShot.n, and supershot.html plays when it sees n go up.
  // From the control page or Stream Deck: a +2 press. From PlayHQ: the team's super shot
  // count (2_POINT_SCORE) going up by exactly one with their score up by at least 2, so two
  // normal goals between checks and a scorer swapping a goal for a super shot don't count.
  // When the feed has no super shot count, a score jump of exactly 2 with the normal goal
  // count unchanged (or unknown) counts. The first reading after a game is picked or scores
  // switch to PlayHQ only sets the starting point, so catching up never plays it, and nothing
  // plays once the game is finished.
  const superSeen = new WeakMap(); // board -> last PlayHQ reading compared against
  function superShot(b, side, how) {
    if (!competitions.superShotsFor(config(), b.division)) return;
    const n = ((b.superShot && b.superShot.n) || 0) + 1;
    b.superShot = { n, side, at: Date.now(), how };
    log('info', 'supershot', `Super shot for ${b[side].name} (${side}, ${how}), number ${n}`);
  }
  function watchSuperShots(b, game, live, kind) {
    const read = k => ({ score: game[k].score, goals: live ? live[k].goals : null, superGoals: live ? live[k].superGoals : null });
    const now = { key: `${b.gameId} ${kind}`, home: read('home'), away: read('away') };
    const before = superSeen.get(b);
    superSeen.set(b, now);
    if (!before || before.key !== now.key || isFinished(game)) return;
    for (const k of ['home', 'away']) {
      const was = before[k], is = now[k];
      if (was.score == null || is.score == null) continue;
      const up = is.score - was.score;
      const counted = was.superGoals != null && is.superGoals != null;
      if (counted ? is.superGoals - was.superGoals === 1 && up >= 2
        : up === 2 && (was.goals == null || is.goals == null || is.goals === was.goals)) superShot(b, k, 'playhq');
    }
  }

  function applyOne(b, a) {
    trackPeriods(b); // anything PlayHQ put on the board before this goes to the period it came in
    applyOneAction(b, a);
    if (a.type === 'resetScores' || a.type === 'reset') b.periodTrack = null;
    trackPeriods(b);
  }
  function applyOneAction(b, a) {
    if (['score', 'setScore', 'resetScores', 'selectGame', 'source', 'reset'].includes(a.type)) superSeen.delete(b); // start again from the next reading
    if (MANUAL_CLOCK.has(a.type) && b.followPlayhqClock && !a.fromToggle) {
      b.followPlayhqClock = false;
      log('info', 'scoreboard', `Clock switched to manual by ${a.type}`);
    }
    const side = a.side === 'away' ? b.away : b.home;
    switch (a.type) {
      case 'score': {
        const before = Number(side.score) || 0;
        side.score = Math.max(0, before + Number(a.delta || 0));
        noteGoals(b, a.side === 'away' ? 'away' : 'home', side.score - before, 'manual');
        watchStreaks(b, 'manual');
        b.source = 'manual';
        if (Number(a.delta) === 2) superShot(b, a.side === 'away' ? 'away' : 'home', 'manual');
        break;
      }
      case 'superShot': superShot(b, a.side === 'away' ? 'away' : 'home', 'test'); break; // plays it without changing the score
      case 'streak': { // plays streak.html without changing the score
        const kind = STREAK_NAMES[a.kind] ? a.kind : 'heating';
        const side = a.side === 'away' ? 'away' : 'home';
        const both = kind === 'goalForGoal' || kind === 'level';
        streak(b, { kind, side: both ? '' : side, goals: STREAK_GOALS[kind] || 0, from: kind === 'goalForGoal' ? side : '', down: kind === 'comeback' ? COMEBACK_DOWN + 1 : 0 }, 'test');
        break;
      }
      case 'setScore': {
        const before = Number(side.score) || 0;
        side.score = Math.max(0, Number(a.value) || 0);
        b.source = 'manual';
        // A score typed in isn't a list of goals: noted as a gap, so runs and the worm carry on from the new score.
        if (side.score !== before) {
          if (!Array.isArray(b.goals) || b.goalsGameId !== b.gameId) clearGoals(b, b.gameId);
          pushGap(b, { [a.side === 'away' ? 'away' : 'home']: side.score });
        }
        break;
      }
      case 'setTeams': b.home.name = a.home ?? b.home.name; b.away.name = a.away ?? b.away.name; b.division = a.division ?? b.division; b.court = a.court ?? b.court; break;
      case 'selectGame':
        if (!a.auto && b.autoSelect) { b.autoSelect = false; log('info', 'auto', 'Game picked by hand, so automatic game selection is off'); }
        // The game it leaves, with the score it had, for the fixture board's finished game until PlayHQ has the result.
        if (b.gameId && b.gameId !== a.game.id) b.lastGame = { id: b.gameId, home: { ...b.home }, away: { ...b.away } };
        Object.assign(b, { gameId: a.game.id, roundId: a.game.roundId, division: a.game.division || '', court: a.game.court || '', source: 'playhq',
          round: a.game.round || '', date: a.game.date || '', time: a.game.time || '', venue: a.game.venue || '', playhqPeriodSeen: null, playhqClock: null, playhqClockKey: null, playhqBreak: null });
        b.home = { name: a.game.home.name, score: a.game.home.score ?? 0 };
        b.away = { name: a.game.away.name, score: a.game.away.score ?? 0 };
        if (b.goalsGameId !== a.game.id) clearGoals(b, a.game.id);
        setImmediate(() => warmTeamLists(a.auto ? 'game picked automatically' : 'game picked'));
        break;
      case 'source': {
        const want = a.value === 'toggle' ? (b.source === 'playhq' ? 'manual' : 'playhq') : a.value;
        b.source = want === 'playhq' && b.gameId ? 'playhq' : 'manual';
        break;
      }
      case 'resetScores': b.home.score = 0; b.away.score = 0; b.source = 'manual'; clearGoals(b, b.gameId); break;
      case 'clockToggle': applyOne(b, { type: b.clock.running ? 'clockStop' : 'clockStart', fromToggle: true }); break;
      case 'autoSelect':
        b.autoSelect = a.value === 'toggle' ? !b.autoSelect : !!a.value && a.value !== 'off';
        b.autoHold = '';
        break;
      case 'autoCourt': // choosing a court means "follow this court", so it also turns automatic selection on
        b.autoCourt = String(a.value || '').trim(); b.autoHold = '';
        if (b.autoCourt && !b.autoSelect) { b.autoSelect = true; log('info', 'auto', `Court set to ${b.autoCourt}, so automatic game selection is on`); }
        break;
      case 'followPlayhqClock': {
        b.followPlayhqClock = a.value === 'toggle' ? !b.followPlayhqClock : !!a.value && a.value !== 'off';
        b.playhqClockKey = null; // apply the next PlayHQ reading straight away
        break;
      }
      case 'period': {
        // Quarters 1-4 or halves 1-2, then 5 for extra time.
        const last = config().periodType === 'halves' ? 2 : 4;
        let next = a.value === 'next' ? b.period + 1 : a.value === 'prev' ? b.period - 1 : Number(a.value) || 1;
        if (next > last && next < 5) next = a.value === 'prev' ? last : 5;
        if (a.value === 'prev' && b.period === 5) next = last;
        b.period = Math.max(1, Math.min(5, next));
        break;
      }
      case 'periodLabel': b.periodLabel = String(a.value || 'Q').slice(0, 6); break;
      case 'clockStart': if (!b.clock.running) { b.clock.running = true; b.clock.startedAt = Date.now(); } break;
      case 'clockStop': noteClock(b); if (b.clock.running) { b.clock.elapsedMs = clockElapsed(b.clock); b.clock.running = false; b.clock.startedAt = null; } break;
      case 'clockReset': b.clock = { ...b.clock, lengthSec: b.clock.baseSec || QUARTER_SEC, elapsedMs: 0, running: false, startedAt: null }; break;
      case 'clockSet': { // set the time left, e.g. to match the venue clock
        const left = Math.max(0, Math.round(Number(a.secondsLeft) || 0));
        if (left > b.clock.lengthSec) b.clock.lengthSec = left; // e.g. a longer extra-time period
        b.clock.elapsedMs = (b.clock.lengthSec - left) * 1000;
        if (b.clock.running) b.clock.startedAt = Date.now();
        break;
      }
      case 'clockLength': b.clock.lengthSec = b.clock.baseSec = Math.max(60, Number(a.value) || QUARTER_SEC); break;
      case 'clockAdjust': { // + adds time to the clock, - takes it off
        const leftMs = b.clock.lengthSec * 1000 - clockElapsed(b.clock);
        applyAction(b, { type: 'clockSet', secondsLeft: Math.max(0, leftMs / 1000 + Number(a.deltaSec || 0)) });
        break;
      }
      case 'playhqRefresh': b.playhqRefreshSec = Math.max(1, Math.min(120, Math.round(Number(a.value) || DEFAULT_REFRESH_SEC))); break;
      case 'showClock': b.showClock = !!a.value; break;
      case 'tickerSpeed': { // a speed in pixels per second, or 'faster', 'slower', 'normal'
        const now = b.tickerSpeed || TICKER_SPEED;
        b.tickerSpeed = a.value === 'faster' ? tickerSpeed(now + TICKER_STEP) : a.value === 'slower' ? tickerSpeed(now - TICKER_STEP)
          : a.value === 'normal' ? TICKER_SPEED : tickerSpeed(a.value);
        log('info', 'ticker', `Ticker speed now ${b.tickerSpeed} pixels per second`);
        break;
      }
      case 'reset': Object.assign(b, newBoard(), { tickerSpeed: b.tickerSpeed }); clearGoals(b, null); break; // the ticker keeps its speed
    }
    b.updatedAt = Date.now();
  }

  // While a board follows PlayHQ, refresh its score from PlayHQ (every playhqRefreshSec, default 5).
  // Called every second by refreshTick and by the scoreboard, goals, stats and worm requests; the
  // live feed is cached for playhqRefreshSec, so PlayHQ is asked once per period however often this runs.
  async function refreshFromPlayhq(b) {
    noteClock(b);
    if (b.source !== 'playhq' || !b.roundId) return;
    // Before electronic scoring starts there is nothing to read, so PlayHQ isn't asked.
    const wait = scoringNotYet(b);
    if (wait !== (b.playhqWaiting || '')) { if (wait) log('info', 'scoreboard', wait); b.playhqWaiting = wait; }
    if (wait) { b.playhqError = ''; return; }
    try {
      const maxAge = (b.playhqRefreshSec || DEFAULT_REFRESH_SEC) * 1000;
      let game = null;
      const s = await liveScore({ id: b.gameId }, maxAge);
      if (s) {
        game = { id: b.gameId, status: s.status, home: { name: b.home.name, score: s.home }, away: { name: b.away.name, score: s.away } };
        // Follow the scorer's quarter when it changes (the Stream Deck can still set it in between).
        const q = s.live && PERIOD_NUMBER[s.live.period];
        if (q && b.playhqPeriodSeen !== s.live.period) {
          // This reading's score still belongs to the quarter that was on (the quarter moves on when the next one starts).
          if (b.period !== q) trackPeriods(b, { home: s.home, away: s.away });
          if (b.period !== q) { b.period = q; log('info', 'scoreboard', `PlayHQ moved to quarter ${q}`); }
          b.playhqPeriodSeen = s.live.period;
        }
        if (s.live && s.live.clock) followClock(b, s.live);
      } else {
        // Last resort: the round fixture, which only has scores once a game is final. One kept from before PlayHQ
        // failed isn't a reading: the board keeps its score and says why.
        const games = await getRoundGames(b.roundId, maxAge);
        if (games.stale) throw new Error(games.stale);
        game = games.find(g => g.id === b.gameId);
      }
      if (!game) return;
      watchSuperShots(b, game, s && s.live, s ? (s.live ? 'live' : 'game') : 'fixture');
      // Log what PlayHQ reports each time it changes, including "no score yet", for debugging.
      const seen = `${game.id} ${game.status} ${game.home.score} ${game.away.score}`;
      if (b.playhqSeen !== seen) {
        log('info', 'scoreboard', `PlayHQ says ${game.home.name} ${game.home.score ?? 'no score'} - ${game.away.score ?? 'no score'} ${game.away.name} (${game.status})`);
        b.playhqSeen = seen;
      }
      const goalsChanged = goalsFromPlayhq(b, game, s && s.live);
      if (game.home.score !== null) b.home.score = game.home.score;
      if (game.away.score !== null) b.away.score = game.away.score;
      trackPeriods(b);
      if (goalsChanged) {
        if (!isFinished(game)) watchStreaks(b, 'playhq'); // after the score is on the board, which the moments read
        saveBoards();
      }
      b.playhqStatus = game.status;
      b.playhqError = '';
    } catch (err) {
      if (b.playhqError !== err.message) log('error', 'scoreboard', `Following PlayHQ failed: ${err.message}`);
      b.playhqError = err.message;
    }
  }

  // ─── Goal order (last 10 goals graphic) ─────────────────────────────────────
  // PlayHQ's live feed only gives running totals (score, goals, super goals per team), not a
  // list of goals, so the order is worked out here from the score changing: each Follow PlayHQ
  // reading (every playhqRefreshSec, default 5 s) is compared with the score on the board, and
  // each +1 / +2 press on the control page or Stream Deck is a goal as it happens. A rise of 2 is
  // split into goals and super goals by the feed's goal counts; without them it is taken as one
  // super shot (two goals inside 5 seconds can't happen). The first reading of a game picked
  // part way through, or a jump of more than 3 points for one team at once (the helper was
  // closed, or nothing was polling), isn't split into goals: a gap is noted instead.
  const GOALS_KEPT = 400; // a whole game, so gamestats.html can count its runs
  const MAX_STEP = 3;
  function clearGoals(b, gameId) { b.goals = []; b.goalsGameId = gameId || null; b.goalsBaseline = false; b.goalsSeq = 0; b.playhqCounts = null; b.streakFired = {}; momentsFrom(b); }
  function clockLeft(b) { return b.clock ? Math.max(0, Math.ceil(b.clock.lengthSec - clockElapsed(b.clock) / 1000)) : null; }
  function pushGoal(b, side, points, how) {
    b.goalsSeq = (b.goalsSeq || 0) + 1;
    b.goals.push({ id: b.goalsSeq, side, points, period: b.period, clockLeft: clockLeft(b), periodSec: b.clock ? b.clock.lengthSec : null, at: Date.now(), how });
    if (b.goals.length > GOALS_KEPT) b.goals.splice(0, b.goals.length - GOALS_KEPT);
  }
  // A gap: the score moved without Studio seeing the goals. `set` is the score it moved to
  // ({ home, away }, or just the side that jumped), so worm.html can carry on from there.
  function pushGap(b, set) {
    b.goals.push({ id: ++b.goalsSeq, gap: true, set, period: b.period, clockLeft: clockLeft(b), periodSec: b.clock ? b.clock.lengthSec : null, at: Date.now() });
  }
  // A score taken off (a correction) removes that team's latest goals.
  function takeGoals(b, side, points) {
    for (let i = b.goals.length - 1; i >= 0 && points > 0; i--) {
      const g = b.goals[i];
      if (g.side !== side || g.gap) continue;
      if (g.points <= points) { points -= g.points; b.goals.splice(i, 1); }
      else { g.points -= points; points = 0; } // a super goal taken down by 1
    }
  }
  function noteGoals(b, side, delta, how, split) {
    if (!Array.isArray(b.goals) || b.goalsGameId !== b.gameId) clearGoals(b, b.gameId);
    if (how === 'manual') b.goalsBaseline = true; // the board's score is now the one goals are counted from
    if (!delta) return;
    if (delta < 0) { takeGoals(b, side, -delta); return; }
    const supers = split ? split.superGoals : (rules(b.division).superShots ? Math.floor(delta / 2) : 0);
    const goals = split ? split.goals : delta - 2 * supers;
    for (let i = 0; i < supers; i++) pushGoal(b, side, 2, how);
    for (let i = 0; i < goals; i++) pushGoal(b, side, 1, how);
  }
  // Called with each PlayHQ reading before it is put on the board. Returns true if goals changed.
  function goalsFromPlayhq(b, game, live) {
    if (!Array.isArray(b.goals) || b.goalsGameId !== b.gameId) clearGoals(b, b.gameId);
    const counts = live ? { home: { goals: live.home.goals, superGoals: live.home.superGoals, shots: live.home.shots }, away: { goals: live.away.goals, superGoals: live.away.superGoals, shots: live.away.shots } } : null;
    const before = b.goals.length, seq = b.goalsSeq;
    const deltas = { home: (game.home.score ?? b.home.score) - (Number(b.home.score) || 0), away: (game.away.score ?? b.away.score) - (Number(b.away.score) || 0) };
    if (!b.goalsBaseline) {
      // First reading for this game: only a game that hasn't started yet (0-0 on the board) is followed goal by goal from here.
      b.goalsBaseline = true;
      const onBoard = (Number(b.home.score) || 0) + (Number(b.away.score) || 0);
      if ((deltas.home || deltas.away) && (onBoard || deltas.home > MAX_STEP || deltas.away > MAX_STEP || deltas.home < 0 || deltas.away < 0)) {
        log('info', 'goals', `Picked up ${b.home.name} v ${b.away.name} at ${game.home.score}-${game.away.score}, so goals are listed from here`);
        pushGap(b, { home: game.home.score ?? (Number(b.home.score) || 0), away: game.away.score ?? (Number(b.away.score) || 0) });
        b.playhqCounts = counts;
        return true;
      }
    }
    for (const side of ['home', 'away']) {
      const d = deltas[side];
      if (!d) continue;
      if (d > MAX_STEP) {
        log('info', 'goals', `${b[side].name} went up ${d} points between readings, too many to list one by one; noted as a gap`);
        pushGap(b, { [side]: game[side].score });
        continue;
      }
      const was = b.playhqCounts && b.playhqCounts[side], now = counts && counts[side];
      let split = null;
      if (d > 0 && was && now && now.goals != null && now.superGoals != null && was.goals != null && was.superGoals != null) {
        const g = now.goals - was.goals, sg = now.superGoals - was.superGoals;
        if (g >= 0 && sg >= 0 && g + 2 * sg === d) split = { goals: g, superGoals: sg };
      }
      noteGoals(b, side, d, 'playhq', split);
      log('info', 'goals', `${b[side].name} ${d > 0 ? '+' : ''}${d} (${split ? `${split.goals} goal${split.goals === 1 ? '' : 's'}, ${split.superGoals} super from PlayHQ's counts` : 'split worked out from the score'})`);
    }
    if (counts) b.playhqCounts = counts;
    return b.goals.length !== before || b.goalsSeq !== seq;
  }
  // ─── Hot streaks and game moments (for streak.html) ─────────────────────────
  // Worked out from the goal order above, where a super goal is one goal, and the score:
  //   heating up       3 goals in a row by one team; on fire at 5
  //   goal for goal    10 goals going one each way (home, away, home...)
  //   hits the front   a team goes ahead when the other team was the last one ahead
  //   all square       the scores are level again in the last 2 minutes of a quarter
  //   coming back      a team that was 5 or more down gets within 2
  //   on the siren     a goal with 10 seconds or less left in a quarter, while the clock is (or was just) running
  //   back to back     a team's second super shot in a row
  // Each plays once: a run that reaches 5 plays "on fire" (and not "heating up" again), a goal
  // for goal stretch plays once however long it goes on, and a comeback has to go 5 down again
  // to replay. A run is known by the id of its first goal, so a -1 correction and the goal again
  // doesn't replay it. One goal plays one moment at most, the first of MOMENT_ORDER, so the
  // stream isn't flooded (the rest are logged). A gap in the goal list (a game picked part way
  // through, a jump too big to split) starts again from that score, so scores catching up never
  // play, and nothing plays once the game is finished. Each one bumps b.streak.n and is added to
  // b.streakLog, and streak.html plays the ones it hasn't seen.
  const STREAK_GOALS = { heating: 3, fire: 5, goalForGoal: 10 };
  const MOMENT_ORDER = ['siren', 'backToBack', 'fire', 'lead', 'comeback', 'level', 'goalForGoal', 'heating'];
  const STREAK_NAMES = { heating: 'heating up', fire: 'on fire', goalForGoal: 'goal for goal', lead: 'hits the front', level: 'all square',
    comeback: 'coming back', siren: 'on the siren', backToBack: 'back to back super shots' };
  const COMEBACK_DOWN = 5, COMEBACK_WITHIN = 2, LEVEL_LAST_SEC = 120, SIREN_LAST_SEC = 10, SIREN_STOPPED_MS = 15000;
  const leaderOf = (h, a) => (h > a ? 'home' : a > h ? 'away' : '');
  function streak(b, ev, how) {
    const n = ((b.streak && b.streak.n) || 0) + 1;
    b.streak = { n, side: '', goals: 0, from: '', ...ev, score: { home: Number(b.home.score) || 0, away: Number(b.away.score) || 0 },
      period: b.period, periodLabel: rules(b.division).periodLabel, clockLeft: clockLeft(b), at: Date.now(), how };
    b.streakLog = [...(b.streakLog || []), b.streak].slice(-6);
    log('info', 'streak', `${ev.side ? `${b[ev.side].name} (${ev.side}) ` : ''}${STREAK_NAMES[ev.kind]}${ev.goals ? `, ${ev.goals} goals` : ''}${ev.down ? `, was ${ev.down} down` : ''} (${how}), number ${n}`);
  }
  // The score moments start from here: on a new game, after a gap, and the first time they're looked at.
  function momentsFrom(b) {
    const h = Number(b.home.score) || 0, a = Number(b.away.score) || 0;
    b.moments = { home: h, away: a, lastLeader: leaderOf(h, a), worst: { home: Math.max(0, a - h), away: Math.max(0, h - a) }, levelAt: null, lastId: b.goalsSeq || 0 };
  }
  // Whether the clock is running, or was running a moment ago (PlayHQ's reading comes up to 5 seconds after the goal).
  function noteClock(b) { if (b.clock && b.clock.running && clockLeft(b) > 0) b.clockRanAt = Date.now(); }
  const clockRecent = b => (b.clock && b.clock.running) || Date.now() - (b.clockRanAt || 0) < SIREN_STOPPED_MS;
  function watchStreaks(b, how) {
    if (!Array.isArray(b.goals)) return;
    const fired = b.streakFired || (b.streakFired = {});
    const found = [];
    // Back from the latest goal: the current run by one team, and the stretch of goals going one each way.
    let run = 0, runStart = null, runSide = '', alt = 0, altStart = null, altSide = '', last = '';
    for (let i = b.goals.length - 1; i >= 0; i--) {
      const g = b.goals[i];
      if (g.gap || (runSide && g.side !== runSide)) break;
      runSide = g.side; run++; runStart = g.id;
    }
    for (let i = b.goals.length - 1; i >= 0; i--) {
      const g = b.goals[i];
      if (g.gap || (last && g.side === last)) break;
      last = altSide = g.side; alt++; altStart = g.id;
    }
    if (run >= STREAK_GOALS.fire && fired.fire !== runStart) { fired.fire = fired.heating = runStart; found.push({ kind: 'fire', side: runSide, goals: run }); }
    else if (run >= STREAK_GOALS.heating && fired.heating !== runStart) { fired.heating = runStart; found.push({ kind: 'heating', side: runSide, goals: run }); }
    if (alt >= STREAK_GOALS.goalForGoal && fired.goalForGoal !== altStart) { fired.goalForGoal = altStart; found.push({ kind: 'goalForGoal', goals: alt, from: altSide }); }

    // The score moments, from the score at the last look; after a gap they start again from this score.
    const m = b.moments;
    if (!m || b.goals.some(g => g.gap && g.id > m.lastId)) momentsFrom(b);
    else scoreMoments(b, m, found);
    found.sort((x, y) => MOMENT_ORDER.indexOf(x.kind) - MOMENT_ORDER.indexOf(y.kind));
    if (found.length > 1) log('info', 'streak', `Also ${found.slice(1).map(f => STREAK_NAMES[f.kind]).join(', ')}, not played (one moment per goal)`);
    if (found.length) streak(b, found[0], how);
  }
  function scoreMoments(b, m, found) {
    const fired = b.streakFired;
    const h = Number(b.home.score) || 0, a = Number(b.away.score) || 0;
    const fresh = b.goals.filter(g => !g.gap && g.id > m.lastId);
    const latest = b.goals[b.goals.length - 1];
    if (h + a > m.home + m.away && fresh.length) {
      const now = leaderOf(h, a);
      if (now && m.lastLeader && now !== m.lastLeader) found.push({ kind: 'lead', side: now });
      const left = clockLeft(b);
      if (!now && h > 0 && left !== null && left <= LEVEL_LAST_SEC && m.levelAt !== h) { m.levelAt = h; found.push({ kind: 'level' }); }
      for (const side of ['home', 'away']) {
        const down = side === 'home' ? a - h : h - a, wasDown = side === 'home' ? m.away - m.home : m.home - m.away;
        if (m.worst[side] >= COMEBACK_DOWN && down <= COMEBACK_WITHIN && down < wasDown) { found.push({ kind: 'comeback', side, down: m.worst[side] }); m.worst[side] = Math.max(0, down); }
      }
      const g = fresh[fresh.length - 1];
      if (g.clockLeft !== null && g.clockLeft <= SIREN_LAST_SEC && clockRecent(b)) found.push({ kind: 'siren', side: g.side });
      // Back to back super shots: the latest two goals, both super goals by the same team.
      const prev = b.goals[b.goals.length - 2];
      if (latest === g && g.points === 2 && prev && !prev.gap && prev.side === g.side && prev.points === 2 && fired.backToBack !== g.id) {
        fired.backToBack = g.id; found.push({ kind: 'backToBack', side: g.side });
      }
    }
    for (const side of ['home', 'away']) m.worst[side] = Math.max(m.worst[side], side === 'home' ? a - h : h - a);
    m.home = h; m.away = a; m.lastLeader = leaderOf(h, a) || m.lastLeader; m.lastId = b.goalsSeq || 0;
  }

  // What goals.html shows: the last `count` goals (oldest first), the current run and the tally.
  function getGoals(count) {
    const b = board();
    if (!Array.isArray(b.goals) || b.goalsGameId !== b.gameId) clearGoals(b, b.gameId);
    const n = Math.max(3, Math.min(30, Math.round(Number(count) || 10)));
    // Take the last n goals; a gap inside them is kept so the page can mark it.
    const out = [];
    let found = 0;
    for (let i = b.goals.length - 1; i >= 0 && found < n; i--) {
      out.unshift(b.goals[i]);
      if (!b.goals[i].gap) found++;
    }
    while (out.length && out[0].gap) out.shift();
    const real = out.filter(g => !g.gap);
    const tally = side => ({ goals: real.filter(g => g.side === side).length, points: real.filter(g => g.side === side).reduce((t, g) => t + g.points, 0) });
    let run = null;
    for (let i = b.goals.length - 1; i >= 0; i--) {
      const g = b.goals[i];
      if (g.gap) break;
      if (!run) run = { side: g.side, goals: 0, points: 0 };
      if (g.side !== run.side) break;
      run.goals++; run.points += g.points;
    }
    const r = rules(b.division);
    return {
      gameId: b.gameId, division: b.division, court: b.court, round: b.round, source: b.source, period: b.period,
      periodLabel: r.periodLabel, superShots: r.superShots, competition: competitionName(),
      home: { name: b.home.name, score: b.home.score, logo: logoFor(b.home.name), colour: colourFor(b.home.name) },
      away: { name: b.away.name, score: b.away.score, logo: logoFor(b.away.name), colour: colourFor(b.away.name) },
      count: n, goals: out, tally: { home: tally('home'), away: tally('away') }, run,
      totalGoals: b.goals.filter(g => !g.gap).length, gapInHistory: b.goals.some(g => g.gap),
    };
  }

  // ─── Game stats (gamestats.html) ────────────────────────────────────────────
  // Points per quarter (or half) are tracked from the score on the board: whatever the score
  // goes up or down by is put on the quarter that is on at the time. The quarter only moves on
  // when the next one starts, so the goals up to then are the last quarter's. A quarter is
  // "unsure" when its points can't be split out: the game was picked up part way through it, or
  // the score jumped by more than MAX_STEP for a team in one go (Studio was closed, or a score was
  // typed in). Quarters before the one the game was picked up in aren't known at all.
  function trackPeriods(b, score) {
    const now = { home: Number(score && score.home != null ? score.home : b.home.score) || 0, away: Number(score && score.away != null ? score.away : b.away.score) || 0 };
    let t = b.periodTrack;
    if (!t || t.gameId !== (b.gameId || null)) {
      const fresh = !now.home && !now.away;
      t = b.periodTrack = { gameId: b.gameId || null, period: b.period, base: now, periods: {} };
      t.periods[b.period] = { home: 0, away: 0, sure: fresh };
      if (!fresh) log('info', 'stats', `Quarter scores for ${b.home.name} v ${b.away.name} start at ${now.home}-${now.away} in ${rules(b.division).periodLabel}${b.period}, so earlier quarters aren't known`);
      return;
    }
    const p = t.periods[t.period] || (t.periods[t.period] = { home: 0, away: 0, sure: true });
    for (const side of ['home', 'away']) {
      const d = now[side] - t.base[side];
      if (!d) continue;
      if (Math.abs(d) > MAX_STEP && p.sure) { p.sure = false; log('info', 'stats', `${b[side].name} went ${d > 0 ? 'up' : 'down'} ${Math.abs(d)} at once in ${rules(b.division).periodLabel}${t.period}, so that quarter's split isn't sure`); }
      p[side] = Math.max(0, p[side] + d);
    }
    t.base = now;
    if (b.period !== t.period) {
      t.period = b.period;
      if (!t.periods[b.period]) t.periods[b.period] = { home: 0, away: 0, sure: true };
    }
  }
  // Extra time is only played from a level score, so anything put on a period after the last
  // quarter (a "next quarter" press at the siren, then a shot after the siren) when the scores
  // weren't level at the end of normal time belongs to the last quarter. `extra` is the points
  // put on the periods after it.
  function playedExtraTime(b, extra) {
    const h = (Number(b.home.score) || 0) - (extra.home || 0), a = (Number(b.away.score) || 0) - (extra.away || 0);
    return h === a;
  }
  // Runs: goals in a row by one team (a super goal is one goal, as on the Last 10 goals graphic).
  // A gap in the goal order (picked up part way, a jump) ends a run.
  function runsFrom(goals) {
    const runs = [];
    let run = null;
    for (const g of goals) {
      if (g.gap) { run = null; continue; }
      if (!run || run.side !== g.side) runs.push(run = { side: g.side, goals: 0, period: g.period });
      run.goals++;
    }
    return runs;
  }
  function getStats() {
    const b = board();
    trackPeriods(b);
    if (!Array.isArray(b.goals) || b.goalsGameId !== b.gameId) clearGoals(b, b.gameId);
    const r = rules(b.division);
    const t = b.periodTrack;
    let last = Math.max(r.periods, ...Object.keys(t.periods).map(Number));
    let current = t.period;
    const tracked = { ...t.periods };
    if (last > r.periods) {
      const extra = { home: 0, away: 0 };
      for (let n = r.periods + 1; n <= last; n++) if (tracked[n]) { extra.home += tracked[n].home; extra.away += tracked[n].away; }
      if (!playedExtraTime(b, extra)) {
        const into = tracked[r.periods] = { ...(tracked[r.periods] || { home: 0, away: 0, sure: false }) };
        for (let n = r.periods + 1; n <= last; n++) if (tracked[n]) { into.home += tracked[n].home; into.away += tracked[n].away; into.sure = into.sure && tracked[n].sure; delete tracked[n]; }
        last = r.periods;
        current = Math.min(current, r.periods + 1); // the last quarter counts as finished
      }
    }
    const periods = [];
    for (let n = 1; n <= last; n++) {
      const p = tracked[n];
      if (n > r.periods && !p) continue; // no extra time
      periods.push({ n, label: n > r.periods ? 'ET' : `${r.periodLabel}${n}`, played: !!p || n < current,
        home: p ? p.home : null, away: p ? p.away : null, sure: !!(p && p.sure) && n <= current });
    }
    const sure = periods.filter(p => p.sure && p.n <= r.periods && (p.n < current || p.home || p.away));
    const won = side => sure.filter(p => p[side] > p[side === 'home' ? 'away' : 'home']).length;
    const best = side => sure.reduce((top, p) => (!top || p[side] > top.points ? { n: p.n, label: p.label, points: p[side] } : top), null);
    const goals = b.goals.filter(g => !g.gap);
    const counts = b.playhqCounts || {};
    const supers = side => Math.max(goals.filter(g => g.side === side && g.points === 2).length, Number(counts[side] && counts[side].superGoals) || 0);
    const runs = runsFrom(b.goals);
    const runsOf = (side, n) => runs.filter(x => x.side === side && x.goals >= n).length;
    const longest = side => runs.filter(x => x.side === side).reduce((m, x) => Math.max(m, x.goals), 0);
    const both = f => ({ home: f('home'), away: f('away') });
    // Shooting from PlayHQ's live counts (goals and super shots made, from every shot: GOAL_ATTEMPT), when following
    // PlayHQ and its scorer records shots; null otherwise (presses on the control page don't say how many were missed).
    const shooting = side => {
      const c = counts[side];
      if (!c || c.shots == null) return null;
      const made = (Number(c.goals) || 0) + (Number(c.superGoals) || 0), shots = Number(c.shots) || 0;
      return { made, shots, percent: shots ? Math.round((made / shots) * 100) : null };
    };
    return {
      gameId: b.gameId, division: b.division, court: b.court, round: b.round, period: b.period, competition: competitionName(),
      periodType: r.periodType, periodLabel: r.periodLabel, periods: r.periods, superShots: r.superShots,
      home: { name: b.home.name, score: b.home.score, logo: logoFor(b.home.name), colour: colourFor(b.home.name) },
      away: { name: b.away.name, score: b.away.score, logo: logoFor(b.away.name), colour: colourFor(b.away.name) },
      quarters: periods,
      stats: {
        quartersWon: { ...both(won), drawn: sure.filter(p => p.home === p.away).length, of: sure.length },
        bestQuarter: both(best),
        superShots: both(supers),
        runs3: both(side => runsOf(side, 3)), runs5: both(side => runsOf(side, 5)), longestRun: both(longest),
        shooting: both(shooting),
      },
      totalGoals: goals.length, gapInHistory: b.goals.some(g => g.gap),
    };
  }

  // ─── Score worm (worm.html) ─────────────────────────────────────────────────
  // The margin (home minus away) over game time, from the goal order. Time is in periods:
  // 1.5 is half way through the first quarter, from the clock when each goal came in. A
  // quarter whose goals have no clock times (the clock wasn't run) has its goals spread
  // evenly across it. Each gap (the game picked up part way, a score typed in or a jump of
  // more than 3) ends a line: the next one starts from the score after the gap, and the gap
  // is listed so the page can show Studio wasn't watching then.
  function getWorm() {
    const b = board();
    if (!Array.isArray(b.goals) || b.goalsGameId !== b.gameId) clearGoals(b, b.gameId);
    const r = rules(b.division);
    const defaultSec = (Number(r.periodMinutes) || 10) * 60;
    const fraction = (left, sec) => {
      const len = Number(sec) || defaultSec;
      return left == null ? null : Math.max(0, Math.min(1, (len - left) / len));
    };
    const entries = b.goals.map(g => ({ g, period: Number(g.period) || 1, frac: fraction(g.clockLeft, g.periodSec) }));
    // Goals after the last quarter without a level score at its end (see playedExtraTime) were on the siren of the last quarter.
    const extra = { home: 0, away: 0 };
    for (const e of entries) if (!e.g.gap && e.period > r.periods) extra[e.g.side] += e.g.points;
    const extraTime = (extra.home || extra.away || (Number(b.period) || 1) > r.periods) && playedExtraTime(b, extra);
    if (!extraTime) for (const e of entries) if (e.period > r.periods) { e.period = r.periods; e.frac = 1; e.atSiren = true; }
    // Goals in a quarter without usable clock times (none running, or all at the same moment) are spread evenly.
    const byPeriod = new Map();
    for (const e of entries) if (!e.g.gap) (byPeriod.get(e.period) || byPeriod.set(e.period, []).get(e.period)).push(e);
    for (const list of byPeriod.values()) {
      const timed = list.filter(e => !e.atSiren);
      const fracs = timed.map(e => e.frac);
      if (timed.length && (fracs.some(f => f == null) || (timed.length > 1 && fracs.every(f => f === fracs[0])))) {
        timed.forEach((e, i) => { e.frac = (i + 1) / (timed.length + 1); e.spread = true; });
      }
    }
    const score = { home: 0, away: 0 };
    const segments = [], gaps = [];
    let seg = null, lastT = 0;
    const point = (t, extra) => ({ t: Math.round(t * 10000) / 10000, home: score.home, away: score.away, margin: score.home - score.away, ...extra });
    if (entries.length && !entries[0].g.gap) segments.push(seg = [point(0)]);
    if (!entries.length) segments.push(seg = [point(0)]);
    for (const e of entries) {
      let t = e.frac == null ? lastT : e.period - 1 + e.frac;
      t = Math.max(t, lastT);
      if (e.g.gap) {
        for (const side of ['home', 'away']) if (e.g.set && e.g.set[side] != null) score[side] = Number(e.g.set[side]) || 0;
        if (seg && seg.length === 1 && seg.fromGap) { // gaps in a row (both scores typed in): one gap, to the last of them
          seg[0] = point(t);
          gaps[gaps.length - 1].to = t;
        } else {
          gaps.push({ from: seg ? lastT : 0, to: t });
          segments.push(seg = [point(t)]);
          seg.fromGap = true;
        }
      } else {
        score[e.g.side] += e.g.points;
        seg.push(point(t, { side: e.g.side, points: e.g.points }));
      }
      lastT = t;
    }
    // The line carries on to now (the end of the game, once it's over); a score now different
    // from the line's (corrections Studio couldn't place) moves the end to the board's score.
    const nowFrac = fraction(clockLeft(b), b.clock && b.clock.lengthSec);
    const nowPeriod = Number(b.period) || 1;
    const end = Math.max(lastT, extraTime || nowPeriod <= r.periods ? nowPeriod - 1 + (nowFrac ?? 0) : r.periods);
    const board_ = { home: Number(b.home.score) || 0, away: Number(b.away.score) || 0 };
    if (board_.home !== score.home || board_.away !== score.away) {
      gaps.push({ from: lastT, to: end });
      Object.assign(score, board_);
      segments.push(seg = [point(end)]);
    } else if (end > lastT) seg.push(point(end));
    const all = segments.flat();
    const lead = side => all.reduce((top, p) => {
      const m = side === 'home' ? p.margin : -p.margin;
      return m > 0 && (!top || m > top.margin) ? { margin: m, t: p.t } : top;
    }, null);
    let changes = 0, leader = 0;
    for (const p of all) { const now = Math.sign(p.margin); if (now && leader && now !== leader) changes++; if (now) leader = now; }
    const periods = extraTime ? Math.max(r.periods, nowPeriod, ...entries.map(e => e.period)) : r.periods;
    // The super shot period (the last superShotMinutes of each quarter, super shot divisions only):
    // where it falls on the chart, and the points each team scored in it (goals with clock times only).
    let superShot = null;
    const ssSec = (Number(r.superShotMinutes) || 0) * 60;
    if (r.superShots && ssSec > 0) {
      const windows = [];
      for (let n = 1; n <= r.periods; n++) {
        const seen = entries.find(e => e.period === n && e.g.periodSec);
        const len = Number(seen ? seen.g.periodSec : n === Number(b.period) && b.clock ? b.clock.lengthSec : 0) || defaultSec;
        windows.push({ n, from: n - Math.min(ssSec, len) / len, to: n });
      }
      const inWindow = entries.filter(e => !e.g.gap && !e.spread && e.g.clockLeft != null && e.g.clockLeft <= ssSec && e.period <= r.periods);
      const pts = side => inWindow.filter(e => e.g.side === side).reduce((t, e) => t + e.g.points, 0);
      superShot = { minutes: r.superShotMinutes, windows, points: { home: pts('home'), away: pts('away') }, timed: entries.some(e => !e.g.gap && !e.spread) };
    }
    return {
      gameId: b.gameId, division: b.division, court: b.court, round: b.round, period: b.period, competition: competitionName(),
      periodType: r.periodType, periodLabel: r.periodLabel, periods, regularPeriods: r.periods,
      home: { name: b.home.name, score: b.home.score, logo: logoFor(b.home.name), colour: colourFor(b.home.name) },
      away: { name: b.away.name, score: b.away.score, logo: logoFor(b.away.name), colour: colourFor(b.away.name) },
      segments, gaps: gaps.filter(g => g.to > g.from), end,
      biggestLead: { home: lead('home'), away: lead('away') }, leadChanges: changes, superShot,
      totalGoals: entries.filter(e => !e.g.gap).length,
    };
  }


  // The scorer's game clock from PlayHQ's live feed. Seen so far (one finished game):
  // { period: "4th Quarter", periodValue: "FOURTH_QTR", status: "RESUME", time: "00:00", lastUpdatedAt: "<ms>" }.
  // Read as: `time` is the time left when the scorer last touched the clock (lastUpdatedAt),
  // and RESUME/START mean it is running. Every reading is logged so this can be checked.
  function followClock(b, live) {
    const c = live.clock;
    b.playhqClock = c;
    b.playhqBreak = live.break || null;
    const key = `${c.periodValue || c.period} ${c.status} ${c.time} ${c.lastUpdatedAt} ${live.break || ''}`;
    if (b.playhqClockKey === key) return;
    b.playhqClockKey = key;
    const secs = parseClock(c.time);
    const running = /^(RESUME|RESUMED|START|STARTED|RUNNING)$/i.test(c.status || '') && !live.break;
    const updated = Number(c.lastUpdatedAt) || Date.parse(c.lastUpdatedAt) || 0;
    const lagMs = running && updated ? Math.max(0, Math.min(120000, Date.now() - updated)) : 0;
    log('info', 'clock', `PlayHQ clock ${c.periodValue || c.period || '?'} ${c.status || '?'} ${c.time ?? '?'} (updated ${updated ? Math.round((Date.now() - updated) / 1000) + 's ago' : '?'})${live.break ? ' break ' + live.break : ''}${b.followPlayhqClock ? '' : ' (not followed)'}`);
    if (!b.followPlayhqClock || secs === null) return;
    if (secs > b.clock.lengthSec) b.clock.lengthSec = secs;
    const leftMs = Math.max(0, secs * 1000 - lagMs);
    b.clock = { ...b.clock, elapsedMs: b.clock.lengthSec * 1000 - leftMs, running: running && leftMs > 0, startedAt: running && leftMs > 0 ? Date.now() : null };
    b.updatedAt = Date.now();
  }

  function parseClock(t) {
    const m = String(t || '').match(/^(\d{1,2})(?:[:.](\d{1,2}))?$/);
    return m ? Number(m[1]) * 60 + Number(m[2] || 0) : null;
  }

  // The quarter length from the competition setup, applied by server.js when the setup changes.
  const quarterSec = () => QUARTER_SEC;
  const setQuarterSec = n => { QUARTER_SEC = n; };

  // A copy of the scoreboard, and putting one back (practice.js: a practice game leaves it as it was).
  const snapshot = () => JSON.parse(JSON.stringify(board()));
  function restore(s) {
    if (!s) return;
    boards['1'] = s;
    saveBoards();
  }

  return { snapshot, restore, board, newBoard, saveBoards, scoreboardJson, pushBoard, applyAction, clockElapsed, clockLeft, refreshFromPlayhq, followClock, parseClock,
    getGoals, getStats, getWorm, streak, superShot, tickerSpeed, DEFAULT_REFRESH_SEC, TICKER_SPEED, quarterSec, setQuarterSec };
}

module.exports = { create };
