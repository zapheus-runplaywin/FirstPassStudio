// FirstPass Studio - the Socials picture's script (social.html loads it as a module, so its names stay its own).

declare global {
  interface Window { socialReady: Promise<string | true> }
}

// The parts of /api/socials/night that each picture's kind needs (socials.ts night() and NEEDS). A part that can't be
// made says why in error (the rest of it is then left out).
type Result = 'W' | 'L' | 'D';
// A shooter or athlete on a list: their name, team and logo, their photo when they approved its use, and their numbers.
interface Shooter {
  name: string; team: string; logo?: string | null; photo?: string | null; position?: string;
  goals: number; superGoals: number; shots: number; accuracy: number | null; points: number; games: number;
  moved?: number; fresh?: boolean; last?: number[]; rise?: number; earlier?: number;
}
// A side of a game with its shooting (Game stats, Shooting duel).
interface StatsSide extends SocialTeam { goals: number; superGoals: number; shots: number; accuracy: number | null; shooters: Shooter[] }
// A kept story's numbers (board.ts getStats).
interface StoryNumbers {
  quartersWon?: HomeAway<number> & { of: number }; bestQuarter?: { home?: { points: number; label: string }; away?: { points: number; label: string } };
  longestRun?: Partial<HomeAway<number>>; runs3?: Partial<HomeAway<number>>; runs5?: Partial<HomeAway<number>>;
  superShots?: HomeAway<number>; biggestLead?: { home?: { margin: number } | null; away?: { margin: number } | null };
}
interface Moment {
  kind: string; also?: { kind: string }[]; side?: 'home' | 'away'; goals?: number; down?: number; period?: number; periodLabel?: string;
  clockLeft?: number; score?: HomeAway<number>;
}
// A finals game: its teams once known (else who they will be), the score and winner once played.
interface FinalSide { name: string | null; logo?: string | null; placeholder?: string; score?: number | null }
interface FinalGame { id: string; weekName: string; name: string; date?: string; time?: string; court?: string; notNeeded?: boolean; winner?: string | null; home: FinalSide; away: FinalSide }
interface NightPicture extends SocialsNight {
  form?: { id: string; home: { result: Result; for: number; against: number }[]; away: { result: Result; for: number; against: number }[];
    meetings: { round?: string; date?: string; for: number; against: number; result: Result }[]; wins: { home: number; away: number; draws?: number } }[];
  preview?: { division: string; error?: string; pick?: string; topOfTable?: boolean; finalsPlaces?: number;
    games?: { id: string; home?: { place: number; points: number }; away?: { place: number; points: number }; climbs?: string[] }[] };
  milestones?: { name: string; team: string; logo: string | null; photo: string | null; games: number; played: boolean }[];
  race?: { division: string; error?: string; finalsPlaces?: number;
    rows?: { position: number; team: string; logo: string | null; points: number; left: number; status: 'in' | 'chance' | 'out' }[] };
  draw?: { division: string; team: string; games: { date: string; time: string; court: string; round?: string; opponent: string; opponentLogo: string | null;
    result: { result: Result; for: number; against: number } | null }[] };
  accuracy?: { division: string; gamesFinished: number; minShots: number; players: Shooter[] };
  superShots?: { division: string; error?: string; night?: Shooter[]; season?: Shooter[] };
  teamSupers?: { division: string; error?: string; gamesFinished?: number; notCounted?: number;
    teams?: { team: string; logo: string | null; games: number; tonight: number | null; season: number }[] };
  onFire?: { division: string; players: (Shooter & { last: number[]; rise: number; earlier: number })[] };
  numbers?: { games: number; points: number; superShots: number | null; notCounted?: number; close: number; closeMargin: number; biggest: number;
    highest: { score: number; team: string } | null; accuracy?: number | null; upsets?: number; averageWin?: number | null; draws?: number;
    leadChanges?: number; longestRun?: { n: number; team: string } | null; runs5?: number };
  season?: { team: string; division: string; error?: string; played: number; won: number; lost: number; drawn: number; place: number | null;
    percentage: number | null; run: { games: number; result: Result } | null; biggestWin: { for: number; against: number; opponent: string } | null;
    topShooter: { name: string; points: number } | null };
  wrap?: { division: string; error?: string; champion?: { name: string; logo: string | null } | null; topShooter?: Shooter | null;
    accuracy?: Shooter | null; superShots?: Shooter | null; biggestWin?: { home: SocialTeam; away: SocialTeam } | null };
  potm?: { error?: string; medal?: string; game?: SocialGame;
    player: { name: string; team: string; position?: string; photo?: string | null; logo?: string | null;
      shooting: { goals: number; superGoals: number; shots: number; accuracy: number | null } | null } };
  teamRound?: { division: string; error?: string; players?: { position: string; name: string; team?: string; photo?: string | null; logo?: string | null }[] };
  spotlight?: { error?: string; name: string; photo: string | null; teams: { team: string; division: string; logo: string | null }[]; positions?: string[];
    career?: { division: string; games: number }[]; shooting?: { goals: number; superGoals: number } | null };
  sponsorSpot?: { error?: string; name: string; logo: string | null; tier?: string; website?: string; tagline?: string; seconds?: number };
  story?: { error?: string; game: SocialGame; complete: boolean; moments?: Moment[]; worm: SocialWorm;
    stats: { quarters?: ({ played: boolean; label: string; sure: boolean } & HomeAway<number>)[]; superShots?: boolean; stats?: StoryNumbers } };
  gameStats?: { error?: string; read?: boolean; superShots?: boolean; story?: StoryNumbers | null;
    game?: Omit<SocialGame, 'home' | 'away'> & { home: StatsSide; away: StatsSide } };
  teamSheet?: { error?: string; game: Omit<SocialGame, 'home' | 'away'> & HomeAway<SocialTeam & { players: { name: string; position?: string; games: number }[] }> };
  watch?: { error?: string; qr: string; shown: string };
  ladders?: { division: string; after?: string; asAt?: { round?: string; date: string } | null; error?: string; movers?: boolean; finalsPlaces?: number;
    rows: { position: number; team: string; logo: string | null; played?: number; won?: number; lost?: number; drawn?: number;
      percentage?: number | null; points?: number; moved: number }[] }[];
  review?: { upsets?: { id: string; winnerWas: number; loserWas: number }[]; biggest?: string | null; closest?: string | null };
  shooters?: { gamesFinished?: number; error?: string; superShots?: boolean; players: Shooter[] };
  tournament?: { division?: string; round?: string; after?: string; gamesFinished?: number; error?: string; compared?: boolean; superShots?: boolean; players: Shooter[] };
  finalsDraw?: { division: string; error?: string; season?: string; projected?: boolean; format?: { series?: boolean };
    ladder?: { position: number; team: string; logo: string | null; mark: string }[]; legend?: { mark: string; label: string }[];
    games?: FinalGame[]; champion?: { name: string; logo: string | null; colour?: string | null } | null };
}
// What a picture's draw function hands back: why it couldn't be drawn, or nothing.
type Drawn = string | undefined | void;
// A team or person drawn with their logo (or initials).
interface Badge { name: string | null; logo?: string | null }
type Side = 'home' | 'away';
const SIDES = ['home', 'away'] as const;

const params = new URLSearchParams(location.search);
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const SIZES = { square: [1080, 1080], portrait: [1080, 1350], story: [1080, 1920] } as const;
const asked = params.get('size');
const size: keyof typeof SIZES = asked === 'portrait' || asked === 'story' ? asked : 'square';
const [W, H] = SIZES[size];
document.body.classList.add(size);
// ?fit=1: drawn smaller to fit a smaller window (the Mac app draws a picture taller than the screen in a window
// half its size at twice the density, so it still comes out at full size).
if (params.get('fit') === '1' && innerWidth && innerWidth < W) document.documentElement.style.zoom = String(innerWidth / W);
document.documentElement.style.setProperty('--w', `${W}px`);
document.documentElement.style.setProperty('--h', `${H}px`);
const KINDS = ['story', 'worm', 'watch', 'gamestats', 'shooting', 'moments', 'h2h', 'teamsheet', 'runs', 'supershottime', 'comeback', 'potm', 'teamround', 'spotlight', 'sponsorspot', 'thanks', 'accuracy', 'supershots', 'teamsupers', 'onfire', 'numbers', 'club', 'streaks', 'season', 'wrap', 'fixtures', 'matchup', 'form', 'preview', 'byes', 'milestones', 'race', 'countdown', 'draw', 'onstream', 'commentators', 'polaroid', 'results', 'review', 'fulltime', 'ladder', 'topshooters', 'tournament', 'finalsbound', 'finalsdraw', 'champions'] as const;
const kind = KINDS.find(k => k === params.get('kind')) || 'fixtures';
document.body.classList.add(`k-${kind}`);
const flag = (name: string, saved: boolean) => (params.has(name) ? params.get(name) !== '0' : saved);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string | null) {
  const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = text; return e;
}
function logoEl(team: Badge, cls?: string) {
  if (team.logo) { const img = el('img', `logo ${cls || ''}`); img.src = team.logo; img.alt = ''; return img; }
  const initials = String(team.name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase();
  return el('div', `logo logo-fallback ${cls || ''}`, initials);
}
function clock(time: string | undefined) {
  const [h, m] = String(time || '').split(':').map(Number);
  return Number.isFinite(h) ? `${(h % 12) || 12}:${String(m || 0).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}` : (time || 'TBC');
}
const nth = (n: number) => `${n}${[, 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || 'th'}`;
const dayLong = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
const dayShort = (d: string) => { const x = new Date(`${d}T00:00:00`); return `${x.toLocaleDateString('en-AU', { weekday: 'short' })} ${x.getDate()} ${x.toLocaleDateString('en-AU', { month: 'short' })}`; };

// Fits what's in the middle between the heading and the foot: shrinks it when it's too big, and when there's room
// to spare, lays it out narrower and scales it back up to the full width, as far as the height allows (up to 1.35
// times, 1.6 on a Story), then spreads its rows apart, so a short ladder or two games fill the picture instead of
// floating in it.
function fit() {
  const box = $('body'), inner = $('fit');
  inner.style.scale = ''; inner.style.width = ''; inner.style.alignSelf = ''; inner.style.removeProperty('--spread');
  // The body's own padding is 36 + 60; a template that pads it more (to clear its decoration) gets less room.
  const cs = getComputedStyle(box), pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) - 96;
  // With the sponsor strip, the PIVT logo and the mark sit in the body's bottom padding, so nothing runs into it.
  const room = { w: box.clientWidth, h: box.clientHeight - ($('sponsors').hidden ? 72 : 108) - pad }, need = { w: inner.scrollWidth, h: inner.scrollHeight };
  const s = Math.min(1, room.w / need.w, room.h / need.h);
  if (s < 1) { inner.style.scale = String(Math.floor(s * 1000) / 1000); return; }
  // How tall it comes out at g times, laid out at the width that g brings back to full; no good if anything is too
  // wide for it, or any words wrap onto more lines than at full width (a name broken up, a row taller).
  const all = [...inner.querySelectorAll<HTMLElement>('*')];
  const words = all.filter(e => !e.children.length && e.textContent?.trim());
  const lines = words.map(e => e.offsetHeight);
  const spill = (e: HTMLElement) => e.clientWidth ? e.scrollWidth - e.clientWidth : 0; // a name running out of its cell, say
  const spills = all.map(spill);
  const tall = (g: number) => {
    inner.style.width = `${room.w / g}px`;
    if (inner.scrollWidth > room.w / g + 1 || words.some((e, i) => e.offsetHeight > lines[i] * 1.2 + 2)
      || all.some((e, i) => spill(e) > spills[i] + 1)) return Infinity;
    return inner.scrollHeight * g;
  };
  let lo = 1, hi = size === 'story' ? 1.6 : 1.35;
  if (tall(hi) <= room.h) lo = hi;
  else for (let i = 0; i < 8; i++) { const g = (lo + hi) / 2; if (tall(g) <= room.h) lo = g; else hi = g; }
  if (lo >= 1.03) {
    inner.style.width = `${room.w / lo}px`;
    inner.style.alignSelf = 'center';
    inner.style.scale = String(Math.floor(lo * 1000) / 1000);
  } else { inner.style.width = ''; lo = 1; }
  // Height still to spare (a Story, mostly): the rows and groups spread apart into it, up to 36px more between rows.
  let a = 0, b = 36;
  const fits = (x: number) => { inner.style.setProperty('--spread', `${x}px`); return inner.scrollHeight * lo <= room.h; };
  if (fits(b)) a = b;
  else for (let i = 0; i < 6; i++) { const x = (a + b) / 2; if (fits(x)) a = x; else b = x; }
  inner.style.setProperty('--spread', `${Math.floor(a)}px`);
}

