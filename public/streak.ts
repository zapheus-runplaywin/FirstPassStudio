// FirstPass Studio - the streaks and game moments' script (streak.html loads it as a module, so its names stay its own).

type Side = 'home' | 'away';
type Kind = 'heating' | 'fire' | 'goalForGoal' | 'lead' | 'level' | 'comeback' | 'siren' | 'backToBack';
// A streak or moment, as the scoreboard reports it (board.ts) or ?play= asks for one.
interface Streak {
  kind: Kind; n?: number; at?: number; side?: Side | ''; from?: Side; goals?: number; down?: number;
  score?: Record<Side, number>; period?: number; periodLabel?: string; clockLeft?: number;
}
type Board = ScoreboardView & { streak?: Streak & { n: number }; streakLog?: (Streak & { n: number })[] };
// A particle: where it is, how it moves, how long it lives, and the colours it goes through (a ramp, hottest first).
interface Particle {
  x: number; y: number; vx: number; vy: number; ay: number; drag?: number; life: number; size: number; shrink?: boolean;
  ramp: string[]; wobble?: number; age?: number; phase?: number;
}
interface Emitter { from: number; to: number; rate: number; make: () => Particle }
const opts = new URLSearchParams(location.search);
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const stage = $('stage');
const KINDS: Record<Kind, string> = { heating: 'k-heating', fire: 'k-fire', goalForGoal: 'k-gfg', lead: 'k-moment m-lead', level: 'k-moment m-level', comeback: 'k-moment m-comeback',
  siren: 'k-moment m-siren', backToBack: 'k-moment m-b2b' };
const NAMES: Record<Kind, string> = { heating: 'heating up', fire: 'on fire', goalForGoal: 'goal for goal', lead: 'hits the front', level: 'all square', comeback: 'coming back',
  siren: 'on the siren', backToBack: 'back to back super shots' };
const GOALS: Partial<Record<Kind, number>> = { heating: 3, fire: 5, goalForGoal: 10 };
// The big words for each moment, and the little word after the team's name on the plate.
const WORDS: Partial<Record<Kind, [string, string]>> = { lead: ['HITS THE FRONT', ''], comeback: ['COMING BACK', 'is'], siren: ['ON THE SIREN!', ''], backToBack: ['BACK TO BACK', ''], level: ['ALL SQUARE', ''] };
const KIND_WORDS: Record<string, Kind> = { heating: 'heating', heatingup: 'heating', fire: 'fire', onfire: 'fire', goalforgoal: 'goalForGoal', lead: 'lead', front: 'lead',
  level: 'level', square: 'level', allsquare: 'level', comeback: 'comeback', siren: 'siren', backtoback: 'backToBack' };
const kindOf = (v: string | null): Kind | undefined => KIND_WORDS[String(v || '').toLowerCase().replace(/[^a-z]/g, '')];
const ALL_CLASSES = [...new Set(Object.values(KINDS).join(' ').split(' '))];

