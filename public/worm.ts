// FirstPass Studio - the score worm's script (worm.html loads it as a module, so its names stay its own).

// What /api/worm answers: the margin (home minus away) over game time (a period is 1), in segments between the
// stretches Studio wasn't watching, with each team's biggest lead and the super shot periods.
type Side = 'home' | 'away';
interface Point { t: number; margin: number }
interface WormTeam { name: string; score: number; logo?: string | null; colour?: string | null }
interface Worm {
  division?: string; round?: string; court?: string; competition?: string; periodLabel: string; periods: number; regularPeriods: number;
  home: WormTeam; away: WormTeam; segments: Point[][]; gaps: { from: number; to: number }[]; leadChanges: number;
  biggestLead: Record<Side, Point | null>;
  superShot?: { windows: { n: number; from: number; to: number }[]; timed?: boolean; points: Record<Side, number> } | null;
}
type Rgb = number[];
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const off = (key: string) => params.get(key) === '0';
const title = params.get('title');
if (title) $('title').textContent = title;
const showSuperShot = (d: Worm) => !!d.superShot && !off('supershot');
const DRAW_MS = Math.max(0, Math.min(15, Number(params.get('draw') ?? 3))) * 1000;

// The plot, inside the 1320 x 420 chart: margin labels on the left, quarter labels underneath.
const W = 1320, H = 420, X0 = 70, X1 = 1290, Y0 = 16, Y1 = 370;
const NS = 'http://www.w3.org/2000/svg';
function svg(tag: string, attrs: Record<string, string | number>, parent?: Element) {
  const e = document.createElementNS(NS, tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (parent) parent.appendChild(e);
  return e;
}

// Club colours, kept readable on the card: a very dark one is lightened, and two that look
// alike fall back to the competition's pink (home) and yellow (away).
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
function rgb(c: string | null | undefined): Rgb | null {
  const m = String(c || '').match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, x => x + x) : m[1];
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}
const lum = ([r, g, b]: Rgb) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const mix = (c: Rgb, w: Rgb, t: number) => c.map((v, i) => Math.round(v + (w[i] - v) * t));
const hex = (c: Rgb) => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
function teamColours(d: Worm): Record<Side, string> {
  const fallback = { home: css('--pink') || '#e6007e', away: css('--yellow') || '#ffcd00' };
  if (off('colours')) return fallback;
  const lighter = (c: Rgb | null) => c && lum(c) < 0.35 ? mix(c, [255, 255, 255], 0.35 - lum(c) + 0.15) : c;
  const home = lighter(rgb(d.home.colour)), away = lighter(rgb(d.away.colour));
  if (home && away && home.reduce((t, v, i) => t + Math.abs(v - away[i]), 0) < 90) return fallback;
  return { home: home ? hex(home) : fallback.home, away: away ? hex(away) : fallback.away };
}

function niceMax(m: number) {
  const top = Math.max(3, m);
  const step = top <= 4 ? 1 : top <= 10 ? 2 : top <= 25 ? 5 : 10;
  return { max: Math.ceil((top + 1) / step) * step, step }; // room above the biggest lead for its label
}