// A team or player name stays on one line in its row, shrinking (to 60%) rather than breaking onto a second line, so
// the rows keep one height; a name too long for that wraps between words at 85%.
function fitNames() {
  for (const e of $('fit').querySelectorAll<HTMLElement>(':is(.game__team, .call__teams span, .shooter__name, .vs h2, .crew__game span, .champ__name):not(.final__tbc)')) {
    const base = parseFloat(getComputedStyle(e).fontSize);
    e.style.whiteSpace = 'nowrap';
    if (!e.clientWidth || e.scrollWidth <= e.clientWidth) continue;
    const px = Math.floor(base * e.clientWidth / e.scrollWidth);
    if (px >= base * .6) { e.style.fontSize = `${px}px`; continue; }
    e.style.whiteSpace = 'normal'; e.style.overflowWrap = 'normal'; e.style.fontSize = `${Math.round(base * .85)}px`;
  }
}

// The commentators' names share one size, so a long name next to a short one keeps the row balanced: the biggest
// that fits each one's longest word in its column, shrinking up to 25% to keep a hyphenated name whole, and
// otherwise breaking it after the hyphen (down to 60%).
function fitCrew() {
  const names = [...$('fit').querySelectorAll<HTMLElement>('.crew .mic__name')];
  if (!names.length) return;
  const base = parseFloat(getComputedStyle(names[0]).fontSize);
  const fitOf = (n: HTMLElement) => {
    const words: number[][] = [[]];
    for (const c of n.childNodes) if (c.nodeType === 3) words.push([]); else if (c instanceof HTMLSpanElement) words[words.length - 1].push(c.offsetWidth);
    const k = (ws: number[]) => Math.min(1, ...ws.filter(Boolean).map(w => n.clientWidth / w));
    const whole = k(words.map(w => w.reduce((a, b) => a + b, 0)));
    return whole >= .75 ? whole : k(words.flat());
  };
  const k = Math.min(...names.map(fitOf));
  if (k < 1) for (const n of names) n.style.fontSize = `${Math.floor(base * Math.max(k, .6))}px`;
}

function head(d: NightPicture, title: string, when: (string | Node)[], tab?: string) {
  $('tab').textContent = tab || d.competition;
  $('tab').hidden = !$('tab').textContent;
  // A word a span, so a template can set one apart (Final puts the last word in its script face).
  const words = String(params.get('title') || title).split(/\s+/).filter(Boolean);
  $('title').replaceChildren(...words.flatMap((w, i) => [...(i ? [' '] : []), el('span', 'w', w)]));
  $('title').dataset.text = $('title').textContent; // for a template that echoes the title (Final's faint echo)
  $('when').replaceChildren(...when);
  if (d.competitionLogo) { $<HTMLImageElement>('compLogo').src = d.competitionLogo; $('compLogo').hidden = false; }
}

// The title stays on one line, shrinking up to 30% to fit beside the logo at any size; only a title that would get
// smaller than that wraps (at the template's size, each word still fitting). Poster stacks its words on purpose.
function fitTitle() {
  const t = $('title'), head = $('head'), logo = $('compLogo');
  if (document.body.classList.contains('t-poster') && size !== 'square') return;
  const gap = parseFloat(getComputedStyle(head).columnGap) || 0;
  // --title-clear: the room a template keeps free at the right for its decoration (Poster's bar).
  const clear = parseFloat(getComputedStyle(head).getPropertyValue('--title-clear')) || 0;
  const room = head.clientWidth - (logo.hidden ? 0 : logo.getBoundingClientRect().width + gap) - 8 - clear;
  fitWhen(room);
  const base = parseFloat(getComputedStyle(t).fontSize);
  t.style.whiteSpace = 'nowrap';
  const wide = t.scrollWidth;
  if (wide <= room) return;
  if (wide * .7 <= room) {
    let px = Math.floor(base * room / wide);
    t.style.fontSize = `${px}px`;
    while (t.scrollWidth > room && px > base * .7) t.style.fontSize = `${--px}px`;
    return;
  }
  t.style.whiteSpace = '';
  for (let px = base; t.scrollWidth > room && px > base * .5; px -= 2) t.style.fontSize = `${px}px`;
}
// The date line under the title stays on one line too, shrinking a little (to 75%); a longer one puts its small part
// (court, venue) on a second line.
function fitWhen(room: number) {
  const w = $('when');
  w.style.whiteSpace = 'nowrap';
  if (w.scrollWidth <= room) return;
  const base = parseFloat(getComputedStyle(w).fontSize);
  if (w.scrollWidth * .75 > room) {
    // Too long to shrink: the small part (court, venue) goes on a line of its own rather than breaking mid-phrase.
    const small = w.querySelector('small');
    if (small) { small.style.display = 'block'; small.style.marginLeft = '0'; small.style.marginTop = '4px'; }
    for (let px = base; w.scrollWidth > room && px > base * .75; px--) w.style.fontSize = `${px}px`;
    if (w.scrollWidth > room) w.style.whiteSpace = '';
    return;
  }
  w.style.fontSize = `${base * room / w.scrollWidth}px`;
}

function drawFixtures(d: NightPicture): Drawn {
  head(d, 'Game night', [dayLong(d.date), el('small', '', d.venue)]);
  if (!d.games.length) return `No games on ${dayLong(d.date)}.`;
  const times = [...new Set(d.games.map(g => g.time))];
  for (const t of times) {
    const slot = $('fit').appendChild(el('div', 'slot'));
    slot.append(el('div', 'slot__time', clock(t)));
    for (const g of d.games.filter(x => x.time === t)) {
      const row = slot.appendChild(el('div', 'game'));
      row.append(logoEl(g.home), el('div', 'game__team', g.home.name), el('div', 'game__v', 'v'), el('div', 'game__team away', g.away.name), logoEl(g.away),
        el('div', 'game__info', [g.division, g.court].filter(Boolean).join('  ·  ')));
    }
  }
}

// An athlete picked for a side: their photo over the team's logo (as a badge), else the logo alone.
function picture(t: Badge, who: { name: string; photo: string } | undefined) {
  if (!who) return [logoEl(t)];
  const box = el('div', 'athlete');
  const img = box.appendChild(el('img', 'athlete__photo')); img.src = who.photo; img.alt = who.name;
  box.append(logoEl(t));
  return [box];
}
const athleteName = (who: { name: string } | undefined) => (who ? [el('div', 'athlete__name', who.name)] : []);
// A shooter's face with their team's logo as a badge.
function face(p: { name: string; photo?: string | null; team: string; logo?: string | null }) {
  const box = el('div', 'face');
  const img = box.appendChild(el('img', 'face__photo')); img.src = p.photo || ''; img.alt = p.name;
  box.append(logoEl({ name: p.team, logo: p.logo }));
  return box;
}

// Commentary team: one picture a game (?game=, else the night's first called game), with who calls it side by side,
// each with their headshot (or initials) and a Special guest tag, and the game's time and teams once underneath.
function drawCommentators(d: NightPicture): Drawn {
  head(d, 'Commentary team', [dayLong(d.date), el('small', '', d.stream ? [d.stream.court, d.venue].filter(Boolean).join('  ·  ') : '')]);
  if (!d.stream) return `No plan for ${dayLong(d.date)} yet: plan the court and commentators on the Production Planner tab.`;
  const called = d.stream.slots.filter(s => s.people.length);
  const s = called.find(x => x.id === params.get('game')) || called[0];
  if (!s) return `Nobody is on the mic for ${dayLong(d.date)} yet: add the commentators on the Production Planner tab.`;
  const box = $('fit').appendChild(el('div', `crew crew--${s.people.length}`));
  for (const c of s.people) {
    const card = box.appendChild(el('div', 'mic'));
    const faceBox = card.appendChild(el('div', 'mic__face'));
    if (c.headshot) { const img = faceBox.appendChild(el('img')); img.src = c.headshot; img.alt = c.name; }
    else faceBox.append(c.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase());
    // A blank tag under the others when someone is a guest, so the names all start on one line.
    if (s.people.some(x => x.guest)) card.append(el('div', `mic__guest${c.guest ? '' : ' mic__guest--blank'}`, 'Special guest'));
    // A word a span that never breaks, with a break allowed after a hyphen: Hartley- / Nguyen, never Papadopoul / os.
    const name = card.appendChild(el('div', 'mic__name'));
    c.name.split(/\s+/).forEach((w, i) => w.split(/(?<=-)/).forEach((bit, j) => name.append(...(i && !j ? [' '] : j ? [document.createElement('wbr')] : []), el('span', '', bit))));
  }
  const game = $('fit').appendChild(el('div', 'crew__game'));
  game.append(el('b', '', clock(s.time)), el('span', '', `${s.home.name} v ${s.away.name}`), ...(s.division ? [el('small', '', s.division)] : []));
}

function drawMatchup(d: NightPicture): Drawn {
  const g = d.games.find(x => x.id === params.get('game')) || d.games[0];
  if (!g) { head(d, 'Match up', [dayLong(d.date)]); return `No games on ${dayLong(d.date)}.`; }
  head(d, 'Match day', [[g.division, g.final || g.round].filter(Boolean).join('  ·  ')]);
  const vs = $('fit').appendChild(el('div', 'vs'));
  const side = (t: SocialTeam, which: Side) => { const s = el('div'); s.append(...picture(t, d.picked[which]), el('h2', '', t.name), ...athleteName(d.picked[which])); return s; };
  vs.append(side(g.home, 'home'), el('div', 'vs__v', 'v'), side(g.away, 'away'));
  const info = $('fit').appendChild(el('div', 'info'));
  const bit = (label: string, value: string) => { const s = el('span'); s.append(el('b', '', label), ` ${value}`); return s; };
  info.append(el('span', '', dayShort(d.date)), bit('', clock(g.time)), ...(g.court ? [el('span', '', g.court)] : []), ...(g.venue || d.venue ? [el('span', '', g.venue || d.venue)] : []));
}

const bound = (cls: string, ...kids: (string | Node)[]) => { const row = el('div', `bound ${cls}`); row.append(...kids); return row; };
const who = (name: string, line: string) => { const x = el('div'); x.append(el('div', 'shooter__name', name), el('div', 'shooter__team', line)); return x; };
const pill = (text: string, mark?: string) => el('div', `bound__earned${mark ? ` bound__earned--${mark}` : ''}`, text);
const stat = (v: string | number, label: string, main?: boolean) => { const x = el('div', `stat${main ? ' main' : ''}`); x.append(el('b', '', String(v)), el('small', '', label)); return x; };

// Form guide (?game=): each team's last five results this season (oldest first, a win in the main colour) and how
// their meetings this season went.
function drawForm(d: NightPicture): Drawn {
  const g = d.games.find(x => x.id === params.get('game')) || d.games[0];
  if (!g) { head(d, 'Form guide', [dayLong(d.date)]); return `No games on ${dayLong(d.date)}.`; }
  head(d, 'Form guide', [[g.division, g.final || g.round].filter(Boolean).join('  ·  '), el('small', '', [dayShort(d.date), clock(g.time), g.court].filter(Boolean).join('  ·  '))]);
  const f = (d.form || []).find(x => x.id === g.id) || { home: [], away: [], meetings: [], wins: { home: 0, away: 0, draws: 0 } };
  for (const side of SIDES) {
    const chips = el('div', 'form__chips');
    for (const r of f[side]) chips.append(stat(r.result, `${r.for}–${r.against}`, r.result === 'W'));
    if (!f[side].length) chips.append(el('div', 'form__none', 'First game of the season'));
    const team = el('div'); team.append(el('div', 'game__team', g[side].name), chips);
    $('fit').append(bound('bound--form', logoEl(g[side]), team));
  }
  const info = $('fit').appendChild(el('div', 'info'));
  const m = f.meetings || [];
  if (!m.length) info.append(el('span', '', 'First meeting this season'));
  else {
    const s = el('span');
    s.append('This season: ', el('b', '', `${g.home.name} ${f.wins.home}`), ', ', el('b', '', `${g.away.name} ${f.wins.away}`), ...(f.wins.draws ? [`, ${f.wins.draws} drawn`] : []));
    info.append(s);
  }
}