// A club colour from the competition setup page, as on supershot.html; without one, the competition's main colour (home) or accent (away).
function colourOf(hex: string | null | undefined, fallbackVar: string) {
  const rgb = hex && /^#[0-9a-f]{6}$/i.test(hex) ? [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) : (css(fallbackVar) || '127, 64, 146').split(',').map(Number);
  const lum = rgb.map(c => c / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const light = 0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2] > 0.4;
  return { rgb: rgb.join(', '), dark: rgb.map(c => Math.round(c * .5)).join(', '), text: light ? '#111111' : '#ffffff', list: rgb };
}
const sideColour = (s: Board | null, side: Side) => colourOf(s && s.teamColours && s.teamColours[side], side === 'away' ? '--pink-rgb' : '--purple-rgb');
function fit(node: HTMLElement, max: number, size: number, min: number) {
  node.style.fontSize = size + 'px';
  while (node.scrollWidth > max && size > min) node.style.fontSize = (size -= 2) + 'px';
}
// The big words, a span per letter, each coming in a little after the one before.
function letters(box: HTMLElement, text: string, step: number, start: number) {
  box.replaceChildren();
  [...text].forEach((ch, i) => {
    const span = document.createElement('span');
    span.className = ch === ' ' ? 'sp' : 'l';
    if (ch !== ' ') span.innerHTML = `<span class="o">${ch}</span><span class="f">${ch}</span>`;
    span.style.setProperty('--d', (start + i * step).toFixed(3) + 's');
    box.appendChild(span);
  });
}
function pips(box: HTMLElement, n: number, start: number) {
  box.replaceChildren();
  for (let i = 0; i < n; i++) {
    const p = document.createElement('span');
    p.className = 'pip';
    p.style.setProperty('--d', (start + i * .12).toFixed(2) + 's');
    box.appendChild(p);
  }
}
// A moment's words, the line under them, and its touches (chevrons, netballs).
const scoreOf = (ev: Streak, s: Board | null) => ev.score || { home: s && s.home ? Number(s.home.score) || 0 : 0, away: s && s.away ? Number(s.away.score) || 0 : 0 };
function momentWords(ev: Streak, s: Board | null) {
  const [words, after] = WORDS[ev.kind] || ['', ''];
  $('nameAfter').textContent = after;
  letters($('momWords'), words, .04, .2);
  fitLetters($('momWords'), ev.kind === 'level' ? 1240 : 1560, 180, 90); // level: room for both crests either side
  const sc = scoreOf(ev, s), row = $('momRow');
  const scoreBox = () => { const b = document.createElement('span'); b.className = 'score'; b.innerHTML = `${sc.home} <b>–</b> ${sc.away}`; return b; };
  const text = (t: string) => { const b = document.createElement('span'); b.textContent = t; return b; };
  if (ev.kind === 'lead' || ev.kind === 'level') row.replaceChildren(scoreBox());
  else if (ev.kind === 'comeback') row.replaceChildren(text(`from ${Math.max(5, Number(ev.down) || 5)} down`), scoreBox());
  else if (ev.kind === 'siren') {
    const q = ev.period ? (ev.period > 4 ? 'Extra time' : `${ev.periodLabel || (s && s.periodLabel) || 'Q'}${ev.period}`) : '';
    const left = Number(ev.clockLeft);
    row.replaceChildren(...q ? [text(q)] : [], text(Number.isFinite(left) && left > 0 ? `${left} second${left === 1 ? '' : 's'} to go` : 'at the siren'), scoreBox());
  } else if (ev.kind === 'backToBack') {
    const balls = [0, 1].map(i => { const b = document.createElement('span'); b.className = 'mball'; b.style.setProperty('--d', (1.1 + i * .3) + 's'); b.innerHTML = $('ballSvg').innerHTML; return b; });
    row.replaceChildren(text('Super shots'), ...balls);
  } else row.replaceChildren();
  const box = $('chevrons');
  box.replaceChildren(...Array.from({ length: 7 }, (_, i) => {
    const c = document.createElement('span');
    c.className = 'chev';
    c.style.setProperty('--x', (300 + i * 210) + 'px');
    c.style.setProperty('--y', (40 + (i * 83) % 460) + 'px');
    c.style.setProperty('--d', (.15 + (i * .37) % .6).toFixed(2) + 's');
    return c;
  }));
}
// Shrinks letters() words to fit a width (layout sizes, so the stage's own scaling doesn't count).
function fitLetters(box: HTMLElement, max: number, size: number, min: number) {
  const ls = box.querySelectorAll<HTMLElement>('.l, .sp');
  const width = () => ls.length ? ls[ls.length - 1].offsetLeft + ls[ls.length - 1].offsetWidth - ls[0].offsetLeft : 0;
  box.style.fontSize = size + 'px';
  while (width() > max && size > min) box.style.fontSize = (size -= 4) + 'px';
}
const waitFor = (node: HTMLElement) => node instanceof HTMLImageElement ? Promise.race([node.decode().catch(() => {}), new Promise(r => setTimeout(r, 1500))]) : null;

