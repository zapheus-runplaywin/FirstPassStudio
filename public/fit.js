// Keeps a graphic in the space between the title banner (top centre) and the scoreboard
// (bottom centre, above the ticker), with some room around it so the frame isn't cluttered.
//
// The space is set here once, as CSS variables on the page:
//   --zone-top     just under the title banner (its bottom edge is at about 162px, so there is room to spare)
//   --zone-bottom  just over the scoreboard's PlayHQ Live tab (its top edge is at about 930px)
// Pages place their graphic in that space with CSS. This script scales the graphic down,
// keeping its shape, when it's taller or wider than the space (long team lists, big
// ladders), and again whenever its content changes. It never makes a graphic bigger.
//
// Load it in <head>, then mark the graphic with data-fit:
//   <main class="card" data-fit>              scales from its centre (sets the CSS scale property)
//   <main class="card" data-fit="var">        only sets --fit (1 when it fits), for a page whose own CSS
//                                             already positions the graphic with transform, as in
//                                             transform: translateX(-50%) scale(var(--fit, 1));
//
// Full-screen animations (The Clash, winner, super shot, logo) mark their 1920x1080 stage with the
// part of the frame their content uses, top and bottom in px, and are moved and scaled to fit the space:
//   <div class="stage" data-fit-box="60 1000">
(function () {
  const ZONE = { top: 244, bottom: 894, width: 1800 };
  const root = document.documentElement.style;
  root.setProperty('--zone-top', ZONE.top + 'px');
  root.setProperty('--zone-bottom', ZONE.bottom + 'px');
  root.setProperty('--zone-height', (ZONE.bottom - ZONE.top) + 'px');

  function fit(el) {
    // offsetWidth/Height are the unscaled layout size, so scaling doesn't feed back into itself.
    const w = el.offsetWidth, h = el.offsetHeight;
    if (!w || !h) return;
    const s = Math.min(1, (ZONE.bottom - ZONE.top) / h, ZONE.width / w);
    const asVar = el.dataset.fit === 'var';
    const next = s < 1 ? String(Math.floor(s * 1000) / 1000) : asVar ? '1' : '';
    if ((asVar ? el.style.getPropertyValue('--fit') : el.style.scale) !== next) {
      if (asVar) el.style.setProperty('--fit', next);
      else el.style.scale = next;
      if (s < 1 && window.pageLog) window.pageLog('info', `Scaled to ${next} to fit between the title and the scoreboard (${w}x${h}px)`);
    }
  }

  // Maps the box's middle onto the middle of the space, scaled down if the box is taller than it.
  function fitBox(el) {
    const [top, bottom] = el.dataset.fitBox.split(/[\s,]+/).map(Number);
    if (!(bottom > top)) return;
    const s = Math.min(1, (ZONE.bottom - ZONE.top) / (bottom - top));
    const mid = (top + bottom) / 2, zoneMid = (ZONE.top + ZONE.bottom) / 2;
    el.style.transformOrigin = `960px ${mid}px`;
    el.style.scale = s < 1 ? String(Math.floor(s * 1000) / 1000) : '';
    el.style.translate = `0 ${zoneMid - mid}px`;
  }

  // A page can change its box later (logo.html does once it knows the logo size) and call this again.
  window.fitBox = fitBox;

  function start() {
    document.querySelectorAll('[data-fit-box]').forEach(fitBox);
    const items = document.querySelectorAll('[data-fit]');
    items.forEach(el => {
      fit(el);
      new ResizeObserver(() => fit(el)).observe(el);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