// Round preview (?division=): the division's games that night with each team's ladder place and points, the game of
// the round outlined, and who a win could lift into the finals places.
function drawPreview(d: NightPicture): Drawn {
  const p: Partial<NonNullable<NightPicture['preview']>> = d.preview || {};
  const mine = d.games.filter(g => g.division === p.division);
  const rounds = [...new Set(mine.map(g => g.final || g.round).filter(Boolean))];
  head(d, 'Round preview', [p.division || '', el('small', '', [rounds.join(', '), dayShort(d.date)].filter(Boolean).join('  ·  '))]);
  if (p.error) return p.error;
  if (!mine.length) return `${p.division} doesn't play on ${dayLong(d.date)}.`;
  for (const g of mine) {
    const x: { home?: { place: number; points: number }; away?: { place: number; points: number }; climbs?: string[] } = (p.games || []).find(y => y.id === g.id) || {};
    const place = (t: { place: number; points: number }) => t ? `${nth(t.place)} (${t.points} pts)` : '';
    if (p.pick === g.id) $('fit').append(el('div', 'result__final', p.topOfTable ? 'Top of the table' : 'Game of the round'));
    const row = $('fit').appendChild(el('div', `game${p.pick === g.id ? ' preview--pick' : ''}`));
    const info = x.home && x.away ? `${place(x.home)}  v  ${place(x.away)}  ·  ${clock(g.time)}` : [clock(g.time), g.court].filter(Boolean).join('  ·  ');
    row.append(logoEl(g.home), el('div', 'game__team', g.home.name), el('div', 'game__v', 'v'), el('div', 'game__team away', g.away.name), logoEl(g.away),
      el('div', 'game__info', info));
    for (const t of x.climbs || []) $('fit').append(el('div', 'later', `A win can lift ${t} into the top ${p.finalsPlaces}`));
  }
}

// Byes: the teams of each division playing that night that aren't.
function drawByes(d: NightPicture): Drawn {
  head(d, 'Byes', [dayLong(d.date), el('small', '', d.venue)]);
  if (!(d.byes || []).length) return `Every team plays on ${dayLong(d.date)}.`;
  for (const b of d.byes) {
    const group = $('fit').appendChild(el('div', 'group'));
    group.append(el('div', 'group__name', b.division));
    for (const t of b.teams) group.append(bound('bound--bye', logoEl(t), el('div', 'game__team', t.name)));
  }
}

// Milestones: athletes playing a first game or a 50th, 100th... (?when=played: those who played it that night, from the
// finished games' line ups; ?when=next: those whose next game would be it, for before the night).
function drawMilestones(d: NightPicture): Drawn {
  const when = params.get('when') === 'next' ? 'next' : 'played';
  head(d, 'Milestones', [dayLong(d.date), el('small', '', d.venue)]);
  const list = (d.milestones || []).filter(m => m.played === (when === 'played'));
  if (!list.length) return when === 'played' ? `No milestones in ${dayLong(d.date)}'s line ups.` : `No milestones due on ${dayLong(d.date)}.`;
  for (const m of list) {
    const line = m.games === 1 ? `${m.team}  ·  first game` : `${m.team}  ·  ${when === 'played' ? 'played' : 'set to play'} their ${nth(m.games)}`;
    $('fit').append(bound('bound--ms', m.photo ? face(m) : logoEl({ name: m.team, logo: m.logo }), who(m.name, line), stat(m.games === 1 ? '1st' : nth(m.games), 'Game', true)));
  }
}

// Finals race (?division=): the ladder as it stands, each team in, out or still a chance, with its games left.
function drawRace(d: NightPicture): Drawn {
  const r: Partial<NonNullable<NightPicture['race']>> = d.race || {};
  const on = (d.raceOn || []).find(x => x.division === r.division);
  head(d, 'Finals race', [r.division || '', el('small', '', on ? (on.left === 1 ? 'Last round' : `${on.left} rounds to go`) : '')]);
  if (r.error) return r.error;
  const rows = r.rows || [];
  if (!rows.length) return `No ladder for ${r.division} yet.`;
  const words = { in: ['In the finals', 'final'], chance: ['Still a chance', ''], out: ['Out', 'out'] } as const;
  for (const t of rows) {
    const [text, mark] = words[t.status];
    $('fit').append(bound('', el('div', 'shooter__rank', String(t.position)), logoEl({ name: t.team, logo: t.logo }),
      who(t.team, `${t.points} pts  ·  ${t.left} to play`), pill(text, mark)));
  }
  const k = $('fit').appendChild(el('div', 'key')); k.append(`Top ${r.finalsPlaces} play finals`);
}

// Countdown: the rounds left before the finals, or on a finals night the days to the grand final.
function drawCountdown(d: NightPicture): Drawn {
  const c = d.countdown || {};
  head(d, 'Countdown', [dayLong(d.date), el('small', '', d.venue)]);
  let big: string, words: string;
  if (c.rounds === 1) [big, words] = ['Last', 'round before finals'];
  else if (c.rounds) [big, words] = [String(c.rounds), 'rounds to go until finals'];
  else if (c.grandFinal === 0) [big, words] = ['GF', 'Grand final night'];
  else if (c.grandFinal !== undefined && c.grandFinal % 7 === 0) [big, words] = [String(c.grandFinal / 7), c.grandFinal === 7 ? 'week to the grand final' : 'weeks to the grand final'];
  else if (c.grandFinal) [big, words] = [String(c.grandFinal), 'days to the grand final'];
  else return 'The finals are more than four rounds away.';
  const box = $('fit').appendChild(el('div', 'count'));
  box.append(el('div', 'count__big', big), el('div', 'count__words', words));
}

// Season draw (?division= &team=): every game of the team's season, with the result once played.
function drawDraw(d: NightPicture): Drawn {
  const x: Partial<NonNullable<NightPicture['draw']>> = d.draw || {};
  head(d, 'Season draw', [x.team || '', el('small', '', x.division || '')]);
  if (!x.team) return 'Pick a team: there is a Season draw picture for each one on the Socials tab.';
  const games = x.games || [];
  if (!games.length) return `${x.team} has no games in ${x.division}.`;
  for (const g of games) {
    const r = g.result;
    $('fit').append(bound('bound--draw', who(dayShort(g.date), [clock(g.time), g.court].filter(Boolean).join('  ·  ')), logoEl({ name: g.opponent, logo: g.opponentLogo }), el('div', 'game__team', `v ${g.opponent}`),
      r ? pill(`${r.result} ${r.for}–${r.against}`, r.result === 'W' ? 'final' : '') : pill(g.round || '')));
  }
}

