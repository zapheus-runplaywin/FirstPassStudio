// FirstPass Studio - the match up's script (matchup.html loads it as a module, so its names stay its own).

// What it reads: the board's game (/api/scoreboard), each team's last five results (/api/form) and this season's meetings (/api/headtohead).
interface Form { home: { form: { result: string }[] }; away: { form: { result: string }[] } }
interface Meeting { round?: string; date?: string; home: { name: string; score: number | null }; away: { name: string; score: number | null } }
interface HeadToHead { games: Meeting[]; tally: { home: number; away: number; draws: number } }
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let last = '';

function when(date?: string, time?: string) {
  const parts: string[] = [];
  if (date) {
    const d = new Date(`${date}T00:00:00`);
    parts.push(isNaN(d.getTime()) ? date : d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' }));
  }
  if (time) {
    const [h, m] = String(time).split(':').map(Number);
    parts.push(Number.isFinite(h) ? `${(h % 12) || 12}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` : time);
  }
  return parts.join('  ·  ');
}

function setLogo(id: string, name: string, logo?: string | null) {
  const node = logoEl({ name, logo }, 'matchup__logo');
  node.id = id;
  $(id).replaceWith(node);
}

const opts = new URLSearchParams(location.search);
async function getJson<T>(path: string): Promise<T> {
  const d = await (await fetch(path, { cache: 'no-store' })).json();
  if (d.error) throw new Error(d.error);
  return d;
}
// Last five results as W/L/D dots (left out quietly if PlayHQ has none yet).
async function loadForm() {
  try {
    const d = await getJson<Form>('/api/form');
    for (const side of ['home', 'away'] as const) {
      const form = d[side].form;
      $(side + 'Form').replaceChildren(...form.map(f => el('div', `form-dot form-dot--${f.result}`, f.result)));
      $(side + 'FormWrap').hidden = !form.length;
    }
  } catch (err) { console.warn('Match up form unavailable:', err instanceof Error ? err.message : err); }
}
// This season's meetings: the win tally under VS, and the last three games above the footer.
async function loadHeadToHead() {
  try {
    const d = await getJson<HeadToHead>('/api/headtohead');
    const box = $('h2h');
    box.replaceChildren();
    if (!d.games.length) {
      box.append(el('div', 'matchup__h2hnone', 'First meeting this season'));
    } else {
      $('tally').textContent = `${d.tally.home} – ${d.tally.away}` + (d.tally.draws ? ` (${d.tally.draws} D)` : '');
      $('tallyBox').hidden = false;
      box.append(el('div', 'matchup__caption', 'Earlier this season'));
      for (const g of d.games.slice(-3)) {
        const row = el('div', 'matchup__h2hgame');
        const h = g.home.score ?? 0, a = g.away.score ?? 0;
        const winner = h > a ? 'home' : a > h ? 'away' : '';
        row.append(el('span', 'matchup__h2hround', [g.round, shortDate(g.date)].filter(Boolean).join('  ·  ')),
          el('span', 'matchup__h2hteam' + (winner === 'home' ? ' is-win' : ''), g.home.name),
          el('span', 'matchup__h2hscore', `${g.home.score ?? '–'} – ${g.away.score ?? '–'}`),
          el('span', 'matchup__h2hteam matchup__h2hteam--away' + (winner === 'away' ? ' is-win' : ''), g.away.name));
        box.append(row);
      }
    }
    box.hidden = false;
  } catch (err) { console.warn('Match up head to head unavailable:', err instanceof Error ? err.message : err); }
}

async function load() {
  try {
    const s: ScoreboardView = await (await fetch('/api/scoreboard', { cache: 'no-store' })).json();
    const view = [s.competition, s.division, s.round, s.home.name, s.away.name, s.logos, s.date, s.time, s.court, s.venue];
    const json = JSON.stringify(view);
    if (json === last) return;
    last = json;
    $('comp').textContent = s.competition || 'Match up';
    $('division').textContent = [s.division, s.round].filter(Boolean).join('  ·  ');
    $('homeName').textContent = s.home.name;
    $('awayName').textContent = s.away.name;
    setLogo('homeLogo', s.home.name, s.logos && s.logos.home);
    setLogo('awayLogo', s.away.name, s.logos && s.logos.away);
    const info = $('info');
    info.replaceChildren();
    [when(s.date, s.time), [s.court, s.venue].filter(Boolean).join(', ')].filter(Boolean)
      .forEach(t => info.appendChild(el('span', '', t)));
    $('card').hidden = false;
    if (opts.get('form') !== '0') loadForm();
    if (opts.get('h2h') !== '0') loadHeadToHead();
  } catch (err) { console.warn('Match up unavailable:', err instanceof Error ? err.message : err); }
}
load();

// What makes this file a module (its names its own), as the first line says.
export {};
