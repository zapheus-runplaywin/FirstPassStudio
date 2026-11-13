// FirstPass Studio - the fixture board's script (fixtureboard.html loads it as a module, so its names stay its own).

// What /api/planner/fixtureboard answers: the night's games by time slot and court, with who is on the mic for the streamed ones.
type Side = 'home' | 'away';
interface BoardGame {
  state: string; streamed?: boolean; people: { name: string; guest?: boolean; headshot?: string }[]; winner?: Side | 'draw' | null;
  home: { name: string; logo?: string | null }; away: { name: string; logo?: string | null }; score?: Record<Side, number> | null;
  division?: string; round?: string; period?: string; court: string;
}
interface Slot { time: string; games: BoardGame[] }
interface FixtureBoard { date: string; today?: boolean; competition?: string; venue?: string; court?: string; courts: string[]; slots: Slot[]; error?: string }
const params = new URLSearchParams(location.search);
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
if (params.get('bg') === '0') document.body.classList.add('see-through');
const refresh = params.get('refresh') !== '0';

function clock(time?: string) {
  const [h, m] = String(time || '').split(':').map(Number);
  return Number.isFinite(h) ? `${(h % 12) || 12}:${String(m || 0).padStart(2, '0')}` : (time || 'TBC');
}
const ampm = (time: string) => (Number(String(time).split(':')[0]) < 12 ? 'AM' : 'PM');
const camera = () => el('span', 'cam');

// The time slots shown: from the last one that is all finished, so one finished slot at most stays.
function shown(slots: Slot[]) {
  let first = 0;
  slots.forEach((s, i) => { if (s.games.length && s.games.every(g => g.state === 'done')) first = i; });
  return slots.slice(first);
}

// A game's box. With photos, the teams and details go in a column on the left and who is on the mic sits on the
// right; without, they are name pills under the details.
function cell(g: BoardGame, photos: boolean) {
  const box = el('div', `game ${g.state}${g.streamed ? ' streamed' : ''}`);
  const mic = g.streamed && g.people.length ? g.people : [];
  const c = photos && mic.length ? box.appendChild(el('div', 'info')) : box;
  for (const side of ['home', 'away'] as const) {
    const t = el('div', `team${g.winner === side ? ' win' : ''}`);
    t.append(logoEl(g[side], 'logo'), el('span', 'name', g[side].name));
    if (g.score) t.append(el('span', 'pts', g.score[side]));
    c.append(t);
  }
  const meta = el('div', 'meta');
  meta.append(el('span', '', [g.division, g.round].filter(Boolean).join('  ·  ')));
  const tags = meta.appendChild(el('div', 'tags'));
  if (g.state === 'live') tags.append(el('span', 'tag live', g.period || 'Live'));
  if (g.state === 'done') tags.append(el('span', 'tag', g.winner === 'draw' ? 'Draw' : 'Full time'));
  c.append(meta);
  if (mic.length && photos) {
    box.classList.add('withmic');
    const on = box.appendChild(el('div', 'onmic'));
    on.append(el('div', 'onmic__tab', 'On the mic'));
    const faces = on.appendChild(el('div', 'faces'));
    for (const p of mic) {
      const f = faces.appendChild(el('figure', `face${p.guest ? ' guest' : ''}`));
      const img = el('img');
      img.src = p.headshot || 'silhouettes/neutral.svg';
      img.alt = '';
      f.append(img, el('figcaption', '', p.name));
    }
  } else if (mic.length) {
    const pills = c.appendChild(el('div', 'mic'));
    for (const p of mic) pills.append(el('span', `person${p.guest ? ' guest' : ''}`, p.name));
  }
  return box;
}

// Photos only where there is room: the board is drawn with them and with name pills, and keeps the photos when
// that costs at most a tenth of the size (team names never cut short beside them, see over() below). Otherwise,
// on a crowded night, the pills stay.
function draw(d: FixtureBoard) {
  const withPhotos = layout(d, true);
  if (!document.querySelector('.game.withmic')) return;
  const without = layout(d, false);
  if (withPhotos.size >= without.size * 0.9 - 0.001) layout(d, true);
}