// A shooter's row: rank (none when null), face (or team logo), name and team, then the stats given.
function shooterRow(i: number | null, p: { name: string; team: string; logo?: string | null; photo?: string | null }, ...stats: Node[]) {
  const row = el('div', `shooter${i === null ? ' shooter--norank' : ''}`);
  const s = el('div', 'shooter__stats'); s.append(...stats);
  row.append(...(i === null ? [] : [el('div', 'shooter__rank', String(i + 1))]), p.photo ? face(p) : logoEl({ name: p.team, logo: p.logo }), who(p.name, p.team), s);
  return row;
}
// Sharpshooter (?division=): the night's best accuracy, from its finished games' line ups.
function drawAccuracy(d: NightPicture): Drawn {
  const a = d.accuracy || { division: '', gamesFinished: 0, minShots: 0, players: [] };
  head(d, 'Sharpshooter', [a.division || '', el('small', '', dayLong(d.date))]);
  if (!a.gamesFinished) return `No results in ${a.division} for ${dayLong(d.date)} yet.`;
  if (!a.players.length) return `Nobody in ${a.division} had ${a.minShots} or more shots at goal that night.`;
  for (const [i, p] of a.players.entries()) $('fit').append(shooterRow(i, p, stat(`${p.goals + p.superGoals}/${p.shots}`, 'Shots'), stat(`${p.accuracy}%`, 'Accuracy', true)));
}
// Super shot leaders (?division=): the most super shots that night and over the season so far.
function drawSuperShots(d: NightPicture): Drawn {
  const x: Partial<NonNullable<NightPicture['superShots']>> = d.superShots || {};
  head(d, 'Super shot leaders', [x.division || '', el('small', '', dayLong(d.date))]);
  if (x.error) return x.error;
  if (!(x.night || []).length && !(x.season || []).length) return `No super shots in ${x.division} yet.`;
  for (const [label, list] of [['Tonight', x.night || []], ['Season', x.season || []]] as const) {
    if (!list.length) continue;
    const group = $('fit').appendChild(el('div', 'group'));
    group.append(el('div', 'group__name', label));
    for (const [i, p] of list.entries()) group.append(shooterRow(i, p, stat(p.points, 'Points'), stat(p.superGoals, 'Super', true)));
  }
}
// Team super shots (?division=): every team's super shots that night and over the season so far, from PlayHQ's team
// counts, most first; a team that didn't play that night shows a dash.
function drawTeamSupers(d: NightPicture): Drawn {
  const x: Partial<NonNullable<NightPicture['teamSupers']>> = d.teamSupers || {};
  head(d, 'Team super shots', [x.division || '', el('small', '', dayLong(d.date))]);
  if (x.error) return x.error;
  if (!x.gamesFinished) return `No results in ${x.division} for ${dayLong(d.date)} yet.`;
  for (const [i, t] of (x.teams || []).entries()) {
    $('fit').append(shooterRow(i, { name: t.team, team: `${t.games} ${t.games === 1 ? 'game' : 'games'}`, logo: t.logo },
      stat(t.tonight === null ? '–' : t.tonight, 'Tonight'), stat(t.season, 'Season', true)));
  }
  if (x.notCounted) $('fit').append(el('p', 'message', `${x.notCounted} ${x.notCounted === 1 ? 'game' : 'games'} not counted: PlayHQ couldn't give ${x.notCounted === 1 ? 'its' : 'their'} stats.`));
}
// On fire (?division=): the shooters who played that night whose goals a game have risen most over their last games.
function drawOnFire(d: NightPicture): Drawn {
  const x = d.onFire || { division: '', players: [] };
  head(d, 'On fire', [x.division || '', el('small', '', dayLong(d.date))]);
  if (!x.players.length) return `Nobody in ${x.division} has more goals a game lately than before.`;
  for (const [i, p] of x.players.entries()) {
    const row = shooterRow(i, p, ...p.last.map(n => stat(n, 'Goals')), stat(`+${p.rise}`, 'A game', true));
    row.querySelector('.shooter__team')!.textContent = `${p.team}  ·  was ${p.earlier} a game`;
    $('fit').append(row);
  }
}
// Night in numbers: the night's finished games added up.
function drawNumbers(d: NightPicture): Drawn {
  const n = d.numbers;
  head(d, 'Night in numbers', [dayLong(d.date), el('small', '', d.venue)]);
  if (!n || !n.games) return noResults(d);
  const tile = (v: string | number, label: string, note?: string) => { const x = stat(v, label); if (note) x.append(el('small', 'stat__note', note)); return x; };
  const tiles = $('fit').appendChild(el('div', 'tiles'));
  tiles.append(tile(n.games, n.games === 1 ? 'Game' : 'Games'), tile(n.points, n.superShots === null ? 'Goals' : 'Points'));
  // Super shots from PlayHQ's team counts; a game whose line ups couldn't be read is said, not counted as none.
  if (n.superShots !== null && n.superShots !== undefined) tiles.append(tile(n.superShots, 'Super shots', n.notCounted ? `${n.notCounted} ${n.notCounted === 1 ? 'game' : 'games'} not counted` : ''));
  // Margins are in points where super shots count (a super shot is 2).
  tiles.append(tile(n.close, `Within ${n.closeMargin} ${n.superShots === null ? 'goals' : 'points'}`), tile(n.biggest, 'Biggest win'));
  if (n.highest) tiles.append(tile(n.highest.score, 'Highest score', n.highest.team));
  if (n.accuracy !== null && n.accuracy !== undefined) tiles.append(tile(`${n.accuracy}%`, 'Shooting'));
  // Upsets (Round in review's rule); a night without one shows the average winning margin instead.
  if (n.upsets) tiles.append(tile(n.upsets, n.upsets === 1 ? 'Upset' : 'Upsets'));
  else if (n.averageWin !== null && n.averageWin !== undefined) tiles.append(tile(n.averageWin, 'Average win'));
  if (n.draws) tiles.append(tile(n.draws, n.draws === 1 ? 'Draw' : 'Draws'));
  // From the goal order, only when Studio has every game's whole story (socials.js goalOrderNumbers).
  if (n.leadChanges) tiles.append(tile(n.leadChanges, n.leadChanges === 1 ? 'Lead change' : 'Lead changes'));
  if (n.longestRun) tiles.append(tile(n.longestRun.n, 'Goals in a row', n.longestRun.team));
  if (n.runs5) tiles.append(tile(n.runs5, n.runs5 === 1 ? 'Run of 5 goals' : 'Runs of 5 goals'));
}
// Club round up (?club=): every result that night of one club's teams, division by division.
function drawClub(d: NightPicture): Drawn {
  const c = (d.clubs || []).find(x => x.club === params.get('club')) || (d.clubs || [])[0];
  head(d, c ? c.club : 'Club round up', [dayLong(d.date), el('small', '', d.venue)], 'Club round up');
  if (!c) return 'No club had more than one team playing that night.';
  const mine = d.games.filter(g => c.games.includes(g.id));
  for (const div of [...new Set(mine.map(g => g.division))]) {
    const group = $('fit').appendChild(el('div', 'group'));
    if (div) group.append(el('div', 'group__name', div));
    for (const g of mine.filter(x => x.division === div)) group.append(resultRow(g));
  }
}
// Still unbeaten: the teams unbeaten all season, or on a run of wins, once that night's results are in.
function drawStreaks(d: NightPicture): Drawn {
  head(d, 'On a roll', [dayLong(d.date), el('small', '', d.venue)]);
  const list = d.streaks || [];
  if (!list.length) return 'No team is unbeaten or on a run of three wins or more.';
  for (const t of list) {
    const text = t.unbeaten && t.won === t.played ? `${t.won} from ${t.played}` : t.unbeaten ? `Unbeaten in ${t.played}` : `${t.run} wins in a row`;
    $('fit').append(bound('bound--team', logoEl({ name: t.team, logo: t.logo }), who(t.team, `${t.division}  ·  ${t.unbeaten ? 'Still unbeaten' : 'On a run'}`), pill(text, 'final')));
  }
}
// Team season card (?division= &team=): the season so far: its record, place, run, biggest win and top shooter.
function drawSeason(d: NightPicture): Drawn {
  const c = d.season;
  head(d, c?.team || 'Season so far', [c?.division || '', el('small', '', `after ${dayShort(d.date)}`)], 'Season so far');
  if (c?.error) return c.error;
  if (!c || !c.played) return `${c?.team || 'The team'} hasn't played yet this season.`;
  const tiles = $('fit').appendChild(el('div', 'tiles'));
  tiles.append(stat(c.played, 'Played'), stat(c.won, 'Won', true), stat(c.lost, 'Lost'));
  if (c.drawn) tiles.append(stat(c.drawn, 'Drawn'));
  if (c.place) tiles.append(stat(nth(c.place), 'On the ladder'));
  if (c.percentage !== null) tiles.append(stat(c.percentage, 'Percentage'));
  const lines = $('fit').appendChild(el('div', 'card__lines'));
  const line = (label: string, value: string) => lines.append(bound('bound--line', el('div', 'game__team', label), pill(value, 'final')));
  if (c.run && c.run.games > 1) line('Current run', `${c.run.games} ${{ W: 'wins', L: 'losses', D: 'draws' }[c.run.result]} in a row`);
  if (c.biggestWin) line('Biggest win', `by ${c.biggestWin.for - c.biggestWin.against} v ${c.biggestWin.opponent}`);
  if (c.topShooter) line('Top shooter', `${c.topShooter.name}  ·  ${c.topShooter.points}`);
}
// Season wrap (?division=): the division's season in five lines: champions, top shooter, sharpest shooter, most super
// shots and the biggest win.
function drawWrap(d: NightPicture): Drawn {
  const w: Partial<NonNullable<NightPicture['wrap']>> = d.wrap || {};
  head(d, 'Season wrap', [w.division || '', el('small', '', dayLong(d.date))]);
  if (w.error) return w.error;
  const lines = $('fit');
  const add = (label: string, ...kids: Node[]) => { const group = lines.appendChild(el('div', 'group')); group.append(el('div', 'group__name', label), ...kids); };
  if (w.champion) add(d.winners || 'Champions', bound('bound--bye', logoEl(w.champion), el('div', 'game__team', w.champion.name)));
  if (w.topShooter) add('Top shooter', shooterRow(null, w.topShooter, stat(w.topShooter.points, 'Points', true)));
  if (w.accuracy) add('Sharpest shooter', shooterRow(null, w.accuracy, stat(`${w.accuracy.accuracy}%`, 'Accuracy', true)));
  if (w.superShots) add('Most super shots', shooterRow(null, w.superShots, stat(w.superShots.superGoals, 'Super', true)));
  if (w.biggestWin) add('Biggest win', resultRow({ ...w.biggestWin, winner: (w.biggestWin.home.score ?? 0) > (w.biggestWin.away.score ?? 0) ? 'home' : 'away' }));
  if (!lines.children.length) return `${w.division} has no results yet.`;
}

// A big picture in the middle: an athlete's approved photo with their team's logo as a badge, else the logo alone;
// the name under it in the title's colour, then a line of what they are.
function bigCard(who: { name: string; photo?: string | null; team?: string; logo?: string | null }, what: string) {
  const box = $('fit').appendChild(el('div', 'champ'));
  const pic = box.appendChild(el('div', 'champ__logo'));
  if (who.photo) {
    const img = pic.appendChild(el('img', 'champ__photo')); img.src = who.photo; img.alt = who.name;
    if (who.logo || who.team) pic.append(logoEl({ name: who.team || '', logo: who.logo }, 'champ__badge'));
  } else pic.append(logoEl({ name: who.team || who.name, logo: who.logo }));
  const name = box.appendChild(el('h2', 'champ__name', who.name));
  const tc = getComputedStyle($('title')).color;
  if (!/rgba\(.*,\s*0\)$|transparent/.test(tc)) name.style.color = tc;
  if (what) box.append(el('div', 'champ__what', what));
  return box;
}
// Player of the match (?game= &athlete=, &medal= a medal's name, its title): the player picked on the tab, with their
// shooting that game and the score.
function drawPotm(d: NightPicture): Drawn {
  const x = d.potm;
  const g = x?.game;
  head(d, x?.medal || 'Player of the match', [g ? [g.division, g.final || g.round].filter(Boolean).join('  ·  ') : dayLong(d.date),
    el('small', '', g ? `${g.home.name} ${g.home.score}–${g.away.score} ${g.away.name}` : '')], x?.medal ? 'Player of the match' : undefined);
  if (!x) return 'Pick the player of the match on the Socials tab.';
  if (x.error) return x.error === 'Pick the player of the match.' ? 'Pick the player of the match on the Socials tab.' : x.error;
  const p = x.player;
  const box = bigCard(p, [p.team, p.position].filter(Boolean).join('  ·  '));
  const sh = p.shooting;
  if (sh && sh.shots) {
    const tiles = box.appendChild(el('div', 'tiles'));
    tiles.append(stat(sh.goals + sh.superGoals, sh.superGoals ? `Goals (${sh.superGoals} super)` : 'Goals', true), stat(`${sh.goals + sh.superGoals}/${sh.shots}`, 'Shots'));
    if (sh.accuracy !== null) tiles.append(stat(`${sh.accuracy}%`, 'Accuracy'));
  }
}
// Team of the round (?division=, &GS= .. &GK=): an athlete a position, picked on the tab from that night's line ups.
function drawTeamRound(d: NightPicture): Drawn {
  const t: Partial<NonNullable<NightPicture['teamRound']>> = d.teamRound || {};
  head(d, 'Team of the round', [t.division || '', el('small', '', dayLong(d.date))]);
  if (t.error) return t.error;
  const named = (t.players || []).filter(p => p.name);
  if (!named.length) return 'Pick the team on the Socials tab.';
  for (const p of named) $('fit').append(bound('bound--pos', el('div', 'shooter__rank', p.position), p.photo ? face({ ...p, team: p.team || '' }) : logoEl({ name: p.team || p.name, logo: p.logo }), who(p.name, p.team || '')));
}
// Athlete spotlight (?athlete=): one athlete from the Athletes tab: their photo, teams, positions, games played per
// division and this season's goals.
function drawSpotlight(d: NightPicture): Drawn {
  const a = d.spotlight;
  head(d, 'Athlete spotlight', [a?.teams ? a.teams.map(t => t.team).filter((x, i, l) => l.indexOf(x) === i).join('  ·  ') : '', el('small', '', (a?.positions || []).join('  ·  '))]);
  if (!a) return 'Pick the athlete on the Socials tab.';
  if (a.error) return a.error === 'Pick an athlete.' ? 'Pick the athlete on the Socials tab.' : a.error;
  const team: { team?: string; logo?: string | null } = a.teams[0] || {};
  const box = bigCard({ name: a.name, photo: a.photo, team: team.team, logo: team.logo }, a.teams.map(t => t.division).filter((x, i, l) => l.indexOf(x) === i).join('  ·  '));
  const tiles = box.appendChild(el('div', 'tiles'));
  for (const c of (a.career || []).slice(0, 2)) tiles.append(stat(c.games, (a.career || []).length > 1 ? `Games · ${c.division}` : 'Games played'));
  if (a.shooting && (a.shooting.goals || a.shooting.superGoals)) tiles.append(stat(a.shooting.goals + a.shooting.superGoals, 'Goals this season', true));
  if (!tiles.children.length) tiles.remove();
}
// Sponsor spotlight (?sponsor=): one sponsor's logo big, their tagline and website, and after the night how long they
// were on screen.
function drawSponsorSpot(d: NightPicture): Drawn {
  const x = d.sponsorSpot;
  head(d, 'Thank you', [x?.tier ? `Our ${x.tier.toLowerCase()} partner` : '', el('small', '', x?.website || '')], 'Sponsor spotlight');
  if (!x) return 'Pick the sponsor on the Socials tab.';
  if (x.error) return x.error;
  const box = bigCard({ name: x.name, logo: x.logo }, x.tagline || '');
  const mins = Math.round((x.seconds || 0) / 60);
  if (mins >= 1) box.append(el('div', 'later', `On screen for ${mins} minute${mins === 1 ? '' : 's'} of the stream ${d.today ? 'tonight' : `on ${dayShort(d.date)}`}`));
}
// Thanks for watching: a thank you with the competition's sponsors, and the next game night.
function drawThanks(d: NightPicture): Drawn {
  head(d, 'Thanks for watching', [dayLong(d.date), el('small', '', d.venue)]);
  if (d.nextNight) $('fit').append(bound('bound--line', el('div', 'game__team', 'See you next time'), pill(dayLong(d.nextNight), 'final')));
  if (!d.sponsors.length) return;
  $('fit').append(el('div', 'later', 'Proudly supported by'));
  const logos = $('fit').appendChild(el('div', 'thanks__logos'));
  for (const x of d.sponsors) { if (x.logo) { const img = el('img'); img.src = x.logo; img.alt = x.name; logos.append(img); } else logos.append(el('span', '', x.name)); }
}

