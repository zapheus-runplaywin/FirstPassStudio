// FirstPass Studio - the commentator stats' script (commentatorstats.html loads it as a module, so its names stay its own).

type Side = 'home' | 'away';
type Both<T> = Record<Side, T>;
// A goal in the board's goal list (a gap where Studio wasn't watching), and a streak or moment Studio noted.
type BoardGoal = { id: number; gap: true; side?: undefined } | { id: number; gap?: false; side: Side; points: number; period?: number; clockLeft?: number | null; at?: number };
interface Moment { n: number; kind: string; side?: Side | ''; goals?: number; down?: number; at?: number; gameId?: string; period?: number; periodLabel?: string; clockLeft?: number | null; also?: Moment[] }
// The board as Studio's scene socket sends it (the fields this page reads).
interface LiveBoard extends ScoreboardView {
  gameId?: string; showClock?: boolean; clock?: { running: boolean; lengthSec: number }; clockElapsedMs: number; serverNow: number;
  rules?: ScoreboardView['rules'] & { superShotMinutes?: number | string }; countdown?: { kind: string; at: number; name?: string } | null;
  goals?: BoardGoal[]; goalsGameId?: string | null; streak?: Moment; streakLog?: Moment[];
}
// What /api/stats answers (as on gamestats.html, with each side's shooting) and /api/worm (as on worm.html).
interface Quarter { n: number; label: string; home: number | null; away: number | null; sure: boolean }
interface StatsTeam { name: string; score: number; logo?: string | null }
interface Worm {
  segments: { t: number; margin: number }[][]; gaps?: { from: number; to: number }[]; regularPeriods: number; periods: number; end?: number;
  periodLabel: string; leadChanges: number; biggestLead: Both<{ t: number; margin: number } | null>; home: { colour?: string | null }; away: { colour?: string | null };
}
interface GameStats {
  division?: string; round?: string; court?: string; competition?: string; periodType?: string; periods: number; superShots?: boolean; totalGoals: number;
  home: StatsTeam; away: StatsTeam; quarters: Quarter[]; worm: Worm;
  stats: {
    quartersWon: Both<number> & { of: number }; bestQuarter: Both<{ label: string; points: number } | null>; superShots: Both<number>;
    runs3: Both<number>; runs5: Both<number>; longestRun: Both<number>; shooting: Both<{ made: number; shots: number; percent: number | null } | null> | null;
  };
}
// A stat row: label, each side's number (or one shared number for the game), what's shown, a note, and when it's shown.
interface Stat {
  key: string; label: (d: GameStats) => string; value?: (s: Side, d: GameStats) => number; shared?: (d: GameStats) => number;
  text?: (s: Side, d: GameStats) => string; note?: (s: Side, d: GameStats) => string; when?: (d: GameStats) => unknown;
}
// What the season answers give: the ladder bar, the last five results, this season's meetings and the next game.
interface Season {
  ladder: Both<{ ladder: { position: number; won?: number; lost?: number; drawn?: number } | null }> | null;
  form: Both<{ form: { result: string }[] }> | null;
}
interface HeadToHead { home: { name: string }; away: { name: string }; tally: { home: number; away: number; draws: number }; games: { round?: string; home: { score: number | null }; away: { score: number | null } }[] }
interface UpNext { home?: { name: string }; away: { name: string }; time?: string }
// A line in the moments list.
interface Said { at: number; when: string; text: string; team?: { name: string; logo?: string | null } | null; icon?: string; fresh: boolean }
type GamesPlayed = Partial<Both<Record<string, { games?: number }>>>;
const params = new URLSearchParams(location.search);
const off = (key: string) => params.get(key) === '0';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const title = params.get('title');
if (title) $('title').textContent = title;
if (off('bg')) document.body.classList.add('see-through');
if (off('moments')) $('moments').hidden = true;
if (off('goals')) $('goals').hidden = true;
if (off('run')) $('run').hidden = true;
if (off('worm')) $('worm').hidden = true;
// Auto-refresh (on by default here, unlike the other graphics: commentators keep this page up the whole game).
// The stats come from Studio (what it has worked out from the board), so refreshing them costs PlayHQ nothing.
// The team lists are a PlayHQ request each, so they aren't refreshed on a timer: they load when the page comes on
// and at each quarter break (positions can change then).
const refresh = params.has('refresh') ? Number(params.get('refresh')) || 0 : 15;
const every = Math.max(5, refresh) * 1000;

