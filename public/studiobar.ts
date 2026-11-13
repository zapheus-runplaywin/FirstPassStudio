// FirstPass Studio - the tab bar at the top of every Studio page, drawn from one list.
//
// Each Studio page (not the graphics) has an empty <header class="fp-bar"></header> and loads this
// script straight after it, which fills in the mark and wordmark, the tabs and the status chips, and marks
// the page it is on. Add a tab here and every page and the Mac app's Go menu (desktop/windows.ts reads
// STUDIO_PAGES too, with ⌘1, ⌘2... in this order) have it. The list is in Matt's keyboard order: Output,
// Production Planner, Scoreboard control, Recordings, Socials, Competitions setup, Sponsors, Athletes, Stream Deck,
// Docs (the tenth tab is ⌘0). The bar shows them in three groups, by what the operator is doing (UI level-up,
// 31 Oct 2026): Run (Output, Scoreboard control), Plan (Production Planner, Socials) and Set up (Competitions setup,
// Sponsors, Athletes, Recordings, Stream Deck), with Docs on its own at the right. A tab's `short` is the word the
// bar shows when the full name is long; the page's title, h1 and the Go menu keep the full label.
// A tab: its link, name (short: the word the bar shows when the name is long), the other links it covers, its group.
interface StudioTab { href: string, label: string, short?: string, also?: string[], group?: string }
// What /api/health gives the chips (server.ts health): only what they show.
interface StudioHealth {
  output?: { on?: boolean, outputs?: { name: string, colour?: string, on?: boolean }[] },
  game?: { label: string, court?: string, phase?: string, ended?: boolean } | null,
  source?: string,
  playhq?: { waiting?: boolean, state?: string, trouble?: string, troubleSays?: string, holding?: boolean },
  clock?: { left?: number | null, running?: boolean, period?: number, periodLabel?: string, following?: boolean },
  playing?: { name?: string, step: number, steps: number, paused?: boolean, leftMs?: number | null } | null,
  armed?: { name?: string, leftMs?: number | null } | null,
  next?: { name?: string, then?: string } | null,
  switcher?: { setUp?: boolean, connected?: boolean, model?: string },
  recording?: { on?: boolean, record?: boolean, name?: string },
}