// Game story (?game=): a game Studio streamed or followed, as Studio kept it: the score quarter by quarter, then quarters
// won, the best quarter, the longest run, the biggest lead and the lead changes.
function storyHead(d: NightPicture, title: string) {
  const x = d.story, g = x?.game;
  head(d, title, [g ? [g.division, g.final || g.round].filter(Boolean).join('  ·  ') : dayLong(d.date), el('small', '', g ? `${g.home.name} ${g.home.score}–${g.away.score} ${g.away.name}` : '')]);
  return x;
}
const noStory = 'No game story for this game.';
function drawStory(d: NightPicture): Drawn {
  const x = storyHead(d, 'Game story');
  if (!x || x.error) return x?.error || noStory;
  const { game: g, stats } = x;
  const quarters = (stats.quarters || []).filter(q => q.played);
  const t = $('fit').appendChild(el('table', 'ladder story'));
  const hr = t.appendChild(el('tr'));
  for (const h of ['', 'Team', ...quarters.map(q => q.label), 'Total']) hr.append(el('th', '', h));
  for (const side of SIDES) {
    const tr = t.appendChild(el('tr'));
    const logo = el('td'); logo.append(logoEl(g[side]));
    tr.append(logo, el('td', 'team', g[side].name), ...quarters.map(q => el('td', '', q.sure ? String(q[side]) : '–')), el('td', '', String(g[side].score)));
  }
  const lines = $('fit').appendChild(el('div', 'card__lines'));
  const line = (label: string, value: string) => lines.append(bound('bound--line', el('div', 'game__team', label), pill(value, 'final')));
  const s: StoryNumbers = stats.stats || {}, name = (k: Side) => g[k].name;
  if (s.quartersWon && s.quartersWon.of) line('Quarters won', `${name('home')} ${s.quartersWon.home}  ·  ${name('away')} ${s.quartersWon.away}`);
  const best = SIDES.flatMap(k => { const v = s.bestQuarter?.[k]; return v ? [{ k, v }] : []; }).sort((a, b) => b.v.points - a.v.points)[0];
  if (best) line('Best quarter', `${name(best.k)}  ·  ${best.v.points} in ${best.v.label}`);
  const run = SIDES.map(k => ({ k, n: s.longestRun?.[k] || 0 })).sort((a, b) => b.n - a.n)[0];
  if (run && run.n > 1) line('Longest run', `${name(run.k)}  ·  ${run.n} goals`);
  const w: SocialWorm = x.worm || {}, lead = SIDES.flatMap(k => { const v = w.biggestLead?.[k]; return v ? [{ k, v }] : []; }).sort((a, b) => b.v.margin - a.v.margin)[0];
  if (lead) line('Biggest lead', `${name(lead.k)} by ${lead.v.margin}`);
  if (w.leadChanges !== undefined) line('Lead changes', String(w.leadChanges));
  if (stats.superShots && s.superShots && (s.superShots.home || s.superShots.away)) line('Super shots', `${name('home')} ${s.superShots.home}  ·  ${name('away')} ${s.superShots.away}`);
  if (!x.complete) $('fit').append(el('div', 'later', 'Studio didn\'t see every goal of this game'));
}
// Moments of the game (?game=): every moment Studio saw in a game it streamed or followed (lead changes, comebacks,
// runs, super shots), oldest first, each with its quarter, the time left in it (when the clock ran) and the score then.
// The 8 that matter most when there are more.
const MOMENT_WORDS: Record<string, string> = { heating: 'Heating up', fire: 'On fire', goalForGoal: 'Goal for goal', lead: 'Hits the front', level: 'All square',
  comeback: 'Coming back', siren: 'On the siren', backToBack: 'Back to back super shots' };
const MOMENT_RANK = ['siren', 'backToBack', 'comeback', 'lead', 'fire', 'goalForGoal', 'level', 'heating'];
const MOMENTS_SHOWN = 8;
function drawMoments(d: NightPicture): Drawn {
  const x = storyHead(d, 'Moments of the game');
  if (!x || x.error) return x?.error || noStory;
  const { game: g } = x;
  let list = (x.moments || []).map((m, i) => ({ ...m, i }));
  if (!list.length) return `No moments in ${g.home.name} v ${g.away.name}: no runs, comebacks or lead changes.`;
  const rank = (m: Moment) => Math.min(...[m.kind, ...(m.also || []).map(a => a.kind)].map(k => { const r = MOMENT_RANK.indexOf(k); return r === -1 ? 99 : r; }));
  if (list.length > MOMENTS_SHOWN) list = [...list].sort((a, b) => rank(a) - rank(b) || a.i - b.i).slice(0, MOMENTS_SHOWN).sort((a, b) => a.i - b.i);
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const timed = new Set(list.map(m => m.clockLeft)).size > 1; // a clock never run says the same time for them all
  for (const m of list) {
    const when = el('div', 'moment__when', `${m.periodLabel || 'Q'}${m.period || ''}`);
    if (timed && m.clockLeft !== undefined && Number.isFinite(m.clockLeft)) when.append(el('small', '', `${mmss(m.clockLeft)} left`));
    const team = m.side ? g[m.side] : null;
    const words = [MOMENT_WORDS[m.kind] || m.kind, m.goals ? `${m.goals} in a row` : m.down ? `from ${m.down} down` : ''].filter(Boolean).join('  ·  ');
    const also = (m.also || []).map(a => (MOMENT_WORDS[a.kind] || a.kind).toLowerCase()).filter(w => !words.toLowerCase().includes(w));
    $('fit').append(bound('bound--moment', when, team ? logoEl(team) : el('div'), who(team ? team.name : 'Both teams', [words, ...also].join('  ·  ')),
      pill(m.score ? `${m.score.home}–${m.score.away}` : '', 'final')));
  }
  if (!x.complete) $('fit').append(el('div', 'later', 'Studio didn\'t see every goal of this game'));
}

// Game stats (?game=): a finished game's numbers from PlayHQ's line ups, team against team (points and super shots
// where they're played, goals, attempts, accuracy), and when Studio streamed it, quarters won, the longest run, the
// 3 and 5 goal runs (a run of 5 counts as a 3 goal run too) and the biggest lead. The team ahead on a row is lit up;
// a drawn row stays plain. No misses: having the most isn't a win.
function gameHead(d: NightPicture, title: string) {
  const x: NonNullable<NightPicture['gameStats']> = d.gameStats || {}, g = x.game;
  head(d, title, [g ? [g.division, g.final || g.round].filter(Boolean).join('  ·  ') : dayLong(d.date), el('small', '', g ? [dayShort(d.date), g.court].filter(Boolean).join('  ·  ') : '')]);
  return x;
}
const winnerOf = (g: HomeAway<{ score: number | null }>) => (g.home.score ?? 0) > (g.away.score ?? 0) ? 'home' : (g.away.score ?? 0) > (g.home.score ?? 0) ? 'away' : '';
function drawGameStats(d: NightPicture): Drawn {
  const x = gameHead(d, 'Game stats');
  if (!x.game) return x.error;
  const g = x.game;
  $('fit').append(Object.assign(resultRow({ ...g, winner: winnerOf(g) }), { className: 'result cmp__teams' }));
  const row = (label: string, h: string | number, a: string | number, better = 'more') => {
    const hv = Number.parseFloat(String(h)), av = Number.parseFloat(String(a));
    const best = !Number.isFinite(hv) || !Number.isFinite(av) || hv === av ? '' : (better === 'more') === (hv > av) ? 'home' : 'away';
    $('fit').append(bound('bound--cmp', stat(h, '', best === 'home'), el('div', 'game__team', label), stat(a, '', best === 'away')));
  };
  const pct = (v: number | null) => v === null ? '–' : `${Math.round(v)}%`;
  if (x.read) {
    if (x.superShots) { row('Super shots', g.home.superGoals, g.away.superGoals); row('Goals', g.home.goals, g.away.goals); }
    else row('Goals', g.home.goals + g.home.superGoals, g.away.goals + g.away.superGoals);
    if (g.home.shots || g.away.shots) {
      row('Attempts', g.home.shots, g.away.shots);
      row('Accuracy', pct(g.home.accuracy), pct(g.away.accuracy));
    }
  }
  const s = x.story;
  if (s) {
    if (s.quartersWon && s.quartersWon.of) row('Quarters won', s.quartersWon.home, s.quartersWon.away);
    if (s.longestRun) row('Longest run', s.longestRun.home || 0, s.longestRun.away || 0);
    if (s.runs3) row('3 goal runs', s.runs3.home || 0, s.runs3.away || 0);
    if (s.runs5) row('5 goal runs', s.runs5.home || 0, s.runs5.away || 0);
    if (s.biggestLead) row('Biggest lead', (s.biggestLead.home || {}).margin || 0, (s.biggestLead.away || {}).margin || 0);
  }
  if (!x.read && !s) return x.error;
}
// Shooting duel (?game=): each team's shooters that game, most points first, with goals from attempts and accuracy,
// under the team's own total.
function drawShooting(d: NightPicture): Drawn {
  const x = gameHead(d, 'Shooting duel');
  if (!x.game) return x.error;
  if (!x.read) return x.error;
  const g = x.game;
  if (![g.home, g.away].some(t => t.shooters.length)) return 'PlayHQ has no shooting for this game.';
  for (const k of SIDES) {
    const t = g[k];
    const group = $('fit').appendChild(el('div', 'group'));
    const total = t.shots ? `${t.goals + t.superGoals}/${t.shots}${t.accuracy !== null ? `  ·  ${Math.round(t.accuracy)}%` : ''}` : String(t.goals + t.superGoals);
    group.append(el('div', 'group__name', `${t.name}  ·  ${total}`));
    for (const p of t.shooters.slice(0, 4)) {
      const scored = p.goals + p.superGoals;
      const stats = [stat(p.shots ? `${scored}/${p.shots}` : scored, p.superGoals ? `Goals (${p.superGoals} super)` : 'Goals', true)];
      if (p.accuracy !== null) stats.push(stat(`${Math.round(p.accuracy)}%`, 'Accuracy'));
      group.append(shooterRow(null, { ...p, team: [t.name, p.position].filter(Boolean).join('  ·  '), logo: t.logo }, ...stats));
    }
  }
}
// Head to head (?game=): how the two teams' meetings this season went before this night, each with its score, and
// the wins each way.
function drawH2H(d: NightPicture): Drawn {
  const g = d.games.find(x => x.id === params.get('game')) || d.games[0];
  if (!g) { head(d, 'Head to head', [dayLong(d.date)]); return `No games on ${dayLong(d.date)}.`; }
  head(d, 'Head to head', [[g.division, g.final || g.round].filter(Boolean).join('  ·  '), el('small', '', [dayShort(d.date), clock(g.time), g.court].filter(Boolean).join('  ·  '))]);
  const f = (d.form || []).find(x => x.id === g.id) || { meetings: [], wins: { home: 0, away: 0, draws: 0 } };
  const m = f.meetings || [];
  if (!m.length) return `${g.home.name} and ${g.away.name} haven't met yet this season.`;
  const tiles = $('fit').appendChild(el('div', 'tiles'));
  tiles.append(stat(f.wins.home, g.home.name, f.wins.home > f.wins.away), stat(f.wins.draws || 0, 'Drawn'), stat(f.wins.away, g.away.name, f.wins.away > f.wins.home));
  const lines = $('fit').appendChild(el('div', 'card__lines'));
  for (const r of m) {
    const home = { name: g.home.name, logo: g.home.logo, score: r.for }, away = { name: g.away.name, logo: g.away.logo, score: r.against };
    const group = lines.appendChild(el('div', 'group'));
    group.append(el('div', 'group__name', [r.round, r.date ? dayShort(r.date) : ''].filter(Boolean).join('  ·  ')), resultRow({ home, away, winner: r.result === 'W' ? 'home' : r.result === 'L' ? 'away' : '' }));
  }
}
// Team sheet (?game=): both teams' squads this season side by side, each player's position (the one they play most)
// and games played in the division.
function drawTeamSheet(d: NightPicture): Drawn {
  const x = d.teamSheet, g = x?.game;
  head(d, 'Team sheet', [g ? [g.division, g.final || g.round].filter(Boolean).join('  ·  ') : dayLong(d.date), el('small', '', g ? [dayShort(d.date), clock(g.time), g.court].filter(Boolean).join('  ·  ') : '')]);
  if (!x || !g || x.error) return x?.error || 'No team sheet for this game.';
  if (![g.home, g.away].some(t => t.players.length)) return `PlayHQ has no line ups yet for ${g.home.name} or ${g.away.name} this season.`;
  const sheet = $('fit').appendChild(el('div', 'sheet'));
  for (const k of SIDES) {
    const t = g[k], col = sheet.appendChild(el('div'));
    const top = col.appendChild(el('div', 'sheet__team')); top.append(logoEl(t), el('div', 'game__team', t.name));
    for (const p of t.players.slice(0, 14)) col.append(bound('bound--sheet', el('div', 'sheet__pos', p.position || ''), el('div', 'shooter__name', p.name), pill(`${p.games} ${p.games === 1 ? 'game' : 'games'}`)));
    if (!t.players.length) col.append(el('div', 'form__none', 'No line ups yet'));
  }
}

