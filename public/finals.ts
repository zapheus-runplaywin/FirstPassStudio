// FirstPass Studio - the finals bracket's script (finals.html loads it as a module, so its names stay its own).

// What /api/finals answers (the fields this page reads): the division's finals format, its games week by week, and the champion.
interface FinalsTeam { name?: string; placeholder?: string; logo?: string | null; seed?: number; score?: number | null }
interface FinalsGame { id: string; week: number; name: string; date?: string; time?: string; court?: string; ifNeeded?: boolean; notNeeded?: boolean; winner?: string; home: FinalsTeam; away: FinalsTeam }
interface Finals {
  competition?: string; division?: string; projected?: boolean; rules?: LogoRules; error?: string;
  format: { all?: boolean; teams: number; weeks: string[] } | null; games: FinalsGame[]; champion?: { name: string; logo?: string | null } | null;
}
const params = new URLSearchParams(location.search);
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function when(g: FinalsGame) {
  if (!g.date && !g.time && !g.court) return '';
  const d = g.date ? new Date(`${g.date}T00:00:00`) : null;
  const [h, m] = String(g.time || '').split(':').map(Number);
  const t = Number.isFinite(h) ? `${(h % 12) || 12}:${String(m || 0).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}` : '';
  return [d && !isNaN(d.getTime()) ? d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) : '', t, g.court].filter(Boolean).join(' · ');
}

function side(g: FinalsGame, s: 'home' | 'away') {
  const t = g[s];
  const row = el('div', 'side');
  if (!t.name) {
    row.classList.add('side--tbc');
    row.append(el('div', 'side__name', t.placeholder || 'TBC'));
    return row;
  }
  if (g.winner) row.classList.add(g.winner === t.name ? 'side--won' : 'side--lost');
  const seed = params.get('seeds') === '0' || !t.seed || t.seed > 32 ? '' : t.seed;
  row.append(el('div', 'side__seed', seed), logoEl(t, 'side__logo'), el('div', 'side__name', t.name), el('div', 'side__score', t.score ?? ''));
  return row;
}

function render(data: Finals) {
  const rules = data.rules || {};
  $('comp').textContent = data.competition || '';
  $('title').textContent = params.get('title') || `${data.division} finals`;
  document.title = `${data.competition} ${data.division} Finals`;
  // "Top 4 finals" rather than the format's name (Page means nothing to viewers); ?sub= other words, ?sub=0 none.
  const sub = params.get('sub');
  $('format').textContent = sub === '0' ? '' : sub || (data.format ? (data.format.all ? 'Every team plays for its place' : `Top ${data.format.teams} finals`) : '');
  $('projected').hidden = !data.projected || params.get('projected') === '0';
  const logo = (params.get('mode') === 'light' ? rules.competitionLogoLight : rules.competitionLogoDark) || rules.competitionLogo;
  $('logo').hidden = !logo || params.get('logo') === '0';
  if (logo && !$('logo').hidden) $<HTMLImageElement>('logo').src = logo;

  const weeks = $('weeks');
  weeks.replaceChildren();
  if (!data.format) {
    weeks.append(el('div', 'finals__empty', data.error || 'No finals format set for this division.'));
  } else {
    const format = data.format;
    const only = Number(params.get('week')) || 0;
    let n = 0;
    format.weeks.forEach((name, i) => {
      if (only && only !== i + 1) return;
      const games = data.games.filter(g => g.week === i + 1);
      if (!games.length) return;
      const col = el('section', 'week');
      col.append(el('div', 'week__name', name));
      // A long day of games (every team playing) goes in two columns.
      const list = el('div', 'week__games' + (games.length > 4 && format.weeks.length === 1 ? ' week__games--two' : ''));
      for (const g of games) {
        const card = el('div', 'game' + (g.id === 'GF' ? ' game--gf' : '') + (g.notNeeded ? ' game--off' : ''));
        card.style.animationDelay = `${n++ * 90}ms`;
        const head = el('div', 'game__head');
        head.append(el('span', 'game__name', g.name + (g.ifNeeded ? (g.notNeeded ? ' (not needed)' : ' (if needed)') : '')), el('span', 'game__when', when(g)));
        card.append(head, side(g, 'home'), side(g, 'away'));
        list.append(card);
      }
      col.append(list);
      weeks.append(col);
    });
  }
  const champ = $('champion');
  champ.replaceChildren();
  champ.hidden = !data.champion || !!Number(params.get('week'));
  if (data.champion) champ.append(el('span', 'champion__word', 'Champions'), logoEl(data.champion, 'champion__logo'), el('span', 'champion__name', data.champion.name));
  $('card').hidden = false;
  // Shrink to fit 1080 high.
  const card = $('card');
  card.style.transform = '';
  const scale = Math.min(1, 1040 / card.offsetHeight);
  card.style.transform = scale < 1 ? `scale(${scale})` : '';
}

async function load() {
  const msg = $('message');
  try {
    const q = new URLSearchParams();
    const division = params.get('division');
    if (division) q.set('division', division);
    const res = await fetch(`/api/finals?${q}`, { cache: 'no-store' });
    const data: Finals = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    render(data);
    msg.hidden = true;
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    console.warn('Finals unavailable:', why);
    msg.textContent = location.protocol === 'file:'
      ? 'Open this page through Studio (http://localhost:8080/finals.html), not as a file.'
      : `Finals unavailable: ${why}`;
    msg.hidden = false;
  }
}
load();

// What makes this file a module (its names its own), as the first line says.
export {};