// Dresses the stage for one streak: the team (heating up, on fire) or both teams (goal for goal).
async function dress(s: Board | null, ev: Streak) {
  ['--team-rgb', '--side-dark', '--side-text', '--home-rgb', '--away-rgb'].forEach(v => stage.style.removeProperty(v));
  stage.classList.remove(...ALL_CLASSES);
  stage.classList.add(...KINDS[ev.kind].split(' '));
  $('nameAfter').textContent = 'is';
  const waits: (Promise<unknown> | null)[] = [];
  let who = '';
  if (ev.kind === 'goalForGoal') {
    const h = sideColour(s, 'home'), a = sideColour(s, 'away');
    stage.style.setProperty('--home-rgb', h.rgb);
    stage.style.setProperty('--away-rgb', a.rgb);
    for (const [side, box] of [['home', 'crestH'], ['away', 'crestA']] as const) {
      const t = s && s[side];
      const node = logoEl({ name: t ? t.name : side === 'home' ? 'Home' : 'Away', logo: s && s.logos && s.logos[side] }, 'logo');
      $(box).replaceChildren(node);
      waits.push(waitFor(node));
    }
    const least = GOALS.goalForGoal || 10;
    const n = Math.max(least, Math.min(14, Number(ev.goals) || least));
    const first = ev.from === 'away' ? 1 : 0;
    $('dots').replaceChildren(...Array.from({ length: n }, (_, i) => {
      const d = document.createElement('span');
      d.className = 'dot';
      d.style.setProperty('--c', (i + first) % 2 ? a.rgb : h.rgb);
      d.style.setProperty('--d', (1 + i * .07).toFixed(2) + 's');
      return d;
    }));
    $('team').style.display = 'none';
    who = s ? `${s.home.name} v ${s.away.name}` : '';
  } else if (ev.kind === 'level') {
    const h = sideColour(s, 'home'), a = sideColour(s, 'away');
    stage.style.setProperty('--home-rgb', h.rgb);
    stage.style.setProperty('--away-rgb', a.rgb);
    for (const [side, box] of [['home', 'mcrestH'], ['away', 'mcrestA']] as const) {
      const t = s && s[side];
      const node = logoEl({ name: t ? t.name : side === 'home' ? 'Home' : 'Away', logo: s && s.logos && s.logos[side] }, 'logo');
      $(box).replaceChildren(node);
      waits.push(waitFor(node));
    }
    $('team').style.display = 'none';
    momentWords(ev, s);
    who = s ? `${s.home.name} v ${s.away.name}` : '';
  } else {
    const side = ev.side === 'away' ? 'away' : 'home';
    const t = s ? s[side] : null;
    const c = sideColour(s, side);
    stage.style.setProperty('--team-rgb', c.rgb);
    stage.style.setProperty('--side-dark', c.dark);
    stage.style.setProperty('--side-text', c.text);
    $('team').style.display = t && t.name ? '' : 'none';
    if (s && t && t.name) {
      $('name').textContent = t.name;
      fit($('name').parentElement as HTMLElement, 1000, 76, 34);
      const node = logoEl({ name: t.name, logo: s.logos && s.logos[side] }, 'logo');
      $('crest').replaceChildren(node);
      waits.push(waitFor(node));
      who = `${t.name} (${side})`;
    }
    if (WORDS[ev.kind]) momentWords(ev, s);
    const n = Math.max(GOALS[ev.kind] || 0, Math.min(9, Number(ev.goals) || GOALS[ev.kind] || 0));
    if (WORDS[ev.kind]) { /* done above */ }
    else if (ev.kind === 'heating') { letters($('heatWords'), 'HEATING UP', .045, .25); pips($('heatPips'), n, .9); $('heatCount').textContent = `${n} in a row`; }
    else { letters($('fireWords'), 'ON FIRE', 0, 0); pips($('firePips'), n, .9); $('fireCount').textContent = `${n} in a row`; }
  }
  await Promise.all(waits);
  return who;
}