// Score worm (?game=): the margin over the game from its goals, above the line while the home team led.
function drawWorm(d: NightPicture): Drawn {
  const st = storyHead(d, 'Score worm');
  if (!st || st.error) return st?.error || noStory;
  return wormChart(st.game, st.worm, st.complete);
}
// A game's worm drawn into the picture (Score worm, Comeback of the night); short: a lower chart, under other rows.
function wormChart(g: HomeAway<SocialTeam>, w: SocialWorm, complete: boolean | undefined, short?: boolean) {
  const pts = (w.segments || []).flat();
  if (!pts.length) return 'No goals were kept for this game.';
  const W = 940, H = short ? 380 : 520, X0 = 90, X1 = W - 10, Y0 = 20, Y1 = H - 50;
  const span = Math.max(1, w.periods || 4, w.end || 0);
  const top = Math.max(4, ...pts.map(p => Math.abs(p.margin)));
  const mid = (Y0 + Y1) / 2, x = (t: number) => X0 + (X1 - X0) * t / span, y = (m: number) => mid - (Y1 - Y0) / 2 * m / top;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = (tag: string, attrs: Record<string, string | number>, parent: Element) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v)); parent.append(e); return e; };
  const box = $('fit').appendChild(el('div', 'worm'));
  const chart = document.createElementNS(NS, 'svg'); chart.setAttribute('viewBox', `0 0 ${W} ${H}`); box.append(chart);
  const colour = (k: Side) => g[k].colour || (k === 'home' ? getComputedStyle(document.documentElement).getPropertyValue('--yellow') : getComputedStyle(document.documentElement).getPropertyValue('--pink')) || '#fff';
  const defs = svg('defs', {}, chart);
  const clip = (id: string, a: number, b: number) => { const c = svg('clipPath', { id }, defs); svg('rect', { x: 0, y: a, width: W, height: b - a }, c); };
  clip('above', 0, mid); clip('below', mid, H);
  for (let n = 1; n < span; n++) svg('line', { x1: x(n), x2: x(n), y1: Y0, y2: Y1, class: 'qline' }, chart);
  for (let n = 1; n <= span; n++) { const t = svg('text', { x: (x(n - 1) + x(n)) / 2, y: H - 8, class: 'axis', 'text-anchor': 'middle' }, chart); t.textContent = n > (w.regularPeriods || span) ? 'ET' : `${w.periodLabel || 'Q'}${n}`; }
  for (const m of [top, -top]) { const t = svg('text', { x: X0 - 14, y: y(m) + 8, class: 'axis', 'text-anchor': 'end' }, chart); t.textContent = `+${Math.abs(m)}`; }
  svg('line', { x1: X0, x2: X1, y1: mid, y2: mid, class: 'zero' }, chart);
  for (const seg of w.segments || []) {
    if (!seg.length) continue;
    const line = seg.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.margin).toFixed(1)}`).join(' ');
    const area = `${line} L${x(seg[seg.length - 1].t).toFixed(1)} ${mid} L${x(seg[0].t).toFixed(1)} ${mid} Z`;
    for (const [half, k] of [['above', 'home'], ['below', 'away']] as const) {
      const gEl = svg('g', { 'clip-path': `url(#${half})` }, chart);
      svg('path', { d: area, fill: colour(k), opacity: .35 }, gEl);
      svg('path', { d: line, class: 'line', stroke: colour(k) }, gEl);
    }
  }
  const key = $('fit').appendChild(el('div', 'info'));
  for (const k of SIDES) { const s = el('span'); s.append(el('b', '', g[k].name), ` ${k === 'home' ? 'above' : 'below'} the line`); key.append(s); }
  if (!complete) $('fit').append(el('div', 'later', 'Studio didn\'t see every goal of this game'));
}
// Runs of the night: every streamed game's longest run of goals (longest first), with each team's runs of 3 and 5.
const nightHead = (d: NightPicture, title: string): Partial<OfTheNight> => { head(d, title, [dayLong(d.date), el('small', '', d.venue)]); return d.ofNight || {}; };
const notStreamed = 'Studio keeps the goals of each game on its scoreboard: none of this night\'s finished games were streamed with it.';
function drawRuns(d: NightPicture): Drawn {
  const o = nightHead(d, 'Runs of the night');
  const runs = o.runs || [];
  if (!runs.length) return (d.stories || []).length ? 'No team scored two goals in a row this night.' : notStreamed;
  for (const r of runs.slice(0, 6)) {
    const g = r.game, t = g[r.longest.side];
    const counts = SIDES.map(k => `${g[k].name} ${r.runs3[k]}`).join('  ·  ');
    $('fit').append(bound('bound--team', logoEl(t), who(t.name, `v ${g[r.longest.side === 'home' ? 'away' : 'home'].name}  ·  runs of 3: ${counts}`), stat(r.longest.n, 'In a row', true)));
  }
}
// Super shot time: each streamed super shot game's points in the super shot period, quarter by quarter.
function drawSuperShotTime(d: NightPicture): Drawn {
  const o = nightHead(d, 'Super shot time');
  const supers = o.supers || [];
  if (!supers.length) return (d.stories || []).length ? 'None of this night\'s streamed games had their super shot period timed.' : notStreamed;
  for (const x of supers.slice(0, 3)) {
    const g = x.game;
    const group = $('fit').appendChild(el('div', 'group'));
    group.append(el('div', 'group__name', [g.division, g.final || g.round].filter(Boolean).join('  ·  ')));
    const t = group.appendChild(el('table', 'ladder story'));
    const hr = t.appendChild(el('tr'));
    for (const h of ['', 'Team', ...x.byPeriod.map(q => `${x.periodLabel}${q.n}`), 'Total']) hr.append(el('th', '', h));
    for (const k of SIDES) {
      const tr = t.appendChild(el('tr'));
      const logo = el('td'); logo.append(logoEl(g[k]));
      tr.append(logo, el('td', 'team', g[k].name), ...x.byPeriod.map(q => el('td', '', String(q[k]))), el('td', '', String(x.points[k])));
    }
  }
  $('fit').append(el('div', 'later', 'Points scored in the last minutes of each quarter'));
}
// Comeback of the night: the streamed game whose winner came back from furthest behind, with its worm.
function drawComeback(d: NightPicture): Drawn {
  const o = nightHead(d, 'Comeback of the night');
  const c = o.comeback;
  if (!c) return (d.stories || []).length ? 'No team came from behind to win this night.' : notStreamed;
  const g = c.game, t = g[c.side], other = g[c.side === 'home' ? 'away' : 'home'];
  $('fit').append(bound('bound--team', logoEl(t), who(t.name, `beat ${other.name} ${t.score}–${other.score}`), stat(c.down, 'Down by', true)));
  return wormChart(g, c.worm, c.complete, true);
}
// Watch it back (?link=): the replay's link as a QR code, with what was streamed that night.
function drawWatch(d: NightPicture): Drawn {
  head(d, 'Watch it back', [dayLong(d.date), el('small', '', d.stream ? [d.stream.court, d.venue].filter(Boolean).join('  ·  ') : d.venue)]);
  const x: Partial<NonNullable<NightPicture['watch']>> = d.watch || {};
  if (x.error) return x.error;
  const box = $('fit').appendChild(el('div', 'watch'));
  const qr = box.appendChild(el('div', 'watch__qr'));
  qr.innerHTML = x.qr || '';
  const right = box.appendChild(el('div', 'watch__games'));
  for (const s of (d.stream ? d.stream.slots : []).filter(s => s.home && s.away).slice(0, 4)) {
    right.append(bound('bound--line', el('div', 'game__team', `${s.home.name} v ${s.away.name}`), pill(clock(s.time))));
  }
  right.append(el('div', 'game__team', 'Scan to watch it back'), el('div', 'watch__link', x.shown));
}

function drawOnStream(d: NightPicture): Drawn {
  head(d, 'On the stream', [dayLong(d.date), el('small', '', d.stream ? [d.stream.court, d.venue].filter(Boolean).join('  ·  ') : '')]);
  if (!d.stream) return `No plan for ${dayLong(d.date)} yet: plan the court and commentators on the Production Planner tab.`;
  if (!d.stream.slots.length) return `No games on ${d.stream.court} that night.`;
  const live = $('fit').appendChild(el('div', 'live', 'Live stream'));
  live.hidden = false;
  for (const s of d.stream.slots) {
    const row = $('fit').appendChild(el('div', 'call'));
    const teams = el('div', 'call__teams');
    teams.append(logoEl(s.home), el('span', '', s.home.name), el('i', '', 'v'), el('span', 'away', s.away.name), logoEl(s.away));
    // The division, then who is calling it.
    const mic = el('div', 'call__mic');
    if (s.division) mic.append(el('span', 'call__div', s.division));
    if (s.people.length) { const who = el('span'); who.append('Calling it: ', ...s.people.flatMap((p, i) => [i ? ', ' : '', el('b', '', p.name)])); mic.append(who); }
    row.append(el('div', 'call__time', clock(s.time)), teams, mic);
  }
}

// The print sits in the middle, tilted, as big as the picture allows. Its window is the photo, or see-through:
// then the ground gets a mask with the same tilted hole, so the PNG is clear right through.
function drawPolaroid(d: NightPicture): Drawn {
  $('head').style.visibility = 'hidden'; // keeps its room, so the foot stays at the bottom
  // offsetTop, not getBoundingClientRect: it stays in the picture's own pixels when drawn smaller (?fit=1).
  const foot = $('foot');
  const top = 70, bottom = foot.offsetHeight ? H - foot.offsetTop + 40 : 70;
  const room = { w: W - 160, h: H - top - bottom };
  const edge = 34, chin = size === 'square' ? 170 : 210;
  // The photo window: square on a square picture, taller on the others.
  const aspect = size === 'square' ? 1 : size === 'portrait' ? 1.12 : 1.3;
  let pw = room.w - 2 * edge, ph = pw * aspect;
  const need = ph + edge + chin;
  if (need > room.h) { const s = (room.h - edge - chin) / ph; ph *= s; pw *= s; }
  const cx = W / 2, cy = top + room.h / 2, angle = -3.5;
  const frameH = ph + edge + chin, frameW = pw + 2 * edge;
  const p = document.body.appendChild(el('div', 'polaroid'));
  Object.assign(p.style, { '--edge': `${edge}px`, '--chin': `${chin}px`, width: `${frameW}px`, height: `${frameH}px`,
    left: `${cx - frameW / 2}px`, top: `${cy - frameH / 2}px`, transform: `rotate(${angle}deg)` });
  p.style.setProperty('--edge', `${edge}px`); p.style.setProperty('--chin', `${chin}px`);
  // The caption scales with the print, so a smaller print (room for the sponsor strip) keeps it on two lines.
  p.style.setProperty('--cap', `${Math.round(Math.min(60, pw / 13))}px`);
  const photo = params.get('photo');
  const athlete = !photo && d.picked.athlete;
  if (photo || athlete) {
    const box = p.appendChild(el('div', 'polaroid__photo'));
    const img = box.appendChild(el('img'));
    const px = Math.max(0, Math.min(100, Number(params.get('px') ?? 50))), py = Math.max(0, Math.min(100, Number(params.get('py') ?? 50)));
    const zoom = Math.max(1, Math.min(3, Number(params.get('zoom')) || 1));
    img.style.objectPosition = `${px}% ${py}%`;
    p.style.setProperty('--px', `${px}%`); p.style.setProperty('--py', `${py}%`);
    img.style.transform = `scale(${zoom})`;
    img.src = athlete ? athlete.photo : `/socials/photos/${encodeURIComponent(photo || '')}`;
    img.alt = '';
  } else {
    // The window's corners, tilted round the print's centre, cut out of the ground.
    const rad = angle * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
    const fx = cx - frameW / 2, fy = cy - frameH / 2;
    const corners = [[fx + edge, fy + edge], [fx + edge + pw, fy + edge], [fx + edge + pw, fy + edge + ph], [fx + edge, fy + edge + ph]]
      .map(([x, y]) => [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos].map(n => n.toFixed(1)).join(','));
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}'><path fill='black' fill-rule='evenodd' d='M0,0H${W}V${H}H0Z M${corners.join(' L')} Z'/></svg>`;
    const mask = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    for (const k of ['maskImage', 'webkitMaskImage'] as const) $('ground').style[k] = mask;
    $('ground').style.maskSize = $('ground').style.webkitMaskSize = `${W}px ${H}px`;
  }
  p.append(el('div', 'tape'));
  // A finished game's polaroid says the score: "Blizzardz win 31-26", then who they beat and when.
  const g = params.get('game') && d.games.find(x => x.id === params.get('game'));
  let caption = 'Game night', note = [dayShort(d.date), d.venue].filter(Boolean).join('  ·  ');
  if (g && g.finished) {
    const [w, l] = g.winner === 'away' ? [g.away, g.home] : [g.home, g.away];
    caption = g.winner === 'draw' ? `Draw ${g.home.score}–${g.away.score}` : `${w.name} win ${w.score}–${l.score}`;
    note = [g.winner === 'draw' ? `${g.home.name} v ${g.away.name}` : `v ${l.name}`, g.division, g.round, dayShort(d.date)].filter(Boolean).join('  ·  ');
  }
  const cap = p.appendChild(el('div', 'polaroid__caption'));
  const b = el('b', '', params.get('caption') || caption);
  const small = el('span', '', params.get('note') || note);
  cap.append(b, small);
  // A long team name shrinks each line to fit the print's chin (the second line also carries the division and round).
  for (let px = parseFloat(p.style.getPropertyValue('--cap')); b.scrollWidth > cap.clientWidth - 60 && px > 20; px -= 2) b.style.fontSize = `${px}px`;
  for (let px = parseFloat(p.style.getPropertyValue('--cap')) * .45; small.scrollWidth > cap.clientWidth - 60 && px > 12; px -= 1) small.style.fontSize = `${px}px`;
}

