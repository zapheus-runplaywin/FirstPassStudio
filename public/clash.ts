// FirstPass Studio - the clash opener's script (clash.html loads it as a module, so its names stay its own).

const opts = new URLSearchParams(location.search);
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function time12(t?: string) {
  const [h, m] = String(t || '').split(':').map(Number);
  return Number.isFinite(h) ? `${(h % 12) || 12}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` : '';
}
// Shrink a name until it fits its plate.
function fit(node: HTMLElement, max: number) {
  let size = 50;
  node.style.fontSize = size + 'px';
  while (node.scrollWidth > max && size > 26) node.style.fontSize = (size -= 2) + 'px';
}
function setLogo(id: string, team: { name: string; logo?: string | null }) {
  const node = logoEl(team, 'logo');
  $(id).replaceWith(node);
  return node instanceof HTMLImageElement ? Promise.race([node.decode().catch(() => {}), new Promise(r => setTimeout(r, 1500))]) : Promise.resolve();
}

// Particles move by elapsed time, not per frame, so they run at the same speed at 25, 30, 50 or 60 fps.
// Speeds are tuned in 60 fps frames; k is how many of those this frame stands for (capped after a stall).
const step = (ms: number) => Math.min(Math.max(ms, 0), 100) / (1000 / 60);

// Sparks fly out from the centre at the moment of impact.
function sparks() {
  const ctx = sharpCanvas($<HTMLCanvasElement>('sparks'));
  const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const colours = ['#ffffff', css('--yellow'), css('--yellow-light'), css('--pink'), css('--purple-light')].filter(Boolean);
  const ps = Array.from({ length: 140 }, () => {
    const a = Math.random() * Math.PI * 2, v = 8 + Math.random() * 26;
    return { x: 960, y: 420, vx: Math.cos(a) * v, vy: Math.sin(a) * v * .75, life: 1, decay: .012 + Math.random() * .02,
      w: 2 + Math.random() * 4, col: colours[Math.floor(Math.random() * colours.length)] };
  });
  let last = performance.now();
  (function frame(t = last) {
    const k = step(t - last); last = t;
    ctx.clearRect(0, 0, 1920, 1080);
    let alive = 0;
    for (const p of ps) {
      if (p.life <= 0) continue;
      alive++;
      const px = p.x, py = p.y;
      p.x += p.vx * k; p.y += p.vy * k; p.vx *= .955 ** k; p.vy = p.vy * .955 ** k + .35 * k; p.life -= p.decay * k;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.strokeStyle = p.col; ctx.lineWidth = p.w; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(p.x, p.y); ctx.stroke();
    }
    if (alive) requestAnimationFrame(frame); else ctx.clearRect(0, 0, 1920, 1080);
  })();
}

// Embers drifting up for as long as the graphic is on screen.
function embers() {
  const ctx = sharpCanvas($<HTMLCanvasElement>('embers'));
  const emberA = getComputedStyle(document.documentElement).getPropertyValue('--yellow-rgb').trim() || '255,205,0';
  const emberB = getComputedStyle(document.documentElement).getPropertyValue('--pink-rgb').trim() || '230,0,126';
  const make = () => ({ x: Math.random() * 1920, y: 1080 + Math.random() * 200, vy: .6 + Math.random() * 1.6,
    sway: Math.random() * Math.PI * 2, r: 1 + Math.random() * 2.6, hue: Math.random() < .7 ? emberA : emberB });
  const es = Array.from({ length: 70 }, make);
  let last = performance.now();
  (function frame(t = last) {
    const k = step(t - last); last = t;
    ctx.clearRect(0, 0, 1920, 1080);
    for (const e of es) {
      e.y -= e.vy * k; e.x += Math.sin(t / 900 + e.sway) * .4 * k;
      if (e.y < 80) Object.assign(e, make(), { y: 1090 });
      const a = Math.min(1, (1080 - e.y) / 300) * Math.min(1, (e.y - 80) / 300) * .8;
      ctx.fillStyle = `rgba(${e.hue},${a})`;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2); ctx.fill();
    }
    requestAnimationFrame(frame);
  })();
}

// A team colour from the competition setup page goes behind that team's logo and name.
// No colour: the competition's (main colour for home, accent for away).
function teamColour(side: string, hex: string | null | undefined) {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return;
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const lum = rgb.map(c => c / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const light = 0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2] > 0.4;
  const team = document.querySelector<HTMLElement>(`.team--${side}`)!;
  const split = document.querySelector<HTMLElement>(`.split--${side}`)!;
  team.style.setProperty('--team-rgb', rgb.join(', '));
  team.style.setProperty('--team-dark', `rgb(${rgb.map(c => Math.round(c * .6)).join(', ')})`);
  team.style.setProperty('--team-text', light ? '#111111' : '#ffffff');
  team.classList.add('has-colour');
  split.style.setProperty('--team-rgb', rgb.join(', '));
  split.classList.add('has-colour');
}

async function start() {
  let s: ScoreboardView;
  try { s = await (await fetch('/api/scoreboard', { cache: 'no-store' })).json(); }
  catch (err) { console.warn('Clash: scoreboard unavailable:', err instanceof Error ? err.message : err); return setTimeout(start, 3000); }
  $('homeName').textContent = s.home.name;
  $('awayName').textContent = s.away.name;
  teamColour('home', s.teamColours && s.teamColours.home);
  teamColour('away', s.teamColours && s.teamColours.away);
  $('bigword').textContent = (opts.get('word') || 'CLASH').toUpperCase();
  $('tag').textContent = [s.competition || 'The Clash', s.round].filter(Boolean).join('  ·  ');
  const own = opts.get('title');
  const title = own || (s.division ? `Battle for <b>${s.division.replace(/[<>&]/g, '')}</b>` : 'The <b>battle</b> begins');
  $('battle').innerHTML = own ? '' : title;
  if (own) $('battle').textContent = own;
  $('info').textContent = [time12(s.time), s.court].filter(Boolean).join('   ·   ');
  await Promise.all([
    setLogo('homeLogo', { name: s.home.name, logo: s.logos && s.logos.home }),
    setLogo('awayLogo', { name: s.away.name, logo: s.logos && s.logos.away }),
    document.fonts ? document.fonts.ready : null,
  ]);
  fit($('homeName'), 500); fit($('awayName'), 500);
  $('stage').classList.add('go');
  setTimeout(sparks, 2200);
  setTimeout(embers, 2500);
  const out = Number(opts.get('out'));
  if (out > 0) setTimeout(() => { $('stage').classList.add('leave'); studioDone(700); }, out * 1000);
}
start();

// What makes this file a module (its names its own), as the first line says.
export {};
