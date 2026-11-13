// FirstPass Studio - the position match ups' script (positions.html loads it as a module, so its names stay its own).

type Pos = 'GS' | 'GA' | 'WA' | 'C' | 'WD' | 'GD' | 'GK';
type Pair = [Pos, SheetPlayer | null, SheetPlayer | null];
// What /api/athletes/games answers: each side's athletes' games played in the division, by name.
type GamesPlayed = Record<'home' | 'away', Record<string, { games?: number }> | undefined>;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const opts = new URLSearchParams(location.search);
const ORDER: Pos[] = ['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK'];
const OPPOSITE: Record<Pos, Pos> = { GS: 'GK', GA: 'GD', WA: 'WD', C: 'C', WD: 'WA', GD: 'GA', GK: 'GS' };
const HOLD = Math.max(1, Number(opts.get('hold')) || 5) * 1000;
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const initials = (n: string) => String(n || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase();

// The athlete's photo, else a generic silhouette for their gender; nobody listed gets the plain one.
function photoEl(p: SheetPlayer | null, cls = '') {
  // Nobody listed for the position: the same plain silhouette as an athlete without a photo.
  const src = p ? (p.photo || p.silhouette) : '/silhouettes/neutral.svg';
  if (src) { const i = el('img', cls); i.src = src; i.alt = ''; return i; }
  return el('div', (cls ? cls + ' ' : '') + 'logo-fallback', p ? initials(p.name) : '?');
}

function side(id: string, team: SheetSide, p: SheetPlayer | null) {
  const box = $(id);
  box.replaceChildren();
  const photo = el('div', 'pm__photo');
  // Line ups in some competitions miss positions: that athlete shows as Unknown.
  photo.appendChild(photoEl(p));
  if (team.logo) { const l = el('img', 'pm__teamlogo'); l.src = team.logo; l.alt = ''; photo.appendChild(l); }
  box.appendChild(photo);
  const plate = el('div', 'pm__plate');
  plate.appendChild(el('div', 'pm__name', p ? p.name : 'Unknown'));
  const meta = el('div', 'pm__meta', [team.name, p && p.number !== '' && p.number != null ? `#${p.number}` : '', gamesText(team, p)].filter(Boolean).join('  ·  '));
  if (p && p.captain) meta.appendChild(el('span', 'badge', 'Captain'));
  if (p && p.viceCaptain) meta.appendChild(el('span', 'badge', 'Vice captain'));
  plate.appendChild(meta);
  box.appendChild(plate);
}

function show(data: TeamSheets, pairs: Pair[], i: number) {
  const [pos, h, a] = pairs[i];
  side('home', data.home, h);
  side('away', data.away, a);
  $('homePos').textContent = pos;
  $('awayPos').textContent = OPPOSITE[pos];
  document.querySelectorAll<HTMLElement>('.pm__dot').forEach((d, j) => { d.className = 'pm__dot' + (j === i ? ' on' : j < i ? ' done' : ''); });
  const stage = $('stage');
  stage.className = 'pm__stage';
  void stage.offsetWidth; // restart the animation
  stage.className = 'pm__stage enter';
}

function showAll(data: TeamSheets, pairs: Pair[]) {
  $('stage').hidden = true;
  $('dots').hidden = true;
  const box = $('all');
  box.replaceChildren();
  const head = el('div', 'pm__allhead');
  for (const t of [data.home, data.away]) {
    const d = el('div');
    const logo = logoEl(t, '');
    const name = el('span', '', t.name);
    if (t === data.home) d.append(logo, name); else d.append(name, logo);
    head.appendChild(d);
  }
  box.appendChild(head);
  pairs.forEach(([pos, h, a], i) => {
    const row = el('div', 'pm__row');
    row.style.animationDelay = `${i * 80}ms`;
    const nm = (p: SheetPlayer | null, cls: string) => { const n = el('div', 'nm ' + cls, p ? p.name : 'Unknown'); if (p && p.number !== '' && p.number != null) n.appendChild(el('small', '', `#${p.number}`)); return n; };
    const ph = (p: SheetPlayer | null) => { const w = el('div', 'ph'); if (!p || p.photo || p.silhouette) w.appendChild(photoEl(p)); else { w.className = 'ph logo-fallback'; w.textContent = initials(p.name); } return w; };
    row.append(ph(h), nm(h, 'nm--home'), el('div', 'ps', pos), el('div', 'v', 'v'), el('div', 'ps', OPPOSITE[pos]), nm(a, ''), ph(a));
    box.appendChild(row);
  });
  box.hidden = false;
}

// Games played in this division (from the Athletes page records and PlayHQ). Asked for once without
// waiting: reading a whole division's line ups the first time can take a while, so it shows when it arrives.
let gamesPlayed: GamesPlayed | null = null;
if (opts.get('games') !== '0') {
  fetch('/api/athletes/games', { cache: 'no-store' }).then(r => r.json())
    .then((d: GamesPlayed & { error?: string }) => { if (d.error) throw new Error(d.error); gamesPlayed = d; })
    .catch(err => console.warn('Position match ups: games played unavailable:', err instanceof Error ? err.message : err));
}
function gamesText(team: SheetSide, p: SheetPlayer | null) {
  if (!p || !gamesPlayed) return '';
  const side = gamesPlayed[lastData && team === lastData.home ? 'home' : 'away'] || {};
  const g = side[p.name] && side[p.name].games;
  return g ? `${g} game${g === 1 ? '' : 's'}` : '';
}
let lastData: TeamSheets | null = null;

// Until there are line ups: what the page is waiting for, with both teams' logos.
let waitingFor = '';
function showWaiting(data: TeamSheets, waiting: { title: string; detail: string }) {
  if (waitingFor !== waiting.title) { waitingFor = waiting.title; window.pageLog?.('info', `Position match ups: ${waiting.title}. ${waiting.detail}`); }
  if (opts.get('waiting') === '0') return;
  const named = data.home && data.away && data.home.name && data.away.name;
  $('waitTeams').textContent = named ? `${data.home.name}  v  ${data.away.name}` : '';
  $('waitHome').replaceChildren(...(named ? [logoEl(data.home, '')] : []));
  $('waitAway').replaceChildren(...(named ? [logoEl(data.away, '')] : []));
  $('waitTitle').textContent = waiting.title;
  $('waitDetail').textContent = waiting.detail;
  $('waitFooter').textContent = [data.competition, data.division, data.court].filter(Boolean).join('  ·  ');
  $('wait').hidden = false;
}

let started = false;
// Asked again every 10 seconds until the line ups arrive (they come once live scoring starts).
const stopLoading = loadTeams<TeamSheets>(async data => {
  if (started) return;
  lastData = data;
  // Players added from the season squad (the line up was incomplete) have no position.
  const lineup = (team: SheetSide) => (team.players || []).filter(p => !p.fromSquad);
  const at = (team: SheetSide, pos: Pos) => lineup(team).find(p => p.position === pos) || null;
  const pairs = ORDER.map((pos): Pair => [pos, at(data.home, pos), at(data.away, OPPOSITE[pos])]);
  // Positions PlayHQ doesn't have show as Unknown; only no line ups at all shows the waiting message.
  const waiting = lineupWait(data);
  if (waiting) { showWaiting(data, waiting); return; }
  stopLoading();
  $('wait').hidden = true;
  const unknown = pairs.flatMap(([pos, h, a]) => [h ? null : `${data.home.name} ${pos}`, a ? null : `${data.away.name} ${OPPOSITE[pos]}`]).filter(Boolean);
  if (unknown.length) window.pageLog?.('warn', `Position match ups: no athlete listed for ${unknown.join(', ')}; showing Unknown`);
  started = true;
  const missing = pairs.flatMap(([pos, h, a]) => [h && !h.photo ? h.name : null, a && !a.photo ? a.name : null]).filter(Boolean);
  if (missing.length) window.pageLog?.('info', `No photo for ${missing.join(', ')} (add them on the Athletes page)`);
  $('teams').textContent = `${data.home.name}  v  ${data.away.name}`;
  $('footer').textContent = [data.competition, data.division, data.court].filter(Boolean).join('  ·  ');
  $('dots').replaceChildren(...ORDER.map(p => el('span', 'pm__dot', `${p} v ${OPPOSITE[p]}`)));
  $('card').hidden = false;

  const one = (opts.get('pair') || '').toUpperCase();
  const pick = ORDER.indexOf(one as Pos);
  if (pick >= 0) { show(data, pairs, pick); return; }
  if (opts.get('show') === 'all') { showAll(data, pairs); return; }
  const stage = $('stage');
  do {
    for (let i = 0; i < pairs.length; i++) {
      show(data, pairs, i);
      await wait(HOLD);
      if (i < pairs.length - 1 || opts.get('loop') === '1') { stage.className = 'pm__stage leave'; await wait(350); }
    }
  } while (opts.get('loop') === '1');
  if (opts.get('end') === 'out') { $('card').classList.add('out'); studioDone(600); }
  else { stage.className = 'pm__stage leave'; await wait(350); showAll(data, pairs); }
}, { every: 10000 });

// What makes this file a module (its names its own), as the first line says.
export {};
