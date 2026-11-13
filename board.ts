// FirstPass Studio - the board: the scoreboard Studio runs for the game on the stream.
//
// Scores, the clock and the period, by hand from the control page and the Stream Deck or following
// PlayHQ's live feed (refreshFromPlayhq, followClock); the goal order the last goals and the score
// worm are drawn from; super shots; hot streaks and game moments; the game stats card; each streamed game's story
// (kept by stories.js, for the Socials tab's Game story, Score worm and Moments of the game). Kept in
// scoreboard-state.json so a restart mid-game keeps the score, with the lasting settings (auto
// select, the court, refresh seconds, the clock following, the ticker speed) also in control.json.
//
// create(deps) gives the one board. deps:
//   log(level, source, message, detail)   the debug log
//   datadir, savefile                      where the state file lives; atomic writes
//   stories                                stories.js: where each streamed game's story is kept (keep, read)
//   machine                                config.json's machine settings (playhqRefreshSeconds)
//   config()                               the competition setup in use (CONFIG in server.js)
//   competitions                           competitions.js (super shots per division)
//   scene                                  scene.js (publishBoard: the board over the scene socket)
//   playhq                                 the PlayHQ client (getLive, liveScore, scoringNotYet, PERIOD_NUMBER, getRoundGames)
//   control                                control.json: get(), save(), LASTING, exists(), markUnsaved()
//   logoFor(name), colourFor(name), rules(division), competitionName(), warmTeamLists(why)   from server.js
//   record                                 recorder.js (record.action: each action, for the game recording)
import fs from 'node:fs';
import path from 'node:path';
import { isFinished, startOf, localDate } from './playhq';
import { errorMessage } from './errors';
import { isObj, str } from './check';
import type * as Datadir from './datadir';
import type * as Savefile from './savefile';
import type * as Competitions from './competitions';
import type { Client as PlayhqClient, LiveGame, LiveClock } from './playhq';
import type { Story, Merge } from './stories';
import type { Rules } from './games';
import type { Config, Control, Log, Machine } from './types';

type Side = 'home' | 'away';
const SIDES: readonly Side[] = ['home', 'away'];
interface Team { name: string; score: number }
interface Clock { lengthSec: number; elapsedMs: number; running: boolean; startedAt: number | null; baseSec?: number }
// A goal in the goal order, or a gap: the score moved without Studio seeing the goals (set: the score it moved to).
interface GoalAt { id: number; period: number; clockLeft: number | null; periodSec: number | null; at: number }
type Goal = (GoalAt & { gap?: false; side: Side; points: number; how: string }) | (GoalAt & { gap: true; set?: Partial<Record<Side, number>> });
// PlayHQ's live counts for a team: goals and super shots made, and every shot.
interface Counts { goals?: number | null; superGoals?: number | null; shots?: number | null }
interface PeriodScore { home: number; away: number; sure: boolean }
interface PeriodTrack { gameId: string | null; period: number; base: Record<Side, number>; periods: Record<number, PeriodScore> }
interface Moments { home: number; away: number; lastLeader: Side | ''; worst: Record<Side, number>; levelAt: number | null; lastId: number }
type StreakKind = 'heating' | 'fire' | 'goalForGoal' | 'lead' | 'level' | 'comeback' | 'siren' | 'backToBack';
interface StreakEvent { kind: StreakKind; side?: Side | ''; goals?: number; from?: Side | ''; down?: number }
interface Streak extends Required<StreakEvent> {
  n: number; also: StreakEvent[]; gameId: string | null; score: Record<Side, number>; period: number; periodLabel: string; clockLeft: number | null; at: number; how: string;
}
interface GameMoment {
  kind: StreakKind; side: Side | ''; goals: number; down: number; also: { kind: StreakKind; side: Side | '' }[];
  score: Record<Side, number>; period: number; periodLabel: string; clockLeft: number | null;
}
// A game's score as a reading gives it (the live feed, or the round fixture as a last resort).
interface Reading { id: string; status?: string | null; home: { name: string; score: number | null }; away: { name: string; score: number | null } }
// What a game's goal order, quarters, clock and moments are kept on: the scoreboard (Board), a game followed in the
// background, or the board a merge of two stories plays its moments through again on.
interface GameBoard {
  gameId: string | null; roundId?: string | null; source?: 'manual' | 'playhq'; division: string; court: string; round: string; date?: string; time?: string; venue?: string;
  home: Team; away: Team; period: number; clock: Clock | null; followPlayhqClock?: boolean;
  goals?: Goal[]; goalsGameId?: string | null; goalsBaseline?: boolean; goalsSeq?: number; playhqCounts?: Record<Side, Counts> | null;
  streakFired?: Partial<Record<StreakKind, number | null>>; moments?: Moments; streak?: Streak; streakLog?: Streak[];
  gameMoments?: GameMoment[]; gameMomentsId?: string | null; periodTrack?: PeriodTrack | null; endedAt?: number | null;
  playhqStatus?: string; playhqPeriodSeen?: string | null; playhqClock?: LiveClock | null; playhqClockKey?: string | null; playhqBreak?: string | null;
  clockRanAt?: number; updatedAt?: number; followed?: boolean; streamed?: boolean; done?: boolean; replay?: boolean;
  wait?: { n: number; until: number };
  // Kept on the scoreboard only (see Board), but read wherever a game board is.
  courtName?: string; playhqRefreshSec?: number; superShot?: { n: number; side: Side; at: number; how: string }; breakFrom?: { period: number; at: number } | null;
  playhqError?: string; playhqWaiting?: string; playhqTrouble?: Trouble; playhqSeen?: string; followHold?: { at: number; logged?: boolean } | null;
  clockMatchedAt?: number; takenOver?: string | null;
}
// The scoreboard: the game on Output 1, its score, clock and period, and the lasting settings (LASTING).
interface Board extends GameBoard {
  source: 'manual' | 'playhq'; roundId: string | null; date: string; time: string; venue: string; courtName: string;
  clock: Clock; periodLabel: string; showClock: boolean; followPlayhqClock: boolean;
  autoSelect: boolean; autoCourt: string; courtFrom: string; courtNight: string; planCourt?: string; playhqRefreshSec: number; followOthers: boolean; tickerSpeed: number; updatedAt: number;
  lastGame?: { id: string; home: Team; away: Team }; handPickedOn?: string;
  // Automatic game selection (games.js).
  autoNote?: string; autoNext?: unknown; autoHold?: string;
}
type Trouble = '' | 'not-live' | 'quiet';
type RealGoal = Extract<Goal, { side: Side }>;
// What a story's stats, worm and moments are worked out from (goalOrderOf), so a gap can be filled from another Mac's.
interface GoalOrder {
  home: Team; away: Team; court: string; period: number; clock: { lengthSec: number; elapsedMs: number } | null;
  goals: Goal[]; counts: Record<Side, Counts> | null; periodTrack: PeriodTrack | null;
}
// A story as mergeStories reads it: this Mac's own, or one from another Mac (its goal order checked by goalOrderIn).
type StoryOf = { gameId: string; goalOrder?: unknown; division?: unknown; round?: unknown; studio?: string };
// A story's goal order, when it has one with its goals: Studio wrote it (goalOrderOf), on this Mac or another.
function goalOrderIn(s: StoryOf | null | undefined): GoalOrder | null {
  const o = s && s.goalOrder;
  return isObj(o) && Array.isArray(o.goals) && isObj(o.home) && isObj(o.away) ? o as unknown as GoalOrder : null;
}
// The goals in a goal order, without its gaps.
const realGoals = (goals: Goal[]) => goals.filter((g): g is RealGoal => !g.gap);
// A followed game's board: a game board with what following it needs.
type Followed = GameBoard & { gameId: string; followed: true; source: 'playhq'; followPlayhqClock: boolean; wait: { n: number; until: number }; date: string; time: string; clock: Clock };
// A change to the scoreboard: from the control page, the Stream Deck, a page, automatic selection or a recording.
interface Action {
  type: string; side?: string; delta?: unknown; value?: unknown; kind?: string; home?: string; away?: string; division?: string; court?: unknown;
  auto?: boolean; game?: GameChoice; from?: string; secondsLeft?: unknown; deltaSec?: unknown; fromToggle?: boolean;
}
// A game picked for the scoreboard.
interface GameChoice {
  id: string; roundId?: string | null; division?: string; court?: string; round?: string; date?: string | null; time?: string | null; venue?: string; status?: string | null;
  home: { name: string; score?: number | null }; away: { name: string; score?: number | null }; toBeDecided?: boolean;
}
// What board.js needs from the rest of the helper (see the top of this file).
interface Deps {
  log: Log; datadir: typeof Datadir; savefile: typeof Savefile;
  stories?: { keep(story: Story, opts?: { final?: boolean }): void; read(id: string): Story | null; useMerge?(fn: Merge): void; liveFrom?(id: string): Promise<Story[]> };
  machine: Machine; config: () => Config; competitions: typeof Competitions; scene: { publishBoard(): void }; playhq: PlayhqClient;
  control: Control;
  logoFor(name: string): string | null; colourFor(name: string): string | null; rules(division?: string): Rules; competitionName(): string;
  warmTeamLists(why: string): unknown; record?: { action(a: Action): void };
}