// Scales a part down to fit its box (never up), from the top.
function fitInto(e: HTMLElement) {
  const box = e.parentElement as HTMLElement, h = e.offsetHeight, w = e.offsetWidth;
  if (!h || !w) return;
  const s = Math.min(1, box.clientHeight / h, box.clientWidth / w);
  e.style.scale = s < 1 ? String(Math.floor(s * 1000) / 1000) : '';
}
// A team list scaled down to fit its box's height is also drawn wider, so that once scaled it still fills the box's
// width: long names get that room instead of being cut short. Widening can make it shorter (fewer lines), so it's
// measured again a few times.
function fitTeam(e: HTMLElement) {
  const box = e.parentElement as HTMLElement;
  e.style.width = ''; e.style.scale = '';
  for (let i = 0; i < 4; i++) {
    const h = e.offsetHeight;
    if (!h || !box.clientWidth) return;
    const s = Math.min(1, box.clientHeight / h);
    e.style.scale = s < 1 ? String(Math.floor(s * 1000) / 1000) : '';
    e.style.width = s < 1 ? `${box.clientWidth / (Math.floor(s * 1000) / 1000)}px` : '';
  }
}
const fitAll = () => { fitTeam($('home')); fitTeam($('away')); fitInto($('card')); };
addEventListener('resize', fitAll);
if (document.fonts) document.fonts.addEventListener('loadingdone', fitAll);

