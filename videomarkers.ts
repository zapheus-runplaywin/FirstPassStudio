// FirstPass Studio - video markers: a recorded game as named markers for a video editor.
//
// A coach drops the camera recording of a game into DaVinci Resolve or Premiere Pro with one file from here and finds
// a marker on every moment worth finding. Studio makes the file from a game's recording (recorder.ts), on the
// Recordings tab, in two depths:
//
//   On air (always): what the scoreboard showed. Each quarter as its clock first ran, each goal as the score went up
//   ("Goal Red · 12–10"), and every moment the producer marked with the Mark moment key. All of it went to air, so
//   it is no more private than the stream.
//
//   FirstPass stats (when Studio holds the game's stats from the club's FirstPass HQ, hqstats.ts): every event the
//   statistician recorded in FirstPass Vantage, named and coloured by @firstpass/engine exactly as Vantage's and
//   Vision's own marker files are, with the producer's marks beside them. These are FirstPass stats, so the file is
//   private as they are: it is only answered under /api/firstpass/ (access.firstpassRefusal(): this Mac, or a browser
//   allowed over the secure link). And the team totals rule holds (firstpassfigures.ts): a player is named only when
//   HQ says they may be (may_publish); everyone else is marked by position alone, and a substitution's detail, which
//   is all names, is left out.
//
// Lining the video up. A marker's place is its moment on this Mac's clock less the moment the video started:
//   start=HH:MM:SS:FF  the video's first timecode, as a time of day (a HyperDeck stamps it that way). The offset
//                      between the recorder's timecode and this Mac's clock that a 4K replay keeps for the recording
//                      (replay.ts Follow, replay.json) is added, so a game synced once for a replay is already synced.
//   into=M:SS          or, for a video with no time of day in it, how far into the video the first quarter starts.
// FirstPass events are timed by the statistician's tablet, whose clock is taken to agree with this Mac's (both set
// themselves from the internet); nudge=<seconds> moves every marker when they don't.
//
// GET /api/recordings/<name>/markers?game=&format=edl|xml|list&start=|into=&fps=&lead=&nudge=   the on-air file
// GET /api/firstpass/markers?recording=<name>&...                                               with FirstPass stats
// Either with info=1 answers what there is to mark instead ({ game, onAir, firstpass?, offset }), counts only.
//
// create(deps). deps:
//   read(recording)     recorder.ts read(): a recording's lines
//   has(recording)      whether there is such a recording (recorder.ts fileOf())
//   offset(recording)   replay.ts offsetOf(): the ms a 4K replay's sync keeps for it, 0 when never synced
//   stats(playhqGameId) what Studio holds of that game's FirstPass stats ({ game, snapshot, events, helper, lineup }), or null

import {
  DEFAULT_LEAD_MS, firstClockStart, MARKER_FORMATS, markerFile, parseTimecode, parseVideoTime, placeMarkers, videoMarkers, VIDEO_RATES, videoStartFrom,
  type GameState, type MarkerFormat, type VideoMarker, type VideoRate,
} from '@firstpass/engine';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { obj, str } from './check';
import { configOf, recordOf, sameLine, type Followed } from './firstpassfigures';
import { ENGINE_VERSION, initialState } from '@firstpass/engine';
import type { Line } from './recorder';
import type { Send } from './types';

