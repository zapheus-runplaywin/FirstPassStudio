// FirstPass Studio - the super shot moment's script (supershot.html loads it as a module, so its names stay its own).

type Side = 'home' | 'away';
const opts = new URLSearchParams(location.search);
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const stage = $('stage');

// A club colour from the competition setup page, as on winner.html; without one, the competition's main colour (home) or accent (away).
function colourOf(hex: string | null | undefined, fallbackVar: string) {
  const rgb = hex && /^#[0-9a-f]{6}$/i.test(hex) ? [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) : (css(fallbackVar) || '127, 64, 146').split(',').map(Number);
  const lum = rgb.map(c => c / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const light = 0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2] > 0.4;
  return { rgb: rgb.join(', '), dark: rgb.map(c => Math.round(c * .5)).join(', '), text: light ? '#111111' : '#ffffff' };
}
function fit(node: HTMLElement, max: number, size: number, min: number) {
  node.style.fontSize = size + 'px';
  while (node.scrollWidth > max && size > min) node.style.fontSize = (size -= 2) + 'px';
}

// The ball and three fading copies behind it for a trail (drawn last so the ball flies over the words).
function balls() {
  const box = $('balls');
  ['g3', 'g2', 'g1', ''].forEach(g => {
    const f = document.createElement('div');
    f.className = 'flight' + (g ? ' ghost ' + g : '');
    f.innerHTML = '<div class="arc">' + $('ballSvg').innerHTML + '</div>';
    box.appendChild(f);
  });
}
// Sparks flying out from where the ball bursts, and speed lines across the words.
function sparks() {
  const box = $('sparks');
  const colours = ['var(--yellow)', '#ffffff', 'rgb(var(--team-rgb))'];
  for (let i = 0; i < 30; i++) {
    const s = document.createElement('div');
    s.className = 'spark';
    const a = i * 12 + (i % 3) * 4;
    s.style.cssText = `--a:${a}deg;--d:${380 + (i * 53) % 340}px;--len:${70 + (i * 37) % 90}px;--t:${.7 + (i % 4) * .12}s;--c:${colours[i % 3]}`;
    box.appendChild(s);
  }
  const lines = $('lines');
  ([[250, 10, 900, '.38s', 'var(--yellow)'], [330, 5, 1300, '.42s', '#ffffff'], [420, 14, 700, '.46s', 'rgb(var(--team-rgb))'],
   [505, 6, 1100, '.40s', '#ffffff'], [580, 10, 800, '.50s', 'var(--yellow)'], [190, 4, 600, '.52s', 'rgb(var(--team-rgb))']] as const)
    .forEach(([y, h, w, dl, c]) => {
      const l = document.createElement('div');
      l.className = 'line';
      l.style.cssText = `--y:${y}px;--h:${h}px;--w:${w}px;--dl:${dl};--c:${c}`;
      lines.appendChild(l);
    });
}

// Puts a team's logo, name and club colour on the stage, or takes them off (side '' or no name).
function dress(s: ScoreboardView | null, side: Side | '') {
  const t = side && s ? s[side] : null;
  stage.classList.toggle('has-team', !!(t && t.name));
  ['--team-rgb', '--side-rgb', '--side-dark', '--side-text'].forEach(v => stage.style.removeProperty(v));
  if (!s || !side || !t || !t.name) return null;
  const c = colourOf(s.teamColours && s.teamColours[side], side === 'home' ? '--purple-rgb' : '--pink-rgb');
  stage.style.setProperty('--team-rgb', c.rgb);
  stage.style.setProperty('--side-rgb', c.rgb);
  stage.style.setProperty('--side-dark', c.dark);
  stage.style.setProperty('--side-text', c.text);
  $('name').textContent = t.name;
  fit($('name'), 960, 64, 30);
  const node = logoEl({ name: t.name, logo: s.logos && s.logos[side] }, 'logo');
  const name = t.name;
  $('crest').replaceChildren(node);
  return node instanceof HTMLImageElement ? Promise.race([node.decode().catch(() => {}), new Promise(r => setTimeout(r, 1500))]).then(() => name) : name;
}
const scoreboard = async (): Promise<ScoreboardView> => (await fetch('/api/scoreboard', { cache: 'no-store' })).json();

// Starts the animation from the beginning (taking 'go' off and back on restarts every CSS animation).
const LENGTH_MS = 3000;
let playingUntil = 0, queued: { s: ScoreboardView; side: Side | '' } | null = null;
async function play(s: ScoreboardView | null, side: Side | '') {
  const [who, sponsor] = await Promise.all([dress(s, side), sponsorSpot.moment('superShot', $('shaker'))]);
  stage.style.setProperty('--moment-top', side ? '800px' : '640px');
  stage.style.setProperty('--moment-at', '.9s');
  stage.classList.remove('go');
  void stage.offsetWidth;
  stage.classList.add('go');
  playingUntil = performance.now() + LENGTH_MS;
  window.pageLog?.('info', `Playing the super shot${who ? ` for ${who} (${side})` : ''}${sponsor ? `, brought to you by ${sponsor.name}` : ''}`);
  setTimeout(() => { if (queued) { const q = queued; queued = null; play(q.s, q.side); } }, LENGTH_MS);
}

// Watching (the default): stays clear until the helper reports a new super shot on the scoreboard (a +2 press on
// the control page or Stream Deck, or PlayHQ's super shot count going up), then plays it for that team.
// One that lands while another is playing plays straight after it. Only asks the helper on this computer.
let seen: number | null = null, warned = false;
async function watch() {
  try {
    const s = await scoreboard();
    const shot: Partial<NonNullable<ScoreboardView['superShot']>> & { n: number } = s.superShot || { n: 0 };
    if (warned) { console.info('Super shot: the helper is back'); warned = false; }
    if (seen === null || shot.n < seen) seen = shot.n; // first look, or the helper's count started again
    else if (shot.n > seen) {
      seen = shot.n;
      const age = (s.serverNow || Date.now()) - (shot.at || 0);
      if (age > 15000) console.info(`Super shot ${shot.n} is ${Math.round(age / 1000)} s old, so it isn't played`);
      else if (performance.now() < playingUntil) queued = { s, side: shot.side || '' };
      else play(s, shot.side || '');
    }
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    if (!warned) console.warn('Super shot: scoreboard unavailable, still watching:', why);
    warned = true;
  }
  setTimeout(watch, 1000);
}

(async function start() {
  const side = String(opts.get('team') || '').toLowerCase();
  if (document.fonts) await document.fonts.ready;
  balls(); sparks();
  if (!opts.has('team')) {
    window.pageLog?.('info', 'Watching the scoreboard for super shots');
    return watch();
  }
  // ?team=home|away|none: play once now, for that team or without one.
  if (!['home', 'away', 'none'].includes(side)) console.warn(`Super shot: ?team=${opts.get('team')} is not home, away or none; playing without a team`);
  let s: ScoreboardView | null = null;
  if (side === 'home' || side === 'away') {
    try { s = await scoreboard(); } catch (err) { console.warn('Super shot: scoreboard unavailable, playing without the team:', err instanceof Error ? err.message : err); }
  }
  await play(s, side === 'home' || side === 'away' ? side : '');
  studioDone(LENGTH_MS + 100); // played once and faded out: done
})();

// What makes this file a module (its names its own), as the first line says.
export {};
