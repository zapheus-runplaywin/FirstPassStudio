// FirstPass Studio - the tab bar at the top of every Studio page, drawn from one list.
//
// Each Studio page (not the graphics) has an empty <header class="fp-bar"></header> and loads this
// script straight after it, which fills in the mark and wordmark, the tabs and the status chips, and marks
// the page it is on. Add a tab here and every page and the Mac app's Go menu (desktop/windows.js reads
// STUDIO_PAGES too, with ⌘1, ⌘2... in this order) have it. The list is in Matt's keyboard order: Output,
// Production Planner, Scoreboard control, Recordings, Socials, Competitions setup, Sponsors, Athletes, Stream Deck,
// Docs (the tenth tab is ⌘0). The bar shows them in three groups, by what the operator is doing (UI level-up,
// 31 Oct 2026): Run (Output, Scoreboard control), Plan (Production Planner, Socials) and Set up (Competitions setup,
// Sponsors, Athletes, Recordings, Stream Deck), with Docs on its own at the right. A tab's `short` is the word the
// bar shows when the full name is long; the page's title, h1 and the Go menu keep the full label.
(function () {
  'use strict';
  const STUDIO_PAGES = [
    { href: '/output.html', label: 'Output', also: ['/'], group: 'Run' },
    { href: '/planner.html', label: 'Production Planner', short: 'Planner', group: 'Plan' },
    { href: '/control.html', label: 'Scoreboard control', short: 'Scoreboard', group: 'Run' },
    { href: '/recordings.html', label: 'Recordings', group: 'Set up' },
    { href: '/socials.html', label: 'Socials', group: 'Plan' },
    { href: '/setup.html', label: 'Competitions setup', short: 'Competitions', group: 'Set up' },
    { href: '/sponsors.html', label: 'Sponsors', also: ['/sponsorreport.html'], group: 'Set up' },
    { href: '/athletes.html', label: 'Athletes', group: 'Set up' },
    { href: '/api.html', label: 'Stream Deck', also: ['/devices.html'], group: 'Set up' },
    { href: '/graphics.html', label: 'Docs', group: 'Docs' },
  ];
  // The groups in the order the bar shows them; Docs is drawn apart, at the right.
  const GROUPS = ['Run', 'Plan', 'Set up'];

  if (typeof module !== 'undefined' && module.exports) { module.exports = { STUDIO_PAGES, GROUPS }; return; }

  const bar = document.querySelector('header.fp-bar');
  if (!bar || bar.children.length) return;
  const here = location.pathname;
  const current = p => p.href === here || (p.also || []).includes(here);
  const tab = p => {
    const a = document.createElement('a');
    a.href = p.href; a.textContent = p.short || p.label;
    if (p.short) a.title = p.label;
    if (current(p)) a.setAttribute('aria-current', 'page');
    return a;
  };
  // The brand: the 1P mark and the FirstPass STUDIO wordmark (public/studio/), both for the navy bar.
  const brand = document.createElement('a');
  brand.className = 'fp-brand'; brand.href = '/'; brand.setAttribute('aria-label', 'FirstPass Studio home');
  brand.innerHTML = '<span class="fp-mark"><img src="/studio/1p-studio-dark.svg" alt=""></span><img class="fp-word" src="/studio/firstpass-studio.svg" alt="FirstPass Studio">';
  const nav = document.createElement('nav');
  for (const g of GROUPS) {
    const label = document.createElement('span');
    label.className = 'fp-grp'; label.textContent = g;
    nav.appendChild(label);
    for (const p of STUDIO_PAGES) if (p.group === g) nav.appendChild(tab(p));
  }
  // The status chips, filled from /api/health below, then Docs.
  const chips = document.createElement('div');
  chips.className = 'fp-chips';
  chips.setAttribute('role', 'status');
  chips.setAttribute('aria-live', 'off');
  const docs = document.createElement('nav');
  docs.className = 'fp-docs';
  for (const p of STUDIO_PAGES) if (p.group === 'Docs') docs.appendChild(tab(p));
  bar.append(brand, nav, chips, docs); // the zoom chip joins after chips below

  // ─── Status chips ───────────────────────────────────────────────────────
  // What's on air, at a glance, from any page: the outputs sending (orange while any is), the game on the board,
  // PlayHQ following and the clock, the sequence playing (step and time left on it) or the triggered one counting
  // down to start, and REC while a game records. One read of /api/health every 2 s while the page is in view; the
  // times count down between reads. Styled by studio.css (.fp-chips).
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mmss = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  let health = null, heardAt = 0;
  const chip = (cls, href, dot, text) => `<a class="chip ${cls}" href="${href}">${dot ? `<span class="dot ${dot}"></span>` : ''}${text}</a>`;
  const render = () => {
    const h = health;
    if (!h) { chips.innerHTML = chip('off', '/output.html', 'bad', 'Studio isn\'t answering'); return; }
    const since = Date.now() - heardAt;
    const left = ms => ms == null ? null : Math.max(0, ms - since);
    const parts = [];
    const air = h.output && h.output.onAir && h.output.onAir.length ? h.output.onAir : h.output && h.output.on ? [{ name: 'Output' }] : [];
    parts.push(air.length ? chip('air', '/output.html', '', `ON AIR · ${esc(air.map(o => o.name).join(', '))}`) : chip('off', '/output.html', 'off', 'Off air'));
    const g = h.game;
    parts.push(g ? chip('game', '/control.html', 'ok', `${esc(g.label)}${g.court ? ` · ${esc(g.court)}` : ''}`) : chip('game off', '/control.html', 'off', 'No game on the board'));
    if (g) {
      const p = h.playhq || {}, c = h.clock || {};
      const clock = c.left != null ? ` · ${esc(c.periodLabel || 'Q')}${esc(c.period)} ${mmss(c.left * 1000 - (c.running ? since : 0))}` : '';
      let dot = 'ok', text;
      if (h.source !== 'playhq') { dot = 'off'; text = 'Scores by hand'; }
      else if (p.waiting) { dot = 'off'; text = 'PlayHQ · not scoring yet'; }
      else if (p.finished) text = 'PlayHQ · game finished';
      else if (p.state === 'bad') { dot = 'bad'; text = 'PlayHQ failing'; }
      else if (p.state === 'warn') { dot = 'warn'; text = 'PlayHQ overdue'; }
      else text = c.following ? 'PlayHQ' : 'PlayHQ · clock by hand';
      parts.push(chip(`playhq ${dot}`, '/control.html', dot, `${text}${clock}`));
    }
    if (h.playing) {
      const s = h.playing, l = s.paused ? s.leftMs : left(s.leftMs);
      parts.push(chip('seq', '/output.html', 'gold', `${esc(s.name || 'Sequence')} ${s.step}/${s.steps}${s.paused ? ' · paused' : l != null ? ` · ${mmss(l)}` : ''}`));
    } else if (h.armed) {
      const a = h.armed, l = left(a.leftMs);
      parts.push(chip('armed', '/output.html', 'ok', `Armed: ${esc(a.name || 'sequence')}${l != null ? ` · in ${mmss(l)}` : ' · after this'}`));
    }
    if (h.recording && h.recording.on) parts.push(chip('rec', '/recordings.html', 'rec', 'REC'));
    chips.innerHTML = parts.join('');
  };
  // Page zoom (the Mac app, desktop/windows.js): the app says the level after each change and each load; while it
  // isn't 100% a chip at the right of the bar shows it, and a click asks for 100% (the app watches for #zoom=100).
  const zoomChip = document.createElement('a');
  zoomChip.className = 'chip zoom';
  zoomChip.href = '#zoom=100';
  zoomChip.title = 'Page zoom: click for actual size (⌘⌥0)';
  zoomChip.hidden = true;
  chips.after(zoomChip);
  document.addEventListener('studio-zoom', e => {
    const pct = Number(e.detail) || 100;
    zoomChip.hidden = pct === 100;
    zoomChip.textContent = `${pct}%`;
  });
  const read = () => fetch('/api/health', { cache: 'no-store' }).then(r => r.json()).then(h => { health = h; heardAt = Date.now(); render(); })
    .catch(() => { health = null; render(); });
  read();
  setInterval(() => { if (!document.hidden) read(); }, 2000);
  setInterval(() => { if (!document.hidden && health) render(); }, 1000);

  // While a practice game or a 4K replay runs (practice.js, replay.js), a red strip under the bar on every Studio page
  // says so, with Stop. One read of /api/playback (both at once) every 3 s while the page is in view; styled by
  // studio.css (.fp-practice).
  const strip = document.createElement('div');
  strip.className = 'fp-practice';
  strip.setAttribute('role', 'status');
  strip.hidden = true;
  bar.after(strip);
  const stop = path => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"stop":true}' }).then(playback);
  const show = (text, controls, stopPath) => {
    strip.innerHTML = `<span>${text}</span><a href="/recordings.html">${controls}</a><button type="button">Stop</button>`;
    strip.querySelector('button').onclick = () => stop(stopPath);
    strip.hidden = false;
  };
  const playback = () => fetch('/api/playback').then(r => r.json()).then(({ replay: r, practice: p }) => {
    if (r && r.active) {
      show(`4K replay${r.paused ? ' (paused)' : ''}${r.game ? `: ${esc(r.game.home)} v ${esc(r.game.away)}` : ''}. The pages show the recorded night; the live scene and scoreboard can't be changed.`, 'Replay controls', '/api/replay');
    } else if (p && p.active) {
      show(`${p.demo ? 'Demo' : 'Practice'} game${p.paused ? ' (paused)' : ''}: ${esc(p.game.home.name)} v ${esc(p.game.away.name)}. Nothing counts for the sponsors.`, 'Practice controls', '/api/practice');
    } else strip.hidden = true;
  }).catch(() => {});
  playback();
  setInterval(() => { if (!document.hidden) playback(); }, 3000);
})();
