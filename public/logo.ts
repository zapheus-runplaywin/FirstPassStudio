// FirstPass Studio - the logo animation's script (logo.html loads it as a module, so its names stay its own).

// What a built template is given: the logo's size and shape, the competition's name and line under it, and a seeded random.
interface TemplateOptions { size: number; name: string; sub: string; aspect: number; rand: () => number }
type Template = (url: string, o: TemplateOptions) => string;

(function () {
  const params = new URLSearchParams(location.search);
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const stage = $('stage');
  // ?template= picks the animation. fun and pro are the two
  // originals in this page; the rest are built by TEMPLATES below and styled in logo-templates.css.
  const NAMES = ['fun', 'pro', 'coin', 'tiles', 'slices', 'glitch', 'badge', 'doors', 'bounce', 'lightning', 'rings', 'title', 'goal', 'court', 'bibs', 'pass', 'net'];
  let template = (params.get('template') || 'fun').trim().toLowerCase();
  if (template === 'random') template = NAMES[Math.floor(Math.random() * NAMES.length)];
  if (!NAMES.includes(template)) { console.warn('Logo animation: no template called', template, '- using fun. Templates:', NAMES.join(', ')); template = 'fun'; }
  console.log('Logo animation: template', template);
  const style = template === 'pro' ? 'pro' : 'fun';
  const built = template !== 'fun' && template !== 'pro';
  stage.dataset.style = style;
  stage.dataset.template = template;
  if (built) stage.classList.add('tpl', 't-' + template);
  if (built && params.get('out') === '0') stage.classList.add('stay');
  const dark = (params.get('mode') || params.get('theme') || 'light').toLowerCase() === 'dark';
  const num = (k: string) => { const v = parseFloat(params.get(k) ?? ''); return Number.isFinite(v) && v > 0 ? v : null; };
  const speed = num('speed') || 1;
  const size = num('size');
  if (size) document.documentElement.style.setProperty('--size', size + 'px');
  // The part of the frame the logo uses (pro's lines reach .62 of the size above and below the middle),
  // so fit.js can put it between the title and the scoreboard.
  const reach = (size || 640) * (style === 'pro' ? .66 : .5);
  stage.dataset.fitBox = `${540 - reach} ${540 + reach}`;
  if (window.fitBox) window.fitBox(stage);
  document.documentElement.style.setProperty('--speed', String(speed));

  // Confetti in the competition's colours, flying out from the middle as the logo lands.
  function confetti() {
    const box = $('confetti');
    const colours = ['var(--purple)', 'var(--yellow)', 'var(--pink)', '#ffffff', 'var(--purple-light)'];
    for (let i = 0; i < 110; i++) {
      const b = document.createElement('div');
      b.className = 'bit' + (i % 3 === 0 ? ' dot' : '');
      const angle = Math.random() * Math.PI * 2, dist = 380 + Math.random() * 760;
      b.style.background = colours[i % colours.length];
      b.style.setProperty('--x', Math.cos(angle) * dist * 1.3 + 'px');
      b.style.setProperty('--y', Math.sin(angle) * dist * .8 + 'px');
      b.style.setProperty('--r', (Math.random() * 1080 - 540) + 'deg');
      b.style.setProperty('--t', (1.4 + Math.random() * 1.4) / speed + 's');
      b.style.setProperty('--d', ((i < 70 ? 1.3 : 2.5) + Math.random() * .15) / speed + 's');
      box.appendChild(b);
    }
  }

  // The optional background (?bg=, ?bg2=, ?bgimage=; see backdrop.js).
  studioBackdrop($('backdrop'), params, 'Logo animation');

  // The ten built templates. Each returns the markup for its logo (url), with the page's logo size and a seeded random
  // (so it plays the same each time). Everything moves by CSS from the moment .go is added; nothing is timed in script.
  const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  const esc = (t: unknown) => String(t).replace(/[&<>"]/g, c => ESC[c]);
  const logoTag = (url: string) => `<img class="logo" src="${esc(url)}" alt="">`;
  const COLOURS = ['var(--purple)', 'var(--yellow)', 'var(--pink)'];
  function seeded(seed: number) { return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const TEMPLATES: Record<string, Template> = {
    coin(url, { size, rand }) {
      let sparks = '';
      for (let i = 0; i < 10; i++) {
        const a = rand() * Math.PI * 2, r = .55 + rand() * .3;
        sparks += `<div class="spark" style="--x:${Math.round(Math.cos(a) * size * r * 1.2)}px;--y:${Math.round(Math.sin(a) * size * r * .8)}px;` +
          `--s:${Math.round(40 + rand() * 50)}px;--c:${i % 3 ? 'var(--yellow)' : '#ffffff'};--d:${(1.25 + i * .14).toFixed(2)}s"></div>`;
      }
      return `<div class="t-centre"><div class="coin"><div class="spinner"><div class="logo-box front">${logoTag(url)}<div class="t-shine"></div></div>` +
        `<div class="back"><div class="sil"></div></div></div></div>${sparks}</div>`;
    },
    tiles(url, { aspect, rand }) {
      const R = 5, C = Math.max(3, Math.min(9, Math.round(R * aspect)));
      let html = '';
      for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
        const p = (v: number) => (v * 100).toFixed(3) + '%';
        html += `<div class="logo-box tile" style="clip-path:inset(${p(r / R)} ${p((C - c - 1) / C)} ${p((R - r - 1) / R)} ${p(c / C)});` +
          `transform-origin:${p((c + .5) / C)} ${p((r + .5) / R)};--d:${(.1 + (c + r) * .07).toFixed(2)}s;--c:${COLOURS[(c + r) % 3]};` +
          `--e:${(rand() * .25).toFixed(2)}s;--fx:${Math.round(rand() * 400 - 200)}px;--fr:${Math.round(rand() * 120 - 60)}deg">` +
          `${logoTag(url)}<div class="face"></div></div>`;
      }
      return `<div class="t-centre">${html}</div>`;
    },
    slices(url) {
      const N = 8;
      let bars = '', strips = '';
      for (let i = 0; i < N; i++) {
        const left = i % 2 === 0, p = (v: number) => (v * 100).toFixed(3) + '%';
        bars += `<div class="sbar" style="--i:${i};--n:${N};--c:${COLOURS[i % 3]};--sweep:${left ? 'sweepRight' : 'sweepLeft'}"></div>`;
        strips += `<div class="logo-box strip" style="--i:${i};--in:${left ? 'fromLeft' : 'fromRight'};--away:${left ? 'toRight' : 'toLeft'};` +
          `clip-path:inset(${p(i / N)} 0 ${p((N - i - 1) / N)} 0)">${logoTag(url)}</div>`;
      }
      return `<div class="t-centre">${bars}${strips}</div>`;
    },
    glitch(url) {
      const bands: [string, string, number][] = [['18%', '68%', 1], ['47%', '41%', -1.3], ['74%', '12%', .8]];
      const slices = bands.map(([t, b, k], i) => `<div class="g-slice" style="--band:inset(${t} -20% ${b} -20%);--k:${k};animation-delay:${i * .08}s,2.3s,3.35s,var(--out)">${logoTag(url)}</div>`).join('');
      return `<div class="t-centre"><div class="g-wrap"><div class="sil g-a"></div><div class="sil g-b"></div>` +
        `<div class="logo-box g-main">${logoTag(url)}</div>${slices}<div class="sil g-lines"></div></div></div>`;
    },
    badge(url, { name }) {
      const text = (name || '').toUpperCase().trim();
      const C = 2 * Math.PI * 405, unit = text ? text + '\u00a0\u00a0•\u00a0\u00a0' : ''; // (SVG would squash plain spaces)
      const reps = unit ? Math.max(1, Math.round(C / (unit.length * 46))) : 0;
      const ring = (cls: string, r: number) => `<circle class="${cls}" r="${r}" pathLength="1" transform="rotate(-90)"/>`;
      return `<div class="t-centre"><div class="badge">` +
        `<svg class="b-rings" viewBox="-500 -500 1000 1000">${ring('b-band', 405)}${ring('b-outer', 470)}${ring('b-inner', 340)}</svg>` +
        (reps ? `<div class="b-text"><svg viewBox="-500 -500 1000 1000"><path id="bPath" fill="none" d="M -405 0 a 405 405 0 1 1 810 0 a 405 405 0 1 1 -810 0"/>` +
          `<text dominant-baseline="central" textLength="${(C - 4).toFixed(0)}" lengthAdjust="spacing"><textPath href="#bPath">${esc(unit.repeat(reps))}</textPath></text></svg></div>` : '') +
        `<div class="logo-box">${logoTag(url)}</div></div></div>`;
    },
    doors(url) {
      return `<div class="slam"><div class="panel panel--left"></div><div class="panel panel--right"></div><div class="seam"></div>` +
        `<div class="t-centre"><div class="logo-box">${logoTag(url)}</div></div></div>`;
    },
    bounce(url, { size, rand }) {
      let dust = '';
      for (let i = 0; i < 10; i++) {
        const side = i % 2 ? 1 : -1;
        dust += `<div class="dust" style="--x:${Math.round(side * (size * .35 + rand() * size * .5))}px;--y:${Math.round(-20 - rand() * 120)}px;` +
          `--s:${Math.round(18 + rand() * 22)}px;--c:${COLOURS[i % 3]}"></div>`;
      }
      return `<div class="t-centre"><div class="shadow"></div>${dust}<div class="drop"><div class="squash"><div class="logo-box">${logoTag(url)}</div></div></div></div>`;
    },
    lightning(url, { size, rand }) {
      const top = 540 - size * .5 + 30;
      // A jagged line from one point to another, with an optional fork part way down
      const zigzag = (x0: number, y0: number, x1: number, y1: number, n: number, jag: number) => {
        let d = `M ${x0} ${y0}`;
        for (let i = 1; i < n; i++) {
          const f = i / n;
          d += ` L ${Math.round(x0 + (x1 - x0) * f + (rand() * 2 - 1) * jag)} ${Math.round(y0 + (y1 - y0) * f + (rand() * 2 - 1) * jag * .3)}`;
        }
        return d + ` L ${x1} ${y1}`;
      };
      const bolt = (d: string, delay: string, cls = 'bolt', length = '') =>
        `<g class="${cls}" style="--d:${delay}${length ? ';--t:' + length : ''}"><path class="edge" pathLength="1" d="${d}"/><path class="core" pathLength="1" d="${d}"/></g>`;
      let svg = '';
      ([[640, 860, '.12s'], [1290, 1060, '.26s'], [930, 975, '.4s']] as const).forEach(([x0, x1, d]) => {
        svg += bolt(zigzag(x0, -40, x1, top, 9, 55), d);
        const fx = x0 + (x1 - x0) * .45, fy = top * .45;
        svg += bolt(zigzag(fx, fy, fx + (x0 < 960 ? -150 : 150), fy + 220, 4, 35), d);
      });
      // Sparks crackling round the logo while it holds
      [1.6, 1.75, 2.3, 2.75, 2.85, 3.3, 3.75].forEach((t, i) => {
        const a = rand() * Math.PI * 2, cx = 960 + Math.cos(a) * size * .78, cy = 540 + Math.sin(a) * size * .5;
        const b = a + Math.PI / 2 + (rand() - .5);
        svg += bolt(zigzag(Math.round(cx - Math.cos(b) * 70), Math.round(cy - Math.sin(b) * 70), Math.round(cx + Math.cos(b) * 70), Math.round(cy + Math.sin(b) * 70), 4, 26), t + 's', 'bolt spark', '.3s');
      });
      svg += bolt(zigzag(1100, -40, 990, top, 9, 55), 'var(--out)');
      return `<div class="jolt"><div class="t-centre"><div class="logo-box">${logoTag(url)}</div></div></div>` +
        `<svg class="bolts" viewBox="0 0 1920 1080">${svg}</svg>`;
    },
    rings(url) {
      const rings = [
        { r: 470, w: 10, c: 'var(--yellow)', dash: '.06 .02', spin: '14s', dir: 'normal' },
        { r: 425, w: 30, c: 'var(--purple)', dash: '.3 .05 .1 .05', spin: '10s', dir: 'reverse' },
        { r: 384, w: 7, c: 'var(--pink)', dash: '.012 .014', spin: '8s', dir: 'normal' },
        { r: 352, w: 14, c: 'var(--yellow)', dash: '.42 .08', spin: '18s', dir: 'reverse' },
      ];
      let html = rings.map((g, i) => `<div class="rw" style="--d:${(i * .1).toFixed(1)}s;--e:${((3 - i) * .06).toFixed(2)}s;--spin:${g.spin};--dir:${g.dir}">` +
        `<svg viewBox="-500 -500 1000 1000"><circle r="${g.r}" pathLength="1" stroke="${g.c}" stroke-width="${g.w}" stroke-dasharray="${g.dash}"/></svg></div>`).join('');
      html += `<div class="rw" style="--d:.4s;--e:0s;--spin:4s;--dir:normal"><svg viewBox="-500 -500 1000 1000">` +
        [0, 120, 240].map((a, i) => `<circle r="14" cx="${Math.round(Math.cos(a * Math.PI / 180) * 510)}" cy="${Math.round(Math.sin(a * Math.PI / 180) * 510)}" fill="${COLOURS[i]}" style="fill:${COLOURS[i]}"/>`).join('') +
        '</svg></div>';
      return `<div class="t-centre">${html}<div class="logo-box">${logoTag(url)}</div></div>`;
    },
    title(url, { name, sub }) {
      return `<div class="t-centre"><div class="row"><div class="slide"><div class="logo-box">${logoTag(url)}</div></div>` +
        `<div class="words"><div class="name">${esc(name)}</div><div class="bar"></div><div class="sub">${esc(sub)}</div></div></div></div>`;
    },

    // ----- Netball templates -----
    goal(url, { size }) {
      // The ring is seen from the side as an ellipse: its back half is drawn behind the ball and its front half and net in front.
      const back = `<svg class="layer" viewBox="0 0 1920 1080"><g class="goalpost"><rect class="post" x="1052" y="410" width="18" height="700"/>` +
        `<path class="post" d="M 1030 416 L 1056 416 L 1056 426 L 1030 426 Z"/><path class="hoop" d="M 890 420 A 70 15 0 0 1 1030 420"/></g></svg>`;
      let net = '';
      for (let i = 0; i <= 6; i++) {
        const x0 = 890 + i * 140 / 6, x1 = 922 + i * 76 / 6;
        net += `<path d="M ${x0.toFixed(0)} 420 L ${x1.toFixed(0)} 540"/>`;
      }
      [460, 500, 540].forEach((y, i) => { const w = 70 - (i + 1) * 10; net += `<path d="M ${960 - w} ${y} Q 960 ${y + 10} ${960 + w} ${y}"/>`; });
      const front = `<svg class="layer" viewBox="0 0 1920 1080"><g class="goalpost"><g class="net">${net}</g>` +
        `<path class="hoop" d="M 890 420 A 70 15 0 0 0 1030 420"/></g></svg>`;
      return `${back}<div class="bx"><div class="by">${netball(84)}</div></div>${front}` +
        `<div class="t-centre"><div class="burst-ring"></div><div class="logo-box">${logoTag(url)}</div></div>`;
    },
    court(url) {
      // A netball court to scale (30.5 m by 15.25 m at 50 px a metre): outline, thirds, centre circle and goal circles.
      const lines = ['M 0 0 H 1525 V 762 H 0 Z', 'M 508 0 V 762', 'M 1017 0 V 762',
        'M 740 381 a 22.5 22.5 0 1 0 45 0 a 22.5 22.5 0 1 0 -45 0', 'M 0 136 A 245 245 0 0 1 0 626', 'M 1525 136 A 245 245 0 0 0 1525 626'];
      return `<div class="court"><svg viewBox="0 0 1525 762"><rect class="floor" width="1525" height="762"/><rect class="third" x="508" width="509" height="762"/>` +
        lines.map((d, i) => `<path class="cline" pathLength="1" style="--d:${(.25 + i * .12).toFixed(2)}s" d="${d}"/>`).join('') + '</svg></div>' +
        `<div class="t-centre"><div class="logo-box">${logoTag(url)}</div></div>`;
    },
    bibs(url, { size }) {
      const POS = ['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK'];
      const bibs = POS.map((p, i) => {
        const a = -Math.PI / 2 + i * 2 * Math.PI / 7;
        return `<div class="bib" style="--x:${Math.round(Math.cos(a) * size * .95)}px;--y:${Math.round(Math.sin(a) * size * .62)}px;` +
          `--d:${(.5 + i * .12).toFixed(2)}s;--e:${(i * .05).toFixed(2)}s"><span>${p}</span></div>`;
      }).join('');
      return `<div class="t-centre">${bibs}<div class="logo-box">${logoTag(url)}</div></div>`;
    },
    pass(url) {
      // Down the court from GK to GS, one chest pass each, then the last pass goes to the middle and becomes the logo.
      const pts = [[-100, 840], [250, 300], [520, 800], [800, 270], [1100, 820], [1380, 290], [1640, 780], [1780, 330], [960, 540]];
      const POS = ['GK', 'GD', 'WD', 'C', 'WA', 'GA', 'GS'];
      const d = 'M ' + pts.map(p => p.join(' ')).join(' L ');
      const lens = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
      const total = lens.reduce((a, b) => a + b, 0);
      let run = 0;
      const players = POS.map((p, i) => {
        run += lens[i];
        const t = .15 + 1.8 * run / total; // when the ball reaches this player
        return `<div class="player" style="--x:${pts[i + 1][0]}px;--y:${pts[i + 1][1]}px;--d:${(t - .3).toFixed(2)}s;--e:${(i * .03).toFixed(2)}s">${p}</div>`;
      }).join('');
      return `<svg class="trail" viewBox="0 0 1920 1080"><path pathLength="1" d="${d}"/></svg>${players}` +
        `<div class="pball" style="--path:path('${d}')">${netball(76)}</div>` +
        `<div class="t-centre"><div class="burst-ring"></div><div class="logo-box">${logoTag(url)}</div></div>`;
    },
    net(url) {
      // A ring seen a little from above: its back half behind the logo, its front half and net in front, so the logo drops through it.
      let net = '';
      for (let i = 0; i <= 10; i++) {
        const x0 = 660 + i * 60, x1 = 780 + i * 36;
        net += `<path d="M ${x0} 300 L ${x1} 640"/>`;
      }
      [400, 500, 600].forEach((y, i) => { const w = 285 - (i + 1) * 40; net += `<path d="M ${960 - w} ${y} Q 960 ${y + 30} ${960 + w} ${y}"/>`; });
      return `<svg class="layer" viewBox="0 0 1920 1080"><g class="goalpost"><path class="hoop" d="M 660 300 A 300 55 0 0 1 1260 300"/></g></svg>` +
        `<div class="t-centre"><div class="logo-box">${logoTag(url)}</div></div>` +
        `<svg class="layer" viewBox="0 0 1920 1080"><g class="goalpost"><g class="net">${net}</g><path class="hoop" d="M 660 300 A 300 55 0 0 0 1260 300"/></g></svg>`;
    },
  };

  // A netball, d pixels across: plain white with a thin grey rim.
  function netball(d: number) {
    return `<svg class="netball" width="${d}" height="${d}" viewBox="-50 -50 100 100"><circle class="skin" r="48"/></svg>`;
  }

  function play() {
    if (template === 'fun') confetti();
    stage.classList.add('go');
    if (built) {
      // Built templates are timed in CSS at ?speed=1; other speeds play the whole timeline faster or slower.
      if (speed !== 1) stage.getAnimations({ subtree: true }).forEach(a => { a.playbackRate = speed; });
      if (params.get('out') !== '0') studioDone.afterAnimations();
      return;
    }
    if (params.get('out') !== '0') setTimeout(() => { stage.classList.add('out'); studioDone.afterAnimations(); }, (style === 'pro' ? 4400 : 4200) / speed);
  }

  // Builds a template once its logo has loaded, then starts it when the pictures and font are ready.
  async function build(logo: string, img: HTMLImageElement, rules: { competitionName?: string }) {
    const px = size || 640;
    const name = (params.get('text') ?? rules.competitionName ?? '').trim();
    const box = $('tpl');
    document.documentElement.style.setProperty('--logo', `url("${logo.replace(/"/g, '%22')}")`);
    box.innerHTML = TEMPLATES[template](logo, { size: px, name, sub: (params.get('sub') || '').trim(),
      aspect: img.naturalWidth / img.naturalHeight || 1, rand: seeded(20261014) });
    if (template === 'title' && !name) console.warn('Logo animation: no competition name for the title template; add ?text=');
    await Promise.all([...box.querySelectorAll('img')].map(i => i.decode().catch(() => {})));
    if (document.fonts) await document.fonts.ready;
    if (template === 'title') {
      // The logo starts in the middle of the screen, then slides left to make room for the name.
      const row = box.querySelector<HTMLElement>('.row')!, slide = box.querySelector<HTMLElement>('.slide')!;
      row.style.setProperty('--shift', (row.offsetWidth - slide.offsetWidth) / 2 + 'px');
    }
    play();
  }

  async function load() {
    try {
      const res = await fetch('/api/scoreboard', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const rules: LogoRules & { competitionName?: string } = (await res.json()).rules || {};
      const logo = (dark ? rules.competitionLogoDark : rules.competitionLogoLight) || rules.competitionLogo;
      if (!logo) { console.warn('Logo animation: the competition setup has no competition logo'); return; }
      if (built) {
        const img = new Image();
        img.onload = () => build(logo, img, rules);
        img.onerror = () => console.warn('Logo animation: could not load the competition logo', logo);
        img.src = logo;
        return;
      }
      const img = $<HTMLImageElement>(style === 'pro' ? 'proLogo' : 'funLogo');
      // The light sweep only covers the logo's own shape.
      $('shine').style.webkitMaskImage = $('shine').style.maskImage = `url("${logo}")`;
      // Starts once the logo has loaded, so it never animates an empty box.
      let started = false;
      const start = () => { if (!started) { started = true; play(); } };
      img.onload = start;
      img.onerror = () => console.warn('Logo animation: could not load the competition logo', logo);
      img.src = logo;
      document.querySelectorAll<HTMLImageElement>('.trail .logo').forEach(t => { t.src = logo; });
      setTimeout(() => { if (!started && img.complete && img.naturalWidth) start(); }, 3000);
    } catch (err) { console.warn('Logo animation: competition logo unavailable:', err instanceof Error ? err.message : err); }
  }
  load();
})();

// What makes this file a module (its names its own), as the first line says.
export {};