// ─── Team lists ──────────────────────────────────────────────────────────
const COURT = ['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK'];
// Games played this season in the division (the Athletes page records and PlayHQ, as on the position match ups):
// asked for when the page comes on and for each new game. The first time can take a while (a division's line ups),
// so the lists show without it and it's added when it comes.
let gamesPlayed: GamesPlayed | null = null;
async function loadGamesPlayed() {
  if (off('games')) return;
  try {
    const d: GamesPlayed & { error?: string } = await (await fetch('/api/athletes/games', { cache: 'no-store' })).json();
    if (d.error) throw new Error(d.error);
    gamesPlayed = d;
    drawTeamLists();
    fitAll();
  } catch (err) { console.warn('Games played unavailable:', err instanceof Error ? err.message : err); }
}
function gamesText(side: Side, p: SheetPlayer) {
  const played = gamesPlayed && gamesPlayed[side];
  const g = played && played[p.name] && played[p.name].games;
  return g ? `${g} game${g === 1 ? '' : 's'}` : '';
}
// Ladder position, record and form under each logo in the game stats, head to head under the team names and up next
// under the clock: read once when the page comes on and for each new game (the season's games are kept by Studio, so
// this is a few requests at most). The team lists keep each team's scoring drought.
let season: Season = { ladder: null, form: null };
const getJson = async <T>(path: string): Promise<T> => { const d = await (await fetch(path, { cache: 'no-store' })).json(); if (d.error) throw new Error(d.error); return d; };
function teamMeta(side: Side) {
  const meta = el('div', 'team__meta');
  if (!off('drought')) meta.append(Object.assign(el('span', 'team__drought'), { id: `${side}Drought` }));
  return meta;
}
// Ladder position, record and the last 5 results, under each logo in the game stats.
function badgeMeta(side: Side) {
  const meta = el('div', 'team__meta');
  const l = season.ladder && season.ladder[side] && season.ladder[side].ladder;
  if (l) meta.append(el('span', 'team__pos', ordinal(l.position)), el('span', '', record(l)));
  const form = season.form && season.form[side] && season.form[side].form;
  if (form && form.length) {
    const dots = el('span', 'team__form');
    dots.append(...form.map(f => el('span', f.result, f.result)));
    meta.append(dots);
  }
  return meta;
}
async function loadSeason() {
  const ask = <T>(u: string) => getJson<T>(u).catch(err => { console.warn(`${u} unavailable:`, err instanceof Error ? err.message : err); return null; });
  const [ladder, form, h2h, next] = await Promise.all([ask<Season['ladder']>('/api/ladderbar'), ask<Season['form']>('/api/form'), ask<HeadToHead>('/api/headtohead'), ask<UpNext>('/api/upnext')]);
  season = { ladder, form };
  drawTeamLists();
  if (lastStatsData) drawTeams(lastStatsData);
  if (h2h && !off('h2h')) {
    const t = h2h.tally;
    $('h2h').replaceChildren(...(h2h.games.length
      ? [`${h2h.home.name} ${t.home} – ${t.away} ${h2h.away.name}${t.draws ? ` (${t.draws} drawn)` : ''}`,
        el('small', '', h2h.games.slice(-2).map(g => `${g.round ? (/^\d+$/.test(g.round) ? `R${g.round}` : g.round) + ' ' : ''}${g.home.score ?? '–'}–${g.away.score ?? '–'}`).join('  ·  '))]
      : ['First meeting this season']));
    $('h2hRow').hidden = false;
  } else $('h2hRow').hidden = true;
  if (next && next.home && !off('next')) {
    const [h, m] = String(next.time || '').split(':').map(Number);
    const at = Number.isFinite(h) ? `${(h % 12) || 12}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` : next.time || ''; // as upnext.html
    $('next').textContent = [`${next.home.name} v ${next.away.name}`, at].filter(Boolean).join('  ·  ');
    $('nextRow').hidden = false;
  } else $('nextRow').hidden = true;
  drawDroughts();
  fitAll();
}
// Scoring drought: game time since each team's last goal (the clock's time, so breaks don't count), from the board's goals.
function drawDroughts() {
  const b = state;
  if (!b || off('drought')) return;
  const goals = goalsOf(b);
  const nowLeft = b.clock ? msLeft(b) / 1000 : null;
  const len = b.clock ? b.clock.lengthSec : 0;
  for (const side of ['home', 'away'] as const) {
    const box = document.getElementById(`${side}Drought`);
    if (!box) continue;
    const g = [...goals].reverse().find(x => !x.gap && x.side === side);
    const after = goals.length && [...goals].reverse().find(x => x.gap); // a gap after it: Studio wasn't watching
    let text = '', long = false;
    if (!g || g.gap) text = goals.some(x => !x.gap) || (Number(b[side].score) || 0) === 0 ? 'No goal yet' : '';
    else if (g.clockLeft != null && nowLeft != null && !(after && after.id > g.id)) {
      const periods = (Number(b.period) || 1) - (Number(g.period) || 1);
      const sec = periods <= 0 ? g.clockLeft - nowLeft : g.clockLeft + (periods - 1) * len + (len - nowLeft);
      if (sec >= 0) { text = `Last goal ${mmss(sec * 1000)} ago`; long = sec >= 120; }
    }
    box.textContent = text;
    box.classList.toggle('is-long', long);
  }
}
// The team lists, drawn again when the games played or the season's answers come in.
function drawTeamLists() { const d = lastTeamsData; if (d) for (const side of ['home', 'away'] as const) teamList($(side), d[side], side); }
function teamList(box: HTMLElement, team: SheetSide, side: Side) {
  const head = el('div', 'team__head');
  const who = el('div', '');
  who.append(el('div', 'team__name', team.name), teamMeta(side));
  head.append(logoEl(team, 'team__logo'), who);
  const list = el('ol', 'team__list');
  let benchShown = false;
  (team.players || []).forEach((p, i) => {
    const onCourt = COURT.includes(p.position);
    if (!onCourt && !benchShown && i > 0 && !(p.fromSquad && team.players.every(x => x.fromSquad))) {
      list.appendChild(el('li', 'team__bench', p.fromSquad ? 'Squad' : 'Bench')); benchShown = true;
    }
    const li = el('li', 'player');
    li.append(el('span', 'pos', onCourt ? p.position : ''), el('span', 'pname', p.name), el('span', 'games', gamesText(side, p)));
    list.appendChild(li);
  });
  box.replaceChildren(head, list);
  if (!(team.players || []).length) box.appendChild(el('p', 'team__empty', 'Team list not available from PlayHQ yet.'));
}
let lastTeams = '', lastTeamsData: TeamSheets | null = null;
async function loadTeamLists() {
  try {
    const data: TeamSheets = await (await fetch('/api/teams', { cache: 'no-store' })).json();
    const json = JSON.stringify(data, (k, v) => (k === 'updatedAt' ? undefined : v));
    if (json === lastTeams) return;
    lastTeams = json;
    if (data.error) console.warn('Team lists:', data.error);
    lastTeamsData = data;
    drawTeamLists();
    fitAll();
  } catch (err) { console.warn('Team lists unavailable:', err instanceof Error ? err.message : err); }
}