function layout(d: FixtureBoard, photos: boolean) {
  const day = new Date(`${d.date}T00:00:00`);
  $('comp').textContent = d.competition || '';
  $('title').textContent = params.get('title') || (d.today ? "Tonight's Fixtures" : `${day.toLocaleDateString('en-AU', { weekday: 'long' })} Night's Fixtures`);
  $('when').replaceChildren(day.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' }), el('small', '', d.venue || ''));
  $('head').hidden = false;
  const courts = d.courts.length ? d.courts : [''];
  const slots = shown(d.slots);
  const board = $('board');
  // Courts side by side up to three, then two rows: four courts are 2 x 2, five or six 3 x 2, seven or eight 4 x 2.
  const cols = courts.length <= 3 ? courts.length : Math.ceil(courts.length / 2);
  board.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  board.style.setProperty('--s', '1.6');
  const cells: HTMLElement[] = [];
  for (const c of courts) {
    const streamed = c && c === d.court;
    const card = el('div', `courtcard${streamed ? ' streamed' : ''}`);
    const h = card.appendChild(el('div', `court${streamed ? ' streamed' : ''}`));
    if (streamed) h.append(camera(), `${c} · Streamed`); else h.textContent = c;
    const games = card.appendChild(el('div', 'games'));
    for (const s of slots) {
      const g = s.games.find(x => x.court === c) || (c === '' ? s.games[0] : null);
      if (!g) continue;
      const t = el('div', `slot${g.state === 'done' ? ' done' : ''}`);
      t.append(el('b', '', clock(s.time)), el('small', '', ampm(s.time)));
      const row = games.appendChild(el('div', 'row'));
      row.append(t, cell(g, photos));
    }
    if (!games.children.length) card.classList.add('empty');
    cells.push(card);
  }
  board.replaceChildren(...cells);
  // As big as fits: from 1.6 (a small night fills the frame) down until nothing in a card is cut off, and no team
  // name beside photos is cut short (elsewhere a long name may end in "…").
  const over = () => [...board.querySelectorAll('.courtcard, .games, .game, .meta, .withmic .name')].some(g => g.scrollHeight > g.clientHeight + 1 || g.scrollWidth > g.clientWidth + 1)
    || board.scrollHeight > board.clientHeight + 1;
  for (let size = 1.6; size > 0.4 && over(); size -= 0.05) board.style.setProperty('--s', size.toFixed(2));
  return { size: parseFloat(board.style.getPropertyValue('--s')) };
}

let last = '';
async function load() {
  try {
    const q = new URLSearchParams();
    const date = params.get('date');
    if (date) q.set('date', date);
    const d: FixtureBoard = await (await fetch(`/api/planner/fixtureboard?${q}`, { cache: 'no-store' })).json();
    if (d.error && !(d.slots && d.slots.length)) throw new Error(d.error);
    $('message').hidden = true;
    const json = JSON.stringify(d);
    if (json === last) return;
    last = json;
    draw(d);
    window.pageLog?.('info', `Fixture board: ${d.date}, ${d.slots.length} time slots${d.court ? `, ${d.court} streamed` : ''}`);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    console.warn('Fixture board unavailable:', why);
    $('message').textContent = `Fixture board: ${why}`;
    $('message').hidden = false;
  }
}

(document.fonts ? document.fonts.ready : Promise.resolve()).then(() => {
  load();
  if (!refresh) return;
  // The scoreboard moves on through the night: a new game, a goal, a new quarter or the clock starting shows
  // straight away (at most once a second).
  let key: string | undefined, timer: ReturnType<typeof setTimeout> | null = null;
  sceneEvents<unknown, { gameId?: string; home?: { score: number }; away?: { score: number }; period?: number; clock?: { running: boolean } }>(null, { board: b => {
    const k = `${b.gameId}|${b.home && b.home.score}|${b.away && b.away.score}|${b.period}|${!!(b.clock && b.clock.running)}`;
    if (key !== undefined && k !== key && !timer) timer = setTimeout(() => { timer = null; load(); }, 1000);
    key = k;
  } });
  setInterval(load, 60000);
});

// What makes this file a module (its names its own), as the first line says.
export {};
