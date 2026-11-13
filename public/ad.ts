// FirstPass Studio - the FirstPass Studio ad's script (ad.html loads it as a module, so its names stay its own).

(function () {
  const params = new URLSearchParams(location.search);
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const stage = $('stage');
  if (params.get('out') === '0') stage.classList.add('stay');

  // Background, as on logo.html: ?bg=gradient, ?bg=<colour> (radial to a darker shade, ?bg2= the edge),
  // ?bg=solid-<colour>, ?bgimage=<file in the competition's brand folder, or a link>.
  function colour(v: string | null) {
    if (!v) return null;
    v = v.trim();
    if (/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v)) v = '#' + v;
    return CSS.supports('color', v) ? v : null;
  }
  function darker(c: string) {
    const ctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
    ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${Math.round(r * .3)}, ${Math.round(g * .3)}, ${Math.round(b * .3)})`;
  }
  const bg = (params.get('bg') || '').trim(), image = (params.get('bgimage') || '').trim();
  const layers: string[] = [];
  if (image) {
    const url = /[/:]/.test(image) ? image : '/brand/' + encodeURIComponent(image);
    layers.push(`url("${url.replace(/"/g, '%22')}")`);
    const test = new Image(); test.onerror = () => console.warn('Ad: could not load the background image', image); test.src = url;
  }
  if (bg) {
    const solid = bg.toLowerCase().startsWith('solid-') ? colour(bg.slice(6)) : null;
    const centre = bg.toLowerCase() === 'gradient' ? '#3a4250' : colour(bg);
    const edge = colour(params.get('bg2')) || (bg.toLowerCase() === 'gradient' ? '#15181d' : centre && darker(centre));
    if (solid) layers.push(`linear-gradient(${solid}, ${solid})`);
    else if (centre) layers.push(`radial-gradient(circle at 50% 40%, ${centre}, ${edge})`);
    else console.warn('Ad: ?bg= is not a colour or "gradient":', bg);
  }
  if (layers.length) { $('backdrop').style.backgroundImage = layers.join(', '); $('backdrop').hidden = false; }
  const glow = params.get('glow');
  // Chroma key safe (chroma.js): the soft glow would only key as a coloured oval, so it's left out.
  if (!window.studioChroma && (glow === '1' || (glow !== '0' && layers.length))) stage.classList.add('with-glow');

  // The wordmark: the coloured one (light mode) over a light or busy picture, the white one (dark mode) over a dark one.
  const asked = (params.get('mode') || '').toLowerCase();
  const dark = asked ? asked === 'dark' : layers.length > 0;
  if (dark) stage.classList.add('dark');
  const markSrc = dark ? 'studio/firstpass-studio.svg' : 'studio/firstpass-studio-light.svg';
  $<HTMLImageElement>('mark').src = markSrc;
  $('markShine').style.webkitMaskImage = $('markShine').style.maskImage = `url("${markSrc}")`;

  const tagline = (params.get('tagline') || '').trim();
  if (tagline) { $('tagline').textContent = tagline; $('tagline').hidden = false; }

  // Streak bars and sparkles. A fixed seed keeps them the same on every play.
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  function streaks(box: HTMLElement, start: number) {
    [[300, 46, 760], [400, 22, 520], [486, 70, 980], [612, 26, 640], [700, 14, 420]].forEach(([y, h, w], i) => {
      const b = document.createElement('div');
      b.className = 'bar';
      b.style.cssText = `--y:${y}px;--h:${h}px;--w:${w}px;--d:${start + i * .06}s`;
      box.appendChild(b);
    });
  }
  streaks($('streaksIn'), .2);
  streaks($('streaksOut'), 0);
  const sparkColours = ['#f1c40f', '#ff8a1f', '#9b30ff', '#ffffff', '#d9468f'];
  for (let i = 0; i < 44; i++) {
    const s = document.createElement('div');
    s.className = 'spark';
    const x = 960 + (rand() - .5) * 1500, y = 560 + (rand() - .3) * 420;
    s.style.cssText = `--x:${x}px;--y:${y}px;--s:${6 + rand() * 10}px;--t:${2 + rand() * 1.6}s;--d:${1.3 + rand() * 5.4}s;background:${sparkColours[i % sparkColours.length]}`;
    $('sparkles').appendChild(s);
  }

  // Starts once both logos have loaded, so it never animates an empty box.
  let started = false;
  const start = () => { if (!started) { started = true; stage.classList.add('go'); if (params.get('out') !== '0') studioDone.afterAnimations(); } };
  Promise.all([$<HTMLImageElement>('pivt'), $<HTMLImageElement>('mark')].map(img => img.decode().catch(() => console.warn('Ad: could not load', img.src))))
    .then(start);
  setTimeout(start, 3000);
})();

// What makes this file a module (its names its own), as the first line says.
export {};