function draw(d: Worm) {
  const chart = $('chart');
  chart.replaceChildren();
  const colours = teamColours(d);
  const all = d.segments.flat();
  const { max, step } = niceMax(Math.max(0, ...all.map(p => Math.abs(p.margin))));
  const span = Math.max(1, d.periods);
  const x = (t: number) => X0 + (X1 - X0) * Math.min(span, Math.max(0, t)) / span;
  const mid = (Y0 + Y1) / 2;
  const y = (m: number) => mid - (Y1 - Y0) / 2 * m / max;

  const defs = svg('defs', {}, chart);
  const hatch = svg('pattern', { id: 'hatch', width: 14, height: 14, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
  svg('rect', { width: 6, height: 14, fill: 'rgba(255,255,255,.07)' }, hatch);
  const clip = (id: string, top: number, bottom: number) => { const c = svg('clipPath', { id }, defs); svg('rect', { x: 0, y: top, width: W, height: bottom - top }, c); };
  clip('above', 0, mid);
  clip('below', mid, H);
  // The reveal: everything drawn is shown up to this rect's right edge, which moves across as the line draws in.
  const reveal = svg('clipPath', { id: 'reveal' }, defs);
  const revealRect = svg('rect', { x: 0, y: 0, width: X0, height: H }, reveal);

  // Each team's half, tinted (the team names above say which is which).
  svg('rect', { x: X0, y: Y0, width: X1 - X0, height: mid - Y0, fill: colours.home, opacity: .07 }, chart);
  svg('rect', { x: X0, y: mid, width: X1 - X0, height: Y1 - mid, fill: colours.away, opacity: .07 }, chart);
  for (const side of ['home', 'away'] as const) $(side + 'Team').style.setProperty('--team', colours[side]);

  // Margin grid and labels.
  for (let m = step; m <= max; m += step) {
    for (const s of [1, -1]) {
      svg('line', { x1: X0, x2: X1, y1: y(m * s), y2: y(m * s), class: 'worm__grid' }, chart);
      const t = svg('text', { x: X0 - 14, y: y(m * s), class: 'worm__axis', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, chart);
      t.textContent = String(m);
    }
  }
  // The super shot period of each quarter: a light band with a yellow cap along the top.
  if (d.superShot && showSuperShot(d)) {
    for (const w of d.superShot.windows) {
      if (w.n > span) continue;
      const wx = x(w.from), ww = x(w.to) - wx;
      svg('rect', { x: wx, y: Y0, width: ww, height: Y1 - Y0, class: 'worm__ss' }, chart);
      svg('rect', { x: wx, y: Y0, width: ww, height: 5, class: 'worm__sscap' }, chart);
      const t = svg('text', { x: wx + ww / 2, y: Y0 + 22, class: 'worm__sslabel', 'text-anchor': 'middle' }, chart);
      t.textContent = ww > 110 ? 'Super shot' : 'SS';
    }
  }
  // Stretches Studio wasn't watching.
  for (const g of d.gaps) {
    const gx = x(g.from), gw = x(g.to) - gx;
    if (gw < 2) continue;
    svg('rect', { x: gx, y: Y0, width: gw, height: Y1 - Y0, fill: 'url(#hatch)' }, chart);
    if (gw > 150) {
      const t = svg('text', { x: gx + gw / 2, y: Y1 - 40, class: 'worm__gap', 'text-anchor': 'middle' }, chart);
      t.textContent = 'Not watching';
    }
  }
  // Quarters: a line at each break and the label under each.
  for (let n = 1; n <= span; n++) {
    if (n < span) svg('line', { x1: x(n), x2: x(n), y1: Y0, y2: Y1, class: 'worm__break' }, chart);
    const t = svg('text', { x: (x(n - 1) + x(n)) / 2, y: Y1 + 34, class: 'worm__quarter', 'text-anchor': 'middle' }, chart);
    t.textContent = n > d.regularPeriods ? 'ET' : `${d.periodLabel}${n}`;
  }
  svg('line', { x1: X0, x2: X1, y1: mid, y2: mid, class: 'worm__zero' }, chart);

  // The worm: each line between gaps, filled to the middle in the team's colour, and a dotted join across each gap.
  const drawn = svg('g', { 'clip-path': 'url(#reveal)' }, chart);
  const path = (seg: Point[]) => seg.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.margin).toFixed(1)}`).join(' ');
  const area = (seg: Point[]) => `${path(seg)} L${x(seg[seg.length - 1].t).toFixed(1)} ${mid} L${x(seg[0].t).toFixed(1)} ${mid} Z`;
  for (let i = 1; i < d.segments.length; i++) {
    const a = d.segments[i - 1], b = d.segments[i][0];
    if (!a.length) continue;
    const p = a[a.length - 1];
    svg('line', { x1: x(p.t), y1: y(p.margin), x2: x(b.t), y2: y(b.margin), class: 'worm__join' }, drawn);
  }
  for (const [half, colour] of [['above', colours.home], ['below', colours.away]] as const) {
    const g = svg('g', { 'clip-path': `url(#${half})` }, drawn);
    for (const seg of d.segments.filter(s => s.length > 1)) {
      svg('path', { d: area(seg), fill: colour, opacity: .28 }, g);
      svg('path', { d: path(seg), class: 'worm__shadow' }, g);
      svg('path', { d: path(seg), class: 'worm__line', stroke: colour }, g);
    }
  }
  const marks = svg('g', { class: 'worm__marks' }, chart);
  const lastSeg = d.segments[d.segments.length - 1];
  const last = lastSeg[lastSeg.length - 1];
  const colourOf = (m: number) => (m > 0 ? colours.home : m < 0 ? colours.away : 'var(--text)');
  const mark = (p: Point, text: string, colour: string, below: boolean) => {
    svg('circle', { cx: x(p.t), cy: y(p.margin), r: 8, fill: colour, class: 'worm__dot' }, marks);
    if (below && y(p.margin) + 60 > Y1) below = false; // keep the label inside the chart
    if (!below && y(p.margin) - 34 < Y0) below = true;
    const t = svg('text', { x: Math.min(X1 - 30, Math.max(X0 + 30, x(p.t))), y: y(p.margin) + (below ? 34 : -18), fill: colour, class: 'worm__mark', 'text-anchor': 'middle', 'dominant-baseline': below ? 'hanging' : 'auto' }, marks);
    t.textContent = text;
  };
  if (!off('leads')) {
    const h = d.biggestLead.home, a = d.biggestLead.away;
    if (h) mark({ t: h.t, margin: h.margin }, `+${h.margin}`, colours.home, false);
    if (a) mark({ t: a.t, margin: -a.margin }, `+${a.margin}`, colours.away, true);
  }
  const glow = svg('circle', { cx: X0, cy: mid, r: 0, class: 'worm__glow', fill: colourOf(0) }, chart);
  const head = svg('circle', { cx: X0, cy: mid, r: 9, class: 'worm__head', fill: colourOf(0) }, chart);
  return { revealRect, head, glow, x, y, colourOf, marks, endX: x(last.t), segments: d.segments, tAt: (X: number) => (X - X0) / (X1 - X0) * span };
}

// Draws the line in from the left by elapsed time (so it's the same at 50 or 60 fps), the head
// riding along it, then shows the biggest leads.
function animate(p: ReturnType<typeof draw>) {
  const yAt = (X: number) => {
    for (const seg of p.segments) {
      for (let i = 1; i < seg.length; i++) {
        const a = seg[i - 1], b = seg[i], ax = p.x(a.t), bx = p.x(b.t);
        if (X >= ax && X <= bx) return bx === ax ? b.margin : a.margin + (b.margin - a.margin) * (X - ax) / (bx - ax);
      }
    }
    return null; // in a gap
  };
  // How fast the line is moving: the margin change from goals in the last RATE_WINDOW of game
  // time (a period is 1), the older ones counting less, as a share of the busiest moment in the game.
  const RATE_WINDOW = 0.2; // two minutes of a 10 minute quarter
  const moves: { t: number; dm: number }[] = [];
  for (const seg of p.segments) for (let i = 1; i < seg.length; i++) {
    const dm = Math.abs(seg[i].margin - seg[i - 1].margin);
    if (dm) moves.push({ t: seg[i].t, dm });
  }
  const rateAt = (t: number) => moves.reduce((sum, e) => (e.t <= t && e.t > t - RATE_WINDOW ? sum + e.dm * (1 - (t - e.t) / RATE_WINDOW) : sum), 0);
  const busiest = Math.max(1, ...moves.map(e => rateAt(e.t)));
  let heat = 0; // flares up at once and fades over about a quarter of a second, so a quick burst still shows
  const glowAt = (X: number, Y: number, colour: string, dtMs: number) => {
    const target = Math.min(1, rateAt(p.tAt(X)) / busiest);
    heat = target > heat ? target : heat + (target - heat) * Math.min(1, dtMs / 250);
    p.glow.setAttribute('cx', String(X)); p.glow.setAttribute('cy', String(Y)); p.glow.setAttribute('fill', colour);
    p.glow.setAttribute('r', (10 + 40 * heat).toFixed(1));
    p.glow.style.opacity = (0.1 + 0.9 * heat).toFixed(3);
    p.head.setAttribute('r', (9 + 6 * heat).toFixed(1));
  };
  const finish = () => {
    p.revealRect.setAttribute('width', String(W));
    p.glow.style.opacity = '0';
    p.head.setAttribute('r', '9');
    const m = yAt(p.endX);
    p.head.setAttribute('cx', String(p.endX));
    if (m !== null) { p.head.setAttribute('cy', String(p.y(m))); p.head.setAttribute('fill', p.colourOf(m)); }
    p.marks.classList.add('is-shown');
  };
  if (!DRAW_MS) { finish(); return; }
  p.head.style.opacity = '0';
  const ease = (t: number) => (t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  let start: number | null = null, prev: number | null = null;
  const DELAY = 600; // after the card has risen in
  function frame(now: number) {
    if (start === null) start = now;
    const dtMs = Math.min(100, prev === null ? 0 : now - prev);
    prev = now;
    const t = Math.min(1, Math.max(0, (now - start - DELAY) / DRAW_MS));
    const X = X0 + (p.endX - X0) * ease(t);
    p.revealRect.setAttribute('width', String(X + 1));
    const m = yAt(X);
    p.head.style.opacity = m === null || t === 0 ? '0' : '1';
    if (m === null || t === 0) p.glow.style.opacity = '0';
    if (m !== null) {
      p.head.setAttribute('cx', String(X)); p.head.setAttribute('cy', String(p.y(m))); p.head.setAttribute('fill', p.colourOf(m));
      if (t > 0) glowAt(X, p.y(m), p.colourOf(m), dtMs);
    }
    if (t < 1) requestAnimationFrame(frame); else finish();
  }
  requestAnimationFrame(frame);
}

function facts(d: Worm) {
  const box = $('facts');
  box.replaceChildren();
  const when = (t: number) => (Math.floor(t) + 1 > d.regularPeriods ? 'ET' : `${d.periodLabel}${Math.min(d.periods, Math.floor(t) + 1)}`);
  const fact = (label: string, value: string | number, note = '', team?: WormTeam) => {
    const f = el('div', 'worm__fact');
    if (team) f.appendChild(logoEl(team, 'worm__factlogo'));
    f.append(el('span', 'label', label), el('span', 'num', value));
    if (note) f.appendChild(el('span', 'note', note));
    box.appendChild(f);
  };
  if (!off('leads')) {
    for (const side of ['home', 'away'] as const) {
      const l = d.biggestLead[side];
      fact('Biggest lead', l ? l.margin : '–', l ? when(l.t) : '', d[side]);
    }
    fact('Lead changes', d.leadChanges);
  }
  // Points each team scored in super shot time (only goals Studio has clock times for).
  if (d.superShot && showSuperShot(d) && d.superShot.timed) {
    fact('Super shot time', `${d.superShot.points.home}–${d.superShot.points.away}`, 'points');
    box.lastElementChild?.classList.add('worm__fact--ss');
  }
  box.hidden = !box.children.length;
  if (d.gaps.length) console.info(`Score worm: Studio wasn't watching ${d.gaps.length} stretch${d.gaps.length === 1 ? '' : 'es'} of the game, shown as gaps`);
}

async function load() {
  let d: Worm;
  try { d = await (await fetch('/api/worm', { cache: 'no-store' })).json(); }
  catch (err) { console.warn('Score worm unavailable:', err instanceof Error ? err.message : err); return; }
  $('division').textContent = [d.division, d.round && /^\d+$/.test(d.round) ? `Round ${d.round}` : d.round, d.court].filter(Boolean).join('  ·  ');
  for (const side of ['home', 'away'] as const) {
    const t = d[side];
    const name = el('div', 'worm__name', t.name);
    name.appendChild(el('span', 'worm__key', side === 'home' ? '▲ Ahead above the line' : '▼ Ahead below the line'));
    $(side + 'Team').replaceChildren(logoEl(t, 'worm__logo'), name);
    const num = $(side + 'Score');
    num.textContent = String(t.score);
    num.className = t.score > d[side === 'home' ? 'away' : 'home'].score ? 'is-win' : '';
  }
  $('footer').textContent = d.competition || '';
  const plot = draw(d);
  facts(d);
  $('card').hidden = false;
  animate(plot);
}
load();

// What makes this file a module (its names its own), as the first line says.
export {};
