// FirstPass Studio - the intro and outro's script (introoutro.html loads it as a module, so its names stay its own).

// What /api/introoutro answers: the competition's teams and logos, the game's details, and (for the outro) when to come back.
interface IntroTeam { name: string; logo?: string | null }
interface IntroOutro {
  competition?: string; organisation?: string; division?: string; round?: string; venueName?: string; date?: string; error?: string;
  competitionLogoLight?: string; competitionLogoDark?: string; teams: IntroTeam[]; wrap?: Wrap | null;
}
type Cue = [number, string, number?];
interface Spot { t: IntroTeam; i: number; a: number; x: number; y: number; cx: number; cy: number }
// What a style is given (the ring's spots only for orbit), and what it gives back: when the logo (ct) and the words (wt)
// come in, its sound effects, and anything it starts itself (court's moves).
interface StyleInput { teams: IntroTeam[]; logo?: string; aspect: number; S?: number; spots?: Spot[] }
interface Timing { ct: number; wt: number; cues?: Cue[]; start?: () => void }

(function () {
  const params = new URLSearchParams(location.search);
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const stage = $('stage'), root = document.documentElement.style;
  const LABEL = 'Intro and outro';
  const STYLES = ['orbit', 'parade', 'tiles', 'spotlight', 'court', 'blueprint'];
  const type = (params.get('type') || 'intro').toLowerCase() === 'outro' ? 'outro' : 'intro';
  let style = (params.get('style') || 'orbit').trim().toLowerCase();
  if (style === 'random') style = STYLES[Math.floor(Math.random() * STYLES.length)];
  if (!STYLES.includes(style)) { console.warn(`${LABEL}: no style called`, style, '- using orbit. Styles:', STYLES.join(', ')); style = 'orbit'; }
  stage.classList.add('s-' + style);
  const num = (k: string, min = 0) => { const v = parseFloat(params.get(k) ?? ''); return Number.isFinite(v) && v >= min ? v : null; };
  let speed = num('speed', 0.1) || 1;
  const hold = num('hold') ?? 5, outOn = params.get('out') !== '0';
  studioBackdrop($('backdrop'), params, LABEL);
  // Full screen by default (an intro or outro has the frame to itself); ?fit=1 fits it between the title and the scoreboard.
  if (params.get('fit') === '1') { stage.dataset.fitBox = '70 1010'; if (window.fitBox) window.fitBox(stage); }

  // The final picture: the ring is an ellipse round the middle, RX wide and RY tall.
  const CX = 960, CY = 540, RX = 760, RY = 400;
  const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  const esc = (t: unknown) => String(t).replace(/[&<>"]/g, c => ESC[c]);
  const px = (v: number) => Math.round(v) + 'px';

  // Shrinks a line of words until it fits the width of the words block.
  function fitLine(node: HTMLElement, width = 1100) {
    let size = parseFloat(getComputedStyle(node).fontSize);
    while (node.scrollWidth > width && size > 20) { size -= 2; node.style.fontSize = size + 'px'; }
  }

  function buildRing(teams: IntroTeam[]) {
    const n = teams.length;
    // Logos get smaller as there are more of them, so they never touch round the ring.
    const around = 2 * Math.PI * Math.sqrt((RX * RX + RY * RY) / 2);
    const S = Math.max(64, Math.min(170, around / Math.max(n, 1) * .6));
    root.setProperty('--S', px(S));
    root.setProperty('--squash', String(RY / RX));
    const spots = teams.map((t, i): Spot => {
      const a = -Math.PI / 2 + i * 2 * Math.PI / n;
      return { t, i, a, x: CX + RX * Math.cos(a), y: CY + RY * Math.sin(a), cx: RX * Math.cos(a), cy: RX * Math.sin(a) };
    });
    $('ring').innerHTML = spots.map(s => `<div class="tm" style="left:${px(s.cx)};top:${px(s.cy)}"><div class="tm__in" style="--i:${s.i}" data-i="${s.i}">` +
      `<div class="tm__name">${esc(s.t.name)}</div></div></div>`).join('');
    $('ring').querySelectorAll('.tm__in').forEach((box, i) => box.prepend(logoEl(teams[i], 'tl')));
    return { S, spots };
  }

  // Puts each team (logo, and name under it) at a spot on the frame, for every style but orbit.
  function placeTeams(teams: IntroTeam[], spots: { x: number; y: number }[]) {
    $('teams').innerHTML = teams.map((t, i) => `<div class="tp" style="left:${px(spots[i].x)};top:${px(spots[i].y)}">` +
      `<div class="tm__in" style="--i:${i}"><div class="tm__name">${esc(t.name)}</div></div></div>`).join('');
    $('teams').querySelectorAll('.tm__in').forEach((box, i) => box.prepend(logoEl(teams[i], 'tl')));
  }

  // Each style's own layers and timing: --ct when the competition logo comes in, --wt when the words do.
  const STYLE: Record<string, (o: StyleInput) => Timing> = {
    orbit({ spots = [] }) {
      spots.forEach(s => {
        const from = s.a - 1.1, far = 1500;
        const box = $('ring').querySelectorAll<HTMLElement>('.tm__in')[s.i];
        box.style.setProperty('--fx', px(CX + far * Math.cos(from) - s.x));
        box.style.setProperty('--fy', px(CY + far * .7 * Math.sin(from) - s.y));
      });
      const { ct, wt } = introTiming('orbit', spots.length);
      return { ct, wt, cues: [[0, 'swirl'], ...spots.map((s): Cue => [1.45 + s.i * .07, 'pop', .3]), [ct, 'boom', .8], [ct + .15, 'shimmer']] };
    },
    parade({ teams }) {
      // The teams march in along a line near the bottom with their names and stay there, like a line up;
      // the competition logo and the words go above them.
      const n = Math.max(teams.length, 1), slot = Math.min(230, 1780 / n), S = Math.min(170, slot * .82);
      const step = Math.min(.14, 1.6 / n), y = 850;
      root.setProperty('--S', px(S));
      root.setProperty('--step', step + 's');
      root.setProperty('--laneY', px(y + S / 2 + 56));
      root.setProperty('--namesize', slot < 150 ? '15px' : slot < 190 ? '18px' : '22px');
      placeTeams(teams, teams.map((t, i) => ({ x: CX + (i - (n - 1) / 2) * slot, y })));
      $('under').innerHTML = '<div class="lane"></div>';
      root.setProperty('--cy', '290px'); root.setProperty('--clh', '240px'); root.setProperty('--wy', '430px');
      const { ct, wt } = introTiming('parade', teams.length);
      return { ct, wt, cues: [[0, 'whoosh', .7], ...teams.map((t, i): Cue => [i * step + .45, 'stomp', .8]), [ct, 'boom', .9]] };
    },
    tiles({ teams, logo, aspect }) {
      // A wall of tiles, team logos on the front and a piece of the competition logo on the back.
      const C = 7, R = 3, T = 170, W = C * T, H = R * T, left = CX - W / 2, top = 400 - H / 2;
      const lh = Math.min(H - 20, (W - 40) / (aspect || 1)), lw = lh * (aspect || 1);
      const lx = (W - lw) / 2, ly = (H - lh) / 2;
      let html = `<div class="wall" style="left:${px(left)};top:${px(top)};width:${px(W)};height:${px(H)}">`;
      for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
        const i = r * C + c, team = teams.length ? teams[(i * 5) % teams.length] : null;
        const d1 = .05 + (c + r) * .06, d2 = 1.3 + (c + (R - 1 - r)) * .08;
        html += `<div class="tile" style="left:${px(c * T)};top:${px(r * T)};width:${px(T)};height:${px(T)}">` +
          `<div class="tile__card" style="--d1:${d1.toFixed(2)}s;--d2:${d2.toFixed(2)}s">` +
          `<div class="tile__face tile__front" style="--c:${['var(--purple)', 'var(--yellow)', 'var(--pink)'][(c + r) % 3]}" data-team="${team ? esc(team.name) : ''}"></div>` +
          `<div class="tile__face tile__back" style="background-image:url('${esc(logo || '')}');background-size:${px(lw)} ${px(lh)};` +
          `background-position:${px(lx - c * T - 4)} ${px(ly - r * T - 4)}"></div></div></div>`;
      }
      $('under').innerHTML = html + '</div>';
      $('under').querySelectorAll<HTMLElement>('.tile__front').forEach(f => {
        const team = teams.find(t => t.name === f.dataset.team);
        if (team) f.appendChild(logoEl(team, 'tl'));
      });
      root.setProperty('--wy', px(top + H + 34));
      // A click as each diagonal of tiles turns up, a clack as each flips, and the shine across the finished mosaic.
      const { ct, wt } = introTiming('tiles', teams.length), diagonals = [...Array(C + R - 1).keys()];
      return { ct, wt, cues: [...diagonals.map((k): Cue => [.1 + k * .06, 'tick', .6]), ...diagonals.map((k): Cue => [1.55 + k * .08, 'clack', .7]),
        [ct, 'shimmer', 1.2], [ct, 'boom', .45]] };
    },
    spotlight({ teams }) {
      // The teams stand under an arch across the top of the frame; in the dark, a spotlight visits each in turn
      // (name and all), then the lights come up on all of them with the competition logo and the words below.
      const n = Math.max(teams.length, 1), gap = n > 1 ? 1440 / (n - 1) : 0, S = Math.min(160, Math.max(70, (gap || 300) * .7));
      root.setProperty('--S', px(S));
      root.setProperty('--namesize', gap && gap < 170 ? '14px' : gap && gap < 250 ? '17px' : '22px');
      const spots = teams.map((t, i) => {
        const f = n > 1 ? i / (n - 1) : .5;
        return { i, x: 240 + f * 1440, y: 330 - Math.sin(f * Math.PI) * 170 };
      });
      placeTeams(teams, spots);
      const per = Math.max(.22, Math.min(.42, 3.2 / n)), glide = per * .45, tour = .5 + n * per;
      root.setProperty('--spotW', px(S * 1.9));
      root.setProperty('--tour', tour + 's');
      const frames = [`0% { transform: translate(${px(CX)}, ${px(1300)}); }`];
      spots.forEach(s => {
        const arrive = .5 + s.i * per + glide, leave = .5 + (s.i + 1) * per;
        frames.push(`${(arrive / tour * 100).toFixed(2)}% { transform: translate(${px(s.x)}, ${px(s.y)}); }`);
        frames.push(`${(leave / tour * 100).toFixed(2)}% { transform: translate(${px(s.x)}, ${px(s.y)}); }`);
        $('teams').querySelectorAll<HTMLElement>('.tm__in')[s.i].style.setProperty('--at', (arrive - .05).toFixed(2) + 's');
      });
      frames.push(`100% { transform: translate(${px(CX)}, ${px(600)}); }`);
      const css = document.createElement('style');
      css.textContent = `@keyframes spot-move { ${frames.join(' ')} }`;
      document.head.appendChild(css);
      $('over').innerHTML = '<div class="spot"></div><div class="flash"></div>';
      root.setProperty('--cy', '600px'); root.setProperty('--clh', '230px'); root.setProperty('--wy', '735px');
      const { ct, wt } = introTiming('spotlight', teams.length);
      return { ct, wt, cues: [...spots.map((s): Cue => [.5 + s.i * per + glide - .05, 'clunk', .7]), [tour, 'swell'], [ct, 'boom', .55]] };
    },
    court({ teams }) {
      // A netball court: the outline, the thirds, the centre circle, the goal circles and a goal post at each end.
      const x0 = 70, x1 = 1850, y0 = 100, y1 = 980, third = (x1 - x0) / 3, gr = (y1 - y0) * .36;
      const ln = (d: string, delay: number, cls = 'ln') => `<path class="${cls}" pathLength="1" style="--d:${delay}s" d="${d}"/>`;
      const gx = x1 - 34, gy = CY;
      $('under').innerHTML = `<svg class="court" viewBox="0 0 1920 1080"><rect class="surface" x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" rx="6"/>` +
        ln(`M ${x0} ${y0} H ${x1} V ${y1} H ${x0} Z`, 0) +
        ln(`M ${x0 + third} ${y0} V ${y1}`, .25) + ln(`M ${x1 - third} ${y0} V ${y1}`, .25) +
        ln(`M ${x0} ${CY - gr} A ${gr} ${gr} 0 0 1 ${x0} ${CY + gr}`, .45) + ln(`M ${x1} ${CY - gr} A ${gr} ${gr} 0 0 0 ${x1} ${CY + gr}`, .45) +
        ln(`M ${CX - 46} 540 a 46 46 0 1 0 92 0 a 46 46 0 1 0 -92 0`, .55) +
        ln(`M ${x0 + 34 - 20} ${gy} a 20 20 0 1 0 40 0 a 20 20 0 1 0 -40 0`, .7, 'ln post') + ln(`M ${gx - 20} ${gy} a 20 20 0 1 0 40 0 a 20 20 0 1 0 -40 0`, .7, 'ln post') +
        '</svg>';
      // Play goes from the left goal circle to the right one, every team taking a pass in turn, left to right. With
      // only a few teams the court is too long for one pass each, so after passing a team clears, runs on and
      // reoffers further down the court (each catches twice).
      const n = Math.max(teams.length, 1), catches = n >= 7 ? n : n * 2;
      const S = Math.min(140, Math.max(70, 1500 / catches));
      root.setProperty('--S', px(S));
      const xa = x0 + 160, xb = x1 - 170;
      const pts = Array.from({ length: catches }, (_, k) => {
        const x = catches > 1 ? xa + k * (xb - xa) / (catches - 1) : CX;
        const side = k % 2 ? 1 : -1, ends = k === 0 || k === catches - 1;
        return { x, y: CY + side * (ends ? 70 : 210), side };
      });
      const T0 = 1.7, per = Math.max(.42, Math.min(.62, 4.6 / catches)), turn = .26;
      const tc = (k: number) => T0 + k * per;
      const tGoal = tc(catches - 1) + turn + .6, end = tGoal + 1.6;
      type XY = { x: number; y: number };
      const r = S / 2 + 12, unit = (a: XY, b: XY) => { const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1; return { x: dx / l, y: dy / l }; };
      // Where each team lines up along the side lines once the goal is scored, half along the top and half along the bottom.
      const top = Math.ceil(n / 2), line = (i: number, count: number) => 300 + (count > 1 ? i * 1320 / (count - 1) : 660);
      const lineup = (p: number) => p < top ? { x: line(p, top), y: y0 + 95 } : { x: line(p - top, n - top), y: y1 - 95 };
      placeTeams(teams, teams.map(() => ({ x: 0, y: 0 })));
      const players = [...$('teams').querySelectorAll<HTMLElement>('.tp')];
      const ball = document.createElement('div');
      ball.className = 'ball';
      $('over').innerHTML = '<div class="burst"></div><div class="burst burst--2"></div><div class="burst burst--goal"></div>';
      $('over').prepend(ball);
      root.setProperty('--gx', px(gx)); root.setProperty('--gy', px(gy)); root.setProperty('--goal', tGoal + 's');
      type Frame = { offset: number; transform: string; opacity?: number };
      const at = (t: number, x: number, y: number, extra = ''): Frame => ({ offset: Math.min(1, Math.max(0, t / end)), transform: `translate(${px(x)}, ${px(y)}) ${extra}`.trim() });
      const moves = players.map((): Frame[] => []);
      players.forEach((p, i) => {
        const first = pts[i] || pts[pts.length - 1];
        moves[i].push(at(0, first.x - 150, first.y + first.side * 150));
      });
      // Each catch: the team drives in to meet the ball, catches it on the side it comes from, turns with it
      // to its other side, passes it on, then clears out of the way (and on to its next catch, if it has one).
      const balls: Frame[] = [{ offset: 0, transform: `translate(${px(pts[0].x - r)}, ${px(pts[0].y)})`, opacity: 0 }];
      pts.forEach((pt, k) => {
        const i = k % n, prev: XY = pts[k - 1] || { x: pt.x - 200, y: pt.y }, next: XY = pts[k + 1] || { x: gx, y: gy };
        const uin = unit(pt, prev), uout = unit(pt, next), t = tc(k);
        const lean = (uin.x * uout.y - uin.y * uout.x) > 0 ? 1 : -1;
        const mv = moves[i];
        mv.push(at(t - .45, pt.x - 120, pt.y + pt.side * 120));
        mv.push(at(t - .04, pt.x, pt.y));
        mv.push(at(t + turn * .5, pt.x + 6, pt.y, `rotate(${lean * 18}deg)`));
        mv.push(at(t + turn, pt.x + 4, pt.y));
        mv.push(at(t + turn + .5, pt.x + 70, pt.y + pt.side * 170));
        // The ball: caught on the side it comes from, carried round the front of the logo, passed from the far side.
        const catchAt = { x: pt.x + uin.x * r, y: pt.y + uin.y * r };
        const mid = { x: pt.x - uin.y * lean * r, y: pt.y + uin.x * lean * r };
        const out = { x: pt.x + uout.x * r, y: pt.y + uout.y * r };
        if (k === 0) balls.push({ offset: Math.max(0, (t - .3) / end), transform: `translate(${px(catchAt.x)}, ${px(catchAt.y)})`, opacity: 0 });
        balls.push({ offset: t / end, transform: `translate(${px(catchAt.x)}, ${px(catchAt.y)})`, opacity: 1 });
        balls.push({ offset: (t + turn * .5) / end, transform: `translate(${px(mid.x)}, ${px(mid.y)})`, opacity: 1 });
        balls.push({ offset: (t + turn) / end, transform: `translate(${px(out.x)}, ${px(out.y)})`, opacity: 1 });
        if (k < catches - 1) {
          const nin = unit(pts[k + 1], pt), land = { x: pts[k + 1].x + nin.x * r, y: pts[k + 1].y + nin.y * r };
          const flight = tc(k + 1) - t - turn;
          balls.push({ offset: (t + turn + flight / 2) / end, transform: `translate(${px((out.x + land.x) / 2)}, ${px((out.y + land.y) / 2)}) scale(1.22)`, opacity: 1 });
        } else {
          // The shot: up in an arc and through the ring at the far end.
          balls.push({ offset: (t + turn + .3) / end, transform: `translate(${px((out.x + gx) / 2)}, ${px(gy - 120)}) scale(1.6)`, opacity: 1 });
          balls.push({ offset: tGoal / end, transform: `translate(${px(gx)}, ${px(gy)}) scale(.9)`, opacity: 1 });
          balls.push({ offset: Math.min(1, (tGoal + .2) / end), transform: `translate(${px(gx)}, ${px(gy + 30)}) scale(.6)`, opacity: 0 });
        }
      });
      balls.push({ offset: 1, transform: `translate(${px(gx)}, ${px(gy + 30)}) scale(.6)`, opacity: 0 });
      players.forEach((p, i) => {
        const last = moves[i][moves[i].length - 1], spot = lineup(i);
        moves[i].push({ ...last, offset: Math.min(1, (tGoal + .2) / end) });
        moves[i].push(at(end, spot.x, spot.y));
      });
      root.setProperty('--cy', '410px'); root.setProperty('--clh', '250px'); root.setProperty('--wy', '565px');
      const { ct, wt } = introTiming('court', teams.length);
      // The umpire's whistle, a catch and a throw for every pass, the shot through the net, and the crowd's moment.
      const cues: Cue[] = [[0, 'whoosh', .5], [T0 - .55, 'whistle']];
      pts.forEach((pt, k) => { cues.push([tc(k), 'catch'], [tc(k) + turn, 'pass']); });
      cues.push([tGoal - .05, 'swish'], [ct, 'boom', .8]);
      return { ct, wt, cues, start() {
        const ease: KeyframeAnimationOptions = { easing: 'linear', fill: 'both', duration: end * 1000 };
        players.forEach((p, i) => {
          p.animate(moves[i].sort((a, b) => a.offset - b.offset).map(f => ({ ...f, easing: 'ease-in-out' })), ease);
          p.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: 1000 + i * 60, fill: 'both', easing: 'ease-out' });
        });
        ball.animate(balls.sort((a, b) => a.offset - b.offset), ease);
      } };
    },
    blueprint({ teams, logo }) {
      // The cards: a grid in the middle of the frame, each sketched by a laser, then made solid.
      const n = Math.max(teams.length, 1), cols = Math.min(n, Math.ceil(Math.sqrt(n * 2.2))), rows = Math.ceil(n / cols);
      const cw = Math.min(280, 1640 / cols - 30, (900 / rows - 30) / 1.3), ch = cw * 1.3;
      root.setProperty('--cw', px(cw)); root.setProperty('--ch', px(ch)); root.setProperty('--nameS', px(Math.max(13, Math.min(22, cw / 11))));
      const step = Math.min(.12, 1 / n), solid = .35 + n * step + .9, push = solid + .9, trace = push + .55;
      root.setProperty('--push', push + 's'); root.setProperty('--trace', trace + 's');
      let cards = '';
      teams.forEach((t, i) => {
        const r = Math.floor(i / cols), inRow = r === rows - 1 ? n - r * cols : cols, c = i - r * cols;
        const x = CX + (c - (inRow - 1) / 2) * (cw + 30), y = CY + (r - (rows - 1) / 2) * (ch + 30);
        const tilt = ((c - (inRow - 1) / 2) / Math.max(inRow, 2)) * -24;
        cards += `<div class="bp-card" style="left:${px(x)};top:${px(y)};--d:${(.35 + i * step).toFixed(2)}s;--tilt:${tilt.toFixed(1)}deg" data-i="${i}">` +
          `<div class="bp-frame"></div><div class="bp-face bp-sketch"></div><div class="bp-laser"></div>` +
          `<div class="bp-face bp-solid"><div class="bp-name">${esc(t.name)}</div></div></div>`;
      });
      // Particles: points on the grid that fly out from the middle when the competition logo blasts in.
      let bits = '';
      const rand = ((seed: number) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; })(20261022);
      for (let i = 0; i < 160; i++) {
        const x = 120 + Math.round(rand() * 35) * 48, y = 60 + Math.round(rand() * 20) * 48, a = Math.atan2(y - 400, x - CX), d = 300 + rand() * 700;
        bits += `<div class="bp-bit" style="left:${x}px;top:${y}px;--x:${px(Math.cos(a) * d)};--y:${px(Math.sin(a) * d)};--t:${(.7 + rand() * .8).toFixed(2)}s"></div>`;
      }
      $('under').innerHTML = `<div class="bp-grid"></div><div class="bp-scan"></div><div class="bp-cam">${cards}</div>`;
      $('under').querySelectorAll<HTMLElement>('.bp-card').forEach(card => {
        const t = teams[Number(card.dataset.i)];
        card.querySelector('.bp-sketch')!.appendChild(logoEl(t, 'tl'));
        card.querySelector('.bp-solid')!.prepend(logoEl(t, 'tl'));
      });
      $('over').innerHTML = (logo ? `<img class="bp-comp" src="${esc(logo)}" alt=""><div class="bp-comp-laser"></div>` : '') + `<div class="flash"></div>${bits}`;
      const { ct, wt } = introTiming('blueprint', teams.length);
      const cues: Cue[] = [[0, 'hum'], ...teams.map((t, i): Cue => [.35 + i * step, 'laser', 1 / Math.sqrt(Math.max(1, n / 4))]),
        ...teams.map((t, i): Cue => [.35 + i * step + .9, 'zap', .8]), [push, 'whoosh', .8], [trace, 'laser', 2.2], [ct, 'boom'], [ct + .05, 'sparkle']];
      return { ct, wt, cues };
    },
  };

  function words(data: IntroOutro) {
    const set = (id: string, text?: string | null) => { $(id).textContent = text || ''; };
    set('title', data.competition);
    set('org', data.organisation && data.organisation !== data.competition ? data.organisation : '');
    if (type === 'outro' && data.wrap) {
      const w = wrapWords(data.wrap);
      set('kicker', w.title); set('line', params.get('message') || w.invite); set('detail', w.detail);
    } else {
      if (type === 'outro') console.warn(`${LABEL}: no game this round, so the outro can't say when to join again`);
      set('kicker', type === 'outro' ? 'Thanks for watching' : 'Welcome to');
      set('line', params.get('message') || (type === 'outro' ? '' : [data.round, data.division].filter(Boolean).join('  ·  ')));
      set('detail', type === 'outro' ? '' : [data.venueName, data.date && wrapDay(data.date, true)].filter(Boolean).join('  ·  '));
    }
    ['kicker', 'title', 'org', 'line', 'detail'].forEach(id => fitLine($(id)));
  }

  // The sound: the style's effects, the words rising in and the exit, and the theme, timed as ?themefit= says.
  // Times here are at speed 1; the plan is in real seconds from now.
  async function soundPlan(timing: Timing): Promise<SfxPlan & { sfx: number }> {
    const theme = (params.get('theme') || '').trim(), fit = (params.get('themefit') || 'start').toLowerCase();
    const sfx = (num('sfx') ?? 80) / 100;
    const cues: Cue[] = [...timing.cues || [], [timing.wt, 'rise'], ...(outOn ? [[timing.wt + 1 + hold, 'out', .8] as Cue] : [])];
    let themeAt = 0;
    const length = outOn ? timing.wt + 1 + hold + INTRO_OUT_SEC : timing.wt + 1;
    if (theme) {
      const sec = await studioSound.lengthOf(theme);
      if (!sec) console.warn(`${LABEL}: could not read the theme "${theme}", so it starts with the animation`);
      else {
        if (fit === 'stretch') {
          if (num('speed', 0.1)) console.info(`${LABEL}: ?speed= is set, so the animation isn't stretched to the theme`);
          else speed = Math.max(.75, Math.min(1.25, length / sec));
        } else if (fit === 'logo') themeAt = timing.ct - sec;
        else if (fit === 'end') themeAt = length - sec;
        const runs = length / speed, apart = Math.abs(sec - runs) / runs;
        console.info(`${LABEL}: theme "${theme}" ${sec.toFixed(1)} s, animation ${runs.toFixed(1)} s at ${speed.toFixed(2)}x, theme ${fit}`);
        if (apart > .25) console.warn(`${LABEL}: the theme and the animation are more than 25% apart in length`);
        if (themeAt < 0 && fit !== 'start') console.warn(`${LABEL}: the theme is longer than the animation before it, so its first ${(-themeAt / speed).toFixed(1)} s are skipped`);
      }
    }
    return { sfx, cues: cues.map(([t, name, gain]): Cue => [t / speed, name, gain]),
      theme: theme ? { file: theme, volume: (num('volume') ?? 100) / 100, at: themeAt / speed } : null };
  }

  function play(timing: Timing, plan: SfxPlan & { sfx: number }) {
    root.setProperty('--ct', timing.ct + 's');
    root.setProperty('--wt', timing.wt + 's');
    stage.classList.add('go');
    if (timing.start) timing.start();
    if (speed !== 1) document.getAnimations().forEach(a => { a.playbackRate = speed; });
    if (plan.sfx > 0 || plan.theme) studioSound(plan);
    if (!outOn) return;
    setTimeout(() => {
      stage.classList.add('out');
      if (speed !== 1) requestAnimationFrame(() => document.getAnimations().forEach(a => { a.playbackRate = speed; }));
      studioDone.afterAnimations();
    }, (timing.wt + 1 + hold) * 1000 / speed);
  }

  async function load() {
    try {
      const q = new URLSearchParams({ type });
      const division = params.get('division');
      if (division) q.set('division', division);
      const res = await fetch('/api/introoutro?' + q, { cache: 'no-store' });
      const data: IntroOutro = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'HTTP ' + res.status);
      const logo = (params.get('mode') === 'dark' ? data.competitionLogoDark : data.competitionLogoLight) || data.competitionLogoLight;
      let aspect = 1;
      if (logo) {
        const img = $<HTMLImageElement>('clogo');
        img.src = logo;
        await img.decode().then(() => { aspect = img.naturalWidth / img.naturalHeight || 1; img.hidden = false; })
          .catch(() => console.warn(`${LABEL}: could not load the competition logo`, logo));
      } else console.warn(`${LABEL}: the competition setup has no competition logo`);
      if (!data.teams.length) console.warn(`${LABEL}: no teams found for`, data.division || 'the competition');
      words(data);
      if (style === 'tiles' && !logo) { style = 'orbit'; stage.className = 'stage s-orbit'; }
      const ring = style === 'orbit' ? buildRing(data.teams) : {};
      const timing = STYLE[style]({ ...ring, teams: data.teams, logo, aspect });
      await Promise.all([...document.querySelectorAll('img')].map(i => i.decode().catch(() => {})));
      if (document.fonts) await document.fonts.ready;
      ['kicker', 'title', 'org', 'line', 'detail'].forEach(id => fitLine($(id)));
      const plan = await soundPlan(timing);
      console.info(`${LABEL}: ${type}, ${style}, ${data.teams.length} teams`);
      play(timing, plan);
    } catch (err) { console.warn(`${LABEL} unavailable:`, err instanceof Error ? err.message : err); }
  }
  load();
})();

// What makes this file a module (its names its own), as the first line says.
export {};