interface Deps { read(recording: string): Line[]; has(recording: string): boolean; offset(recording: string): number; stats(playhqGameId: string): Followed | null }
interface Mark { atMs: number; period?: number; clockMs?: number }
interface OnAir { game: { id: string; home: string; away: string } | null; start: number; markers: VideoMarker[]; marks: Mark[]; firstQuarter: number | null }

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// What went to air in a recording, as markers: quarters, goals and the producer's marks. game: the PlayHQ game id
// (the recording's first streamed game when left out).
function onAir(lines: Line[], gameId?: string): OnAir {
  const games = lines.filter(l => l.k === 'game');
  const g = (gameId ? games.find(l => l.id === gameId) : games.find(l => !l.followed)) || null;
  const out: OnAir = { game: g && { id: str(g.id), home: str(g.home), away: str(g.away) }, start: g ? g.t : (lines[0]?.t ?? 0), markers: [], marks: [], firstQuarter: null };
  let score: { home: number; away: number } | null = null;
  const started = new Set<number>();
  for (const l of lines) {
    if (l.k === 'mark') {
      const f = obj(l.flag), period = num(f.period), clockMs = num(f.clockMs);
      out.marks.push(period !== null && clockMs !== null ? { atMs: l.t, period, clockMs } : { atMs: l.t });
      continue;
    }
    if (l.k !== 'board') continue;
    const b = obj(l.board);
    if (out.game && b.gameId != null && String(b.gameId) !== out.game.id) continue;
    const home = obj(b.home), away = obj(b.away), period = num(b.period);
    // A quarter starts when its clock first runs.
    if (period !== null && period >= 1 && period <= 8 && !started.has(period) && obj(b.clock).running === true) {
      started.add(period);
      if (period === 1) out.firstQuarter = l.t;
      out.markers.push({ kind: 'quarter', atMs: l.t, name: `Q${period} starts`, note: '', colour: 'Cream', quarter: period });
    }
    const now = { home: num(home.score) ?? 0, away: num(away.score) ?? 0 };
    if (score) {
      // One marker for each side whose score went up (a goal, or several the scorer caught up on at once).
      for (const side of ['home', 'away'] as const) {
        if (now[side] > score[side]) {
          out.markers.push({ kind: 'goal', atMs: l.t, name: `Goal ${str(obj(b[side]).name) || (side === 'home' ? 'Home' : 'Away')} · ${now.home}–${now.away}`,
            note: period !== null ? `Q${period}` : '', colour: 'Green', quarter: period ?? 0 });
        }
      }
    }
    score = now;
  }
  return out;
}

const plain = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

// A game's FirstPass events as markers, with the producer's marks, naming only who HQ says may be named.
function fromStats(f: Followed, marks: Mark[]) {
  const config = configOf(f.game);
  const byName = new Map<string, boolean[]>();
  for (const a of f.lineup) byName.set(plain(a.name), [...byName.get(plain(a.name)) || [], a.mayPublish]);
  const mayName = (label: string) => { const found = byName.get(plain(label)) || []; return found.length === 1 && found[0] === true; };
  // After a break snapshot the events held start part way through: the snapshot's state is where they start from,
  // when the same engine line made it. Otherwise they start cold (positions are still right; names wait for a sub).
  let from: GameState | undefined;
  if (f.snapshot && sameLine(f.snapshot.engineVersion, ENGINE_VERSION)) {
    const s = obj(f.snapshot.state);
    if (obj(s.score) && typeof s.period === 'number') from = { ...initialState(config), ...structuredClone(s) as Partial<GameState> };
  }
  const events = recordOf(f);
  const markers = videoMarkers(config, events, { mayName, marks, ...(from ? { from } : {}) });
  return { config, markers, firstQuarter: f.snapshot ? null : firstClockStart(events), partial: !!f.snapshot };
}

// The moment of the night a timecode (ms of the day) is: on the day of the game, or the day before or after it, as
// replay.ts nightOf() reads a followed timecode.
function nightAt(start: number, tcMs: number, offset: number) {
  const d = new Date(start);
  let best = NaN;
  for (const day of [-1, 0, 1]) {
    const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + day).getTime() + tcMs + offset;
    if (Number.isNaN(best) || Math.abs(t - start) < Math.abs(best - start)) best = t;
  }
  return best;
}

