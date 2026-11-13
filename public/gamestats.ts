// FirstPass Studio - the game stats' script (gamestats.html loads it as a module, so its names stay its own).

// What /api/stats answers (board.ts getStats): the board's game, its quarters and the numbers this card compares.
type Side = 'home' | 'away';
type Both<T> = Record<Side, T>;
interface StatsTeam { name: string; score: number; logo?: string | null }
interface Quarter { n: number; label: string; played: boolean; home: number | null; away: number | null; sure: boolean }
interface GameStats {
  division?: string; court?: string; round?: string; competition?: string; periodType?: string; periods: number; superShots?: boolean;
  home: StatsTeam; away: StatsTeam; quarters: Quarter[]; totalGoals: number; gapInHistory?: boolean;
  stats: {
    quartersWon: Both<number> & { drawn: number; of: number }; bestQuarter: Both<{ n: number; label: string; points: number } | null>;
    superShots: Both<number>; runs3: Both<number>; runs5: Both<number>; longestRun: Both<number>;
  };
}
// A stat row: label, the number for each side, what's shown when it isn't the number, a note under it, and when it's shown.
interface Stat {
  key: string; label: (d: GameStats) => string; value: (s: Side, d: GameStats) => number;
  text?: (s: Side, d: GameStats) => string; note?: (s: Side, d: GameStats) => string; when?: (d: GameStats) => unknown;
}
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
sponsorSpot.footer('stats');

const params = new URLSearchParams(location.search);
const off = (key: string) => params.get(key) === '0';
const title = params.get('title');
if (title) $('title').textContent = title;

// Each stat row: home value | label | away value, the better one lit up, with a bar
// split between them. To add a stat, add a row here (and its number to getStats in server.ts).
//   value(side, d) the number the bar and the highlight use; text(side, d) what is shown (default the value).
const word = (d: GameStats) => (d.periodType === 'halves' ? 'half' : 'quarter');
const plural = (d: GameStats) => (d.periodType === 'halves' ? 'Halves' : 'Quarters');
const STATS: Stat[] = [
  { key: 'won', label: d => `${plural(d)} won`, value: (s, d) => d.stats.quartersWon[s], when: d => d.stats.quartersWon.of > 0 },
  { key: 'best', label: d => `Best ${word(d)}`, value: (s, d) => (d.stats.bestQuarter[s] || {}).points ?? 0,
    text: (s, d) => { const b = d.stats.bestQuarter[s]; return b ? `${b.points}` : '–'; },
    note: (s, d) => { const b = d.stats.bestQuarter[s]; return b ? b.label : ''; }, when: d => d.stats.quartersWon.of > 0 },
  { key: 'supershots', label: () => 'Super shots made', value: (s, d) => d.stats.superShots[s], when: d => d.superShots || d.stats.superShots.home || d.stats.superShots.away },
  { key: 'runs3', label: () => '3 goal runs', value: (s, d) => d.stats.runs3[s], when: d => d.totalGoals > 0 },
  { key: 'runs5', label: () => '5 goal runs', value: (s, d) => d.stats.runs5[s], when: d => d.totalGoals > 0 },
  { key: 'longest', label: () => 'Longest run', value: (s, d) => d.stats.longestRun[s], note: (s, d) => (d.stats.longestRun[s] ? 'goals' : ''), when: d => d.totalGoals > 0 },
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
    const who = el('td', 'who');
    who.append(logoEl(d[side], 'gamestats__mini'), el('span', '', d[side].name));
    r.appendChild(who);
    shown.forEach(q => {
      const known = q.home !== null && q.sure;
      // A quarter Studio only saw part of shows its points greyed out, and isn't counted as won.
      const c = el('td', known && (q[side] ?? 0) > (q[other] ?? 0) ? 'is-win' : q.home !== null && !q.sure ? 'is-unsure' : '', q[side] ?? '–');
      r.appendChild(c);
    });
    r.appendChild(el('td', 'total' + (d[side].score > d[other].score ? ' is-win' : ''), d[side].score));
  }
  t.hidden = false;
}

function statRows(d: GameStats) {
  const rows = $('rows');
  rows.replaceChildren();
  STATS.filter(s => !off(s.key) && (!s.when || s.when(d))).forEach((s, i) => {
    const h = Number(s.value('home', d)) || 0, a = Number(s.value('away', d)) || 0;
    const row = el('div', 'gamestats__row');
    row.style.animationDelay = `${300 + i * 90}ms`;
    const cell = (side: Side) => {
      const v = side === 'home' ? h : a, o = side === 'home' ? a : h;
      const box = el('div', `gamestats__val gamestats__val--${side}${v > o ? ' is-win' : ''}`);
      box.appendChild(el('span', 'num', s.text ? s.text(side, d) : v));
      const note = s.note && s.note(side, d);
      if (note) box.appendChild(el('span', 'note', note));
      return box;
    };
    const mid = el('div', 'gamestats__label', s.label(d));
    const bar = el('div', 'gamestats__bar');
    const share = h + a ? h / (h + a) : 0.5;
    const hb = el('span', 'home'), ab = el('span', 'away');
    hb.style.flexGrow = String(share); ab.style.flexGrow = String(1 - share);
    if (!h && !a) bar.classList.add('is-empty');
    bar.append(hb, ab);
    mid.appendChild(bar);
    row.append(cell('home'), mid, cell('away'));
    rows.appendChild(row);
  });
  rows.hidden = !rows.children.length;
}

async function load() {
  let d: GameStats;
  try { d = await (await fetch('/api/stats', { cache: 'no-store' })).json(); }
  catch (err) { console.warn('Game stats unavailable:', err instanceof Error ? err.message : err); return; }
  $('division').textContent = [d.division, d.round && /^\d+$/.test(d.round) ? `Round ${d.round}` : d.round, d.court].filter(Boolean).join('  ·  ');
  for (const side of ['home', 'away'] as const) {
    const t = d[side];
    $(side + 'Team').replaceChildren(logoEl(t, 'gamestats__logo'), el('div', 'gamestats__name', t.name));
    const num = $(side + 'Score');
    num.textContent = String(t.score);
    num.className = t.score > d[side === 'home' ? 'away' : 'home'].score ? 'is-win' : '';
  }
  quarterTable(d);
  statRows(d);
  $('footer').textContent = d.competition || '';
  if (d.gapInHistory) console.info('Game stats: Studio picked this game up part way, so runs only count from then');
  $('card').hidden = false;
}
load();

// What makes this file a module (its names its own), as the first line says.
export {};
