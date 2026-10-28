// FirstPass Studio - the tab bar at the top of every Studio page, drawn from one list.
//
// Each Studio page (not the graphics) has an empty <header class="fp-bar"></header> and loads this
// script straight after it, which fills in the wordmark and the tabs and marks the page it is on.
// Add a tab here and every page and the Mac app's Go menu (desktop/windows.js reads STUDIO_PAGES
// too, with ⌘1, ⌘2... in this order) have it. Tabs are listed in the order Matt set: Output,
// Scoreboard control, Production Planner, Competitions setup, Sponsors, Athletes, Stream Deck, Docs.
(function () {
  'use strict';
  const STUDIO_PAGES = [
    { href: '/output.html', label: 'Output', also: ['/'] },
    { href: '/control.html', label: 'Scoreboard control' },
    { href: '/planner.html', label: 'Production Planner' },
    { href: '/setup.html', label: 'Competitions setup' },
    { href: '/sponsors.html', label: 'Sponsors', also: ['/sponsorreport.html'] },
    { href: '/athletes.html', label: 'Athletes' },
    { href: '/api.html', label: 'Stream Deck', also: ['/devices.html'] },
    { href: '/graphics.html', label: 'Docs' },
  ];

  if (typeof module !== 'undefined' && module.exports) { module.exports = { STUDIO_PAGES }; return; }

  const bar = document.querySelector('header.fp-bar');
  if (!bar || bar.children.length) return;
  const here = location.pathname;
  const current = p => p.href === here || (p.also || []).includes(here);
  const logo = document.createElement('a');
  logo.className = 'fp-logo'; logo.href = '/'; logo.setAttribute('aria-label', 'FirstPass Studio home');
  logo.innerHTML = '<span class="fp-logo__name">FirstPass</span> <span class="fp-logo__product">STUDIO</span>';
  const nav = document.createElement('nav');
  for (const p of STUDIO_PAGES) {
    const a = document.createElement('a');
    a.href = p.href; a.textContent = p.label;
    if (current(p)) a.setAttribute('aria-current', 'page');
    nav.appendChild(a);
  }
  bar.append(logo, nav);
})();
