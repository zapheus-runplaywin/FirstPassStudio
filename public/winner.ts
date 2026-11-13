// FirstPass Studio - the winner moment's script (winner.html loads it as a module, so its names stay its own).

interface Colour { rgb: string; dark: string; text: string; list: number[] }
const opts = new URLSearchParams(location.search);
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Shrink a name until it fits.
function fit(node: HTMLElement, max: number, size: number, min: number) {
  node.style.fontSize = size + 'px';
  while (node.scrollWidth > max && size > min) node.style.fontSize = (size -= 2) + 'px';
}
function setLogo(id: string, team: { name: string; logo?: string | null }) {
  const node = logoEl(team, 'logo');
  $(id).replaceWith(node);
  return node instanceof HTMLImageElement ? Promise.race([node.decode().catch(() => {}), new Promise(r => setTimeout(r, 1500))]) : Promise.resolve();
}
// A club colour from the competition setup page; without one, the competition's main colour (home) or accent (away).
function colourOf(hex: string | null | undefined, fallbackVar: string): Colour {
  const rgb = hex && /^#[0-9a-f]{6}$/i.test(hex) ? [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) : (css(fallbackVar) || '127, 64, 146').split(',').map(Number);
  const lum = rgb.map(c => c / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const light = 0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2] > 0.4;
  return { rgb: rgb.join(', '), dark: rgb.map(c => Math.round(c * .55)).join(', '), text: light ? '#111111' : '#ffffff', list: rgb };
}
function paint(node: HTMLElement, c: Colour) {
  node.style.setProperty('--side-rgb', c.rgb);
  node.style.setProperty('--side-dark', c.dark);
  node.style.setProperty('--side-text', c.text);
}
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s: unknown) => String(s).replace(/[&<>"]/g, ch => ESC[ch]);

// Confetti: two cannons from the bottom corners, then a steady fall from the top while the graphic is up.
function confetti(colours: string[], { cannons, rate }: { cannons: boolean; rate: number }) {
  const ctx = sharpCanvas($<HTMLCanvasElement>('confetti'));
  const piece = (x: number, y: number, vx: number, vy: number) => ({ x, y, vx, vy, rot: Math.random() * Math.PI, vr: (Math.random() - .5) * .3,
    w: 10 + Math.random() * 12, h: 6 + Math.random() * 8, flip: Math.random() * Math.PI * 2, vf: .08 + Math.random() * .12,
    col: colours[Math.floor(Math.random() * colours.length)], ribbon: Math.random() < .15 });
  const ps: ReturnType<typeof piece>[] = [];
  if (cannons) for (const side of [-1, 1]) for (let i = 0; i < 140; i++) {
    const a = .12 + Math.random() * .5, v = 22 + Math.random() * 22; // angle off straight up, speed
    ps.push(piece(side < 0 ? 40 : 1880, 1090, -side * Math.sin(a) * v, -Math.cos(a) * v));
  }
  // Pieces move by elapsed time, not per frame, so they fall at the same speed at 25, 30, 50 or 60 fps.
  // Speeds are tuned in 60 fps frames; k is how many of those this frame stands for (capped after a stall).
  let last = performance.now(), spawned = last;
  (function frame(t = last) {
    const k = Math.min(Math.max(t - last, 0), 100) / (1000 / 60); last = t;
    ctx.clearRect(0, 0, 1920, 1080);
    if (t - spawned > 1000 / rate && ps.length < 420) { spawned = t; ps.push(piece(Math.random() * 1920, -30, (Math.random() - .5) * 2, 2 + Math.random() * 2)); }
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.vx *= .985 ** k; p.vy = Math.min(p.vy * .985 ** k + .32 * k, 5.5); p.x += (p.vx + Math.sin(p.flip) * .8) * k; p.y += p.vy * k;
      p.rot += p.vr * k; p.flip += p.vf * k;
      if (p.y > 1110) { ps.splice(i, 1); continue; }
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, Math.cos(p.flip));
      ctx.fillStyle = p.col;
      if (p.ribbon) ctx.fillRect(-2, -p.w, 4, p.w * 2); else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    requestAnimationFrame(frame);
  })();
}

// Stars twinkling around the winner's logo, at staggered times.
function stars() {
  const box = $('stars');
  ([[-330, -250], [310, -280], [-390, 40], [380, 10], [-250, 230], [270, 210], [0, -360], [-120, -330], [150, 300], [420, -140]] as const)
    .forEach(([x, y], i) => {
      const s = document.createElement('div');
      s.className = 'star'; s.style.left = x + 'px'; s.style.top = y + 'px';
      s.style.animationDelay = (1.3 + i * .37) + 's';
      box.appendChild(s);
    });
}

async function start() {
  let s: ScoreboardView;
  try { s = await (await fetch('/api/scoreboard', { cache: 'no-store' })).json(); }
  catch (err) { console.warn('Winner: scoreboard unavailable:', err instanceof Error ? err.message : err); return setTimeout(start, 3000); }
  const hs = Number(s.home.score) || 0, as = Number(s.away.score) || 0;
  const asked = String(opts.get('winner') || '').toLowerCase();
  const fromLink = asked === 'home' || asked === 'away' || asked === 'draw';
  const winner = fromLink ? asked : hs > as ? 'home' : as > hs ? 'away' : 'draw';
  if (asked && !fromLink) console.warn(`Winner: ?winner=${opts.get('winner')} is not home, away or draw; going by the score`);
  window.pageLog?.('info', `Playing ${winner}${fromLink ? '' : ' (from the score)'}: ${s.home.name} ${hs} - ${as} ${s.away.name}`);

  const home = colourOf(s.teamColours && s.teamColours.home, '--purple-rgb');
  const away = colourOf(s.teamColours && s.teamColours.away, '--pink-rgb');
  const stage = $('stage');
  if (opts.get('score') === '0') stage.classList.add('no-score');
  $('tag').textContent = [s.division, s.round, 'Full time'].filter(Boolean).join('  ·  ');
  const highlight = css('--yellow') || '#ffcd00';
  const waits: Promise<unknown>[] = [document.fonts.ready];

  if (winner === 'draw') {
    stage.classList.add('is-draw');
    stage.style.setProperty('--home-rgb', home.rgb);
    stage.style.setProperty('--away-rgb', away.rgb);
    paint($('drawHome'), home); paint($('drawAway'), away);
    $('homeName').textContent = s.home.name;
    $('awayName').textContent = s.away.name;
    $('stamp').textContent = (opts.get('word') || 'DRAW').toUpperCase();
    $('drawScore').innerHTML = `<b>${hs}</b><span class="dash">–</span><b>${as}</b>`;
    const title = opts.get('title');
    if (title) $('drawLine').textContent = title;
    else $('drawLine').innerHTML = 'Honours <b>shared</b>';
    waits.push(setLogo('homeLogo', { name: s.home.name, logo: s.logos && s.logos.home }),
      setLogo('awayLogo', { name: s.away.name, logo: s.logos && s.logos.away }));
    await Promise.all(waits);
    fit($('homeName'), 500, 52, 26); fit($('awayName'), 500, 52, 26); fit($('stamp'), 700, 170, 70);
    stage.classList.add('go');
    setTimeout(() => confetti([`rgb(${home.rgb})`, `rgb(${away.rgb})`, '#ffffff', highlight], { cannons: false, rate: 14 }), 2850);
  } else {
    const team = s[winner], other = s[winner === 'home' ? 'away' : 'home'];
    const c = winner === 'home' ? home : away;
    stage.classList.add('is-win');
    stage.style.setProperty('--team-rgb', c.rgb);
    paint(stage, c);
    $('winName').textContent = team.name;
    $('winWord').textContent = (opts.get('word') || 'VICTORY').toUpperCase();
    const ws = Number(team.score) || 0, ls = Number(other.score) || 0;
    $('winScore').innerHTML = `<small>Full time</small><b>${ws}</b><span class="dash">–</span>${ls}`;
    const title = opts.get('title');
    if (title) $('winLine').textContent = title;
    else $('winLine').innerHTML = `def. <b>${esc(other.name)}</b>`;
    const logo = s.logos && s.logos[winner];
    if (logo) { $('shine').style.webkitMaskImage = `url("${logo}")`; $('shine').style.maskImage = `url("${logo}")`; }
    else $('shine').remove();
    waits.push(setLogo('winLogo', { name: team.name, logo }));
    await Promise.all(waits);
    fit($('winName'), 1380, 92, 40);
    stars();
    stage.classList.add('go');
    const colours = [`rgb(${c.rgb})`, highlight, '#ffffff', css('--yellow-light') || '#fff', `rgb(${c.rgb})`];
    setTimeout(() => confetti(colours, { cannons: true, rate: 22 }), 600);
  }
  const out = Number(opts.get('out'));
  if (out > 0) setTimeout(() => { stage.classList.add('leave'); studioDone(700); }, out * 1000);
}
start();

// What makes this file a module (its names its own), as the first line says.
export {};