// ── Embers, flames and sparks: a canvas moved by elapsed time (speeds in px a second), so the frame rate doesn't change them ──
const ctx = sharpCanvas($<HTMLCanvasElement>('fx'));
const sprites = new Map<string, HTMLCanvasElement>();
function sprite(rgb: string) { // a soft round blob in one colour, drawn once and reused
  const had = sprites.get(rgb);
  if (had) return had;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d') as CanvasRenderingContext2D, grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, `rgba(${rgb}, 1)`); grad.addColorStop(.4, `rgba(${rgb}, .7)`); grad.addColorStop(1, `rgba(${rgb}, 0)`);
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  sprites.set(rgb, c);
  return c;
}
const FIRE = ['255, 250, 220', '255, 220, 90', '255, 160, 30', '255, 80, 0', '200, 20, 0', '90, 10, 10'];
const rand = (a: number, b: number) => a + Math.random() * (b - a);
let parts: Particle[] = [], emitters: (Emitter & { owed: number })[] = [], fxStart = 0, fxEnd = 0, last = 0, raf = 0;
// Each emitter: from..to seconds after the start, rate a second, and make() for one particle.
function emittersFor(ev: Streak, s: Board | null): Emitter[] {
  if (ev.kind === 'heating') return [
    { from: .2, to: 2.9, rate: 70, make: () => ({ x: rand(560, 1360), y: rand(640, 700), vx: rand(-30, 30), vy: rand(-260, -140), ay: -40, life: rand(1, 1.8), size: rand(8, 20), ramp: FIRE.slice(1, 5), wobble: rand(1, 3) }) },
  ];
  if (ev.kind === 'fire') return [
    { from: .35, to: 2.95, rate: 380, make: () => ({ x: rand(460, 1460), y: rand(590, 670), vx: rand(-40, 40), vy: rand(-520, -300), ay: -260, life: rand(.5, 1), size: rand(50, 110), shrink: true, ramp: FIRE, wobble: rand(2, 5) }) },
    { from: .42, to: .5, rate: 900, make: () => { const a = rand(0, Math.PI * 2), v = rand(500, 1300); return { x: 960, y: 560, vx: Math.cos(a) * v, vy: Math.sin(a) * v, ay: 600, drag: 2.2, life: rand(.5, .9), size: rand(10, 22), ramp: FIRE.slice(0, 4) }; } },
    { from: .5, to: 2.9, rate: 60, make: () => ({ x: rand(520, 1400), y: rand(500, 700), vx: rand(-50, 50), vy: rand(-380, -220), ay: -60, life: rand(.8, 1.4), size: rand(6, 12), ramp: FIRE.slice(0, 3), wobble: rand(2, 4) }) },
  ];
  const h = sideColour(s, 'home').rgb, a = sideColour(s, 'away').rgb;
  const team = sideColour(s, ev.side === 'away' ? 'away' : 'home').rgb, gold = css('--yellow-rgb') || '255, 205, 0';
  const burst = (at: number, x: number, y: number, ramp: string[], n = 700): Emitter => ({ from: at, to: at + .08, rate: n, make: () => { const ang = rand(0, Math.PI * 2), v = rand(400, 1100); return { x, y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v * .6, ay: 300, drag: 2.4, life: rand(.4, .8), size: rand(8, 16), ramp }; } });
  if (ev.kind === 'lead') return [
    { from: .3, to: 2.8, rate: 90, make: () => ({ x: rand(420, 1500), y: rand(700, 780), vx: rand(-20, 20), vy: rand(-700, -450), ay: 0, drag: .6, life: rand(.6, 1.1), size: rand(6, 12), ramp: ['255, 255, 255', gold, gold] }) },
    burst(.3, 960, 560, ['255, 255, 255', gold, team]),
  ];
  if (ev.kind === 'comeback') return [
    { from: .3, to: 2.8, rate: 80, make: () => ({ x: rand(200, 700), y: rand(420, 760), vx: rand(900, 1500), vy: rand(-40, 40), ay: 0, drag: .8, life: rand(.5, .9), size: rand(6, 12), ramp: ['255, 255, 255', team, team] }) },
  ];
  if (ev.kind === 'siren') return [burst(.4, 960, 560, ['255, 255, 255', '255, 80, 80', '220, 0, 0'], 900)];
  if (ev.kind === 'backToBack') return [burst(1.3, 900, 735, ['255, 255, 255', gold, team], 500), burst(1.6, 1000, 735, ['255, 255, 255', gold, team], 500)];
  const spark = (fromX: number, dir: number, rgb: string) => (): Particle => { const v = rand(700, 1300); return { x: fromX, y: rand(520, 600), vx: dir * v, vy: rand(-160, 160), ay: 0, drag: 1.2, life: rand(.35, .7), size: rand(8, 16), ramp: ['255, 255, 255', rgb, rgb] }; };
  if (ev.kind === 'level') return [
    { from: .45, to: 2.9, rate: 50, make: spark(300, 1, h) },
    { from: .45, to: 2.9, rate: 50, make: spark(1620, -1, a) },
  ];
  return [
    { from: 1, to: 2.9, rate: 70, make: spark(400, 1, h) },
    { from: 1, to: 2.9, rate: 70, make: spark(1520, -1, a) },
    { from: .7, to: .78, rate: 600, make: () => { const ang = rand(0, Math.PI * 2), v = rand(400, 1000); return { x: 960, y: 548, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v * .5, ay: 0, drag: 2.5, life: rand(.4, .7), size: rand(8, 14), ramp: ['255, 255, 255', '170, 235, 255', '120, 200, 255'] }; } },
  ];
}
function startFx(ev: Streak, s: Board | null) {
  cancelAnimationFrame(raf);
  parts = []; emitters = emittersFor(ev, s).map(e => ({ ...e, owed: 0 }));
  fxStart = last = performance.now(); fxEnd = fxStart + LENGTH_MS;
  raf = requestAnimationFrame(frame);
}
function frame(now: number) {
  const dt = Math.min(.1, (now - last) / 1000), t = (now - fxStart) / 1000;
  last = now;
  for (const e of emitters) {
    if (t < e.from || t > e.to) continue;
    e.owed += e.rate * dt;
    while (e.owed >= 1) { e.owed--; const p = e.make(); p.age = 0; p.phase = rand(0, 6); parts.push(p); }
  }
  ctx.clearRect(0, 0, 1920, 1080);
  ctx.globalCompositeOperation = 'lighter';
  parts = parts.filter(p => (p.age = (p.age || 0) + dt) < p.life);
  for (const p of parts) {
    if (p.drag) { const k = Math.exp(-p.drag * dt); p.vx *= k; p.vy *= k; }
    p.vy += p.ay * dt;
    const age = p.age || 0;
    p.x += (p.vx + (p.wobble ? Math.sin((p.phase || 0) + age * p.wobble * 6) * 40 : 0)) * dt;
    p.y += p.vy * dt;
    const f = age / p.life;
    const size = p.shrink ? p.size * (1 - f * .8) : p.size;
    ctx.globalAlpha = f < .1 ? f * 10 : 1 - Math.pow(f, 2);
    ctx.drawImage(sprite(p.ramp[Math.min(p.ramp.length - 1, Math.floor(f * p.ramp.length))]), p.x - size, p.y - size, size * 2, size * 2);
  }
  ctx.globalAlpha = 1;
  if (now < fxEnd || parts.length) raf = requestAnimationFrame(frame);
  else ctx.clearRect(0, 0, 1920, 1080);
}

