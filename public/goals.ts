// FirstPass Studio - the last goals' script (goals.html loads it as a module, so its names stay its own).

// What /api/goals answers: the game's last goals (oldest first, a gap where Studio wasn't watching), each team's count
// of them, and the run the last goal is part of.
type Side = 'home' | 'away';
interface Goal { id: number; side: Side; points: number; period: number; clockLeft?: number | null; gap?: undefined }
type Shown = Goal | { id: number; gap: true };
interface GoalsTeam { name: string; logo?: string | null; colour?: string | null }
interface Goals {
  gameId?: string; division?: string; court?: string; periodLabel: string; home: GoalsTeam; away: GoalsTeam; goals: Shown[];
  tally: Record<Side, { goals: number }>; run: { side: Side; goals: number; points: number } | null; totalGoals: number;
}
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const vertical = /^v/i.test(params.get('layout') || '');
const showTimes = params.get('times') !== '0';
const count = Math.max(3, Math.min(30, Number(params.get('count')) || 10));
const showRun = params.get('run') !== '0';
const fill = params.get('fill') === '1';
if (fill) document.documentElement.classList.add('fill');
const card = $('card');
// Where it sits; ?fill=1 has its own place in the window.
const pick = (value: string | null, allowed: string[], dflt: string) => value && allowed.includes(value) ? value : dflt;
if (!fill) {
  card.dataset.x = pick(params.get('x'), ['left', 'center', 'right'], vertical ? 'right' : 'center');
  card.dataset.y = pick(params.get('y'), ['top', 'middle', 'bottom'], vertical ? 'middle' : 'bottom');
}
card.classList.add(vertical ? 'card--v' : 'card--h');
if (!vertical && count > 10) card.style.setProperty('--slot', `${Math.max(64, Math.floor(1040 / count))}px`);
if (!vertical && count > 13) card.style.setProperty('--ball', `${Math.max(48, Math.floor(1040 / count) - 18)}px`);
if (vertical && count > 10) card.style.setProperty('--ball', '42px');

