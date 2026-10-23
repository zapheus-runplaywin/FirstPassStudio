// FirstPass Studio - chroma key safe graphics (for the chroma output; on by default there, and can be turned off).
//
// A chroma key cuts out one colour, so anything see-through blends with that colour and keys badly:
// see-through panels, soft shadows and glows, fades to transparent, and soft edges leave a coloured
// fringe or holes. Chroma safe makes every pixel either fully there or fully clear:
//   - dark panels are solid (the competition setup's "Dark panels see-through" is ignored);
//   - soft shadows and glows (box-shadow, text-shadow, filter: drop-shadow) go, and hard ones
//     (no blur) stay, made solid;
//   - soft glows, flashes and vignettes (radial gradients that fade to see-through), bursts and rays
//     that fade out through a radial mask, and backdrop blurs go;
//   - everything left (gradients that fade out, fades in and out, particles, videos' soft edges,
//     anti-aliased edges) is cut at half transparency by an SVG filter, so nothing half see-through
//     reaches the key. A fade becomes a cut halfway through.
//
// It never changes a saved setting: it only overrides how the page draws, so turning it off (or picking
// another output) brings everything back as it was. Page options that would make something see-through
// (the countdown's fade, the ad's glow) are skipped while it's on: those pages check window.studioChroma.
// On when the page's link has ?chromaKey=true (an OBS browser source keyed on a colour), or when the
// page is inside a scene that is chroma key safe (scene.html?chromaKey=true, opened that way by the Mac
// app's chroma outputs unless Chroma key safe is unticked on the Output page). Every overlay page loads
// it in <head>.
// In a scene the scene filters its whole frame once (scene.html marks its stage with
// <html data-chroma-alpha="#stage">), so its pages only make their panels and shadows solid.
(function () {
  const root = document.documentElement;
  const inScene = () => {
    try {
      for (let w = window; w.parent !== w; w = w.parent) if (w.parent.document.documentElement.classList.contains('chroma-safe')) return true;
    } catch {}
    return false;
  };
  const asked = new URLSearchParams(location.search).get('chromaKey');
  const on = asked === 'true' || asked === '1' || inScene();
  window.studioChroma = on;
  if (!on) return;
  root.classList.add('chroma-safe');
  const ID = 'studio-chroma-alpha';
  // Where the cut goes: the whole page on its own; a scene's frame (not its key colour background) in a scene.
  const target = root.dataset.chromaAlpha || (inScene() ? '' : ':root');

  // Splits at top level separators (not inside brackets).
  function split(s, sep) {
    const out = [];
    let depth = 0, cur = '';
    for (const ch of s) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (depth === 0 && (sep === ' ' ? /\s/.test(ch) : ch === sep)) { if (cur.trim()) out.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  const LENGTH = /^-?(\d+\.?\d*|\.\d+)(px|em|rem|vw|vh)?$/;
  // The colour without its transparency, or null for one that's fully clear.
  function solidColour(c) {
    if (/^transparent$/i.test(c)) return null;
    let m = c.match(/^(rgba?|hsla?)\((.*)\)$/i);
    if (m) {
      let args = m[2];
      if (args.includes('/')) args = args.slice(0, args.indexOf('/')).trim();
      else {
        const parts = split(args, ',');
        if (parts.length === 4 || (parts.length === 2 && /^var\(/.test(parts[0]))) parts.pop();
        args = parts.join(', ');
      }
      return `${m[1].toLowerCase().replace(/a$/, '')}(${args})`;
    }
    m = c.match(/^#([0-9a-f]{6})[0-9a-f]{2}$/i) || c.match(/^#([0-9a-f]{3})[0-9a-f]$/i);
    if (m) return '#' + m[1];
    return c;
  }
  // One shadow (box-shadow, text-shadow or drop-shadow's inside): solid if it has no blur, else gone (null).
  // An inset shadow is inside its box, so it's left alone.
  function solidShadow(s) {
    const tokens = split(s, ' ');
    if (tokens.some(t => /^inset$/i.test(t))) return s;
    const lengths = tokens.filter(t => LENGTH.test(t));
    const others = tokens.filter(t => !LENGTH.test(t));
    // A length that can't be read (calc()) might be a blur, so it goes. A lone var() is taken as the colour.
    if (others.length > 1 || (others[0] && /^(calc|min|max|clamp)\(/i.test(others[0]))) return null;
    if (lengths.length < 2 || (lengths[2] && parseFloat(lengths[2]) !== 0)) return null;
    const colour = others[0] ? solidColour(others[0]) : 'currentcolor';
    return colour && [...lengths, colour].join(' ');
  }
  const solidShadows = v => split(v, ',').map(solidShadow).filter(Boolean).join(', ') || 'none';
  const solidFilter = v => split(v, ' ').map(f => {
    const m = f.match(/^drop-shadow\((.*)\)$/i);
    if (!m) return f;
    const s = solidShadow(m[1]);
    return s && `drop-shadow(${s})`;
  }).filter(Boolean).join(' ') || 'none';
  // Soft glows, flashes and vignettes are radial gradients that fade to see-through: cut at half, they'd
  // be hard coloured ovals, so they go. (Gradients that fade in a line, like a stripe's ends, are only cut.)
  const seeThrough = g => /\btransparent\b/i.test(g) || split(g.replace(/^[a-z-]+\(|\)$/gi, ''), ',').some(stop =>
    split(stop, ' ').some(t => {
      const m = t.match(/^(rgba?|hsla?)\((.*)\)$/i);
      if (!m) return false;
      const parts = m[2].includes('/') ? [m[2].split('/').pop()] : split(m[2], ',');
      const a = parts.length === 4 || parts.length === 2 || m[2].includes('/') ? parts[parts.length - 1].trim() : '1';
      return parseFloat(a) / (a.endsWith('%') ? 100 : 1) < 1;
    }));
  const noGlows = v => {
    const layers = split(v, ',');
    const kept = layers.filter(l => !/^(repeating-)?radial-gradient\(/i.test(l) || !seeThrough(l));
    return kept.length === layers.length ? v : kept.join(', ') || 'none';
  };
  window.studioChromaSafe = { solidShadows, solidFilter, noGlows }; // for the tests

  // What each style was left as, so a style already fixed (and written back the browser's way) isn't fixed again.
  const fixed = new WeakMap();
  function fixStyle(style) {
    const was = fixed.get(style) || {};
    for (const [prop, fix] of [['box-shadow', solidShadows], ['text-shadow', solidShadows], ['filter', solidFilter], ['-webkit-filter', solidFilter]]) {
      const v = style.getPropertyValue(prop);
      if (!v || v === 'none' || v === was[prop]) continue;
      const nv = fix(v);
      if (nv !== v) style.setProperty(prop, nv, style.getPropertyPriority(prop));
      was[prop] = style.getPropertyValue(prop);
    }
    fixed.set(style, was);
    for (const prop of ['background', 'background-image']) {
      const v = style.getPropertyValue(prop);
      if (!v || !/radial-gradient/i.test(v) || v === was[prop]) continue;
      const nv = noGlows(v);
      if (nv !== v) style.setProperty(prop, nv, style.getPropertyPriority(prop));
      was[prop] = style.getPropertyValue(prop);
    }
    // Bursts and rays behind animations fade out at their edge through a radial mask: cut at half they'd be
    // a hard disc of spokes, so they're left out.
    if (!was.masked && ['mask-image', '-webkit-mask-image', 'mask', '-webkit-mask'].some(p => {
      const v = style.getPropertyValue(p);
      return /radial-gradient/i.test(v) && split(v, ',').some(l => /^radial-gradient\(/i.test(l) && seeThrough(l));
    })) { style.setProperty('visibility', 'hidden', 'important'); was.masked = true; }
    for (const prop of ['backdrop-filter', '-webkit-backdrop-filter']) {
      if (style.getPropertyValue(prop)) style.setProperty(prop, 'none', style.getPropertyPriority(prop));
    }
  }
  const done = new WeakSet();
  function fixRules(rules) {
    for (const rule of rules) {
      if (done.has(rule)) continue;
      done.add(rule);
      if (rule.style) fixStyle(rule.style);
      if (rule.cssRules) fixRules(rule.cssRules);
    }
  }
  function fixAll() {
    for (const sheet of document.styleSheets) {
      let rules = null;
      try { rules = sheet.cssRules; } catch { continue; } // another site's style sheet (web fonts): nothing to fix
      if (rules) fixRules(rules);
    }
    for (const el of document.querySelectorAll('[style]')) fixStyle(el.style);
  }

  // Solid panels, and the cut. The panel colours come from theme.css (competitions.js themeCss).
  const css = document.createElement('style');
  css.textContent = `
    html.chroma-safe { --purple-deep: rgb(var(--deep-rgb)); --purple-deep-alt: rgb(var(--deep-alt-rgb)); }
    ${target ? `${target === ':root' ? 'html.chroma-safe' : `html.chroma-safe ${target}`} { filter: url(#${ID}); }` : ''}`;
  document.head.appendChild(css);
  if (target) {
    // Alpha under a half becomes 0, the rest 1 (colours are filtered unpremultiplied, so they stay as they are).
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
    svg.innerHTML = `<filter id="${ID}" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB">
      <feComponentTransfer><feFuncA type="discrete" tableValues="0 1"/></feComponentTransfer></filter>`;
    const add = () => document.body.appendChild(svg);
    if (document.body) add(); else document.addEventListener('DOMContentLoaded', add);
  }
  fixAll();
  document.addEventListener('DOMContentLoaded', fixAll);
  addEventListener('load', fixAll);
  // Style sheets and styled elements added later (pages that build their graphic from the helper's data).
  new MutationObserver(list => {
    for (const m of list) {
      if (m.type === 'attributes') { fixStyle(m.target.style); continue; }
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.tagName === 'STYLE' || n.tagName === 'LINK') { n.addEventListener('load', fixAll); setTimeout(fixAll); }
        if (n.hasAttribute('style')) fixStyle(n.style);
        for (const el of n.querySelectorAll('[style]')) fixStyle(el.style);
      }
    }
  }).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  window.pageLog && window.pageLog('info', 'Chroma key safe: solid panels, no soft shadows, nothing half see-through');
})();