const scoreboard = async (): Promise<Board> => (await fetch('/api/scoreboard', { cache: 'no-store' })).json();

// Starts the animation from the beginning (taking 'go' off and back on restarts every CSS animation).
const LENGTH_MS = 3600;
let playingUntil = 0;
const queue: { s: Board | null; ev: Streak }[] = [];
async function play(s: Board | null, ev: Streak) {
  playingUntil = performance.now() + LENGTH_MS + 2000; // held while the logo loads
  const [who, sponsor] = await Promise.all([dress(s, ev), sponsorSpot.moment(ev.kind, $('shaker'))]);
  stage.classList.remove('go');
  void stage.offsetWidth;
  stage.classList.add('go');
  startFx(ev, s);
  playingUntil = performance.now() + LENGTH_MS;
  window.pageLog?.('info', `Playing ${NAMES[ev.kind]}${who ? ` for ${who}` : ''}${ev.goals ? `, ${ev.goals} goals` : ''}${sponsor ? `, brought to you by ${sponsor.name}` : ''}`);
  setTimeout(next, LENGTH_MS);
}
function next() { const q = performance.now() >= playingUntil && queue.shift(); if (q) play(q.s, q.ev); }

// Watching (the default): stays clear until the helper reports a new streak on the scoreboard (from the goals PlayHQ's
// scorer records while following PlayHQ, or +1 / +2 presses), then plays it. One that lands while another is playing
// plays straight after it, and one that comes with a super shot waits for the super shot graphic to finish first.
// Only asks the helper on this computer.
const SUPER_SHOT_MS = 3000;
const off: Record<Kind, boolean> = { heating: opts.get('heating') === '0', fire: opts.get('fire') === '0', goalForGoal: opts.get('goalforgoal') === '0', lead: opts.get('lead') === '0',
  level: opts.get('level') === '0', comeback: opts.get('comeback') === '0', siren: opts.get('siren') === '0', backToBack: opts.get('backtoback') === '0' };