// ─── Game stats ──────────────────────────────────────────────────────────
// As on gamestats.html, with shooting %, biggest lead and lead changes added. shared: one number for the game, in the middle.
const word = (d: GameStats) => (d.periodType === 'halves' ? 'half' : 'quarter');
const plural = (d: GameStats) => (d.periodType === 'halves' ? 'Halves' : 'Quarters');
const periodOf = (w: Worm, t: number) => (Math.floor(t) + 1 > w.regularPeriods ? 'ET' : `${w.periodLabel}${Math.min(w.periods, Math.floor(t) + 1)}`);
const STATS: Stat[] = [
  { key: 'shooting', label: () => 'Shooting', value: (s, d) => d.stats.shooting?.[s]?.percent ?? 0,
    text: (s, d) => { const x = d.stats.shooting?.[s]; return x && x.percent != null ? `${x.percent}%` : '–'; },
    note: (s, d) => { const x = d.stats.shooting?.[s]; return x ? `${x.made}/${x.shots}` : ''; },
    when: d => d.stats.shooting && (d.stats.shooting.home || d.stats.shooting.away) },
  { key: 'won', label: d => `${plural(d)} won`, value: (s, d) => d.stats.quartersWon[s], when: d => d.stats.quartersWon.of > 0 },
  { key: 'best', label: d => `Best ${word(d)}`, value: (s, d) => (d.stats.bestQuarter[s] || {}).points ?? 0,
    text: (s, d) => { const b = d.stats.bestQuarter[s]; return b ? `${b.points}` : '–'; },
    note: (s, d) => { const b = d.stats.bestQuarter[s]; return b ? b.label : ''; }, when: d => d.stats.quartersWon.of > 0 },
  { key: 'supershots', label: () => 'Super shots made', value: (s, d) => d.stats.superShots[s], when: d => d.superShots || d.stats.superShots.home || d.stats.superShots.away },
  { key: 'runs3', label: () => '3 goal runs', value: (s, d) => d.stats.runs3[s], when: d => d.totalGoals > 0 },
  { key: 'runs5', label: () => '5 goal runs', value: (s, d) => d.stats.runs5[s], when: d => d.totalGoals > 0 },
  { key: 'longest', label: () => 'Longest run', value: (s, d) => d.stats.longestRun[s], note: (s, d) => (d.stats.longestRun[s] ? 'goals' : ''), when: d => d.totalGoals > 0 },
  { key: 'leads', label: () => 'Biggest lead', value: (s, d) => (d.worm.biggestLead[s] || {}).margin ?? 0,
    text: (s, d) => { const l = d.worm.biggestLead[s]; return l ? `${l.margin}` : '–'; },
    note: (s, d) => { const l = d.worm.biggestLead[s]; return l ? periodOf(d.worm, l.t) : ''; }, when: d => d.worm && d.totalGoals > 0 },
  { key: 'leads', label: () => 'Lead changes', shared: d => d.worm.leadChanges, when: d => d.worm && d.totalGoals > 0 },
];

function quarterTable(d: GameStats) {
  const t = $<HTMLTableElement>('quarters');
  const shown = d.quarters.filter(q => q.n <= d.periods || q.home !== null);
  if (off('quarters') || !shown.some(q => q.home !== null)) { t.hidden = true; return; }
  t.replaceChildren();
  const head = t.createTHead().insertRow();
  head.appendChild(el('th', 'who', ''));
  shown.forEach(q => head.appendChild(el('th', '', q.label)));
  head.appendChild(el('th', 'total', 'Total'));
  const body = t.createTBody();
  for (const side of ['home', 'away'] as const) {
    const other = side === 'home' ? 'away' : 'home';
    const r = body.insertRow();
    r.appendChild(el('td', 'who', d[side].name));
    shown.forEach(q => {
      const known = q.home !== null && q.sure;
      r.appendChild(el('td', known && (q[side] ?? 0) > (q[other] ?? 0) ? 'is-win' : q.home !== null && !q.sure ? 'is-unsure' : '', q[side] ?? '–'));
    });
    r.appendChild(el('td', 'total' + (d[side].score > d[other].score ? ' is-win' : ''), d[side].score));
  }
  t.hidden = false;
}