const el = (tag: string, cls?: string, text?: string | number | null) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };
const svgEl = (tag: string, attrs: Record<string, string | number>) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag) as SVGElement; for (const k in attrs) e.setAttribute(k, String(attrs[k])); return e; };
const textOn = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#111111' : '#ffffff';
};
const initials = (name: string) => String(name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase();
function badge(team: GoalsTeam) {
  if (team.logo) { const img = document.createElement('img'); img.className = 'logo'; img.src = team.logo; img.alt = ''; return img; }
  return el('div', 'initials', initials(team.name));
}
// Shrink a name until it fits its box.
function fit(e: HTMLElement, min = 12) {
  let size = parseFloat(getComputedStyle(e).fontSize);
  while (e.scrollWidth > e.clientWidth && size > min) { size -= 1; e.style.fontSize = size + 'px'; }
}
const clock = (s: number | null | undefined) => s == null ? '' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
// The goals shown (load() sets them before anything draws), the last answer, and the goals already on screen.
let data: Goals, last = '', seen: Set<number> | null = null;

function ball(g: Goal, isLatest: boolean) {
  const team = data[g.side];
  const b = el('div', `ball ball--${g.side}${g.points > 1 ? ' is-super' : ''}${isLatest ? ' is-latest' : ''}`);
  b.dataset.id = String(g.id);
  b.append(badge(team));
  if (g.points > 1) b.append(el('span', 'two', `+${g.points}`));
  if (seen && !seen.has(g.id)) b.classList.add('is-new');
  return b;
}
const period = (g: Goal) => g.period >= 5 ? 'ET' : `${data.periodLabel}${g.period}`;
const when = (g: Goal) => el('div', 'when', showTimes ? `${period(g)} ${clock(g.clockLeft)}` : '');

// Running difference over the shown goals: + for home points, - for away points.
function wormPoints(goals: Goal[]) {
  let d = 0;
  const pts = [0];
  for (const g of goals) { d += g.side === 'home' ? g.points : -g.points; pts.push(d); }
  return pts;
}
// The momentum line. Horizontal: left to right, up for home. Vertical: top to bottom, left for home.
function worm(goals: Goal[], w: number, h: number, slot: number, offset: number) {
  const pts = wormPoints(goals);
  const max = Math.max(3, ...pts.map(Math.abs));
  const svg = svgEl('svg', { class: 'worm', viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: 'none' });
  const across = (i: number) => offset + (i - 0.5) * slot; // point i sits after goal i
  const xy = vertical
    ? pts.map((p, i) => [w / 2 - (p / max) * (w / 2 - 8), i === 0 ? 4 : across(i)])
    : pts.map((p, i) => [i === 0 ? 4 : across(i), h / 2 - (p / max) * (h / 2 - 8)]);
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  // Shade above the zero line in the home colour and below it in the away colour (left/right when vertical).
  const clip = (id: string, rect: Record<string, number>) => { const c = svgEl('clipPath', { id }); c.append(svgEl('rect', rect)); return c; };
  const defs = svgEl('defs', {});
  const area = vertical ? `${d} L${w / 2},${xy[xy.length - 1][1]} L${w / 2},${xy[0][1]} Z` : `${d} L${xy[xy.length - 1][0]},${h / 2} L${xy[0][0]},${h / 2} Z`;
  defs.append(clip('wh', vertical ? { x: 0, y: 0, width: w / 2, height: h } : { x: 0, y: 0, width: w, height: h / 2 }),
    clip('wa', vertical ? { x: w / 2, y: 0, width: w / 2, height: h } : { x: 0, y: h / 2, width: w, height: h / 2 }));
  svg.append(defs);
  svg.append(svgEl('line', vertical ? { class: 'zero', x1: w / 2, x2: w / 2, y1: 0, y2: h } : { class: 'zero', x1: 0, x2: w, y1: h / 2, y2: h / 2 }));
  if (goals.length) {
    svg.append(svgEl('path', { class: 'fill-home', d: area, 'clip-path': 'url(#wh)' }), svgEl('path', { class: 'fill-away', d: area, 'clip-path': 'url(#wa)' }));
    const line = svgEl('path', { class: 'line', d });
    svg.append(line);
    xy.slice(1).forEach(([x, y], i) => svg.append(svgEl('circle', { class: 'dot' + (i === goals.length - 1 ? ' is-latest' : ''), cx: x, cy: y, r: i === goals.length - 1 ? 7 : 4 })));
    const shown = seen;
    const isNew = shown && goals.some(g => !shown.has(g.id));
    if (isNew) requestAnimationFrame(() => { const len = (line as SVGPathElement).getTotalLength(); line.style.setProperty('--len', String(len)); line.classList.add('draw'); });
  }
  return svg;
}

function runBar() {
  const bar = el('div', 'run');
  const r = data.run;
  if (!r || !data.goals.length) { bar.textContent = data.totalGoals ? '' : 'Waiting for the first goal'; return bar; }
  const team = data[r.side];
  bar.style.setProperty('--c', `var(--${r.side})`);
  bar.style.setProperty('--t', `var(--${r.side}-text)`);
  const hot = r.goals >= 3;
  bar.classList.toggle('is-hot', hot);
  bar.append(el('span', 'chip'));
  const txt = r.goals === 1 ? `Last goal: ${team.name}` : vertical ? `${team.name}: ${r.goals} in a row`
    : `${team.name}: ${r.goals} goals in a row${r.points !== r.goals ? ` (${r.points} points)` : ''}`;
  bar.append(el('span', 'says', txt));
  if (hot) bar.prepend(el('span', 'flame', '🔥'));
  return bar;
}

function head() {
  const h = el('div', 'head');
  h.append(el('div', 'tab', params.get('title') || `Last ${count} goals`));
  if (!vertical) h.append(el('div', 'meta', [data.division, data.court].filter(Boolean).join('  ·  ')));
  return h;
}
const isBreak = (goals: Goal[], i: number) => i > 0 && goals[i].period !== goals[i - 1].period;
const gapBefore = (all: Shown[], g: Goal) => { const i = all.indexOf(g); return i > 0 && !!all[i - 1].gap; };

function renderHorizontal(goals: Goal[], all: Shown[]) {
  const grid = el('div', 'grid');
  const teams = el('div', 'teams');
  const team = (side: Side) => {
    const t = data[side], row = el('div', `team team--${side}`);
    const b = el('div', 'badge'); b.append(badge(t));
    const name = el('div', 'name', t.name);
    row.append(b, name, el('div', 'count', data.tally[side].goals));
    return [row, name];
  };
  const [homeRow, homeName] = team('home'), [awayRow, awayName] = team('away');
  const label = el('div', 'worm-label', 'Momentum');
  teams.append(homeRow, label, awayRow);
  const track = el('div', 'track');
  const lanes = { home: el('div', 'lane lane--home'), away: el('div', 'lane lane--away') };
  const slotW = parseFloat(getComputedStyle(card).getPropertyValue('--slot')) || 104;
  for (let i = 0; i < count; i++) {
    const g = goals[i];
    for (const side of ['home', 'away'] as const) {
      const slot = el('div', 'slot');
      if (g && (isBreak(goals, i) || gapBefore(all, g))) {
        slot.classList.add('is-break');
        if (side === 'away') slot.append(el('span', 'qlabel', gapBefore(all, g) && !isBreak(goals, i) ? '…' : period(g)));
      }
      if (!g) slot.append(el('div', 'empty'));
      else if (g.side === side) slot.append(ball(g, i === goals.length - 1), when(g));
      lanes[side].append(slot);
    }
  }
  track.append(lanes.home, worm(goals, slotW * count, 50, slotW, 0), lanes.away);
  grid.append(teams, track);
  card.replaceChildren(head(), grid, ...(showRun ? [runBar()] : []));
  if (fill) fillWindow();
  fit(homeName); fit(awayName);
}

function renderVertical(goals: Goal[], all: Shown[]) {
  const teams = el('div', 'teams');
  const names: HTMLElement[] = [];
  for (const side of ['home', 'away'] as const) {
    const t = data[side], box = el('div', `team team--${side}`);
    const b = el('div', 'badge'); b.append(badge(t));
    const name = el('div', 'name', t.name); names.push(name);
    const c = el('div', 'count', data.tally[side].goals); c.append(el('small', '', `of last ${goals.length || count}`));
    box.append(b, name, c);
    teams.append(box);
  }
  const rows = el('div', 'rows');
  const rowH = 52;
  for (let i = 0; i < count; i++) {
    const g = goals[i], row = el('div', 'row');
    if (!g) { row.append(el('div', 'empty')); rows.append(row); continue; }
    if (isBreak(goals, i) || gapBefore(all, g)) {
      row.classList.add('is-break');
      row.append(el('span', 'qlabel', gapBefore(all, g) && !isBreak(goals, i) ? '…' : period(g)));
    }
    const home = el('div', 'cell cell--home'), away = el('div', 'cell cell--away');
    (g.side === 'home' ? home : away).append(ball(g, i === goals.length - 1), when(g));
    row.append(home, el('div', ''), away);
    rows.append(row);
  }
  const svg = worm(goals, 64, rowH * count, rowH, 0);
  svg.style.height = `${rowH * count}px`;
  rows.append(svg);
  card.replaceChildren(head(), teams, rows, ...(showRun ? [runBar()] : []));
  names.forEach(n => fit(n, 11));
  const says = card.querySelector<HTMLElement>('.run .says');
  if (says) fit(says, 12);
  if (fill) fillWindow();
}
// ?fill=1: as big as the window allows, keeping its shape (offsetWidth/Height are the unscaled size).
function fillWindow() {
  const w = card.offsetWidth, h = card.offsetHeight;
  // Horizontal: the goals spread out (or close up) so the card takes the window's shape, filling its height.
  if (!vertical && w && h) {
    const slot = parseFloat(getComputedStyle(card).getPropertyValue('--slot')) || 104;
    const want = Math.max(84, Math.floor((innerWidth * h / innerHeight - (w - slot * count)) / count));
    if (Math.abs(want - slot) > 1) { card.style.setProperty('--slot', `${want}px`); requestAnimationFrame(render); return; }
  }
  if (w && h) card.style.setProperty('--fill', String(Math.floor(Math.min(innerWidth / w, innerHeight / h) * 1000) / 1000));
}
if (fill) addEventListener('resize', fillWindow);

// Slide the goals that were already showing from where they were to where they are now.
function render() {
  const before = new Map([...card.querySelectorAll<HTMLElement>('.ball[data-id]')].map(b => [b.dataset.id, b.getBoundingClientRect()]));
  for (const side of ['home', 'away'] as const) {
    const colour = data[side].colour;
    if (colour) { card.style.setProperty(`--${side}`, colour); card.style.setProperty(`--${side}-text`, textOn(colour)); }
    else { card.style.removeProperty(`--${side}`); card.style.removeProperty(`--${side}-text`); }
  }
  const all = data.goals;
  const goals = all.filter((g): g is Goal => !g.gap);
  (vertical ? renderVertical : renderHorizontal)(goals, all);
  card.hidden = false;
  for (const b of card.querySelectorAll<HTMLElement>('.ball[data-id]')) {
    const was = before.get(b.dataset.id);
    if (!was) continue;
    const now = b.getBoundingClientRect();
    const dx = was.left - now.left, dy = was.top - now.top;
    if (!dx && !dy) continue;
    b.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 500, easing: 'cubic-bezier(.3, .8, .3, 1)' });
  }
  seen = new Set(goals.map(g => g.id));
}

async function load() {
  try {
    const res = await fetch(`/api/goals?count=${count}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const next: Goals = await res.json();
    const json = JSON.stringify(next);
    if (json === last) return;
    if (data && next.gameId !== data.gameId) seen = null; // a new game: no pop-ins for what's already there
    last = json; data = next;
    if (!seen) seen = new Set(data.goals.map(g => g.id)); // first load: no pop-ins
    render();
  } catch (err) { console.warn('Last goals unavailable:', err instanceof Error ? err.message : err); }
}
// Asks for the goals when the board changes (over Studio's scene socket) rather than every two seconds.
let boardKey = '';
(document.fonts ? document.fonts.ready : Promise.resolve()).then(() => sceneEvents<unknown, ScoreboardView & { gameId?: string }>(null, { board: b => {
  const key = `${b.gameId}|${b.home.score}|${b.away.score}|${b.period}|${b.source}`;
  if (key === boardKey) return;
  boardKey = key;
  load();
} }));
// The competition font can finish loading after the first draw; draw again so team names are sized in it.
if (document.fonts) document.fonts.addEventListener('loadingdone', () => { if (data) render(); });

// What makes this file a module (its names its own), as the first line says.
export {};