let seen: number | null = null, warned = false;
async function watch() {
  try {
    const s = await scoreboard();
    const latest = s.streak;
    const n = latest ? latest.n : 0;
    if (warned) { console.info('Streak: the helper is back'); warned = false; }
    if (seen === null || n < seen) seen = n; // first look, or the helper's count started again
    // Every one since the last look (two goals pressed quickly can make two), oldest first.
    const since = seen;
    const fresh = (s.streakLog && s.streakLog.length ? s.streakLog : latest ? [latest] : []).filter(ev => ev.n > since);
    if (fresh.length) seen = n;
    for (const ev of fresh) {
      const now = s.serverNow || Date.now();
      const age = now - (ev.at || 0);
      if (!KINDS[ev.kind]) console.warn(`Streak: unknown kind ${ev.kind}`);
      else if (off[ev.kind]) console.info(`Streak: ${NAMES[ev.kind]} is turned off on this source, so it isn't played`);
      else if (age > 15000) console.info(`Streak ${ev.n} is ${Math.round(age / 1000)} s old, so it isn't played`);
      else {
        const shot = s.superShot && s.superShot.at ? SUPER_SHOT_MS - (now - s.superShot.at) : 0;
        const go = () => { queue.push({ s, ev }); next(); };
        if (shot > 0) setTimeout(go, shot); else go();
      }
    }
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    if (!warned) console.warn('Streak: scoreboard unavailable, still watching:', why);
    warned = true;
  }
  setTimeout(watch, 1000);
}

(async function start() {
  if (document.fonts) await document.fonts.ready;
  if (!opts.has('play')) {
    window.pageLog?.('info', `Watching the scoreboard for streaks${(Object.keys(off) as Kind[]).filter(k => off[k]).map(k => `, not ${NAMES[k]}`).join('')}`);
    return watch();
  }
  // ?play=heating|fire|goalforgoal|lead|level|comeback|siren|backtoback (&team=home|away): play once now.
  let kind = kindOf(opts.get('play'));
  if (!kind) { console.warn(`Streak: ?play=${opts.get('play')} is not one of ${Object.keys(KINDS).join(', ')}; playing heating up`); kind = 'heating'; }
  const side = String(opts.get('team') || '').toLowerCase() === 'away' ? 'away' : 'home';
  let s: Board | null = null;
  try { s = await scoreboard(); } catch (err) { console.warn('Streak: scoreboard unavailable, playing without the teams:', err instanceof Error ? err.message : err); }
  const ev: Streak = { kind, side: kind === 'goalForGoal' || kind === 'level' ? '' : side, from: side, goals: GOALS[kind] || 0, down: 6 };
  if (kind === 'siren') Object.assign(ev, { period: (s && s.period) || 4, clockLeft: 2 });
  await play(s, ev);
  studioDone(LENGTH_MS + 100); // played once and faded out: done
})();

// What makes this file a module (its names its own), as the first line says.
export {};
