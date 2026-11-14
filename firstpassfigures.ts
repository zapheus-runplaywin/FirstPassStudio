// FirstPass Studio - the FirstPass figures graphics may put on air, from the game hqstats.ts follows.
//
// HQ sends a game's events (with its latest break snapshot); @firstpass/engine folds them into the game's state,
// exactly as FirstPass Vantage and Vision do. This file turns that state into the few figures the Shooting, Game
// stats and Commentator stats graphics show, and nothing else (no event, profile id, or anyone's own figures
// beyond those).
//
// The team totals rule (HQ's studio_lineup): an athlete is named with their own figures only when HQ says they
// may be (may_publish; for an athlete under 18, a verified parent or guardian has consented). Everyone else counts
// in the team's totals only. The engine keys players by the name recorded in the line-up, so a name is matched to
// HQ's line-up exactly (ignoring case and spaces); a name that matches nobody, or two people, is never shown.
//
// The snapshot: HQ answers a catch-up with its latest break snapshot and only the events after it, so its state is
// the starting point when it was made by the same engine version (major, or major.minor while 0.x); otherwise the
// figures wait for the next snapshot rather than guess. A correction to an event from before the snapshot can't
// be seen from here until HQ's next snapshot takes it in.

import { applyEvent, deriveGame, ENGINE_VERSION, initialState, liveEvents, type GameState } from '@firstpass/engine';
import type { GameConfig, GameEvent } from '@firstpass/schema';
import { obj, str } from './check';
import type { Athlete, HqEvent, HqGame, Snapshot } from './hqstats';

type Side = 'home' | 'away';
interface Shooter { name: string; positions: string[]; goals: number; shots: number }
interface OnAir {
  side: Side; team: string; period: number;
  score: { us: number; them: number };
  shooting: { players: Shooter[]; team: { goals: number; shots: number } };
  centrePass: { us: { received: number; goals: number }; them: { received: number; goals: number } };
  gains: number; turnovers: number;
  // How many of the line-up are named with their own figures, and how many count in team totals only.
  named: number; teamTotalsOnly: number;
}
interface Followed { game: HqGame; snapshot: Snapshot | null; events: HqEvent[]; lineup: Athlete[] }

// The same engine release line: major, or major.minor while the engine is 0.x.
function sameLine(a: string, b: string) {
  const [am, an] = a.split('.'), [bm, bn] = b.split('.');
  return am === bm && (am !== '0' || an === bn);
}

const plain = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const letters = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// Which side of the scoreboard the FirstPass team is, by name: HQ's team name or the game's "us" against the
// scoreboard's teams. Only a clear answer counts; otherwise the graphics keep PlayHQ's figures.
function sideOf(names: string[], board: { home: string; away: string }): Side | null {
  const ours = names.map(letters).filter(Boolean);
  const fits = (team: string) => { const t = letters(team); return !!t && ours.some(n => n === t || n.includes(t) || t.includes(n)); };
  const home = fits(board.home), away = fits(board.away);
  return home !== away ? (home ? 'home' : 'away') : null;
}

function configOf(game: HqGame): GameConfig {
  const c = obj(game.config);
  const quarterMs = typeof c.quarterMs === 'number' && c.quarterMs > 0 ? c.quarterMs : 10 * 60 * 1000;
  return {
    us: str(c.us) || game.teamName, them: str(c.them), quarterMs,
    q1AttackEnd: c.q1AttackEnd === 'right' ? 'right' : 'left', firstCentrePass: c.firstCentrePass === 'them' ? 'them' : 'us',
  };
}

// The game's state from the snapshot and the events after it, or from every event when there's no snapshot yet.
function stateOf(f: Followed, config: GameConfig): GameState | null {
  const events = f.events.filter(e => e.stream === 'primary') as unknown as GameEvent[];
  if (!f.snapshot) return deriveGame(config, events);
  if (!sameLine(f.snapshot.engineVersion, ENGINE_VERSION)) return null;
  const s = obj(f.snapshot.state);
  if (!obj(s.score) || typeof s.period !== 'number' || !obj(s.quarters)) return null;
  const state: GameState = { ...initialState(config), ...structuredClone(s) as Partial<GameState> };
  for (const e of liveEvents(events)) applyEvent(state, e);
  return state;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

// The figures for the scoreboard's game, or null when FirstPass has none to add (no game followed, no clear side,
// or a snapshot from another engine version).
function onAir(f: Followed | null, board: { home: string; away: string }): OnAir | null {
  if (!f) return null;
  const config = configOf(f.game);
  const side = sideOf([f.game.teamName, config.us], board);
  if (!side) return null;
  let state: GameState | null;
  try { state = stateOf(f, config); } catch { return null; }
  if (!state) return null;

  // Who may be named: one line-up entry per name, and only when HQ says so.
  const byName = new Map<string, Athlete[]>();
  for (const a of f.lineup) byName.set(plain(a.name), [...byName.get(plain(a.name)) || [], a]);
  const mayName = (label: string) => { const found = byName.get(plain(label)) || []; return found.length === 1 && found[0].mayPublish ? found[0] : null; };

  const players: Shooter[] = [];
  for (const [label, s] of Object.entries(state.shotsByPlayer || {})) {
    const a = mayName(label);
    if (a && num(s.attempts) > 0) players.push({ name: a.name, positions: [...s.positions || []], goals: num(s.goals), shots: num(s.attempts) });
  }
  players.sort((a, b) => b.goals - a.goals || b.shots - a.shots || a.name.localeCompare(b.name));
  const quarters = Object.values(state.quarters || {});
  const team = { goals: quarters.reduce((n, q) => n + num(q.goals), 0), shots: quarters.reduce((n, q) => n + num(q.shots), 0) };
  const cp = (t: 'us' | 'them') => ({ received: num(state.centrePass?.[t]?.received), goals: num(state.centrePass?.[t]?.goals) });
  const named = f.lineup.filter(a => mayName(a.name)).length;
  return {
    side, team: side === 'home' ? board.home : board.away, period: num(state.period),
    score: { us: num(state.score?.us), them: num(state.score?.them) },
    shooting: { players, team }, centrePass: { us: cp('us'), them: cp('them') },
    gains: num(state.gains), turnovers: num(state.unforced),
    named, teamTotalsOnly: f.lineup.length - named,
  };
}

export type { OnAir, Shooter, Followed };
export { onAir, sideOf, sameLine };