let drawnRows: Set<string> | null = null; // the rows shown last time: only new ones rise in, so a refresh doesn't flash
function statRows(d: GameStats) {
  const rows = $('rows');
  const now = new Set<string>();
  rows.replaceChildren();
  STATS.filter(s => !off(s.key) && (!s.when || s.when(d))).forEach(s => {
    const label = s.label(d);
    now.add(label);
    const row = el('div', 'gs__row' + (drawnRows && !drawnRows.has(label) ? ' is-new' : ''));
    const mid = el('div', 'gs__label', label);
    if (s.shared) {
      mid.appendChild(el('span', 'shared', s.shared(d)));
      row.append(el('div', ''), mid, el('div', ''));
      rows.appendChild(row);
      return;
    }
    const value = s.value || (() => 0);
    const h = Number(value('home', d)) || 0, a = Number(value('away', d)) || 0;
    const cell = (side: Side) => {
      const v = side === 'home' ? h : a, o = side === 'home' ? a : h;
      const box = el('div', `gs__val gs__val--${side}${v > o ? ' is-win' : ''}`);
      box.appendChild(el('span', 'num', s.text ? s.text(side, d) : v));
      const note = s.note && s.note(side, d);
      if (note) box.appendChild(el('span', 'note', note));
      return box;
    };
    const bar = el('div', 'gs__bar');
    const share = h + a ? h / (h + a) : 0.5;
    const hb = el('span', 'home'), ab = el('span', 'away');
    hb.style.flexGrow = String(share); ab.style.flexGrow = String(1 - share);
    if (!h && !a) bar.classList.add('is-empty');
    bar.append(hb, ab);
    mid.appendChild(bar);
    row.append(cell('home'), mid, cell('away'));
    rows.appendChild(row);
  });
  drawnRows = now;
  rows.hidden = !rows.children.length;
}

let lastStats = '', lastStatsData: GameStats | null = null;
function drawTeams(d: GameStats) {
  for (const side of ['home', 'away'] as const) {
    const badge = el('div', 'gs__badge');
    badge.append(logoEl(d[side], 'gs__logo'), badgeMeta(side));
    $(side + 'Team').replaceChildren(badge, el('div', 'gs__name', d[side].name));
  }
}
async function loadStats() {
  let d: GameStats;
  try {
    const [stats, worm]: [Omit<GameStats, 'worm'>, Worm] = await Promise.all([fetch('/api/stats', { cache: 'no-store' }).then(r => r.json()), fetch('/api/worm', { cache: 'no-store' }).then(r => r.json())]);
    d = { ...stats, worm };
  } catch (err) { console.warn('Game stats unavailable:', err instanceof Error ? err.message : err); return; }
  const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  $('footer').textContent = [d.competition, refresh > 0 ? `Updated ${time}` : ''].filter(Boolean).join('  ·  ');
  const json = JSON.stringify(d);
  if (json === lastStats) return;
  lastStats = json;
  $('division').textContent = [d.division, d.round && /^\d+$/.test(d.round) ? `Round ${d.round}` : d.round, d.court].filter(Boolean).join('  ·  ');
  lastStatsData = d;
  drawTeams(d);
  for (const side of ['home', 'away'] as const) {
    const t = d[side];
    const num = $(side + 'Score');
    num.textContent = String(t.score);
    num.className = t.score > d[side === 'home' ? 'away' : 'home'].score ? 'is-win' : '';
  }
  quarterTable(d);
  statRows(d);
  if (!off('worm')) drawWorm(d.worm, d);
  fitAll();
}