const score = (t: { score?: number | null }, won: boolean | null | undefined | '') => el('div', `score${won ? ' won' : ''}`, String(t.score));

// A finished game's row: both logos and names, the scores between them, the winner in the highlight colour.
function resultRow(g: HomeAway<SocialTeam> & { winner: string | null }) {
  const row = el('div', 'result');
  row.append(logoEl(g.home), el('div', `game__team${g.winner === 'home' ? ' won' : ''}`, g.home.name), score(g.home, g.winner === 'home'),
    score(g.away, g.winner === 'away'), el('div', `game__team away${g.winner === 'away' ? ' won' : ''}`, g.away.name), logoEl(g.away));
  return row;
}
const noResults = (d: NightPicture) => d.games.length ? `No results for ${dayLong(d.date)} yet: they show once PlayHQ has each final score.` : `No games on ${dayLong(d.date)}.`;

function drawResults(d: NightPicture): Drawn {
  head(d, 'Results', [dayLong(d.date), el('small', '', d.venue)]);
  const done = d.games.filter(g => g.finished);
  if (!done.length) return noResults(d);
  for (const div of [...new Set(done.map(g => g.division))]) {
    const group = $('fit').appendChild(el('div', 'group'));
    if (div) group.append(el('div', 'group__name', div));
    for (const g of done.filter(x => x.division === div)) {
      if (g.final) group.append(el('div', 'result__final', g.final)); // a finals night: which final
      group.append(resultRow(g));
    }
  }
  const left = d.games.length - done.length;
  if (left) $('fit').append(el('div', 'later', `${left} more game${left === 1 ? '' : 's'} still to finish`));
}

// Round in review: the night's biggest win, closest game and upsets (a winner that stood well below its opponent on
// the ladder before the night), each a result row with what made it one under it.
function drawReview(d: NightPicture): Drawn {
  const rounds = [...new Set(d.games.map(g => g.round).filter(Boolean))];
  head(d, rounds.length === 1 ? 'Round in review' : 'Night in review', [rounds.length === 1 ? rounds[0] : dayLong(d.date), el('small', '', rounds.length === 1 ? dayShort(d.date) : d.venue)]);
  const r: NonNullable<NightPicture['review']> = d.review || {};
  const game = (id: string) => d.games.find(g => g.id === id);
  const by = (g: SocialGame | undefined) => { if (!g) return ''; const m = Math.abs((g.home.score ?? 0) - (g.away.score ?? 0)); return g.winner === 'draw' ? 'A draw' : `${(g.winner === 'home' ? g.home : g.away).name} by ${m}`; };
  // Each game once: an upset that was also the biggest win says both.
  const picks = new Map<string, { g: SocialGame; labels: string[]; notes: string[] }>();
  const add = (id: string, label: string, note: string) => { const g = game(id); if (!g) return; const p = picks.get(id) || { g, labels: [], notes: [] }; picks.set(id, p); p.labels.push(label); p.notes.push(note); };
  for (const u of r.upsets || []) add(u.id, 'Upset', `${nth(u.winnerWas)} beat ${nth(u.loserWas)}`);
  if (r.biggest) add(r.biggest, 'Biggest win', by(game(r.biggest)));
  if (r.closest) add(r.closest, 'Closest game', by(game(r.closest)));
  if (!picks.size) return noResults(d);
  for (const { g, labels, notes } of picks.values()) {
    const group = $('fit').appendChild(el('div', 'group review'));
    group.append(el('div', 'group__name', labels.join('  ·  ')), resultRow(g), el('div', 'later review__note', [...notes, g.division].filter(Boolean).join('  ·  ')));
  }
}

function drawFulltime(d: NightPicture): Drawn {
  const g = d.games.find(x => x.id === params.get('game')) || d.games.find(x => x.finished);
  if (!g || !g.finished) { head(d, 'Full time', [dayLong(d.date)]); return g ? `No result for ${g.home.name} v ${g.away.name} yet.` : `No results for ${dayLong(d.date)} yet.`; }
  head(d, 'Full time', [[g.division, g.final || g.round].filter(Boolean).join('  ·  ')]);
  const vs = $('fit').appendChild(el('div', 'vs'));
  const side = (t: SocialTeam, which: Side) => {
    const s = el('div', g.winner !== 'draw' && g.winner !== which ? 'lost' : '');
    s.append(...picture(t, d.picked[which]), el('h2', '', t.name), ...athleteName(d.picked[which]), el('div', `vs__score${g.winner === which || g.winner === 'draw' ? ' won' : ''}`, String(t.score)));
    return s;
  };
  vs.append(side(g.home, 'home'), el('div', 'vs__v', 'FT'), side(g.away, 'away'));
  const [w, l] = g.winner === 'away' ? [g.away, g.home] : [g.home, g.away];
  $('fit').append(el('div', 'verdict', g.winner === 'draw' ? 'A draw' : `${w.name} by ${(w.score ?? 0) - (l.score ?? 0)}`));
  const info = $('fit').appendChild(el('div', 'info'));
  info.append(el('span', '', dayShort(d.date)), ...(g.court ? [el('span', '', g.court)] : []), ...(g.venue || d.venue ? [el('span', '', g.venue || d.venue)] : []));
}

function drawLadder(d: NightPicture): Drawn {
  const l = (d.ladders || []).find(x => x.division === params.get('division')) || (d.ladders || [])[0];
  if (!l) { head(d, 'Ladder', [dayLong(d.date)]); return `No games on ${dayLong(d.date)}.`; }
  // What it's after: this night's round, or (before this night's results, or on an older night) the division's latest
  // night with results, by its round or else its date.
  const asAt = l.after ? `After ${l.after}` : l.asAt ? (l.asAt.round ? `After ${l.asAt.round}` : `As at ${dayShort(l.asAt.date)}`) : 'Before the first round';
  head(d, 'Ladder', [l.division, el('small', '', asAt)]);
  if (!l.rows.length) return l.error ? `No ladder from PlayHQ: ${l.error}` : `No ladder for ${l.division} yet.`;
  const drawn = l.rows.some(r => r.drawn);
  // With movers on, each team's move since before the night beside its place (the division's latest night only).
  const movers = flag('movers', d.settings.movers) && !!l.movers;
  const t = $('fit').appendChild(el('table', `ladder${movers ? ' movers' : ''}`));
  const hr = t.appendChild(el('tr'));
  for (const h of ['', ...(movers ? [''] : []), 'Team', 'P', 'W', 'L', ...(drawn ? ['D'] : []), '%', 'Pts']) hr.append(el('th', '', h));
  for (const r of l.rows) {
    const tr = t.appendChild(el('tr', l.finalsPlaces && r.position === l.finalsPlaces && l.rows.length > l.finalsPlaces ? 'cut' : ''));
    const team = el('td', 'team'), inner = team.appendChild(el('div'));
    inner.append(logoEl({ name: r.team, logo: r.logo }), el('span', '', r.team));
    const pct = r.percentage === null || r.percentage === undefined ? '' : Number(r.percentage).toFixed(1);
    const move = () => { const m = r.moved > 0 ? ['up', `▲${r.moved}`] : r.moved < 0 ? ['down', `▼${-r.moved}`] : ['same', '–']; const c = el('td', 'mv'); c.append(el('span', `move move--${m[0]}`, m[1])); return c; };
    tr.append(el('td', '', String(r.position)), ...(movers ? [move()] : []), team, ...[r.played, r.won, r.lost, ...(drawn ? [r.drawn] : [])].map(v => el('td', '', String(v ?? 0))),
      el('td', 'pct', pct), el('td', '', String(r.points ?? 0)));
  }
  if (l.finalsPlaces && l.rows.length > l.finalsPlaces) { const k = $('fit').appendChild(el('div', 'key')); k.append(el('i'), `Top ${l.finalsPlaces} play finals`); }
}

function drawTopShooters(d: NightPicture): Drawn {
  // One division's (?division=, a picture per division on the Socials tab), or the whole night's without it.
  const division = params.get('division');
  head(d, 'Top shooters', division ? [division, el('small', '', dayLong(d.date))] : [dayLong(d.date), el('small', '', d.venue)]);
  const s: NonNullable<NightPicture['shooters']> = d.shooters || { players: [] };
  if (!s.gamesFinished) return `No results${division ? ` in ${division}` : ''} for ${dayLong(d.date)} yet: the top shooters show once games are finished.`;
  if (!s.players.length) return s.error ? `Couldn't read the games' line ups from PlayHQ: ${s.error}` : 'No shooting recorded in that night\'s games.';
  for (const [i, p] of s.players.entries()) {
    const row = $('fit').appendChild(el('div', 'shooter'));
    const who = el('div');
    who.append(el('div', 'shooter__name', p.name), el('div', 'shooter__team', p.team));
    const stats = el('div', 'shooter__stats');
    const stat = (v: number, label: string, main?: boolean) => { const x = el('div', `stat${main ? ' main' : ''}`); x.append(el('b', '', String(v)), el('small', '', label)); return x; };
    if (s.superShots) stats.append(stat(p.goals, 'Goals'), stat(p.superGoals, 'Super'), stat(p.points, 'Points', true));
    else stats.append(stat(p.goals, 'Goals', true));
    row.append(el('div', 'shooter__rank', String(i + 1)), p.photo ? face(p) : logoEl({ name: p.team, logo: p.logo }), who, stats);
  }
}