(function () {
  'use strict';
  const STUDIO_PAGES: StudioTab[] = [
    { href: '/output.html', label: 'Output', also: ['/'], group: 'Run' },
    { href: '/planner.html', label: 'Production Planner', short: 'Planner', group: 'Plan' },
    { href: '/control.html', label: 'Scoreboard control', short: 'Scoreboard', group: 'Run' },
    { href: '/recordings.html', label: 'Recordings', group: 'Set up' },
    { href: '/socials.html', label: 'Socials', group: 'Plan' },
    { href: '/setup.html', label: 'Competitions setup', short: 'Competitions', group: 'Set up' },
    { href: '/sponsors.html', label: 'Sponsors', also: ['/sponsorreport.html'], group: 'Set up' },
    { href: '/athletes.html', label: 'Athletes', group: 'Set up' },
    { href: '/api.html', label: 'Devices', also: ['/devices.html'], group: 'Set up' },
    { href: '/guide/', label: 'Docs', also: ['/guide/index.html'], group: 'Docs' },
  ];
  // The groups in the order the bar shows them; Docs is drawn apart, at the right.
  const GROUPS = ['Run', 'Plan', 'Set up'];
  // On a phone the bar is just the phone pages (Matt, 9 Nov 2026): Socials, the Remote and the Commentator mic. The
  // Remote and Commentator pages have no bar of their own and link to the other two the same way. A phone is a touch
  // screen up to 700 px wide; the Mac and an iPad keep the full bar. The other pages still open at their links.
  const PHONE_PAGES: StudioTab[] = [
    { href: '/socials.html', label: 'Socials' },
    { href: '/remote.html', label: 'Remote' },
    { href: '/commentator.html', label: 'Commentator' },
  ];
  const PHONE = '(pointer: coarse) and (max-width: 700px)';

  if (typeof module !== 'undefined' && module) { module.exports = { STUDIO_PAGES, GROUPS, PHONE_PAGES, PHONE }; return; }

  const bar = document.querySelector('header.fp-bar');
  if (!bar || bar.children.length) return;
  const here = location.pathname;
  const phone = matchMedia(PHONE).matches;
  // Studio's own link (/, the Output page on the Mac) opens Socials on a phone.
  if (phone && here === '/') { location.replace('/socials.html'); return; }
  const current = (p: StudioTab) => p.href === here || (p.also || []).includes(here);
  const tab = (p: StudioTab) => {
    const a = document.createElement('a');
    a.href = p.href; a.textContent = p.short || p.label;
    if (p.short) a.title = p.label;
    if (current(p)) a.setAttribute('aria-current', 'page');
    return a;
  };
  // The brand: the 1P mark (the logo without STUDIO, shown whole) and the FirstPass STUDIO wordmark (public/studio/),
  // both for the navy bar.
  const brand = document.createElement('a');
  brand.className = 'fp-brand'; brand.href = phone ? '/socials.html' : '/'; brand.setAttribute('aria-label', 'FirstPass Studio home');
  brand.innerHTML = '<img class="fp-mark" src="/studio/1p-mark-dark.svg" alt=""><img class="fp-word" src="/studio/firstpass-studio.svg" alt="FirstPass Studio">';
  const nav = document.createElement('nav');
  if (phone) {
    bar.classList.add('fp-phone');
    for (const p of PHONE_PAGES) nav.appendChild(tab(p));
  } else for (const g of GROUPS) {
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
  // A phone has no room for the chips (the Remote shows what's on air) or Docs.
  if (phone) bar.append(brand, nav);
  else bar.append(brand, nav, chips, docs); // the zoom chip joins after chips below

  // ─── Status chips ───────────────────────────────────────────────────────
  // What's on air, at a glance, from any page: ON AIR like a tally light (orange while any output sends) with a dot per
  // output, solid in its colour while it sends and hollow while it doesn't; the game on the board; PlayHQ following and
  // the clock; the sequence playing (step and time left on it) or the triggered one counting down to start (or the head of the run order as Next); ATEM while a
  // switcher is set up (green answering, red not); and REC while a game records (grey while Record games waits for one).
  // They are status, not links: the tabs are the way to a page. One read of /api/health every 2 s while the page is in
  // view; the times count down between reads. Styled by studio.css (.fp-chips).
  const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s: unknown) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ESC[c]);
  const mmss = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  let health: StudioHealth | null = null, heardAt = 0;
  const chip = (cls: string, title: string, dot: string, text: string) => `<span class="chip ${cls}"${title ? ` title="${esc(title)}"` : ''}>${dot ? `<span class="dot ${dot}"></span>` : ''}${text}</span>`;
  const render = () => {
    const h = health;
    if (!h) { chips.innerHTML = chip('off', '', 'bad', 'Studio isn\'t answering'); return; }
    const since = Date.now() - heardAt;
    const left = (ms: number | null | undefined) => ms == null ? null : Math.max(0, ms - since);
    const parts = [];
    // ON AIR with a dot per output (one output without a list: its one dot), hollow while that output isn't sending.
    const outs: { name: string, colour?: string, on?: boolean }[] = h.output && h.output.outputs && h.output.outputs.length ? h.output.outputs : [{ name: 'Output', colour: '#F75C03', on: !!(h.output && h.output.on) }];
    const sending = outs.filter(o => o.on);
    const dots = outs.map(o => `<i class="odot${o.on ? ' on' : ''}" data-colour="${esc(o.colour || '#F75C03')}" title="${esc(o.name)}: ${o.on ? 'sending' : 'off'}"></i>`).join('');
    parts.push(chip(sending.length ? 'air' : 'off', sending.length ? `On air: ${sending.map(o => o.name).join(', ')}` : 'No output is sending', '', `${sending.length ? 'ON AIR' : 'Off air'}<span class="odots">${dots}</span>`));
    const g = h.game;
    // The game's dot is where the game is: orange before the clock has started, green from then until an hour after it
    // ends, grey after that (the game is picked either way; the words say which).
    const gdot = !g ? 'off' : g.phase === 'upcoming' ? 'orange' : g.phase === 'over' ? 'off' : 'ok';
    const gtitle = !g ? '' : g.phase === 'upcoming' ? 'Upcoming: the clock hasn\'t started' : g.phase === 'live' ? 'Under way' : g.phase === 'ended' ? 'Ended within the hour' : 'Over';
    parts.push(g ? chip('game', gtitle, gdot, `${esc(g.label)}${g.court ? ` · ${esc(g.court)}` : ''}`) : chip('game off', '', 'off', 'No game on the board'));
    if (g) {
      const p: NonNullable<StudioHealth['playhq']> = h.playhq || {}, c: NonNullable<StudioHealth['clock']> = h.clock || {};
      // The dot is the link to PlayHQ only (green answering, amber overdue or holding a hand score PlayHQ is behind, red failing, purple not scoring live (the
      // scorebench off line) with the reason on hover, grey by hand or not scoring yet), whatever the game's state; the words carry the game: the quarter and clock, or that it's over.
      const over = g.ended ? (h.source === 'playhq' ? 'game completed' : 'full time') : '';
      const clock = over ? ` · ${over}` : c.left != null ? ` · ${esc(c.periodLabel || 'Q')}${esc(c.period)} ${mmss((c.left || 0) * 1000 - (c.running ? since : 0))}` : '';
      let dot = 'ok', text: string;
      if (h.source !== 'playhq') { dot = 'off'; text = 'Scores by hand'; }
      else if (p.waiting) { dot = 'off'; text = 'PlayHQ · not scoring yet'; }
      else if (p.state === 'bad') { dot = 'bad'; text = 'PlayHQ failing'; }
      else if (p.trouble) { dot = 'notlive'; text = `PlayHQ not live${p.holding ? ' · your score held' : ''}`; }
      else if (p.holding) { dot = 'warn'; text = 'PlayHQ · your score held'; }
      else if (p.state === 'warn') { dot = 'warn'; text = 'PlayHQ overdue'; }
      else text = over || c.following ? 'PlayHQ' : 'PlayHQ · clock by hand';
      parts.push(chip(`playhq ${dot}`, dot === 'notlive' ? p.troubleSays || '' : p.holding ? 'PlayHQ is behind your score, so the board keeps yours until PlayHQ catches up or has something new' : '', dot, `${text}${clock}`));
    }
    // The sequence playing, or the one a trigger armed and is counting down.
    if (h.playing) {
      const s = h.playing, l = s.paused ? s.leftMs : left(s.leftMs);
      parts.push(chip('seq', '', 'gold', `${esc(s.name || 'Sequence')} ${s.step}/${s.steps}${s.paused ? ' · paused' : l != null ? ` · ${mmss(l)}` : ''}`));
    } else if (h.armed) {
      const a = h.armed, l = left(a.leftMs);
      parts.push(chip('armed', '', 'ok', `Armed: ${esc(a.name || 'sequence')}${l != null ? ` · in ${mmss(l)}` : ' · after this'}`));
    }
    // The run order, whatever is playing: ▶ what Play next plays, ⏭ what follows it (and what Skip leaves at the head).
    if (h.next && h.next.name) {
      const sym = (c: string) => `<span class="sym" aria-hidden="true">${c}</span>`;
      const title = `Play next plays ${h.next.name}${h.next.then ? `, then ${h.next.then}` : ''}`;
      parts.push(chip('ro', title, '', `Run order ${sym('▶')}${esc(h.next.name)}${h.next.then ? ` ${sym('⏭')}${esc(h.next.then)}` : ''}`));
    }
    // ATEM while a switcher is set up: answering or not. REC while a game records, or waiting for one with Record games on.
    const sw: NonNullable<StudioHealth['switcher']> = h.switcher || {};
    if (sw.setUp) parts.push(chip(`atem ${sw.connected ? 'ok' : 'bad'}`, sw.connected ? `${sw.model || 'The switcher'} is answering` : `${sw.model || 'The switcher'} isn't answering`, sw.connected ? 'ok' : 'bad', 'ATEM'));
    const r: NonNullable<StudioHealth['recording']> = h.recording || {};
    if (r.on) parts.push(chip('rec', `Recording ${r.name || 'this game'}`, 'rec', 'REC'));
    else if (r.record) parts.push(chip('rec wait', 'Records the next PlayHQ game on air', 'off', 'REC'));
    chips.innerHTML = parts.join('');
    // Each output's dot takes that output's colour (the one thing here studio.css can't know).
    for (const d of chips.querySelectorAll<HTMLElement>('.odot')) d.style.setProperty('--c', d.dataset.colour || '');
  };
  // Page zoom (the Mac app, desktop/windows.ts): the app says the level after each change and each load; while it
  // isn't 100% a chip at the right of the bar shows it, and a click asks for 100% (the app watches for #zoom=100).
  const zoomChip = document.createElement('a');
  zoomChip.className = 'chip zoom';
  zoomChip.href = '#zoom=100';
  zoomChip.title = 'Page zoom: click for actual size (⌘⌥0)';
  zoomChip.hidden = true;
  chips.after(zoomChip);
  document.addEventListener('studio-zoom', e => {
    const pct = Number(e instanceof CustomEvent ? e.detail : 0) || 100;
    zoomChip.hidden = pct === 100;
    zoomChip.textContent = `${pct}%`;
  });
  const read = () => fetch('/api/health', { cache: 'no-store' }).then(r => r.json()).then((h: StudioHealth) => { health = h; heardAt = Date.now(); render(); })
    .catch(() => { health = null; render(); });
  if (!phone) {
    read();
    setInterval(() => { if (!document.hidden) read(); }, 2000);
    setInterval(() => { if (!document.hidden && health) render(); }, 1000);
  }

  // While a practice game or a 4K replay runs (practice.ts, replay.ts), a red strip under the bar on every Studio page
  // says so, with Stop. One read of /api/playback (both at once) every 3 s while the page is in view; styled by
  // studio.css (.fp-practice).
  const strip = document.createElement('div');
  strip.className = 'fp-practice';
  strip.setAttribute('role', 'status');
  strip.hidden = true;
  bar.after(strip);
  const stop = (path: string) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"stop":true}' }).then(playback);
  const show = (text: string, controls: string, stopPath: string) => {
    strip.innerHTML = `<span>${text}</span><a href="/recordings.html">${controls}</a><button type="button">Stop</button>`;
    const button = strip.querySelector('button');
    if (button) button.onclick = () => stop(stopPath);
    strip.hidden = false;
  };
  // What /api/playback gives: a 4K replay and a practice game, each running or not.
  interface Playback {
    replay?: { active?: boolean, paused?: boolean, game?: { home: string, away: string } | null },
    practice?: { active?: boolean, paused?: boolean, demo?: boolean, game: { home: { name: string }, away: { name: string } } },
  }
  const playback = (): Promise<void> => fetch('/api/playback').then(r => r.json()).then(({ replay: r, practice: p }: Playback) => {
    if (r && r.active) {
      show(`4K replay${r.paused ? ' (paused)' : ''}${r.game ? `: ${esc(r.game.home)} v ${esc(r.game.away)}` : ''}. The pages show the recorded night; the live scene and scoreboard can't be changed.`, 'Replay controls', '/api/replay');
    } else if (p && p.active) {
      show(`${p.demo ? 'Demo' : 'Practice'} game${p.paused ? ' (paused)' : ''}: ${esc(p.game.home.name)} v ${esc(p.game.away.name)}. Nothing counts for the sponsors.`, 'Practice controls', '/api/practice');
    } else strip.hidden = true;
  }).catch(() => {});
  playback();
  setInterval(() => { if (!document.hidden) playback(); }, 3000);

  // A name cut short (an ellipsis, or a line clamp) shows in full as a tooltip on hover, on every Studio page, so the
  // operator never has to click a source, tile or line just to read it (Matt, 1 Nov 2026). It only adds a title where
  // the text is cut and nothing set one, and takes it off again when the text fits (the window grew). An element's
  // data-full, when set, is the name to show (a source's name also holds its type tag).
  const cut = (el: HTMLElement) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
  document.addEventListener('mouseover', e => {
    for (let at = e.target instanceof Element ? e.target : null, i = 0; at && i < 4; at = at.parentElement, i++) {
      if (!(at instanceof HTMLElement)) continue;
      const el = at;
      if (el.hasAttribute('title') && !el.hasAttribute('data-autotitle')) return;
      const st = getComputedStyle(el);
      if (st.overflow !== 'hidden' && st.overflowX !== 'hidden') continue;
      if (!/ellipsis/.test(st.textOverflow) && st.webkitLineClamp === 'none') continue;
      if (cut(el)) { el.title = el.dataset.full || el.innerText.replace(/\s+/g, ' ').trim(); el.setAttribute('data-autotitle', ''); }
      else if (el.hasAttribute('data-autotitle')) { el.removeAttribute('title'); el.removeAttribute('data-autotitle'); }
      return;
    }
  }, { passive: true });
})();