// The score worm (as worm.html, compact and without the drawing-in): /api/worm's segments, t in periods
// (1.5 is half way through the second), margin = home minus away. Redrawn in place with the stats.
const NS = 'http://www.w3.org/2000/svg';
const svg = (tag: string, attrs: Record<string, string | number>, parent?: Element) => { const e = document.createElementNS(NS, tag) as SVGElement; for (const k in attrs) e.setAttribute(k, String(attrs[k])); if (parent) parent.appendChild(e); return e; };
function drawWorm(w: Worm, d: GameStats) {
  const chart = $('wormChart');
  chart.replaceChildren();
  const W = 680, H = 150, X0 = 2, X1 = W - 8, Y0 = 4, Y1 = H - 16, mid = (Y0 + Y1) / 2;
  const all = w.segments.flat();
  const span = Math.max(w.regularPeriods || 4, Math.ceil(w.end || 0), 1);
  const max = Math.max(4, ...all.map(p => Math.abs(p.margin)));
  const x = (t: number) => X0 + (t / span) * (X1 - X0), y = (m: number) => mid - (m / max) * (mid - Y0);
  const colours = { home: w.home.colour || 'var(--pink)', away: w.away.colour || 'var(--yellow)' };
  const defs = svg('defs', {}, chart);
  const clip = (id: string, top: number, bottom: number) => { const c = svg('clipPath', { id }, defs); svg('rect', { x: 0, y: top, width: W, height: bottom - top }, c); };
  clip('wHome', 0, mid); clip('wAway', mid, H);
  for (const g of w.gaps || []) svg('rect', { x: x(g.from), y: Y0, width: Math.max(0, x(g.to) - x(g.from)), height: Y1 - Y0, class: 'gap' }, chart);
  for (let n = 1; n <= span; n++) {
    if (n < span) svg('line', { x1: x(n), x2: x(n), y1: Y0, y2: Y1, class: 'brk' }, chart);
    const t = svg('text', { x: (x(n - 1) + x(n)) / 2, y: H - 4, class: 'q', 'text-anchor': 'middle' }, chart);
    t.textContent = n > (w.regularPeriods || 4) ? 'ET' : `${w.periodLabel}${n}`;
  }
  svg('line', { x1: X0, x2: X1, y1: mid, y2: mid, class: 'zero' }, chart);
  type Seg = Worm['segments'][number];
  const path = (seg: Seg) => seg.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.margin).toFixed(1)}`).join(' ');
  const area = (seg: Seg) => `${path(seg)} L${x(seg[seg.length - 1].t).toFixed(1)},${mid} L${x(seg[0].t).toFixed(1)},${mid} Z`;
  for (const [half, side] of [['wHome', 'home'], ['wAway', 'away']] as const) {
    const g = svg('g', { 'clip-path': `url(#${half})` }, chart);
    for (const seg of w.segments.filter(sg => sg.length > 1)) {
      svg('path', { d: area(seg), fill: colours[side], opacity: .25 }, g);
      svg('path', { d: path(seg), class: 'line', stroke: colours[side] }, g);
    }
  }
  const last = all[all.length - 1];
  if (last && all.length > 1) svg('circle', { cx: x(last.t), cy: y(last.margin), r: 5, class: 'tip', fill: last.margin < 0 ? colours.away : colours.home }, chart);
  const lead = last ? (last.margin > 0 ? `${d.home.name} by ${last.margin}` : last.margin < 0 ? `${d.away.name} by ${-last.margin}` : 'Level') : '';
  $('wormFacts').textContent = lead;
}