function create(deps: Deps) {
  // What the query asks for, or { error }.
  function make(recording: string, q: URLSearchParams, withStats: boolean) {
    if (!deps.has(recording)) return { status: 404, error: `There's no recording ${recording}.` };
    const air = onAir(deps.read(recording), q.get('game') || undefined);
    if (!air.game) return { status: 404, error: 'That game isn\'t in this recording.' };
    const held = withStats ? deps.stats(air.game.id) : null;
    const stats = held ? fromStats(held, air.marks) : null;
    const offset = deps.offset(recording);

    if (q.get('info')) {
      const count = (kind: string) => air.markers.filter(m => m.kind === kind).length;
      return { status: 200, info: {
        game: { home: air.game.home, away: air.game.away }, started: air.start, offset, synced: offset !== 0,
        onAir: { quarters: count('quarter'), goals: count('goal'), marks: air.marks.length, firstQuarter: air.firstQuarter !== null },
        firstpass: stats ? { markers: stats.markers.length - air.marks.length, partial: stats.partial, firstQuarter: stats.firstQuarter !== null } : null,
        rates: VIDEO_RATES, formats: MARKER_FORMATS.map(f => ({ format: f.format, label: f.label, how: f.how })),
      } };
    }

    const format = MARKER_FORMATS.find(f => f.format === q.get('format'))?.format as MarkerFormat | undefined;
    if (!format) return { status: 400, error: 'Ask for format=edl (DaVinci Resolve), format=xml (Premiere Pro) or format=list.' };
    const fps = VIDEO_RATES.find(r => String(r) === (q.get('fps') || '25')) as VideoRate | undefined;
    if (!fps) return { status: 400, error: `Frames a second (fps) is one of ${VIDEO_RATES.join(', ')}.` };
    const lead = q.get('lead') === null ? DEFAULT_LEAD_MS / 1000 : Number(q.get('lead'));
    if (!Number.isFinite(lead) || lead < 0 || lead > 60) return { status: 400, error: 'The lead before each marker (lead) is 0 to 60 seconds.' };
    const nudge = Number(q.get('nudge') || 0);
    if (!Number.isFinite(nudge) || Math.abs(nudge) > 600) return { status: 400, error: 'Nudge by up to 600 seconds either way.' };

    let videoStartMs: number;
    const start = q.get('start'), into = q.get('into');
    if (start) {
      const tc = parseTimecode(start, fps);
      if (tc === null) return { status: 400, error: "Type the video's first timecode as the recorder shows it, such as 18:55:10:00." };
      videoStartMs = nightAt(air.start, tc, offset);
    } else if (into) {
      const ms = parseVideoTime(into);
      if (ms === null) return { status: 400, error: 'Type how far into the video the first quarter starts, such as 3:12.' };
      const first = stats?.firstQuarter ?? air.firstQuarter;
      if (first === null) return { status: 400, error: "This recording doesn't show when the first quarter started, so line the video up by its first timecode instead." };
      videoStartMs = videoStartFrom(first, ms);
    } else return { status: 400, error: "Give the video's first timecode (start) or how far into it the first quarter starts (into)." };

    // With FirstPass stats the statistician's goals and quarters are the record; the producer's marks are in both.
    const markers = stats ? stats.markers : [...air.markers, ...videoMarkers({ us: '', them: '', quarterMs: 0, q1AttackEnd: 'left', firstCentrePass: 'us' }, [], { marks: air.marks })].sort((a, b) => a.atMs - b.atMs);
    const placed = placeMarkers(markers, { videoStartMs: videoStartMs - nudge * 1000, fps, leadMs: lead * 1000 });
    if (!placed.markers.length) return { status: 400, error: markers.length ? 'Every moment of this game falls before that video starts. Check its first timecode.' : 'This recording has nothing to mark.' };
    const config = stats ? stats.config : { us: air.game.home, them: air.game.away, quarterMs: 0, q1AttackEnd: 'left' as const, firstCentrePass: 'us' as const };
    return { status: 200, file: markerFile(format, config, placed), markers: placed.markers.length, outside: placed.outside };
  }

  function answer(res: ServerResponse, send: Send, made: ReturnType<typeof make>) {
    if ('error' in made) return send(res, made.status, { error: made.error });
    if ('info' in made) return send(res, 200, made.info);
    const name = made.file.name.replace(/[^\w.-]+/g, '-');
    return send(res, 200, made.file.text, `${made.file.mime}; charset=utf-8`,
      { 'content-disposition': `attachment; filename="${name}"`, 'x-markers': String(made.markers), 'x-markers-outside': String(made.outside) });
  }

  // true when the request was one of the two marker routes (and has been answered).
  function route(req: IncomingMessage, res: ServerResponse, url: URL, { send }: { send: Send }) {
    if (req.method !== 'GET') return false;
    if (url.pathname === '/api/firstpass/markers') {
      answer(res, send, make(url.searchParams.get('recording') || '', url.searchParams, true));
      return true;
    }
    const m = /^\/api\/recordings\/([^/]+)\/markers$/.exec(url.pathname);
    if (!m) return false;
    let recording: string;
    try { recording = decodeURIComponent(m[1]); } catch { recording = ''; }
    answer(res, send, make(recording, url.searchParams, false));
    return true;
  }

  return { route, make };
}

// What firstpass.ts's store keeps of a game (hqstats.ts keep()).
type Kept = Followed;
export type { Kept };
export { create, onAir, fromStats, nightAt };
