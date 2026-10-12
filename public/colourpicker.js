// Colour picker for the studio pages (setup.html). ColourPicker.field(value, onChange, opts)
// returns a swatch button and a text box. The box takes HEX (#7f4092, 7f4092, #74f) or RGB
// (rgb(127, 64, 146), "127, 64, 146", "R127 G64 B146") as copied from a brand kit, and shows
// HEX once you leave it. The swatch opens a picker: a shade square, a hue slider, HEX and
// R G B boxes, the screen eyedropper where the browser has one, and swatches from
// opts.swatches() ([{ title, colours: [{ hex, name }] }]). ColourPicker.findAll(text) pulls
// every colour out of pasted brand kit text, with the words before each one as its name.
(function () {
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const hex2 = n => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  const toHex = ([r, g, b]) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  const toRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const okRgb = a => a.length === 3 && a.every(n => Number.isFinite(n) && n >= 0 && n <= 255);

  // One colour typed or pasted into a box, as #rrggbb, or null.
  function parse(text) {
    const s = String(text || '').trim().toLowerCase();
    let m = s.match(/^(?:hex\s*:?\s*)?#?([0-9a-f]{6}|[0-9a-f]{3})$/);
    if (m) return '#' + (m[1].length === 3 ? [...m[1]].map(c => c + c).join('') : m[1]);
    m = s.match(/^(?:rgba?\s*:?\s*)?\(?\s*(\d{1,3}(?:\.\d+)?)\s*[,\s]\s*(\d{1,3}(?:\.\d+)?)\s*[,\s]\s*(\d{1,3}(?:\.\d+)?)\s*(?:[,/]\s*[\d.]+%?\s*)?\)?;?$/)
      || s.match(/^r\s*:?\s*(\d{1,3})\s*,?\s*g\s*:?\s*(\d{1,3})\s*,?\s*b\s*:?\s*(\d{1,3})$/);
    if (m) { const a = m.slice(1, 4).map(Number); if (okRgb(a)) return toHex(a); }
    return null;
  }

  // Every colour in a block of brand kit text. HEX needs its # (or "HEX") so words like
  // "facade" aren't read as colours; RGB can be rgb(…), "RGB 127 64 146" or "R127 G64 B146".
  function findAll(text) {
    const found = [];
    const add = (hex, before) => {
      const name = before.replace(/(hex|rgba?|cmyk|pms|pantone)\s*:?\s*$/i, '').replace(/[^\p{L}\p{N}' &-]+/gu, ' ').trim().split(/\s+/).slice(-3).join(' ');
      if (!found.some(f => f.hex === hex)) found.push({ hex, name });
    };
    const re = /(#|\bhex\s*:?\s*#?)([0-9a-f]{6}|[0-9a-f]{3})\b|\brgba?\s*:?\s*\(?\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})|\br\s*:?\s*(\d{1,3})\s*,?\s*g\s*:?\s*(\d{1,3})\s*,?\s*b\s*:?\s*(\d{1,3})/gi;
    // A brand kit often gives HEX and RGB for the same colour; the repeat is dropped.
    for (const line of String(text || '').split(/\r?\n/)) {
      let m, last = 0;
      re.lastIndex = 0;
      while ((m = re.exec(line))) {
        const hex = m[2] ? parse(m[2]) : parse((m[3] ? m.slice(3, 6) : m.slice(6, 9)).join(','));
        if (hex) add(hex, line.slice(last, m.index));
        last = m.index + m[0].length;
      }
    }
    return found;
  }

  // HSV, for the shade square and hue slider.
  function rgbToHsv([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
    let h = 0;
    if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [(h * 60 + 360) % 360, max ? d / max : 0, max];
  }
  function hsvToRgb([h, s, v]) {
    const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
    return [f(5), f(3), f(1)].map(x => x * 255);
  }

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  let panel = null, current = null;

  function close() { if (panel) { panel.remove(); panel = null; current = null; } }
  document.addEventListener('pointerdown', e => { if (panel && !panel.contains(e.target) && !e.target.closest('.cp-swatch')) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && panel) { const s = current && current.swatch; close(); if (s) s.focus(); } });
  window.addEventListener('resize', close);

  function open(f) {
    if (current === f) { close(); return; }
    close();
    current = f;
    let hsv = rgbToHsv(toRgb(f.get()));
    panel = el('div', 'cp-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Pick a colour');
    const sv = el('div', 'cp-sv'), knob = el('div', 'cp-knob');
    sv.append(knob);
    const hue = Object.assign(el('input', 'cp-hue'), { type: 'range', min: 0, max: 359, step: 1 });
    hue.setAttribute('aria-label', 'Hue');
    const hexBox = Object.assign(el('input', 'cp-hex'), { type: 'text', spellcheck: false });
    const rgbBoxes = ['R', 'G', 'B'].map(n => Object.assign(el('input'), { type: 'number', min: 0, max: 255, step: 1, title: n }));
    const fields = el('div', 'cp-fields');
    const lab = (t, input) => { const l = el('label', '', t); l.append(input); return l; };
    fields.append(lab('HEX', hexBox), ...rgbBoxes.map((b, i) => lab('RGB'[i], b)));
    panel.append(sv, hue, fields);

    function show(from) {
      const rgb = hsvToRgb(hsv), hex = toHex(rgb);
      sv.style.backgroundColor = `hsl(${hsv[0]}, 100%, 50%)`;
      knob.style.left = `${hsv[1] * 100}%`; knob.style.top = `${(1 - hsv[2]) * 100}%`;
      knob.style.backgroundColor = hex;
      if (from !== 'hue') hue.value = Math.round(hsv[0]);
      if (from !== 'hex') hexBox.value = hex;
      if (from !== 'rgb') rgbBoxes.forEach((b, i) => { b.value = Math.round(rgb[i]); });
      return hex;
    }
    const set = (from) => f.set(show(from), true);
    const setHex = (hex, from) => { const keepHue = hsv[0]; hsv = rgbToHsv(toRgb(hex)); if (!hsv[1]) hsv[0] = keepHue; f.set(show(from), true); };

    const drag = e => {
      const r = sv.getBoundingClientRect();
      hsv = [hsv[0], clamp((e.clientX - r.left) / r.width, 0, 1), 1 - clamp((e.clientY - r.top) / r.height, 0, 1)];
      set();
    };
    sv.addEventListener('pointerdown', e => { sv.setPointerCapture(e.pointerId); drag(e); });
    sv.addEventListener('pointermove', e => { if (sv.hasPointerCapture(e.pointerId)) drag(e); });
    sv.tabIndex = 0;
    sv.setAttribute('aria-label', 'Shade: arrow keys move');
    sv.addEventListener('keydown', e => {
      const d = { ArrowLeft: [-.02, 0], ArrowRight: [.02, 0], ArrowUp: [0, .02], ArrowDown: [0, -.02] }[e.key];
      if (!d) return;
      e.preventDefault();
      hsv = [hsv[0], clamp(hsv[1] + d[0], 0, 1), clamp(hsv[2] + d[1], 0, 1)];
      set();
    });
    hue.oninput = () => { hsv = [Number(hue.value), hsv[1], hsv[2]]; set('hue'); };
    hexBox.oninput = () => { const h = parse(hexBox.value); hexBox.classList.toggle('bad', !h); if (h) setHex(h, 'hex'); };
    hexBox.onchange = () => { hexBox.classList.remove('bad'); show(); };
    rgbBoxes.forEach(b => {
      b.oninput = () => { const a = rgbBoxes.map(x => Number(x.value)); if (okRgb(a) && rgbBoxes.every(x => x.value !== '')) setHex(toHex(a), 'rgb'); };
      b.onchange = () => show();
    });

    const tools = el('div', 'cp-tools');
    if (window.EyeDropper) {
      const eye = el('button', 'alt', 'Pick from screen');
      eye.type = 'button';
      eye.title = 'Click anywhere on screen, such as a brand kit or logo in another window';
      eye.onclick = async () => { try { const r = await new window.EyeDropper().open(); const h = parse(r.sRGBHex); if (h) setHex(h); } catch { /* cancelled */ } };
      tools.append(eye);
    }
    const done = el('button', '', 'Done');
    done.type = 'button';
    done.onclick = () => { const s = f.swatch; close(); s.focus(); };
    tools.append(done);

    for (const group of (f.opts.swatches ? f.opts.swatches() : [])) {
      const cols = (group.colours || []).filter(c => parse(c.hex));
      if (!cols.length) continue;
      const box = el('div', 'cp-group');
      box.append(el('div', 'cp-group__title', group.title));
      const row = el('div', 'cp-chips');
      for (const c of cols) {
        const b = el('button', 'cp-chip');
        b.type = 'button';
        b.style.backgroundColor = c.hex;
        b.title = (c.name ? c.name + ' ' : '') + c.hex;
        b.setAttribute('aria-label', b.title);
        b.onclick = () => setHex(parse(c.hex));
        row.append(b);
      }
      box.append(row);
      panel.append(box);
    }
    panel.append(tools);
    show();

    document.body.append(panel);
    const r = f.swatch.getBoundingClientRect(), w = panel.offsetWidth, h = panel.offsetHeight;
    const left = clamp(r.left + window.scrollX, window.scrollX + 8, window.scrollX + document.documentElement.clientWidth - w - 8);
    const below = r.bottom + 6 + h < window.innerHeight || r.top - 6 - h < 0;
    panel.style.left = `${left}px`;
    panel.style.top = `${(below ? r.bottom + 6 : r.top - 6 - h) + window.scrollY}px`;
    sv.focus();
  }

  // A swatch and a text box for one colour. onChange(hex) runs on every change.
  function field(value, onChange, opts = {}) {
    const wrap = el('span', 'cp-field');
    const swatch = el('button', 'cp-swatch');
    swatch.type = 'button';
    swatch.setAttribute('aria-label', `${opts.label ? opts.label + ': ' : ''}open colour picker`);
    const box = Object.assign(el('input', 'cp-text'), { type: 'text', spellcheck: false, placeholder: '#hex or r, g, b' });
    if (opts.label) box.setAttribute('aria-label', `${opts.label} (HEX or RGB)`);
    let hex = parse(value) || '#000000';
    const f = {
      opts, swatch,
      get: () => hex,
      set(h, fromPanel) {
        hex = h;
        swatch.style.backgroundColor = h;
        swatch.title = `${h}  ·  RGB ${toRgb(h).join(', ')}`;
        if (fromPanel || document.activeElement !== box) { box.value = h; box.classList.remove('bad'); }
        onChange(h);
      },
    };
    const paint = () => { swatch.style.backgroundColor = hex; swatch.title = `${hex}  ·  RGB ${toRgb(hex).join(', ')}`; box.value = hex; };
    paint();
    swatch.onclick = () => open(f);
    box.oninput = () => {
      const h = parse(box.value);
      box.classList.toggle('bad', !!box.value.trim() && !h);
      if (h && h !== hex) f.set(h);
    };
    box.onchange = () => { box.classList.remove('bad'); box.value = hex; };
    wrap.append(swatch, box);
    wrap.setValue = h => { hex = parse(h) || hex; paint(); };
    return wrap;
  }

  window.ColourPicker = { field, parse, findAll, toRgb, close };
})();