// A division's top shooters over the whole tournament or season so far (?division=; Tournament or Season top shooters,
// d.running), after this night's latest round, or after a round earlier that night (?after=HH:MM, its games' start).
// With movers on, each shows the places they climbed or fell since the round before.
function drawTournament(d: NightPicture): Drawn {
  const t: NonNullable<NightPicture['tournament']> = d.tournament || { players: [] };
  // After the latest round counted; with no round, after the games picked (they're finished, so "after", not "as at").
  const asAt = t.round ? `after ${t.round}` : t.after ? `after the ${clock(t.after)} games  ·  ${dayShort(d.date)}` : `after ${dayShort(d.date)}`;
  head(d, `${d.running || 'Season'} top shooters`, [t.division || '', el('small', '', asAt)]);
  if (!t.division) return `Pick a division: there is a ${d.running || 'Season'} top shooters picture for each one on the Socials tab.`;
  if (!t.gamesFinished) return `No results in ${t.division} yet: the top shooters show once games are finished.`;
  if (!t.players.length) return t.error ? `Couldn't read the games' line ups from PlayHQ: ${t.error}` : `No shooting recorded in ${t.division} yet.`;
  const movers = flag('movers', d.settings.movers) && !!t.compared;
  $('fit').classList.toggle('movers', movers);
  for (const [i, p] of t.players.entries()) {
    const row = $('fit').appendChild(el('div', 'shooter'));
    const rank = el('div', 'shooter__rank');
    rank.append(el('span', '', String(i + 1)));
    if (movers) {
      const moved = p.moved || 0, m = p.fresh ? ['new', 'NEW'] : moved > 0 ? ['up', `▲${moved}`] : moved < 0 ? ['down', `▼${-moved}`] : ['same', '–'];
      rank.append(el('small', `move move--${m[0]}`, m[1]));
      if (p.fresh || moved > 0) row.classList.add('shooter--climbed');
    }
    const who = el('div');
    who.append(el('div', 'shooter__name', p.name), el('div', 'shooter__team', p.team));
    const stats = el('div', 'shooter__stats');
    const stat = (v: number, label: string, main?: boolean) => { const x = el('div', `stat${main ? ' main' : ''}`); x.append(el('b', '', String(v)), el('small', '', label)); return x; };
    stats.append(stat(p.games, 'Games'));
    if (t.superShots) stats.append(stat(p.goals, 'Goals'), stat(p.superGoals, 'Super'), stat(p.points, 'Points', true));
    else stats.append(stat(p.goals, 'Goals', true));
    row.append(rank, p.photo ? face(p) : logoEl({ name: p.team, logo: p.logo }), who, stats);
  }
}

// Finals bound (?division=): the teams in the division's finals, in ladder order, each with what their place earned
// (Double chance, Week off, Elimination final), as it stands until the last home and away round is finished.
function drawFinalsBound(d: NightPicture): Drawn {
  const f: Partial<NonNullable<NightPicture['finalsDraw']>> = d.finalsDraw || {};
  head(d, 'Finals bound', [f.division || '']);
  if (f.error) return f.error;
  if (!f.ladder || !f.ladder.length) return `No ladder for ${f.division} yet.`;
  const words = Object.fromEntries((f.legend || []).map(x => [x.mark, x.label]));
  if (f.projected) $('fit').append(el('div', 'tag', 'As it stands'));
  for (const r of f.ladder) {
    const row = $('fit').appendChild(el('div', 'bound'));
    row.append(el('div', 'shooter__rank', String(r.position)), logoEl({ name: r.team, logo: r.logo }), el('div', 'game__team', r.team),
      el('div', `bound__earned bound__earned--${r.mark}`, words[r.mark] || ''));
  }
}

// Finals draw (?division=): the division's finals week by week, each game with its name, when and where once PlayHQ has
// it, the teams (or who they will be: "Winner major semi final"), and the score and winner once played.
function drawFinalsDraw(d: NightPicture): Drawn {
  const f: Partial<NonNullable<NightPicture['finalsDraw']>> = d.finalsDraw || {};
  head(d, 'Finals', [f.division || '']);
  if (f.error) return f.error;
  if (f.projected) $('fit').append(el('div', 'tag', 'If the season ended today'));
  const games = (f.games || []).filter(g => !g.notNeeded);
  for (const week of [...new Set(games.map(g => g.weekName))]) {
    const group = $('fit').appendChild(el('div', 'group'));
    group.append(el('div', 'group__name', week));
    for (const g of games.filter(x => x.weekName === week)) {
      const box = group.appendChild(el('div', `final${g.id === 'GF' ? ' final--gf' : ''}`));
      const when = [g.date ? dayShort(g.date) : '', g.time ? clock(g.time) : '', g.court || ''].filter(Boolean).join('  ·  ');
      // The game's name over it, unless it's the week's own (Grand final) and there's no when yet.
      if (g.name !== week || when) {
        const name = box.appendChild(el('div', 'final__name'));
        name.append(el('span', '', g.name !== week ? g.name : ''), el('span', '', when));
      }
      // A team not known yet says who it will be ("Winner minor semi final"), smaller, over two lines if need be.
      const side = (t: FinalSide, cls: string) => t.name ? el('div', `game__team${cls}${g.winner && g.winner === t.name ? ' won' : ''}`, t.name) : el('div', `game__team final__tbc${cls}`, t.placeholder || 'TBC');
      const sc = (t: FinalSide) => t.score === null || t.score === undefined ? el('div', 'score none', '\u00a0') : score(t, g.winner && g.winner === t.name);
      const row = box.appendChild(el('div', 'result'));
      row.append(logoEl({ name: g.home.name || '?', logo: g.home.logo }), side(g.home, ''), sc(g.home), sc(g.away), side(g.away, ' away'),
        logoEl({ name: g.away.name || '?', logo: g.away.logo }));
    }
  }
}

// Champions (?division=): the division's finals winners (the grand final's, or two wins in a best of three), called
// Champions or Premiers as set up, with their logo lit in their colour and the deciding game's score under them.
function drawChampions(d: NightPicture): Drawn {
  const f: Partial<NonNullable<NightPicture['finalsDraw']>> = d.finalsDraw || {};
  const word = d.winners || 'Champions';
  head(d, word, [f.division || '', el('small', '', f.season || '')]);
  if (f.error) return f.error;
  const c = f.champion;
  if (!c) return `${f.division} has no ${word.toLowerCase()} yet: they show once the grand final has a winner, from PlayHQ or picked on Scoreboard control.`;
  const box = $('fit').appendChild(el('div', 'champ'));
  if (c.colour) box.style.setProperty('--team', c.colour);
  const logo = box.appendChild(el('div', 'champ__logo'));
  logo.append(logoEl(c));
  const name = el('h2', 'champ__name', c.name);
  // The name in the title's colour, so it reads on a pale ground too (unless the title is a gradient or see-through).
  const tc = getComputedStyle($('title')).color;
  if (!/rgba\(.*,\s*0\)$|transparent/.test(tc)) name.style.color = tc;
  box.append(name, el('div', 'champ__what', `${f.division} ${word.toLowerCase()}`));
  // The game that decided it: the grand final, or the series' last game played.
  const played = (f.games || []).filter(g => g.winner && !g.notNeeded);
  const last = f.format && f.format.series ? played[played.length - 1] : played.find(g => g.id === 'GF');
  if (!last) return;
  const fin = box.appendChild(el('div', 'champ__final'));
  if (f.format && f.format.series) {
    const won = played.filter(g => g.winner === c.name).length;
    fin.append(el('div', 'final__name', `Won the series ${won}–${played.length - won}  ·  ${last.name}`));
  } else fin.append(el('div', 'final__name', [last.name, last.date ? dayShort(last.date) : ''].filter(Boolean).join('  ·  ')));
  const row = fin.appendChild(el('div', 'result'));
  const known = (t: FinalSide) => t.score !== null && t.score !== undefined;
  const sc = (t: FinalSide) => known(t) ? score(t, last.winner === t.name) : el('div', 'score none', '\u00a0');
  row.append(logoEl(last.home), el('div', `game__team${last.winner === last.home.name ? ' won' : ''}`, last.home.name), sc(last.home), sc(last.away),
    el('div', `game__team away${last.winner === last.away.name ? ' won' : ''}`, last.away.name), logoEl(last.away));
}

function foot(d: NightPicture) {
  const sponsor = flag('sponsor', d.settings.sponsor[kind]);
  if (sponsor && d.sponsors.length) {
    const s = $('sponsors');
    s.append(el('small', '', 'Proudly supported by'));
    for (const x of d.sponsors.slice(0, 4)) {
      if (x.logo) { const img = el('img'); img.src = x.logo; img.alt = x.name; s.append(img); } else s.append(el('span', '', x.name));
    }
    s.hidden = false;
  }
  $('mark').hidden = !flag('mark', d.settings.mark);
  $('pivt').hidden = !flag('pivt', d.settings.pivt);
  // Its place in a carousel (?page=2/6).
  const pg = /^(\d{1,2})\/(\d{1,2})$/.exec(params.get('page') || '');
  if (pg && +pg[1] >= 1 && +pg[1] <= +pg[2]) {
    $('page').replaceChildren(...(+pg[1] === 1 && +pg[2] > 1 ? [el('span', '', 'Swipe')] : []), el('span', '', `${pg[1]}/${pg[2]}`), ...(+pg[1] < +pg[2] ? [el('b', '', '›')] : []));
    $('page').hidden = false;
  }
}

const loadCss = (href: string) => new Promise<void>((ok, fail) => {
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = href; l.onload = () => ok(); l.onerror = () => fail(new Error(`${href} didn't load`));
  document.head.append(l);
});

// Resolves once every picture on the page has loaded and decoded (or failed), so a saved PNG never misses a logo.
const imagesLoaded = () => Promise.all([...document.images].filter(i => !i.hidden && i.src).map(i => i.decode().catch(() => null)));

window.socialReady = (async () => {
  try {
    if (document.fonts) await document.fonts.ready;
    // The night as this kind of picture needs it: the server picks what to read from the link (socials.ts NEEDS).
    const q = new URLSearchParams(params);
    q.set('kind', kind);
    const d = await (await fetch(`/api/socials/night?${q}`, { cache: 'no-store' })).json();
    if (d.error) throw new Error(d.error);
    // The colour set: theme.css's colours worked out for it (none for the competition's own). A pale ground takes
    // the dark-ink Studio mark.
    for (const [k, v] of Object.entries<string>(d.look.vars || {})) document.documentElement.style.setProperty(k, v);
    // The template set: a class on the body (social-templates.css) and its display face. A template with its own
    // ground picks its own mark.
    const t = d.look.template || {};
    if (t.id && t.id !== 'default') document.body.classList.add(`t-${t.id}`);
    const face = (css: string | undefined, font: string | undefined) => css ? loadCss(css).then(() => document.fonts && document.fonts.load(`700 80px "${font}"`)).catch(() => null) : null;
    const fontLoaded = Promise.all([face(t.fontCss, t.font), face(t.scriptCss, t.script)]);
    const markLight = t.mark ? t.mark === 'light' : d.look.light;
    if (markLight) $<HTMLImageElement>('mark').src = 'studio/firstpass-studio-light.svg';
    foot(d);
    const missing = { fixtures: drawFixtures, matchup: drawMatchup, onstream: drawOnStream, commentators: drawCommentators, polaroid: drawPolaroid,
      story: drawStory, worm: drawWorm, watch: drawWatch, moments: drawMoments, gamestats: drawGameStats, shooting: drawShooting, h2h: drawH2H, teamsheet: drawTeamSheet, runs: drawRuns, supershottime: drawSuperShotTime, comeback: drawComeback, potm: drawPotm, teamround: drawTeamRound, spotlight: drawSpotlight, sponsorspot: drawSponsorSpot, thanks: drawThanks,
      accuracy: drawAccuracy, supershots: drawSuperShots, teamsupers: drawTeamSupers, onfire: drawOnFire, numbers: drawNumbers, club: drawClub, streaks: drawStreaks,
      season: drawSeason, wrap: drawWrap, form: drawForm, preview: drawPreview, byes: drawByes, milestones: drawMilestones,
      race: drawRace, countdown: drawCountdown, draw: drawDraw, results: drawResults, review: drawReview, fulltime: drawFulltime, ladder: drawLadder, topshooters: drawTopShooters, tournament: drawTournament,
      finalsbound: drawFinalsBound, finalsdraw: drawFinalsDraw, champions: drawChampions }[kind](d);
    if (missing) $('fit').append(el('p', 'message', missing));
    await imagesLoaded();
    await fontLoaded;
    if (document.fonts) await document.fonts.ready;
    if (kind !== 'polaroid') { fitTitle(); fitNames(); fitCrew(); fit(); }
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    window.pageLog && window.pageLog('info', `Social picture: ${kind} ${size} for ${d.date}${missing ? ` (${missing})` : ''}`);
    return missing || true;
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    console.warn('Social picture unavailable:', why);
    $('fit').append(el('p', 'message', `Social picture: ${why}`));
    return why;
  }
})();

// What makes this file a module (its names its own), as the first line says.
export {};