// ─── Clock, super shot window, moments and the current run: live from the board ─────
let state: LiveBoard | null = null, clockOffset = 0;
// The board's goals, when they're this game's.
const goalsOf = (b: LiveBoard) => Array.isArray(b.goals) && b.goalsGameId === b.gameId ? b.goals : [];
function msLeft(b: LiveBoard) {
  const c = b.clock;
  if (!c) return 0;
  const elapsed = b.clockElapsedMs + (c.running ? Date.now() + clockOffset - b.serverNow : 0);
  return Math.max(0, c.lengthSec * 1000 - elapsed);
}
// Super shots count in the last superShotMinutes of each quarter (competition setup, default 3).
// Shown beside the clock: "Super shot time" while it's on, and when it starts while the clock is on its way there.
let superWas: boolean | null = null;
function superWindow(b: LiveBoard) {
  const r = b.rules || {};
  if (!r.superShots || !b.clock) return { on: false, minutes: 0, startsIn: 0 };
  const win = Number(r.superShotMinutes ?? 3) * 60000, left = msLeft(b);
  const on = win > 0 && left > 0 && left <= win && left < b.clock.lengthSec * 1000;
  return { on, minutes: Number(r.superShotMinutes ?? 3), startsIn: left > win ? left - win : 0 };
}
// Before the game and at the breaks the same pill counts down for the commentary team (Matt, 2026-11-04):
// "Starts in 4:32" to the scheduled start, "Back in 2:15 · Quarter time" from when the clock hit 0:00 by the
// setup's break minutes, then "Due to start" / "Due back now" in pink until the clock runs, for half an hour at most
// (the board's countdown, board.ts countdownFor).
const DUE_FOR_MS = 30 * 60000;
function waiting() {
  const c = state && state.countdown;
  if (!c) return null;
  const left = c.at - (Date.now() + clockOffset);
  if (left < -DUE_FOR_MS) return null; // a game picked long after its start, or a break long over: nothing to count
  if (left <= 0) return { due: true, text: c.kind === 'start' ? 'Due to start' : 'Due back now' };
  const s = Math.ceil(left / 1000), h = Math.floor(s / 3600);
  const time = h ? `${h}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : mmss(left);
  return { due: false, text: c.kind === 'start' ? `Starts in ${time}` : `Back in ${time} · ${c.name}` };
}
const mmss = (ms: number) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function drawClock() {
  const b = state;
  if (!b) return;
  $('period').textContent = b.period >= 5 ? 'ET' : `${b.periodLabel}${b.period}`;
  $('clock').textContent = b.showClock === false || !b.clock ? '' : mmss(msLeft(b));
  const w = superWindow(b), tab = $('super'), wait = waiting();
  tab.hidden = !(w.on || w.startsIn || wait);
  tab.classList.toggle('is-soon', !w.on && !(wait && wait.due));
  tab.classList.toggle('is-due', !w.on && !!wait && wait.due);
  $('superText').textContent = w.on ? `Super shot time · last ${w.minutes} min` : wait ? wait.text : `Super shots in ${mmss(w.startsIn)}`;
  if (superWas === false && w.on) say({ icon: '⏱', text: `Super shot time: the last ${w.minutes} minutes of ${b.periodLabel}${b.period}` });
  superWas = w.on;
}

// Moments: a list, newest at the top, each staying until newer ones push it off the bottom (Matt, 2026-10-29: room
// for at least 5 at once). Each says its quarter and game time, and how long ago it happened, counting up.
const KEEP = 6;
const shown: Said[] = [];
const gameTime = () => (state && state.clock && state.showClock !== false ? `${state.period >= 5 ? 'ET' : `${state.periodLabel}${state.period}`} ${mmss(msLeft(state))}` : '');
// The quarter and game time a moment or goal happened at, from what Studio noted then (the clock as it is now otherwise).
const timeOf = (x: { period?: number; clockLeft?: number | null; periodLabel?: string }) => (x.period && x.clockLeft != null && state && state.showClock !== false
  ? `${x.period >= 5 ? 'ET' : `${x.periodLabel || state.periodLabel}${x.period}`} ${mmss(x.clockLeft * 1000)}` : gameTime());
function say(m: Omit<Said, 'at' | 'when' | 'fresh'> & { at?: number; when?: string }, fresh = true) {
  shown.push({ at: Date.now(), when: gameTime(), ...m, fresh });
  shown.sort((x, y) => y.at - x.at);
  shown.length = Math.min(shown.length, KEEP);
  drawMoments();
}
const ago = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`; };
const agoText = (m: Said) => [m.when, ago(Date.now() - m.at)].filter(Boolean).join('  ·  ');
function drawMoments() {
  $('momentList').replaceChildren(...shown.map(m => {
    const li = el('li', 'moment' + (m.fresh ? ' is-new' : ''));
    m.fresh = false;
    const text = el('span', 'text');
    text.append(el('span', 't', m.text), el('small', 'ago', agoText(m)));
    li.append(m.team ? logoEl(m.team, 'logo') : el('span', 'icon', m.icon || ''), text);
    return li;
  }));
}
function drawAgo() { document.querySelectorAll<HTMLElement>('#momentList .ago').forEach((e, i) => { if (shown[i]) e.textContent = agoText(shown[i]); }); }
const team = (side: Side | '' | undefined) => (side && state ? { name: state[side].name, logo: (state.logos || {})[side] } : null);
function momentText(ev: Moment) {
  const n = ev.side && state ? state[ev.side].name : '';
  switch (ev.kind) {
    case 'heating': return `${n} heating up: ${ev.goals} in a row`;
    case 'fire': return `${n} on fire: ${ev.goals} in a row`;
    case 'goalForGoal': return `Goal for goal: ${ev.goals} straight, one each way`;
    case 'lead': return `Lead change: ${n} hit the front`;
    case 'level': return 'All square in the last 2 minutes';
    case 'comeback': return `${n} coming back from ${ev.down} down`;
    case 'siren': return `${n} score on the siren`;
    case 'backToBack': return `${n}: back to back super shots`;
    default: return '';
  }
}
// One goal can make more than one moment (a team's third in a row that also puts them in front). On air only the
// first plays; here every one is listed: the moment Studio played and the others it kept in its also list.
function sayStreak(ev: Moment, fresh = true) {
  for (const m of [ev, ...(ev.also || [])]) {
    const text = momentText(m);
    // ev.at is Studio's clock: moved onto this one's.
    if (text) say({ team: team(m.side), icon: '🔥', text, when: timeOf(ev), ...(ev.at ? { at: ev.at - clockOffset } : {}) }, fresh);
  }
}
// Opened (or reloaded) part way through a game: the moments this game has had so far, from what Studio keeps (its
// last few moments, and the super shots in the goal list), so the list isn't empty until the next one.
function earlierMoments(b: LiveBoard) {
  for (const ev of (b.streakLog || []).filter(e => e.gameId && e.gameId === b.gameId)) sayStreak(ev, false);
  for (const g of goalsOf(b)) {
    if (g.gap || g.points !== 2 || !g.at) continue;
    say({ team: team(g.side), text: `Super shot: ${b[g.side].name}`, when: timeOf({ ...g, periodLabel: b.periodLabel }), at: g.at - clockOffset }, false);
  }
}
let seenStreak: number | null = null, seenSuper: number | null = null;
function moments(b: LiveBoard) {
  const latest = b.streak ? b.streak.n : 0;
  if (seenStreak === null) earlierMoments(b);
  if (seenStreak === null || latest < seenStreak) seenStreak = latest; // first look: the earlier ones are listed above
  const since = seenStreak;
  for (const ev of (b.streakLog || []).filter(e => e.n > since)) sayStreak(ev);
  seenStreak = latest;
  const sup = b.superShot;
  const n = sup ? sup.n : 0;
  if (seenSuper === null || n < seenSuper) seenSuper = n;
  if (sup && n > seenSuper && sup.side) say({ team: team(sup.side), text: `Super shot: ${b[sup.side].name}`, ...(sup.at ? { at: sup.at - clockOffset } : {}) });
  seenSuper = n;
}
// The run going now, from the board's goal list: goals by one team in a row since the other last scored.
function drawRun(b: LiveBoard) {
  const goals = goalsOf(b);
  let side: Side | '' = '', n = 0;
  for (let i = goals.length - 1; i >= 0; i--) {
    const g = goals[i];
    if (g.gap || (side && g.side !== side)) break;
    side = g.side; n++;
  }
  const box = $('run');
  $('runNum').textContent = n ? String(n) : '–';
  $('runWhat').textContent = n === 1 ? 'Last goal' : n ? 'Goals in a row' : 'Current run';
  $('runTeam').textContent = side ? b[side].name : 'Waiting for the first goal';
  const colour = side && (b.teamColours || {})[side];
  if (colour) box.style.setProperty('--c', colour); else box.style.removeProperty('--c');
  box.classList.toggle('is-hot', n >= 3);
}
// Who is on the mic for this game, from the Production Planner (a Studio read, no PlayHQ request).
async function loadMic() {
  if (off('mic')) return;
  try {
    const on: { names?: string[] } = await (await fetch('/api/planner/onair', { cache: 'no-store' })).json();
    const box = $('mic');
    box.replaceChildren();
    const names = on.names || [];
    if (names.length) box.append('On the mic: ', Object.assign(document.createElement('b'), { textContent: names.join(', ') }));
    box.hidden = !names.length;
  } catch (err) { console.warn('Commentator stats: the Production Planner is unavailable:', err instanceof Error ? err.message : err); }
}
function take(b: LiveBoard) {
  const newGame = state && state.gameId !== b.gameId, newPeriod = state && state.period !== b.period;
  const scoreChanged = !state || state.home.score !== b.home.score || state.away.score !== b.away.score || newGame || newPeriod;
  state = b;
  clockOffset = b.serverNow - Date.now();
  drawClock();
  if (newGame) { shown.length = 0; drawMoments(); } // before this game's moments are looked at
  if (!off('moments')) moments(b);
  if (!off('run')) drawRun(b);
  // A new game or a score change: the stats and team score catch up straight away when auto-refresh is on.
  if (scoreChanged && refresh > 0 && lastStats) loadStats();
  if (newGame || newPeriod) loadTeamLists();
  if (newGame) { loadGamesPlayed(); loadSeason(); loadMic(); }
}

(document.fonts ? document.fonts.ready : Promise.resolve()).then(() => {
  loadStats();
  loadTeamLists();
  loadGamesPlayed();
  loadSeason();
  loadMic();
  setInterval(loadMic, 60000);
  if (refresh > 0) setInterval(loadStats, every);
  sceneEvents<unknown, LiveBoard>(null, { board: take });
  setInterval(drawClock, 250);
  setInterval(drawAgo, 1000);
  setInterval(drawDroughts, 1000);
  window.pageLog?.('info', refresh > 0 ? `Commentator stats: updating every ${every / 1000} seconds` : 'Commentator stats: loaded once (auto-refresh off)');
});

// What makes this file a module (its names its own), as the first line says.
export {};
