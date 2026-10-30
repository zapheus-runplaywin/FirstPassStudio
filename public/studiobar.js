// FirstPass Studio - the tab bar at the top of every Studio page, drawn from one list.
//
// Each Studio page (not the graphics) has an empty <header class="fp-bar"></header> and loads this
// script straight after it, which fills in the wordmark and the tabs and marks the page it is on.
// Add a tab here and every page and the Mac app's Go menu (desktop/windows.js reads STUDIO_PAGES
// too, with ⌘1, ⌘2... in this order) have it. Tabs are listed in the order Matt set: Output,
// Production Planner, Scoreboard control, Competitions setup, Sponsors, Athletes, Stream Deck, Socials, Recordings, Docs
// (the tenth tab is ⌘0).
(function () {
  'use strict';
  const STUDIO_PAGES = [
    { href: '/output.html', label: 'Output', also: ['/'] },
    { href: '/planner.html', label: 'Production Planner' },
    { href: '/control.html', label: 'Scoreboard control' },
    { href: '/setup.html', label: 'Competitions setup' },
    { href: '/sponsors.html', label: 'Sponsors', also: ['/sponsorreport.html'] },
    { href: '/athletes.html', label: 'Athletes' },
    { href: '/api.html', label: 'Stream Deck', also: ['/devices.html'] },
    { href: '/socials.html', label: 'Socials' },
    { href: '/recordings.html', label: 'Recordings' },
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

  // While a practice game or a 4K replay runs (practice.js, replay.js), a red strip under the bar on every Studio page
  // says so, with Stop.
  const strip = document.createElement('div');
  strip.className = 'fp-practice';
  strip.setAttribute('role', 'status');
  strip.style.cssText = 'background:#c62828;color:#fff;font-weight:700;padding:8px 16px;display:none;gap:12px;align-items:center;flex-wrap:wrap';
  bar.after(strip);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const button = 'font:inherit;font-size:13px;padding:2px 10px;border-radius:6px;border:1px solid #fff;background:transparent;color:#fff;cursor:pointer;text-decoration:none';
  // A 4K replay says so the same way, with its own Stop.
  const replay = () => fetch('/api/replay').then(r => r.json()).then(r => {
    if (!r.active) return false;
    strip.style.display = 'flex';
    strip.innerHTML = `<span>4K replay${r.paused ? ' (paused)' : ''}${r.game ? `: ${esc(r.game.home)} v ${esc(r.game.away)}` : ''}. The pages show the recorded night; the live scene and scoreboard can't be changed.</span>`
      + `<a href="/recordings.html" style="${button}">Replay controls</a><button type="button" style="${button}">Stop</button>`;
    strip.querySelector('button').onclick = () => fetch('/api/replay', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"stop":true}' }).then(practice);
    return true;
  }).catch(() => false);
  const practice = async () => { if (await replay()) return; return fetch('/api/practice').then(r => r.json()).then(p => {
    strip.style.display = p.active ? 'flex' : 'none';
    if (!p.active) return;
    strip.innerHTML = `<span>${p.demo ? 'Demo' : 'Practice'} game${p.paused ? ' (paused)' : ''}: ${esc(p.game.home.name)} v ${esc(p.game.away.name)}. Nothing counts for the sponsors.</span>`
      + `<a href="/recordings.html" style="${button}">Practice controls</a><button type="button" style="${button}">Stop</button>`;
    strip.querySelector('button').onclick = () => fetch('/api/practice', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"stop":true}' }).then(practice);
  }).catch(() => {}); };
  practice();
  setInterval(() => { if (!document.hidden) practice(); }, 3000);
})();