function create({ log, datadir, savefile, stories = { keep() {}, read: () => null }, machine, config, competitions, scene, playhq, control: controlFile, logoFor, colourFor, rules, competitionName, warmTeamLists, record = { action() {} } }: Deps) {
  const { getRoundGames, liveScore, scoringNotYet } = playhq;
  const PERIOD_NUMBER: Record<string, number | undefined> = playhq.PERIOD_NUMBER;
  const MACHINE = machine;
  const { LASTING } = controlFile;
  const saveControl = () => controlFile.save();

  // ─── Scoreboard state (set from control.html, shown by scoreboard.html) ─────
  // Kept in scoreboard-state.json so a restart mid-game keeps the score. The lasting
  // settings (LASTING) also go to control.json, which wins when both have them. Studio runs one
  // scoreboard (one Studio per court); both files keep it under "1", as when there could be more.
  const STATE_FILE = datadir.local('scoreboard-state.json');
  let boards = savefile.readJson<{ '1'?: Board }>(STATE_FILE, {}, (err, movedTo) => log('warn', 'scoreboard', `Could not read scoreboard-state.json, starting fresh: ${errorMessage(err)}${movedTo ? ` (moved to ${path.basename(movedTo)})` : ''}`));
  boards = boards['1'] ? { 1: boards['1'] } : {}; // one scoreboard: drop any old second board
  // The scoreboard as the pages see it (GET /api/scoreboard, and the board message on the scene socket).
  function scoreboardJson(b: Board = board()) {
    const logos = { home: logoFor(b.home.name), away: logoFor(b.away.name) };
    const teamColours = { home: colourFor(b.home.name), away: colourFor(b.away.name) };
    const venueName = config().venueName || b.venue || '';
    const r = rules(b.division);
    // court is the name the graphics show (courtShown); courtPlayhq is PlayHQ's own name for it, courtName the one typed.
    return { ...b, court: courtShown(b), courtPlayhq: b.court, periodLabel: r.periodLabel, rules: r, competition: competitionName(), competitionSetup: config().name, venueName, logos, teamColours,
      clockElapsedMs: clockElapsed(b.clock), serverNow: Date.now(), countdown: countdownFor(b), followedGames: followedGames() };
  }

  // ─── What the game is waiting for, for Commentator stats' pill under the clock ───
  // Before the game, its scheduled start: { kind: 'start', at }. At a break, when play should be back: from when the
  // clock first sat at 0:00 (or PlayHQ's scorer started the break), plus the setup's minutes for that break
  // (quarterBreakMinutes, halfTimeMinutes, threeQuarterBreakMinutes): { kind: 'break', at, name }. Otherwise null.
  // The break's start is kept on the board (breakFrom: { period, at }) so a page opened mid-break, or a relaunch,
  // counts from the real start; it's cleared when the clock runs again or the period is wound back.
  type Break = 'qt' | 'ht' | '3qt';
  const BREAK_NAMES: Record<Break, string> = { qt: 'Quarter time', ht: 'Half time', '3qt': 'Three quarter time' };
  const BREAK_MINUTES = { qt: 'quarterBreakMinutes', ht: 'halfTimeMinutes', '3qt': 'threeQuarterBreakMinutes' } as const;
  function countdownFor(b: Board) {
    const last = config().periodType === 'halves' ? 2 : 4;
    const period = Number(b.period) || 1;
    const left = clockLeft(b);
    const running = !!b.clock.running && !!left; // a clock left running reads 0:00 at the end, so that's stopped too
    const atBreak = !running && period < last && (left === 0 || (b.source === 'playhq' && b.followPlayhqClock && !!b.playhqBreak));
    const from = b.breakFrom;
    if (running || (from && period < from.period) || (from && period > from.period + 1)) { if (from) { b.breakFrom = null; saveBoards(); } }
    else if (atBreak && !from) { b.breakFrom = { period, at: Date.now() }; saveBoards(); }
    if (b.breakFrom) {
      const which: Break | undefined = last === 2 ? 'ht' : (['qt', 'ht', '3qt'] as const)[b.breakFrom.period - 1];
      const minutes = which ? Number(config()[BREAK_MINUTES[which]]) || 0 : 0;
      return which && minutes > 0 ? { kind: 'break', at: b.breakFrom.at + minutes * 60000, name: BREAK_NAMES[which] } : null;
    }
    const start = b.gameId ? startOf(b) : null;
    return start !== null && !gameStarted(b) ? { kind: 'start', at: start } : null;
  }
  // Pushes the board to the pages following it (scene.js), once the current change has finished.
  let boardPushTimer: NodeJS.Immediate | null = null;
  function pushBoard() {
    if (boardPushTimer) return;
    boardPushTimer = setImmediate(() => { boardPushTimer = null; try { scene.publishBoard(); } catch (err) { log('warn', 'scoreboard', `Board not pushed: ${errorMessage(err)}`); } });
  }
  // Each game's story, kept once it has goals so the Socials tab's Game story and Score worm pictures can be made after
  // the scoreboard moves on (clearGoals wipes the goal order for the next game): its Game stats, Score worm and every
  // moment (b.gameMoments) as the game left them, in game-stories/<game id>.json in the local folder (stories.js, which
  // also shares the finished ones with the other Studio Macs). Written at most every STORY_EVERY while the game is on,
  // and at once when it ends or the scoreboard picks another game (final). The board's game is a streamed story; a game
  // only followed in the background (see "The night's other games") is marked followed, and stories.js prefers a
  // streamed story of the same game from another Mac over it.
  const STORY_EVERY = 15 * 1000;
  const storyAt = new Map<string, number>(); // game id -> when its story was last kept
  // Games with a change not yet in their story (it came within STORY_EVERY of the last save): kept once that's passed
  // (keepOwedStories, each second from server.js), so the story a late Mac asks for (stories.js liveFrom) isn't left behind.
  const storyOwed = new Map<string, GameBoard>(); // game id -> its board
  function keepOwedStories() { for (const [id, b] of [...storyOwed]) { if (b.gameId === id) keepStory(false, b); else storyOwed.delete(id); } }
  function keepStory(now: boolean, b: GameBoard | undefined = boards['1']) {
    if (!b || !b.gameId || !Array.isArray(b.goals) || b.goalsGameId !== b.gameId || !b.goals.some(g => !g.gap)) return;
    if (!now && Date.now() - (storyAt.get(b.gameId) || 0) < STORY_EVERY) { storyOwed.set(b.gameId, b); return; }
    storyAt.set(b.gameId, Date.now());
    storyOwed.delete(b.gameId);
    try {
      stories.keep({ gameId: b.gameId, date: b.date || '', division: b.division || '', round: b.round || '', ended: !!b.endedAt, savedAt: Date.now(),
        followed: b.followed && !b.streamed ? true : undefined, stats: getStats(b), worm: getWorm(b),
        moments: b.gameMomentsId === b.gameId ? b.gameMoments || [] : [], goalOrder: goalOrderOf(b) }, { final: now });
    } catch (err) { log('warn', 'stats', `The story of ${b.home.name} v ${b.away.name} wasn't kept: ${errorMessage(err)}`); }
  }
  // A game's kept story (this Mac's own, or a copy from another Studio), or null when no Studio streamed or followed it.
  const gameStory = (id: string) => stories.read(id);
  // What a story's stats, worm and moments were worked out from, so a gap in it can be filled from another Mac's story of
  // the same game (mergeStories) and they worked out again.
  const goalOrderOf = (b: GameBoard) => ({ home: { name: b.home.name, score: Number(b.home.score) || 0 }, away: { name: b.away.name, score: Number(b.away.score) || 0 },
    court: courtShown(b), period: b.period, clock: b.clock ? { lengthSec: b.clock.lengthSec, elapsedMs: clockElapsed(b.clock) } : null,
    goals: b.goals, counts: b.playhqCounts || null, periodTrack: b.periodTrack && b.periodTrack.gameId === b.gameId ? b.periodTrack : null });

  function saveBoards() {
    keepStory(false);
    pushBoard();
    savefile.writeFile(STATE_FILE, JSON.stringify(boards, null, 2), err => { if (err) log('warn', 'scoreboard', `scoreboard-state.json not saved: ${errorMessage(err)}`); });
    const b = boards['1'];
    if (b) controlFile.get().boards['1'] = pickKeys(b, LASTING);
    saveControl();
  }

  const DEFAULT_REFRESH_SEC = Math.max(1, Number(MACHINE.playhqRefreshSeconds) || 5);
  let QUARTER_SEC = 600;
  // The ticker's scroll speed in pixels per second: the default, the limits and one Faster / Slower step.
  const TICKER_SPEED = 120, TICKER_MIN = 20, TICKER_MAX = 600, TICKER_STEP = 20;
  const tickerSpeed = (v: unknown) => Math.max(TICKER_MIN, Math.min(TICKER_MAX, Math.round(Number(v) || TICKER_SPEED)));

  function newBoard(): Board {
    return {
      source: 'manual',          // 'playhq' = scores follow PlayHQ, 'manual' = scores from the control page
      gameId: null, roundId: null,
      division: '', court: '', round: '', date: '', time: '', venue: '',
      courtName: '',             // the court's name typed on Scoreboard control, shown instead of PlayHQ's (court) for tonight
      home: { name: 'Home', score: 0 },
      away: { name: 'Away', score: 0 },
      period: 1, periodLabel: 'Q',
      clock: { lengthSec: QUARTER_SEC, elapsedMs: 0, running: false, startedAt: null },
      showClock: true,
      followPlayhqClock: false,  // true = the clock follows the PlayHQ scorer's game clock (while following PlayHQ); matches source when that changes
      autoSelect: true,          // pick the game from the court and the time
      autoCourt: config().defaultCourt || '', // the court to follow tonight (games.js followPlan sets it each night)
      courtFrom: config().defaultCourt ? 'fallback' : '', // where it came from: 'plan', 'fallback' or 'hand'
      courtNight: '',            // "<competition>|<night>" the court was set for
      playhqRefreshSec: DEFAULT_REFRESH_SEC,
      followOthers: true,        // also follow the night's other games in the background, for their stories
      tickerSpeed: TICKER_SPEED,  // how fast ticker.html scrolls, in pixels per second
      updatedAt: Date.now(),
    };
  }
  // The court's name on the graphics: the one typed on Scoreboard control, else PlayHQ's for the game on. Matching
  // games to a court (following a court, up next, the Production Planner) uses PlayHQ's, b.court.
  const courtShown = (b: GameBoard) => String(b.courtName || '').trim() || b.court || '';
  function board(): Board {
    const b = boards['1'] ??= { ...newBoard(), ...pickKeys(controlFile.get().boards['1'], LASTING) };
    if (b.autoSelect === undefined) { const n = newBoard(); b.autoSelect = n.autoSelect; b.autoCourt = n.autoCourt; b.courtFrom = n.courtFrom; } // saved before these existed
    return b;
  }

  // The lasting settings (keys) a saved board has: Partial<Board> as they're unchecked saved values of Board's own keys.
  function pickKeys(o: Partial<Board> | undefined, keys: string[]): Partial<Board> {
    const from: Record<string, unknown> = o || {};
    return Object.fromEntries(keys.filter(k => from[k] !== undefined).map(k => [k, from[k]]));
  }
  if (boards['1']) Object.assign(boards['1'], pickKeys(controlFile.get().boards['1'], LASTING));
  if (!controlFile.exists()) { controlFile.markUnsaved(); saveBoards(); } // none yet: write it from what was in use

  function clockElapsed(c: Clock) { return c.elapsedMs + (c.running && c.startedAt ? Date.now() - c.startedAt : 0); }

  // Clock buttons pressed by a person stop the clock following PlayHQ (like score buttons do for the score).
  const MANUAL_CLOCK = new Set(['clockStart', 'clockStop', 'clockToggle', 'clockReset', 'clockSet', 'clockAdjust']);
  // The clock matches the scores: whenever scoring switches between Follow PlayHQ and Manual
  // (the buttons, the Stream Deck, a score press, or a game being picked), following the
  // PlayHQ scorer's clock is switched to match. Changing the clock afterwards still wins.
  const SETS_SOURCE = new Set(['source', 'selectGame']);
  function applyAction(b: Board, a: Action) {
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
  // switch to PlayHQ only sets the starting point, so catching up never plays it, nor does a reading that is
  // PlayHQ catching up (catchUpIn: a scorebench back on line), and nothing plays once the game is finished.
  interface SuperReading { key: string; home: SideReading; away: SideReading }
  interface SideReading { score: number | null; goals: number | null | undefined; superGoals: number | null | undefined }
  const superSeen = new WeakMap<GameBoard, SuperReading>(); // board -> last PlayHQ reading compared against
  function superShot(b: GameBoard, side: Side, how: string) {
    if (!competitions.superShotsFor(config(), b.division)) return;
    const n = ((b.superShot && b.superShot.n) || 0) + 1;
    b.superShot = { n, side, at: Date.now(), how };
    log('info', 'supershot', `Super shot for ${b[side].name} (${side}, ${how}), number ${n}`);
  }
  function watchSuperShots(b: GameBoard, game: Reading, live: LiveGame | null | undefined, kind: string, catchUp: unknown) {
    const read = (k: Side): SideReading => ({ score: game[k].score, goals: live ? live[k].goals : null, superGoals: live ? live[k].superGoals : null });
    const now: SuperReading = { key: `${b.gameId} ${kind}`, home: read('home'), away: read('away') };
    const before = superSeen.get(b);
    superSeen.set(b, now);
    if (!before || before.key !== now.key || isFinished(game) || catchUp) return; // a catch-up's super shot was minutes ago
    for (const k of SIDES) {
      const was = before[k], is = now[k];
      if (was.score == null || is.score == null) continue;
      const up = is.score - was.score;
      if (was.superGoals != null && is.superGoals != null ? is.superGoals - was.superGoals === 1 && up >= 2
        : up === 2 && (was.goals == null || is.goals == null || is.goals === was.goals)) superShot(b, k, 'playhq');
    }
  }

  function applyOne(b: Board, a: Action) {
    trackPeriods(b); // anything PlayHQ put on the board before this goes to the period it came in
    applyOneAction(b, a);
    if (b.followHold && (b.source !== 'playhq' || ['selectGame', 'reset', 'resetScores', 'setScore', 'score'].includes(a.type))) b.followHold = null;
    if (a.type === 'resetScores' || a.type === 'reset') b.periodTrack = null;
    trackPeriods(b);
  }
  function applyOneAction(b: Board, a: Action) {
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
        const kind: StreakKind = isStreakKind(a.kind) ? a.kind : 'heating';
        const side = a.side === 'away' ? 'away' : 'home';
        const both = kind === 'goalForGoal' || kind === 'level';
        streak(b, { kind, side: both ? '' : side, goals: streakGoals(kind), from: kind === 'goalForGoal' ? side : '', down: kind === 'comeback' ? COMEBACK_DOWN + 1 : 0 }, 'test');
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
      case 'setTeams': b.home.name = a.home ?? b.home.name; b.away.name = a.away ?? b.away.name; b.division = a.division ?? b.division;
        if (a.court !== undefined) b.courtName = String(a.court || '').trim(); // blank goes back to PlayHQ's name
        break;
      case 'selectGame':
        if (!a.auto && b.autoSelect) { b.autoSelect = false; log('info', 'auto', 'Game picked by hand, so automatic game selection is off'); }
        if (!a.auto) b.handPickedOn = localDate(); // a new night turns automatic selection back on, but not over a pick made that night
        // The game it leaves, with the score it had, for the fixture board's finished game until PlayHQ has the result.
      {
        const game = a.game;
        if (!game) break;
        if (b.gameId && b.gameId !== game.id) { b.lastGame = { id: b.gameId, home: { ...b.home }, away: { ...b.away } }; keepStory(true); handOn(b); }
        Object.assign(b, { gameId: game.id, roundId: game.roundId ?? null, division: game.division || '', court: game.court || '', source: 'playhq',
          round: game.round || '', date: game.date || '', time: game.time || '', venue: game.venue || '', playhqStatus: game.status || '', playhqPeriodSeen: null, playhqClock: null, playhqClockKey: null, playhqBreak: null, endedAt: null, breakFrom: null });
        b.home = { name: game.home.name, score: game.home.score ?? 0 };
        b.away = { name: game.away.name, score: game.away.score ?? 0 };
        if (b.goalsGameId !== game.id) clearGoals(b, game.id);
        // A game followed in the background: the board carries on from its goals, quarters and clock (takenOver says so,
        // so games.js switchTo doesn't put it back to Q1 with a full clock).
        b.takenOver = takeOver(b, game.id) ? game.id : null;
        setImmediate(() => warmTeamLists(a.auto ? 'game picked automatically' : 'game picked'));
        break;
      }
      case 'source': {
        const want = a.value === 'toggle' ? (b.source === 'playhq' ? 'manual' : 'playhq') : a.value;
        const was = b.source;
        b.source = want === 'playhq' && b.gameId ? 'playhq' : 'manual';
        // Back to following from a score kept by hand: hold it until PlayHQ catches up (see holdHandScore).
        if (was !== 'playhq' && b.source === 'playhq') b.followHold = { at: Date.now() };
        break;
      }
      case 'resetScores': b.home.score = 0; b.away.score = 0; b.source = 'manual'; clearGoals(b, b.gameId); break;
      case 'clockToggle': applyOne(b, { type: b.clock.running ? 'clockStop' : 'clockStart', fromToggle: true }); break;
      case 'autoSelect':
        b.autoSelect = a.value === 'toggle' ? !b.autoSelect : !!a.value && a.value !== 'off';
        b.autoHold = '';
        break;
      case 'autoCourt': // choosing a court means "follow this court", so it also turns automatic selection on (a court
        // from the plan or the fallback doesn't, over a game picked by hand that night)
        b.autoCourt = String(a.value || '').trim(); b.autoHold = '';
        b.courtFrom = a.from ?? 'hand'; // by hand (control page, Stream Deck) lasts the night
        if (b.autoCourt && !b.autoSelect && (b.courtFrom === 'hand' || b.handPickedOn !== localDate())) { b.autoSelect = true; log('info', 'auto', `Court set to ${b.autoCourt}, so automatic game selection is on`); }
        break;
      case 'followPlayhqClock': {
        b.followPlayhqClock = a.value === 'toggle' ? !b.followPlayhqClock : !!a.value && a.value !== 'off';
        b.playhqClockKey = null; // apply the next PlayHQ reading straight away
        break;
      }
      case 'period': {
        // Quarters 1-4 or halves 1-2, then 5 for extra time.
        const last = config().periodType === 'halves' ? 2 : 4;
        let next: number = a.value === 'next' ? b.period + 1 : a.value === 'prev' ? b.period - 1 : Number(a.value) || 1;
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
      case 'followOthers': b.followOthers = a.value === 'toggle' ? b.followOthers === false : !!a.value && a.value !== 'off';
        log('info', 'follow', `Following the night's other games in the background ${b.followOthers ? 'on' : 'off'}`);
        if (!b.followOthers) setImmediate(() => followGames([])); // let them go now (their stories kept); on, they come with the next look at the night
        break;
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

  // ─── PlayHQ not scoring live ────────────────────────────────────────────────
  // A scorebench that has dropped off line looks like nothing at all to the board: the score just stops moving.
  // So while the board follows PlayHQ, two signs are watched (playhqTrouble), and the status board and the bar's
  // PlayHQ chip turn purple with the reason (red is PlayHQ failing), so the operator knows to fix the scorebench or score by hand:
  //   not-live  the live feed says the game isn't being scored electronically, but it's under way (PlayHQ says it's
  //             in progress, or it's NOT_LIVE_AFTER_MS past its start time)
  //   quiet     the feed's reading (score, counts, clock, break) hasn't changed for QUIET_MS while the scorer's
  //             clock is running; in a live game the longest stretch seen without one was about 2.5 minutes
  const NOT_LIVE_AFTER_MS = 5 * 60000, QUIET_MS = 4 * 60000;
  const RUNNING = /^(RESUME|RESUMED|START|STARTED|RUNNING)$/i;
  const TROUBLE_SAYS: Record<Exclude<Trouble, ''>, string> = {
    'not-live': 'PlayHQ says the game is under way, but its live scoring isn\'t coming through: the scorebench may be off line. Fix the scorebench, or score by hand (a score press switches to Manual).',
    quiet: `Nothing new from PlayHQ's scorer for ${QUIET_MS / 60000} minutes while its clock runs: the scorebench may be off line. Fix the scorebench, or score by hand (a score press switches to Manual).`,
  };
  function playhqTrouble(b: GameBoard, now = Date.now()): Trouble {
    if (b.source !== 'playhq' || !b.gameId || b.playhqWaiting || isFinished({ status: b.playhqStatus || '' }) || !playhq.liveSeenFor) return '';
    const seen = playhq.liveSeenFor(b.gameId);
    if (seen.notScoredAt > seen.okAt) {
      const start = startOf(b);
      const underWay = /PROGRESS|LIVE|STARTED/i.test(b.playhqStatus || '') || (start !== null && now - start > NOT_LIVE_AFTER_MS);
      return underWay ? 'not-live' : '';
    }
    const live = seen.live;
    if (seen.okAt && live && live.clock && RUNNING.test(live.clock.status || '') && !live.break && now - seen.changedAt > QUIET_MS) return 'quiet';
    return '';
  }
  // Called each refresh: keeps b.playhqTrouble current (for /api/health) and logs when it starts and ends.
  function watchTrouble(b: GameBoard) {
    const t = playhqTrouble(b);
    if (t === (b.playhqTrouble || '')) return;
    if (t) log('warn', 'scoreboard', `PlayHQ not scoring live (${t}) for ${b.home.name} v ${b.away.name}: ${TROUBLE_SAYS[t]}`);
    else log('info', 'scoreboard', `PlayHQ's live scoring for ${b.home.name} v ${b.away.name} is coming through again`);
    b.playhqTrouble = t;
  }
  const troubleSays = (t: Trouble | undefined) => t ? TROUBLE_SAYS[t] : '';

  // ─── Back to Follow PlayHQ from a score kept by hand ────────────────────────
  // When the scorebench drops off line, the operator scores by hand and presses Follow PlayHQ once it's back. Pressed
  // before PlayHQ has caught up, PlayHQ still has the old score (or none), and following it would take the board back
  // and drop the goals scored by hand. So after Follow PlayHQ is pressed (b.followHold), the board keeps its own score,
  // quarter and clock while PlayHQ's score is behind it and PlayHQ's live feed hasn't changed since the press. As soon
  // as PlayHQ has caught up (level or ahead for both teams), or its feed has anything new (the scorebench is back, and
  // PlayHQ is then the scorer's word, even a goal lower), the board follows PlayHQ as usual.
  function holdHandScore(b: GameBoard, s: { home: number; away: number }) {
    const h = b.followHold;
    if (!h) return false;
    const seen = b.gameId && playhq.liveSeenFor ? playhq.liveSeenFor(b.gameId) : null;
    const changed = !!(seen && seen.changedAt > h.at);
    const behind = s.home < (Number(b.home.score) || 0) || s.away < (Number(b.away.score) || 0);
    if (behind && !changed) {
      if (!h.logged) { h.logged = true; log('info', 'scoreboard', `Follow PlayHQ: PlayHQ has ${s.home}-${s.away}, behind the board's ${b.home.score}-${b.away.score}, so the board keeps its score until PlayHQ catches up`); }
      return true;
    }
    if (h.logged) log('info', 'scoreboard', `Follow PlayHQ: ${changed ? 'PlayHQ has something new' : 'PlayHQ has caught up'} (${s.home}-${s.away}), so the board follows it again`);
    b.followHold = null;
    return false;
  }

  // While a board follows PlayHQ, refresh its score from PlayHQ (every playhqRefreshSec, default 5).
  // Called every second by refreshTick and by the scoreboard, goals, stats and worm requests; the
  // live feed is cached for playhqRefreshSec, so PlayHQ is asked once per period however often this runs.
  async function refreshFromPlayhq(b: GameBoard) {
    noteClock(b);
    if (b.source !== 'playhq' || !b.roundId) { if (b.playhqTrouble) b.playhqTrouble = ''; return; }
    // Before electronic scoring starts there is nothing to read, so PlayHQ isn't asked.
    const wait = scoringNotYet(b);
    if (wait !== (b.playhqWaiting || '')) { if (wait) log('info', 'scoreboard', wait); b.playhqWaiting = wait; }
    if (wait) { b.playhqError = ''; b.playhqTrouble = ''; return; }
    // A reading that comes back after scores were switched to Manual or another game was picked belongs to before
    // then, so it's dropped: it would otherwise put PlayHQ's score over the one being scored by hand.
    const gameId = b.gameId;
    const roundId = b.roundId;
    if (!gameId) return;
    const stillFollowing = () => b.source === 'playhq' && b.gameId === gameId;
    try {
      const maxAge = (b.playhqRefreshSec || DEFAULT_REFRESH_SEC) * 1000;
      let game: Reading | undefined;
      const s = await liveScore({ id: gameId }, maxAge);
      if (!stillFollowing()) return;
      if (s && b.followHold && holdHandScore(b, s)) { b.playhqError = ''; watchTrouble(b); return; }
      if (s) {
        game = { id: gameId, status: s.status, home: { name: b.home.name, score: s.home }, away: { name: b.away.name, score: s.away } };
        // Follow the scorer's quarter when it changes (the Stream Deck can still set it in between).
        const period = s.live && s.live.period;
        const q = period ? PERIOD_NUMBER[period] : undefined;
        if (q && b.playhqPeriodSeen !== period) {
          // This reading's score still belongs to the quarter that was on (the quarter moves on when the next one starts).
          if (b.period !== q) trackPeriods(b, { home: s.home, away: s.away });
          if (b.period !== q) { b.period = q; log('info', 'scoreboard', `PlayHQ moved to quarter ${q}`); }
          b.playhqPeriodSeen = period;
        }
        if (s.live && s.live.clock) followClock(b, s.live);
      } else {
        // Last resort: the round fixture, which only has scores once a game is final. One kept from before PlayHQ
        // failed isn't a reading: the board keeps its score and says why.
        const games: Reading[] & { stale?: string } = await getRoundGames(roundId, maxAge);
        if (!stillFollowing()) return;
        if (games.stale) throw new Error(games.stale);
        game = games.find(g => g.id === gameId);
      }
      if (!game) { watchTrouble(b); return; }
      const catchUp = catchUpIn(b, game, s && s.live);
      watchSuperShots(b, game, s && s.live, s ? (s.live ? 'live' : 'game') : 'fixture', catchUp);
      // Log what PlayHQ reports each time it changes, including "no score yet", for debugging.
      const seen = `${game.id} ${game.status} ${game.home.score} ${game.away.score}`;
      if (b.playhqSeen !== seen) {
        log('info', 'scoreboard', `PlayHQ says ${game.home.name} ${game.home.score ?? 'no score'} - ${game.away.score ?? 'no score'} ${game.away.name} (${game.status})`);
        b.playhqSeen = seen;
      }
      const goalsChanged = goalsFromPlayhq(b, game, s && s.live, catchUp);
      if (game.home.score !== null) b.home.score = game.home.score;
      if (game.away.score !== null) b.away.score = game.away.score;
      // PlayHQ's own quarter for this reading: a jump on the quarter PlayHQ is still on is all that quarter's.
      trackPeriods(b, null, s && s.live && s.live.period ? PERIOD_NUMBER[s.live.period] : null);
      if (goalsChanged) {
        if (!isFinished(game)) watchStreaks(b, 'playhq'); // after the score is on the board, which the moments read
        saveBoards();
      }
      b.playhqStatus = game.status || '';
      b.playhqError = '';
      watchTrouble(b);
    } catch (err) {
      if (b.playhqError !== errorMessage(err)) log('error', 'scoreboard', `Following PlayHQ failed: ${errorMessage(err)}`);
      b.playhqError = errorMessage(err);
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
  // A catch-up is noted as a gap for both teams too: a reading with more scoring for one team than can happen
  // between two checks (more than one goal or super shot in a 5 s check; one per MIN_GOAL_SEC on longer ones), as
  // when a scorebench back on line sends a quarter's goals at once. Its goals can't be placed in order or in time,
  // so none are listed, and no super shot or moment plays for them (they happened minutes ago).
  const GOALS_KEPT = 400; // a whole game, so gamestats.html can count its runs
  const MAX_STEP = 3;
  const MIN_GOAL_SEC = 10;
  // Whether this reading is a catch-up (see above): false, or which team scored how many times at once.
  type CatchUp = false | { side: Side; events: number; points: number };
  function catchUpIn(b: GameBoard, game: Reading, live: LiveGame | null | undefined): CatchUp {
    if (!b.goalsBaseline || !Array.isArray(b.goals) || b.goalsGameId !== b.gameId) return false; // the first reading has its own rule
    const allowed = Math.max(1, Math.floor((b.playhqRefreshSec || DEFAULT_REFRESH_SEC) / MIN_GOAL_SEC));
    for (const side of SIDES) {
      const d = (game[side].score ?? b[side].score) - (Number(b[side].score) || 0);
      if (d <= 0) continue;
      const was = b.playhqCounts && b.playhqCounts[side], is = live && live[side];
      // Each goal or super shot is 1 or 2 points, so a rise of d is between d/2 and d of them, whatever the counts say
      // (after scoring by hand, PlayHQ's counts also hold goals already on the board).
      const counted = was && is && was.goals != null && was.superGoals != null && is.goals != null && is.superGoals != null
        ? (is.goals - was.goals) + (is.superGoals - was.superGoals) : 0;
      const events = Math.min(d, Math.max(Math.ceil(d / 2), counted));
      if (events > allowed) return { side, events, points: d };
    }
    return false;
  }
  function clearGoals(b: GameBoard, gameId: string | null | undefined) { b.goals = []; b.goalsGameId = gameId || null; b.goalsBaseline = false; b.goalsSeq = 0; b.playhqCounts = null; b.streakFired = {}; momentsFrom(b); }
  function clockLeft(b: GameBoard) { return b.clock ? Math.max(0, Math.ceil(b.clock.lengthSec - clockElapsed(b.clock) / 1000)) : null; }
  function pushGoal(b: GameBoard, side: Side, points: number, how: string) {
    b.goalsSeq = (b.goalsSeq || 0) + 1;
    b.goals ??= [];
    b.goals.push({ id: b.goalsSeq, side, points, period: b.period, clockLeft: clockLeft(b), periodSec: b.clock ? b.clock.lengthSec : null, at: Date.now(), how });
    if (b.goals.length > GOALS_KEPT) b.goals.splice(0, b.goals.length - GOALS_KEPT);
  }
  // A gap: the score moved without Studio seeing the goals. `set` is the score it moved to
  // ({ home, away }, or just the side that jumped), so worm.html can carry on from there.
  function pushGap(b: GameBoard, set: Partial<Record<Side, number>> | undefined) {
    b.goalsSeq = (b.goalsSeq || 0) + 1;
    (b.goals ??= []).push({ id: b.goalsSeq, gap: true, set, period: b.period, clockLeft: clockLeft(b), periodSec: b.clock ? b.clock.lengthSec : null, at: Date.now() });
  }
  // A score taken off (a correction) removes that team's latest goals.
  function takeGoals(b: GameBoard, side: Side, points: number) {
    const goals = b.goals || [];
    for (let i = goals.length - 1; i >= 0 && points > 0; i--) {
      const g = goals[i];
      if (g.gap || g.side !== side) continue;
      if (g.points <= points) { points -= g.points; goals.splice(i, 1); }
      else { g.points -= points; points = 0; } // a super goal taken down by 1
    }
  }
  function noteGoals(b: GameBoard, side: Side, delta: number, how: string, split?: { goals: number; superGoals: number } | null) {
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
  function goalsFromPlayhq(b: GameBoard, game: Reading, live: LiveGame | null | undefined, catchUp: CatchUp) {
    if (!Array.isArray(b.goals) || b.goalsGameId !== b.gameId) clearGoals(b, b.gameId);
    const counts: Record<Side, Counts> | null = live ? { home: { goals: live.home.goals, superGoals: live.home.superGoals, shots: live.home.shots }, away: { goals: live.away.goals, superGoals: live.away.superGoals, shots: live.away.shots } } : null;
    const goalList = b.goals ??= [];
    const before = goalList.length, seq = b.goalsSeq;
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
    if (catchUp) {
      log('info', 'goals', `${b[catchUp.side].name} went up ${catchUp.points} points (at least ${catchUp.events} goals) between readings: PlayHQ catching up, so noted as a gap for both teams, with no goals listed`);
      pushGap(b, { home: game.home.score ?? (Number(b.home.score) || 0), away: game.away.score ?? (Number(b.away.score) || 0) });
      if (counts) b.playhqCounts = counts;
      return true;
    }
    for (const side of SIDES) {
      const d = deltas[side];
      if (!d) continue;
      if (d > MAX_STEP) {
        log('info', 'goals', `${b[side].name} went up ${d} points between readings, too many to list one by one; noted as a gap`);
        pushGap(b, { [side]: game[side].score ?? 0 });
        continue;
      }
      const was = b.playhqCounts && b.playhqCounts[side], now = counts && counts[side];
      let split: { goals: number; superGoals: number } | null = null;
      if (d > 0 && was && now && now.goals != null && now.superGoals != null && was.goals != null && was.superGoals != null) {
        const g = now.goals - was.goals, sg = now.superGoals - was.superGoals;
        if (g >= 0 && sg >= 0 && g + 2 * sg === d) split = { goals: g, superGoals: sg };
      }
      noteGoals(b, side, d, 'playhq', split);
      log('info', 'goals', `${b[side].name} ${d > 0 ? '+' : ''}${d} (${split ? `${split.goals} goal${split.goals === 1 ? '' : 's'}, ${split.superGoals} super from PlayHQ's counts` : 'split worked out from the score'})`);
    }
    if (counts) b.playhqCounts = counts;
    return goalList.length !== before || b.goalsSeq !== seq;
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
  // stream isn't flooded; the rest are logged and kept in its also list, which the Commentator
  // stats page lists too. A gap in the goal list (a game picked part way through, a jump too big
  // to split, PlayHQ catching up) starts again from that score, so scores catching up never play, and nothing plays
  // once the game is finished. Each one bumps b.streak.n and is added to b.streakLog (with its
  // gameId), and streak.html plays the ones it hasn't seen.
  const STREAK_GOALS = { heating: 3, fire: 5, goalForGoal: 10 };
  const streakGoals = (kind: StreakKind) => kind === 'heating' || kind === 'fire' || kind === 'goalForGoal' ? STREAK_GOALS[kind] : 0;
  const GAME_MOMENTS_KEPT = 80;
  const MOMENT_ORDER: StreakKind[] = ['siren', 'backToBack', 'fire', 'lead', 'comeback', 'level', 'goalForGoal', 'heating'];
  const isStreakKind = (k: unknown): k is StreakKind => (MOMENT_ORDER as unknown[]).includes(k);
  const STREAK_NAMES: Record<StreakKind, string> = { heating: 'heating up', fire: 'on fire', goalForGoal: 'goal for goal', lead: 'hits the front', level: 'all square',
    comeback: 'coming back', siren: 'on the siren', backToBack: 'back to back super shots' };
  const COMEBACK_DOWN = 5, COMEBACK_WITHIN = 2, LEVEL_LAST_SEC = 120, SIREN_LAST_SEC = 10, SIREN_STOPPED_MS = 15000;
  const leaderOf = (h: number, a: number): Side | '' => (h > a ? 'home' : a > h ? 'away' : '');
  // also: the other moments the same goal made, which streak.html doesn't play (one per goal on air) but the
  // Commentator stats page lists, so a goal that's a team's third in a row and puts them in front shows both.
  function streak(b: GameBoard, ev: StreakEvent, how: string, also: StreakEvent[] = []) {
    const n = ((b.streak && b.streak.n) || 0) + 1;
    const s: Streak = { n, kind: ev.kind, side: ev.side ?? '', goals: ev.goals ?? 0, from: ev.from ?? '', down: ev.down ?? 0, also, gameId: b.gameId || null,
      score: { home: Number(b.home.score) || 0, away: Number(b.away.score) || 0 },
      period: b.period, periodLabel: rules(b.division).periodLabel, clockLeft: clockLeft(b), at: Date.now(), how };
    b.streak = s;
    b.streakLog = [...(b.streakLog || []), s].slice(-6);
    // Every moment of this game, for the Socials tab's Moments of the game (the log above keeps only the last few).
    if (b.gameMomentsId !== b.gameId) { b.gameMoments = []; b.gameMomentsId = b.gameId; }
    const moment: GameMoment = { kind: ev.kind, side: ev.side || '', goals: ev.goals || 0, down: ev.down || 0, also: also.map(x => ({ kind: x.kind, side: x.side || '' })),
      score: s.score, period: b.period, periodLabel: s.periodLabel, clockLeft: s.clockLeft };
    b.gameMoments = [...(b.gameMoments || []), moment].slice(-GAME_MOMENTS_KEPT);
    if (!b.replay) log('info', 'streak', `${ev.side ? `${b[ev.side].name} (${ev.side}) ` : ''}${STREAK_NAMES[ev.kind]}${ev.goals ? `, ${ev.goals} goals` : ''}${ev.down ? `, was ${ev.down} down` : ''} (${how}), number ${n}`);
  }
  // The score moments start from here: on a new game, after a gap, and the first time they're looked at.
  function momentsFrom(b: GameBoard) {
    const h = Number(b.home.score) || 0, a = Number(b.away.score) || 0;
    b.moments = { home: h, away: a, lastLeader: leaderOf(h, a), worst: { home: Math.max(0, a - h), away: Math.max(0, h - a) }, levelAt: null, lastId: b.goalsSeq || 0 };
  }
  // Whether the clock is running, or was running a moment ago (PlayHQ's reading comes up to 5 seconds after the goal).
  function noteClock(b: GameBoard) { if (b.clock && b.clock.running && (clockLeft(b) ?? 0) > 0) b.clockRanAt = Date.now(); }
  const clockRecent = (b: GameBoard) => (b.clock && b.clock.running) || Date.now() - (b.clockRanAt || 0) < SIREN_STOPPED_MS;
  function watchStreaks(b: GameBoard, how: string) {
    const goals = b.goals;
    if (!Array.isArray(goals)) return;
    const fired = b.streakFired || (b.streakFired = {});
    const found: StreakEvent[] = [];
    // Back from the latest goal: the current run by one team, and the stretch of goals going one each way.
    let run = 0, runStart: number | null = null, runSide: Side | '' = '', alt = 0, altStart: number | null = null, altSide: Side | '' = '', last = '';
    for (let i = goals.length - 1; i >= 0; i--) {
      const g = goals[i];
      if (g.gap || (runSide && g.side !== runSide)) break;
      runSide = g.side; run++; runStart = g.id;
    }
    for (let i = goals.length - 1; i >= 0; i--) {
      const g = goals[i];
      if (g.gap || (last && g.side === last)) break;
      last = altSide = g.side; alt++; altStart = g.id;
    }
    if (run >= STREAK_GOALS.fire && fired.fire !== runStart) { fired.fire = fired.heating = runStart; found.push({ kind: 'fire', side: runSide, goals: run }); }
    else if (run >= STREAK_GOALS.heating && fired.heating !== runStart) { fired.heating = runStart; found.push({ kind: 'heating', side: runSide, goals: run }); }
    if (alt >= STREAK_GOALS.goalForGoal && fired.goalForGoal !== altStart) { fired.goalForGoal = altStart; found.push({ kind: 'goalForGoal', goals: alt, from: altSide }); }

    // The score moments, from the score at the last look; after a gap they start again from this score.
    const m = b.moments;
    if (!m || goals.some(g => g.gap && g.id > m.lastId)) momentsFrom(b);
    else scoreMoments(b, goals, m, found);
    found.sort((x, y) => MOMENT_ORDER.indexOf(x.kind) - MOMENT_ORDER.indexOf(y.kind));
    if (found.length > 1 && !b.replay) log('info', 'streak', `Also ${found.slice(1).map(f => STREAK_NAMES[f.kind]).join(', ')}, not played (one moment per goal)`);
    if (found.length) streak(b, found[0], how, found.slice(1));
  }
  function scoreMoments(b: GameBoard, goals: Goal[], m: Moments, found: StreakEvent[]) {
    const fired = b.streakFired ??= {};
    const h = Number(b.home.score) || 0, a = Number(b.away.score) || 0;
    const fresh = goals.filter(g => !g.gap && g.id > m.lastId);
    const latest = goals[goals.length - 1];
    if (h + a > m.home + m.away && fresh.length) {
      const now = leaderOf(h, a);
      if (now && m.lastLeader && now !== m.lastLeader) found.push({ kind: 'lead', side: now });
      const left = clockLeft(b);
      if (!now && h > 0 && left !== null && left <= LEVEL_LAST_SEC && m.levelAt !== h) { m.levelAt = h; found.push({ kind: 'level' }); }
      for (const side of SIDES) {
        const down = side === 'home' ? a - h : h - a, wasDown = side === 'home' ? m.away - m.home : m.home - m.away;
        if (m.worst[side] >= COMEBACK_DOWN && down <= COMEBACK_WITHIN && down < wasDown) { found.push({ kind: 'comeback', side, down: m.worst[side] }); m.worst[side] = Math.max(0, down); }
      }
      const g = fresh[fresh.length - 1];
      if (g.gap) return; // fresh has no gaps; this tells the compiler
      if (g.clockLeft !== null && g.clockLeft <= SIREN_LAST_SEC && clockRecent(b)) found.push({ kind: 'siren', side: g.side });
      // Back to back super shots: the latest two goals, both super goals by the same team.
      const prev = goals[goals.length - 2];
      if (latest === g && g.points === 2 && prev && !prev.gap && prev.side === g.side && prev.points === 2 && fired.backToBack !== g.id) {
        fired.backToBack = g.id; found.push({ kind: 'backToBack', side: g.side });
      }
    }
    for (const side of SIDES) m.worst[side] = Math.max(m.worst[side], side === 'home' ? a - h : h - a);
    m.home = h; m.away = a; m.lastLeader = leaderOf(h, a) || m.lastLeader; m.lastId = b.goalsSeq || 0;
  }

  // What goals.html shows: the last `count` goals (oldest first), the current run and the tally.
  function getGoals(count: unknown) {
    const b = board();
    if (!Array.isArray(b.goals) || b.goalsGameId !== b.gameId) clearGoals(b, b.gameId);
    const goals = b.goals || [];
    const n = Math.max(3, Math.min(30, Math.round(Number(count) || 10)));
    // Take the last n goals; a gap inside them is kept so the page can mark it.
    const out: Goal[] = [];
    let found = 0;
    for (let i = goals.length - 1; i >= 0 && found < n; i--) {
      out.unshift(goals[i]);
      if (!goals[i].gap) found++;
    }
    while (out.length && out[0].gap) out.shift();
    const real = realGoals(out);
    const tally = (side: Side) => ({ goals: real.filter(g => g.side === side).length, points: real.filter(g => g.side === side).reduce((t, g) => t + g.points, 0) });
    let run: { side: Side; goals: number; points: number } | null = null;
    for (let i = goals.length - 1; i >= 0; i--) {
      const g = goals[i];
      if (g.gap) break;
      if (!run) run = { side: g.side, goals: 0, points: 0 };
      if (g.side !== run.side) break;
      run.goals++; run.points += g.points;
    }
    const r = rules(b.division);
    return {
      gameId: b.gameId, division: b.division, court: courtShown(b), round: b.round, source: b.source, period: b.period,
      periodLabel: r.periodLabel, superShots: r.superShots, competition: competitionName(),
      home: { name: b.home.name, score: b.home.score, logo: logoFor(b.home.name), colour: colourFor(b.home.name) },
      away: { name: b.away.name, score: b.away.score, logo: logoFor(b.away.name), colour: colourFor(b.away.name) },
      count: n, goals: out, tally: { home: tally('home'), away: tally('away') }, run,
      totalGoals: realGoals(goals).length, gapInHistory: goals.some(g => g.gap),
    };
  }

  // ─── Game stats (gamestats.html) ────────────────────────────────────────────
  // Points per quarter (or half) are tracked from the score on the board: whatever the score
  // goes up or down by is put on the quarter that is on at the time. The quarter only moves on
  // when the next one starts, so the goals up to then are the last quarter's. A quarter is
  // "unsure" when its points can't be split out: the game was picked up part way through it, or
  // the score jumped by more than MAX_STEP for a team in one go (Studio was closed, or a score was
  // typed in). Quarters before the one the game was picked up in aren't known at all. A jump that comes from
  // PlayHQ while PlayHQ is still on the quarter it's put on (playhqQuarter, as when a scorebench back on line
  // catches up before the next quarter starts) is all that quarter's, so the quarter stays sure.
  function trackPeriods(b: GameBoard, score?: { home?: number | null; away?: number | null } | null, playhqQuarter: number | null | undefined = null) {

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
    for (const side of SIDES) {
      const d = now[side] - t.base[side];
      if (!d) continue;
      if (Math.abs(d) > MAX_STEP && p.sure && playhqQuarter !== t.period) { p.sure = false; log('info', 'stats', `${b[side].name} went ${d > 0 ? 'up' : 'down'} ${Math.abs(d)} at once in ${rules(b.division).periodLabel}${t.period}, so that quarter's split isn't sure`); }
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
  function playedExtraTime(b: GameBoard, extra: Partial<Record<Side, number>>) {
    const h = (Number(b.home.score) || 0) - (extra.home || 0), a = (Number(b.away.score) || 0) - (extra.away || 0);
    return h === a;
  }
  // Runs: goals in a row by one team (a super goal is one goal, as on the Last 10 goals graphic).
  // A gap in the goal order (picked up part way, a jump) ends a run.
  function runsFrom(goals: Goal[]) {
    const runs: { side: Side; goals: number; period: number }[] = [];
    let run: { side: Side; goals: number; period: number } | null = null;
    for (const g of goals) {
      if (g.gap) { run = null; continue; }
      if (!run || run.side !== g.side) runs.push(run = { side: g.side, goals: 0, period: g.period });
      run.goals++;
    }
    return runs;
  }
  function getStats(b: GameBoard = board()) {
    trackPeriods(b);
    if (!Array.isArray(b.goals) || b.goalsGameId !== b.gameId) clearGoals(b, b.gameId);
    const r = rules(b.division);
    const t = b.periodTrack ?? { gameId: b.gameId, period: b.period, base: { home: 0, away: 0 }, periods: {} }; // trackPeriods made it
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
    interface Quarter { n: number; label: string; played: boolean; home: number | null; away: number | null; sure: boolean }
    const periods: Quarter[] = [];
    for (let n = 1; n <= last; n++) {
      const p = tracked[n];
      if (n > r.periods && !p) continue; // no extra time
      periods.push({ n, label: n > r.periods ? 'ET' : `${r.periodLabel}${n}`, played: !!p || n < current,
        home: p ? p.home : null, away: p ? p.away : null, sure: !!(p && p.sure) && n <= current });
    }
    // The quarters sure of their split have both scores (sure is only set on a played quarter).
    const sure = periods.filter((p): p is Quarter & { home: number; away: number } => p.sure && p.n <= r.periods && (p.n < current || !!p.home || !!p.away));
    const other = (side: Side): Side => side === 'home' ? 'away' : 'home';
    const won = (side: Side) => sure.filter(p => p[side] > p[other(side)]).length;
    type Best = { n: number; label: string; points: number } | null;
    const best = (side: Side) => sure.reduce<Best>((top, p) => (!top || p[side] > top.points ? { n: p.n, label: p.label, points: p[side] } : top), null);
    const allGoals = b.goals || [];
    const goals = realGoals(allGoals);
    const counts: Partial<Record<Side, Counts>> = b.playhqCounts || {};
    const supers = (side: Side) => Math.max(goals.filter(g => g.side === side && g.points === 2).length, Number(counts[side] && counts[side].superGoals) || 0);
    const runs = runsFrom(allGoals);
    const runsOf = (side: Side, n: number) => runs.filter(x => x.side === side && x.goals >= n).length;
    const longest = (side: Side) => runs.filter(x => x.side === side).reduce((m, x) => Math.max(m, x.goals), 0);
    const both = <T>(f: (side: Side) => T) => ({ home: f('home'), away: f('away') });
    // Shooting from PlayHQ's live counts (goals and super shots made, from every shot: GOAL_ATTEMPT), when following
    // PlayHQ and its scorer records shots; null otherwise (presses on the control page don't say how many were missed).
    const shooting = (side: Side) => {
      const c = counts[side];
      if (!c || c.shots == null) return null;
      const made = (Number(c.goals) || 0) + (Number(c.superGoals) || 0), shots = Number(c.shots) || 0;
      return { made, shots, percent: shots ? Math.round((made / shots) * 100) : null };
    };
    return {
      gameId: b.gameId, division: b.division, court: courtShown(b), round: b.round, period: b.period, competition: competitionName(),
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
      totalGoals: goals.length, gapInHistory: allGoals.some(g => g.gap),
    };
  }

  // ─── Score worm (worm.html) ─────────────────────────────────────────────────
  // The margin (home minus away) over game time, from the goal order. Time is in periods:
  // 1.5 is half way through the first quarter, from the clock when each goal came in. A
  // quarter whose goals have no clock times (the clock wasn't run) has its goals spread
  // evenly across it. Each gap (the game picked up part way, a score typed in or a jump of
  // more than 3) ends a line: the next one starts from the score after the gap, and the gap
  // is listed so the page can show Studio wasn't watching then.
  function getWorm(b: GameBoard = board()) {
    if (!Array.isArray(b.goals) || b.goalsGameId !== b.gameId) clearGoals(b, b.gameId);
    const r = rules(b.division);
    const defaultSec = (Number(r.periodMinutes) || 10) * 60;
    const fraction = (left: number | null, sec: number | null | undefined) => {
      const len = Number(sec) || defaultSec;
      return left == null ? null : Math.max(0, Math.min(1, (len - left) / len));
    };
    interface Entry { g: Goal; period: number; frac: number | null; atSiren?: boolean; spread?: boolean }
    const entries: Entry[] = (b.goals || []).map(g => ({ g, period: Number(g.period) || 1, frac: fraction(g.clockLeft, g.periodSec) }));
    // Goals after the last quarter without a level score at its end (see playedExtraTime) were on the siren of the last quarter.
    const extra = { home: 0, away: 0 };
    for (const e of entries) if (!e.g.gap && e.period > r.periods) extra[e.g.side] += e.g.points;
    const extraTime = (extra.home || extra.away || (Number(b.period) || 1) > r.periods) && playedExtraTime(b, extra);
    if (!extraTime) for (const e of entries) if (e.period > r.periods) { e.period = r.periods; e.frac = 1; e.atSiren = true; }
    // Goals in a quarter without usable clock times (none running, or all at the same moment) are spread evenly.
    const byPeriod = new Map<number, Entry[]>();
    for (const e of entries) if (!e.g.gap) { const list = byPeriod.get(e.period); if (list) list.push(e); else byPeriod.set(e.period, [e]); }
    for (const list of byPeriod.values()) {
      const timed = list.filter(e => !e.atSiren);
      const fracs = timed.map(e => e.frac);
      if (timed.length && (fracs.some(f => f == null) || (timed.length > 1 && fracs.every(f => f === fracs[0])))) {
        timed.forEach((e, i) => { e.frac = (i + 1) / (timed.length + 1); e.spread = true; });
      }
    }
    const score = { home: 0, away: 0 };
    interface Point { t: number; home: number; away: number; margin: number; side?: Side; points?: number }
    type Segment = Point[] & { fromGap?: boolean };
    const segments: Segment[] = [], gaps: { from: number; to: number }[] = [];
    let seg: Segment = [], lastT = 0;
    const point = (t: number, extra?: { side: Side; points: number }): Point => ({ t: Math.round(t * 10000) / 10000, home: score.home, away: score.away, margin: score.home - score.away, ...extra });
    if (entries.length && !entries[0].g.gap) segments.push(seg = [point(0)]);
    if (!entries.length) segments.push(seg = [point(0)]);
    for (const e of entries) {
      let t = e.frac == null ? lastT : e.period - 1 + e.frac;
      t = Math.max(t, lastT);
      if (e.g.gap) {
        const set = e.g.set;
        for (const side of SIDES) if (set && set[side] != null) score[side] = Number(set[side]) || 0;
        if (seg.length === 1 && seg.fromGap) { // gaps in a row (both scores typed in): one gap, to the last of them
          seg[0] = point(t);
          gaps[gaps.length - 1].to = t;
        } else {
          gaps.push({ from: segments.length ? lastT : 0, to: t });
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
    const lead = (side: Side) => all.reduce<{ margin: number; t: number } | null>((top, p) => {
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
      const windows: { n: number; from: number; to: number }[] = [];
      for (let n = 1; n <= r.periods; n++) {
        const seen = entries.find(e => e.period === n && e.g.periodSec);
        const len = Number(seen ? seen.g.periodSec : n === Number(b.period) && b.clock ? b.clock.lengthSec : 0) || defaultSec;
        windows.push({ n, from: n - Math.min(ssSec, len) / len, to: n });
      }
      const inWindow = entries.filter((e): e is Entry & { g: RealGoal } => !e.g.gap && !e.spread && e.g.clockLeft != null && e.g.clockLeft <= ssSec && e.period <= r.periods);
      const pts = (side: Side) => inWindow.filter(e => e.g.side === side).reduce((t, e) => t + e.g.points, 0);
      // byPeriod: each quarter's super shot period on its own, for the Socials tab's Super shot time.
      const ptsIn = (side: Side, n: number) => inWindow.filter(e => e.g.side === side && e.period === n).reduce((t, e) => t + e.g.points, 0);
      superShot = { minutes: r.superShotMinutes, windows, points: { home: pts('home'), away: pts('away') },
        byPeriod: windows.map(w => ({ n: w.n, home: ptsIn('home', w.n), away: ptsIn('away', w.n) })), timed: entries.some(e => !e.g.gap && !e.spread) };
    }
    return {
      gameId: b.gameId, division: b.division, court: courtShown(b), round: b.round, period: b.period, competition: competitionName(),
      periodType: r.periodType, periodLabel: r.periodLabel, periods, regularPeriods: r.periods,
      home: { name: b.home.name, score: b.home.score, logo: logoFor(b.home.name), colour: colourFor(b.home.name) },
      away: { name: b.away.name, score: b.away.score, logo: logoFor(b.away.name), colour: colourFor(b.away.name) },
      segments, gaps: gaps.filter(g => g.to > g.from), end,
      biggestLead: { home: lead('home'), away: lead('away') }, leadChanges: changes, superShot,
      totalGoals: entries.filter(e => !e.g.gap).length,
    };
  }

  // ─── Filling a story's gaps from another Mac's story of the same game ───────
  // Two Studio Macs following the same game (one streaming it, the other following it in the background, or both
  // following it) each read PlayHQ's feed, so where one has a gap (its internet or PlayHQ dropped, or it picked the game
  // up part way) the other may have seen those goals one by one. mergeStories(base, other) fills each of base's gaps
  // whose score before and after the other story passes through, with no gap of its own in between, with the other's
  // goals there, and works the stats, worm and moments out again from the goal order (a board of its own, on no page,
  // whose moments are played through again without logging). Quarters a filled gap could have covered (from the last
  // goal before it to the reading after it) are worked out from the goals once no gap is left in them; the rest are as
  // base had them. Answers null when no gap was filled. stories.js does the choosing (see better()) and the keeping.
  function goalWalk(goals: Goal[]) { // the score before each entry, and which gap-free stretch it's in
    const score = { home: 0, away: 0 }, at: { home: number; away: number; stretch: number }[] = [];
    let stretch = 0;
    for (const g of goals) {
      at.push({ home: score.home, away: score.away, stretch });
      if (g.gap) { const set = g.set; for (const side of SIDES) if (set && set[side] != null) score[side] = Number(set[side]) || 0; stretch++; }
      else score[g.side] += Number(g.points) || 0;
    }
    at.push({ home: score.home, away: score.away, stretch });
    return at;
  }
  // The periods each run of gaps could have hidden goals in: from the last goal's before it (1 at the start) to its own.
  function gapPeriods(goals: Goal[]) {
    const out = new Set<number>();
    let last = 1;
    for (const g of goals) {
      if (!g.gap) { last = Number(g.period) || last; continue; }
      for (let p = last; p <= (Number(g.period) || last); p++) out.add(p);
    }
    return out;
  }
  function mergeStories(base: StoryOf, other: StoryOf) {
    const A = goalOrderIn(base), B = goalOrderIn(other);
    if (!A || !B || !A.goals.some(g => g.gap) || !B.goals.some(g => !g.gap)) return null;
    if (base.gameId !== other.gameId) return null;
    const theirs = goalWalk(B.goals);
    const same = (x: Record<Side, number>, y: Record<Side, number>) => x.home === y.home && x.away === y.away;
    // B's goals from score `from` to score `to`, none of them a gap, or null.
    const stretchOf = (from: Record<Side, number>, to: Record<Side, number>) => {
      for (let i = 0; i < theirs.length; i++) {
        if (!same(theirs[i], from)) continue;
        for (let j = i + 1; j < theirs.length && theirs[j].stretch === theirs[i].stretch; j++) if (same(theirs[j], to)) return B.goals.slice(i, j);
      }
      return null;
    };
    const goals: Goal[] = [], score = { home: 0, away: 0 };
    let filled = 0;
    for (let i = 0; i < A.goals.length;) {
      const g = A.goals[i];
      if (!g.gap) { goals.push(g); score[g.side] += Number(g.points) || 0; i++; continue; }
      const from = { ...score };
      let j = i;
      for (let gj = A.goals[j]; j < A.goals.length && gj.gap; gj = A.goals[++j]) {
        const set = gj.set;
        for (const side of SIDES) if (set && set[side] != null) score[side] = Number(set[side]) || 0;
      }
      const fill = !same(from, score) && stretchOf(from, score);
      if (fill) { goals.push(...fill); filled++; } else goals.push(...A.goals.slice(i, j));
      i = j;
    }
    if (!filled) return null;
    goals.forEach((g, k) => { goals[k] = { ...g, id: k + 1 }; });
    // The quarters: the ones a filled gap could have covered are added up from the goals, once no gap is left in them.
    const before = gapPeriods(A.goals), after = gapPeriods(goals);
    const periods: Record<number, PeriodScore> = { ...((A.periodTrack && A.periodTrack.periods) || {}) };
    for (const p of before) {
      if (after.has(p)) continue;
      const sum: PeriodScore = periods[p] = { home: 0, away: 0, sure: true };
      for (const g of realGoals(goals)) if ((Number(g.period) || 1) === p) sum[g.side] += Number(g.points) || 0;
    }
    const b: GameBoard = { replay: true, gameId: base.gameId, division: str(base.division), round: str(base.round), court: A.court || '',
      home: { ...A.home }, away: { ...A.away }, period: A.period || 1,
      clock: A.clock ? { lengthSec: A.clock.lengthSec, elapsedMs: A.clock.elapsedMs, running: false, startedAt: null } : null,
      goals, goalsSeq: goals.length, goalsGameId: base.gameId, goalsBaseline: true, playhqCounts: A.counts || B.counts || null,
      periodTrack: { gameId: base.gameId, period: A.period || 1, base: { home: A.home.score, away: A.away.score }, periods } };
    // The moments, played through again goal by goal, each at its own clock time.
    const replayed: Goal[] = [];
    const r: GameBoard = { ...b, home: { ...b.home, score: 0 }, away: { ...b.away, score: 0 }, goals: replayed, goalsSeq: 0, streakFired: {}, gameMoments: [], gameMomentsId: b.gameId };
    momentsFrom(r);
    for (const g of goals) {
      replayed.push(g);
      r.goalsSeq = g.id;
      if (g.gap) { const set = g.set; for (const side of SIDES) if (set && set[side] != null) r[side].score = Number(set[side]) || 0; }
      else r[g.side].score += Number(g.points) || 0;
      r.period = g.period;
      const len = Number(g.periodSec) || QUARTER_SEC;
      r.clock = g.clockLeft == null ? null : { lengthSec: len, elapsedMs: Math.max(0, len - g.clockLeft) * 1000, running: true, startedAt: null };
      watchStreaks(r, 'merged');
    }
    const goalOrder: GoalOrder = { ...A, goals, periodTrack: b.periodTrack ?? null };
    return { stats: getStats(b), worm: getWorm(b), moments: r.gameMoments, goalOrder, filledGaps: filled, streakFired: r.streakFired };
  }
  if (stories.useMerge) stories.useMerge(mergeStories);

  // A game this Mac picked up part way (turned on late, or its internet dropped), on the scoreboard or followed in the
  // background: while its goal order has a gap, every PEER_FILL_EVERY it asks the other Studio Macs for their story of the
  // game so far (stories.js liveFrom) and fills the gap from it (mergeStories) there and then, so the worm, runs,
  // streaks and Commentator stats have the whole game while it's still on, and it carries on by itself from there. The
  // moments already played aren't played again (the streaks fired come with the goals). Another Mac's story is kept at
  // most every STORY_EVERY, so a gap only just made waits for its next save.
  const PEER_FILL_EVERY = 30 * 1000;
  const peerAsked = new Map<string, number>(); // game id -> when it last asked
  async function fillFromPeers(b: GameBoard) {
    if (!stories.liveFrom || !b || !b.gameId || b.source !== 'playhq' || b.endedAt || b.done || !Array.isArray(b.goals) || b.goalsGameId !== b.gameId || !b.goals.some(g => g.gap)) return false;
    if (Date.now() - (peerAsked.get(b.gameId) || 0) < PEER_FILL_EVERY) return false;
    peerAsked.set(b.gameId, Date.now());
    const id = b.gameId, seq = b.goalsSeq;
    const theirs = await stories.liveFrom(id);
    if (b.gameId !== id || b.goalsSeq !== seq) return false; // moved on, or new goals while it asked: next time
    const mine = { gameId: id, goalOrder: goalOrderOf(b) };
    let best: { m: NonNullable<ReturnType<typeof mergeStories>>; studio: string | undefined } | null = null;
    const gapsIn = (o: GoalOrder) => o.goals.filter(g => g.gap).length;
    for (const other of theirs) {
      const m = mergeStories(mine, other);
      if (m && (!best || gapsIn(m.goalOrder) < gapsIn(best.m.goalOrder))) best = { m, studio: other.studio };
    }
    if (!best) return false;
    const { m } = best;
    b.goals = m.goalOrder.goals;
    b.goalsSeq = b.goals.length;
    b.periodTrack = m.goalOrder.periodTrack;
    b.gameMoments = m.moments;
    b.gameMomentsId = id;
    b.streakFired = m.streakFired || {};
    momentsFrom(b);
    log('info', b.followed ? 'follow' : 'goals', `${b.home.name} v ${b.away.name}: filled ${m.filledGaps} gap${m.filledGaps === 1 ? '' : 's'} in the goal order from ${best.studio}'s Studio, ${realGoals(b.goals).length} goals now`);
    storyAt.delete(id); // its story kept again at the next save, filled
    if (b.followed) saveFollowed(); else saveBoards();
    pushBoard();
    return true;
  }
  // Each second (server.js): the scoreboard's game and every followed one.
  function fillGapsFromPeers() {
    for (const b of [board(), ...Object.values(followed)]) fillFromPeers(b).catch((err: unknown) => log('warn', 'goals', `Filling a gap from another Studio failed: ${errorMessage(err)}`));
  }

  // ─── The night's other games, followed in the background ────────────────────
  // So every game of the night has a story (Game stats, Score worm, moments), not only the one on the stream, Studio
  // also follows the night's other games while it's on air (followOthers, the switch on Scoreboard control, on by
  // default). Each one's live feed is read every playhqRefreshSec from when its scoring opens until PlayHQ says it's
  // finished, and goes through the same goal order, quarters, clock and moments as the board, on a board of its own that
  // no page shows (followed: true), so nothing plays on air for it: no super shot song, no moments, no scorebench
  // warnings. Its story is kept as the board's is, marked followed. A game the scoreboard picks takes over its followed
  // board's goals (takeOver), and a game the scoreboard leaves before it ends goes on being followed from where the board
  // left it (handOn), so a game seen by both is one story, and a streamed one. A reading that fails makes that game wait
  // longer before the next (BACKOFF_MS, doubling up to BACKOFF_MAX_MS), so a PlayHQ that is struggling, or asking Studio
  // to slow down, isn't asked more. Kept in followed-games.json in the local folder, so a restart mid-game carries on.
  const FOLLOWED_FILE = datadir.local('followed-games.json');
  const BACKOFF_MS = 10 * 1000, BACKOFF_MAX_MS = 5 * 60 * 1000;
  // What a game's goal order is made of: what a followed board and the scoreboard hand each other.
  const GOAL_STATE = ['home', 'away', 'period', 'clock', 'goals', 'goalsSeq', 'goalsGameId', 'goalsBaseline', 'playhqCounts', 'periodTrack',
    'moments', 'streakFired', 'gameMoments', 'gameMomentsId', 'playhqPeriodSeen', 'playhqStatus', 'endedAt', 'streamed'] as const satisfies (keyof GameBoard)[];
  // A deep copy of those (JSON.parse gives back what JSON.stringify was handed, so it's still Partial<GameBoard>).
  const goalState = (b: GameBoard): Partial<GameBoard> => JSON.parse(JSON.stringify(Object.fromEntries(GOAL_STATE.filter(k => b[k] !== undefined).map(k => [k, b[k]]))));
  let followed: Record<string, Followed> = savefile.readJson<Record<string, Followed>>(FOLLOWED_FILE, {}, (err, movedTo) => log('warn', 'follow', `Could not read followed-games.json, starting fresh: ${errorMessage(err)}${movedTo ? ` (moved to ${path.basename(movedTo)})` : ''}`));
  if (!followed || typeof followed !== 'object' || Array.isArray(followed)) followed = {};
  {
    const yesterday = localDate(new Date(Date.now() - 86400000)); // a late night's games carry on past midnight
    for (const [id, f] of Object.entries(followed)) if (!f || typeof f !== 'object' || !f.gameId || String(f.date || '') < yesterday) delete followed[id];
  }
  const saveFollowed = () => savefile.writeFile(FOLLOWED_FILE, JSON.stringify(followed), err => { if (err) log('warn', 'follow', `followed-games.json not saved: ${errorMessage(err)}`); });
  const followOthers = () => board().followOthers !== false;
  function followedBoard(game: GameChoice): Followed {
    return { followed: true, source: 'playhq', followPlayhqClock: true, gameId: game.id, roundId: game.roundId || null,
      division: game.division || '', court: game.court || '', round: game.round || '', date: game.date || '', time: game.time || '', venue: game.venue || '',
      home: { name: game.home.name, score: 0 }, away: { name: game.away.name, score: 0 }, period: 1,
      clock: { lengthSec: QUARTER_SEC, elapsedMs: 0, running: false, startedAt: null }, playhqStatus: game.status || '', wait: { n: 0, until: 0 } };
  }
  // The scoreboard picked a game that was being followed: it takes over its goals, quarters, clock and moments.
  function takeOver(b: GameBoard, id: string) {
    const f = followed[id];
    if (!f) return false;
    delete followed[id];
    saveFollowed();
    if (b.gameId !== id || !Array.isArray(f.goals) || f.goalsGameId !== id) return false;
    Object.assign(b, goalState(f));
    log('info', 'follow', `The scoreboard takes over ${b.home.name} v ${b.away.name} at ${b.home.score}-${b.away.score} from following it in the background, with its ${realGoals(f.goals).length} goals`);
    return true;
  }
  // The scoreboard left a game before it ended: it goes on being followed from where the board was.
  function handOn(b: GameBoard) {
    if (!b.gameId || b.source !== 'playhq' || b.endedAt || isFinished({ status: b.playhqStatus || '', date: b.date, home: b.home, away: b.away }) || !followOthers()) return;
    if (!Array.isArray(b.goals) || b.goalsGameId !== b.gameId || !b.goals.length) return;
    const id = b.gameId;
    const f = followedBoard({ id, roundId: b.roundId, division: b.division, court: b.court, round: b.round, date: b.date, time: b.time, venue: b.venue, home: b.home, away: b.away, status: b.playhqStatus });
    followed[id] = Object.assign(f, goalState(b), { streamed: true, followPlayhqClock: true, playhqClockKey: null });
    saveFollowed();
    log('info', 'follow', `${b.home.name} v ${b.away.name} goes on being followed in the background at ${b.home.score}-${b.away.score}`);
  }
  // The night's games (games.js, every so often): the ones not on the scoreboard and not finished are followed. Games no
  // longer on the night (another night picked, the setting off) are let go, their stories kept.
  function followGames(games: GameChoice[] | null | undefined) {
    const want = new Map<string, GameChoice>();
    if (followOthers()) for (const g of games || []) if (g && g.id && g.id !== board().gameId && !g.toBeDecided && g.home && g.away) want.set(g.id, g);
    let changed = false;
    for (const [id, f] of Object.entries(followed)) {
      if (want.has(id)) continue;
      delete followed[id];
      changed = true;
      if (id === board().gameId) continue; // the scoreboard has it (put back by a practice game ending, say): its story is the board's
      keepStory(true, f);
      log('info', 'follow', `Stopped following ${f.home.name} v ${f.away.name} in the background${followOthers() ? ' (no longer on this game night)' : ''}`);
    }
    for (const [id, g] of want) {
      if (followed[id] || isFinished(g)) continue;
      followed[id] = followedBoard(g);
      changed = true;
      log('info', 'follow', `Following ${g.home.name} v ${g.away.name} (${String(g.time || '').slice(0, 5)}, ${g.court || 'no court'}, ${g.division || ''}) in the background for its stats`);
    }
    if (changed) saveFollowed();
  }
  // One reading for a followed game: as refreshFromPlayhq does for the board, with nothing played on air.
  async function readFollowed(f: Followed) {
    const now = Date.now();
    if (f.done || now < (f.wait.until || 0) || scoringNotYet(f)) return;
    const maxAge = (board().playhqRefreshSec || DEFAULT_REFRESH_SEC) * 1000;
    let live: LiveGame;
    try { live = await playhq.getLive(f.gameId, maxAge); }
    catch (err) {
      if (isObj(err) && (err.notYet || err.notScored)) return; // the scorer hasn't started: asked again next time, as the board does
      f.wait = { n: f.wait.n + 1, until: Date.now() + Math.min(BACKOFF_MAX_MS, BACKOFF_MS * 2 ** f.wait.n) };
      log('warn', 'follow', `Reading ${f.home.name} v ${f.away.name} failed (${errorMessage(err)}), so it waits ${Math.round((f.wait.until - Date.now()) / 1000)} s`);
      return;
    }
    if (followed[f.gameId] !== f) return; // let go, or taken over by the scoreboard, while it was being read
    if (f.wait.n) f.wait = { n: 0, until: 0 };
    noteClock(f);
    const score = { home: live.home.score, away: live.away.score };
    if (score.home == null && score.away == null) return;
    const q = live.period ? PERIOD_NUMBER[live.period] : undefined;
    if (q && f.playhqPeriodSeen !== live.period) {
      if (f.period !== q) { trackPeriods(f, { home: score.home ?? f.home.score, away: score.away ?? f.away.score }); f.period = q; }
      f.playhqPeriodSeen = live.period;
    }
    if (live.clock) followClock(f, live);
    const game: Reading = { id: f.gameId, status: live.status, home: { name: f.home.name, score: score.home ?? null }, away: { name: f.away.name, score: score.away ?? null } };
    const catchUp = catchUpIn(f, game, live);
    const goalsChanged = goalsFromPlayhq(f, game, live, catchUp);
    if (score.home != null) f.home.score = score.home;
    if (score.away != null) f.away.score = score.away;
    trackPeriods(f, null, q || null);
    if (goalsChanged && !isFinished(game)) watchStreaks(f, 'followed');
    f.playhqStatus = live.status || '';
    if (isFinished(game)) {
      f.done = true; f.endedAt = f.endedAt || Date.now();
      log('info', 'follow', `${f.home.name} v ${f.away.name} finished ${f.home.score}-${f.away.score}: its story is kept`);
    }
    keepStory(!!f.done, f); // at most every STORY_EVERY, as the board's is
    if (goalsChanged || f.done) { saveFollowed(); pushBoard(); } // Scoreboard control lists where it's up to
  }
  // Each second (server.js): every followed game due a reading. Each is read through the live feed's cache, so PlayHQ is
  // asked once per playhqRefreshSec per game, and a game still being read is left alone.
  const reading = new Set<string>();
  function refreshFollowed() {
    for (const f of Object.values(followed)) {
      if (reading.has(f.gameId) || f.gameId === board().gameId) continue; // the scoreboard reads its own game
      reading.add(f.gameId);
      readFollowed(f).catch((err: unknown) => log('error', 'follow', `Following ${f.home.name} v ${f.away.name} failed: ${errorMessage(err)}`)).finally(() => reading.delete(f.gameId));
    }
  }
  // What Scoreboard control lists under the switch: each followed game and where it's up to (recorder.js records them from it).
  function followedGames() {
    return Object.values(followed).map(f => ({ gameId: f.gameId, home: f.home.name, away: f.away.name, court: f.court, date: f.date, time: f.time, division: f.division, round: f.round,
      score: { home: Number(f.home.score) || 0, away: Number(f.away.score) || 0 }, period: f.period, done: !!f.done, waiting: !!(f.wait && f.wait.n),
      started: !!f.goalsBaseline, goals: Array.isArray(f.goals) ? realGoals(f.goals).length : 0 }))
      .sort((x, y) => String(x.time).localeCompare(String(y.time)) || String(x.court).localeCompare(String(y.court)));
  }

  // The scorer's game clock from PlayHQ's live feed. Seen so far (one finished game):
  // { period: "4th Quarter", periodValue: "FOURTH_QTR", status: "RESUME", time: "00:00", lastUpdatedAt: "<ms>" }.
  // Read as: `time` is the time left when the scorer last touched the clock (lastUpdatedAt),
  // and RESUME/START mean it is running. Every reading is logged so this can be checked.
  function followClock(b: GameBoard, live: LiveGame) {
    const c = live.clock;
    if (!c) return;
    b.playhqClock = c;
    b.playhqBreak = live.break || null;
    const key = `${c.periodValue || c.period} ${c.status} ${c.time} ${c.lastUpdatedAt} ${live.break || ''}`;
    if (b.playhqClockKey === key) return;
    b.playhqClockKey = key;
    const secs = parseClock(c.time);
    const running = /^(RESUME|RESUMED|START|STARTED|RUNNING)$/i.test(c.status || '') && !live.break;
    const updated = Number(c.lastUpdatedAt) || Date.parse(String(c.lastUpdatedAt)) || 0;
    const lagMs = running && updated ? Math.max(0, Math.min(120000, Date.now() - updated)) : 0;
    if (!b.followed) log('info', 'clock', `PlayHQ clock ${c.periodValue || c.period || '?'} ${c.status || '?'} ${c.time ?? '?'} (updated ${updated ? Math.round((Date.now() - updated) / 1000) + 's ago' : '?'})${live.break ? ' break ' + live.break : ''}${b.followPlayhqClock ? '' : ' (not followed)'}`);
    if (!b.followPlayhqClock || secs === null || !b.clock) return;
    if (secs > b.clock.lengthSec) b.clock.lengthSec = secs;
    const leftMs = Math.max(0, secs * 1000 - lagMs);
    b.clock = { ...b.clock, elapsedMs: b.clock.lengthSec * 1000 - leftMs, running: running && leftMs > 0, startedAt: running && leftMs > 0 ? Date.now() : null };
    b.updatedAt = Date.now();
  }

  function parseClock(t: unknown) {
    const m = String(t || '').match(/^(\d{1,2})(?:[:.](\d{1,2}))?$/);
    return m ? Number(m[1]) * 60 + Number(m[2] || 0) : null;
  }

  // The quarter length from the competition setup, applied by server.js when the setup changes.
  const quarterSec = () => QUARTER_SEC;
  const setQuarterSec = (n: number) => { QUARTER_SEC = n; };

  // A copy of the scoreboard, and putting one back (practice.js: a practice game leaves it as it was).
  const snapshot = (): Board => JSON.parse(JSON.stringify(board()));
  function restore(s: Board | null | undefined) {
    if (!s) return;
    boards['1'] = s;
    saveBoards();
  }

  // ─── Where the game is, for the status chips ───────────────────────────
  // 'upcoming' until the clock has run or a score has gone on, 'live' from then, 'ended' from the end (PlayHQ saying so,
  // or by hand the last period run down to 0:00 with the clock stopped, or extra time's) for an hour, then 'over'.
  // The end is kept on the board (endedAt), so a relaunch keeps the colour, and cleared if the period is wound back.
  const ENDED_FOR_MS = 60 * 60000;
  function gameEnded(b: Board) {
    if (!b.gameId) return false;
    if (isFinished({ status: b.playhqStatus || '' })) return true;
    const last = config().periodType === 'halves' ? 2 : 4;
    return Number(b.period) >= last && !b.clock.running && clockLeft(b) === 0;
  }
  function gameStarted(b: Board) {
    return !!b.clock.running || clockElapsed(b.clock) > 0 || Number(b.period) > 1 || (Number(b.home.score) || 0) > 0 || (Number(b.away.score) || 0) > 0
      || /PROGRESS|LIVE|STARTED/i.test(b.playhqStatus || '');
  }
  function gamePhase(b: Board = board()) {

    if (!b.gameId) return 'none';
    const ended = gameEnded(b);
    if (ended && !b.endedAt) { b.endedAt = Date.now(); keepStory(true); saveBoards(); }
    else if (!ended && b.endedAt) { b.endedAt = null; saveBoards(); }
    if (b.endedAt) return Date.now() - b.endedAt > ENDED_FOR_MS ? 'over' : 'ended';
    return gameStarted(b) ? 'live' : 'upcoming';
  }

  return { snapshot, restore, board, newBoard, mergeStories, fillGapsFromPeers, keepOwedStories, courtShown, saveBoards, scoreboardJson, pushBoard, applyAction, clockElapsed, clockLeft, refreshFromPlayhq, followClock, parseClock, gamePhase, gameEnded,
    playhqTrouble, troubleSays, followGames, refreshFollowed, followedGames,
    getGoals, getStats, getWorm, gameStory, streak, superShot, tickerSpeed, DEFAULT_REFRESH_SEC, TICKER_SPEED, quarterSec, setQuarterSec };
}

// The board's API, as the other modules are handed it.
type BoardApi = ReturnType<typeof create>;

export { create, SIDES };
export type { BoardApi, Board, GameBoard, Side, Goal, RealGoal, Action, GameChoice, Streak, StreakKind, GameMoment, Clock, Team, Counts, Followed, Trouble };
