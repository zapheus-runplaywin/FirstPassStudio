// FirstPass Studio - the Scoreboard control page's script (control.html loads it as a module, so its names stay its own).
// What Studio answers: the scoreboard (board.ts state()), the night's games (/api/games), the game nights
// (/api/rounds), the team lists (/api/teams) and the finals (finals.ts).
interface Rules { periods: number; periodLabel: string; periodType: string }
interface Followed { home: string; away: string; court?: string; done?: boolean; waiting?: boolean; started?: boolean; period?: number; time?: string; score: { home: number; away: number } }
interface ControlBoard {
  home: { name: string; score?: number }; away: { name: string; score?: number }; serverNow: number; gameId?: string | null;
  playhqRefreshSec?: number; courtName?: string; courtPlayhq?: string; tickerSpeed?: number; source: string; playhqWaiting?: string; playhqError?: string;
  clock: { running: boolean; lengthSec: number }; clockElapsedMs: number; showClock: boolean; autoSelect?: boolean; autoCourt?: string; courtFrom?: string;
  autoNote?: string; autoHold?: boolean; court?: string; followPlayhqClock?: boolean; clockMatchedAt?: number; playhqClock?: { time: string; status?: string } | null;
  rules?: Rules; period: number; periodLabel?: string; competitionSetup?: string; competition?: string; division?: string;
  teamColours?: Record<string, string>; followOthers?: boolean; followedGames?: Followed[];
}
interface Game { id: string; division?: string; round?: string; date?: string; time?: string; court: string; home: { name: string }; away: { name: string } }
interface TeamList { name: string; players: unknown[]; logo?: string }
interface FinalsGame {
  id: string; name: string; notNeeded?: boolean; source?: string; winner?: string; manual?: boolean; weekName?: string;
  home: { name?: string; placeholder?: string; score?: number | null }; away: { name?: string; placeholder?: string; score?: number | null };
}
interface Finals {
  divisionNumber?: string; division?: string; error?: string; projected?: boolean; playhqFinals?: number; champion?: { name: string } | null;
  format?: { name: string; summary: string } | null; games: FinalsGame[];
}
const errText = (err: unknown) => err instanceof Error ? err.message : String(err);

(function () {
  const api = '/api/scoreboard';
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  let state: ControlBoard | null = null, games: Game[] = [], serverOffset = 0;

  const sbLink = (base: string) => { $('sub').innerHTML = `The scoreboard is <b>${base}/scoreboard.html</b>: add it on the <a href="/output.html">Output page</a>.`; };
  sbLink(location.origin);
  fetch('/api/version').then(r => r.json()).then(v => { if (v.base) sbLink(v.base); }).catch(() => {}); // the Mac's .local name
  $<HTMLIFrameElement>('frame').src = '/scoreboard.html';
  const fit = () => { $<HTMLIFrameElement>('frame').style.transform = `scale(${$('preview').clientWidth / 1920})`; };
  addEventListener('resize', fit); fit();

  async function act(action: { type: string; [more: string]: unknown }) {
    const res = await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(action) });
    const body = await res.json();
    if (res.status === 403) return; // refused from a phone or another computer that isn't paired: studio.js shows why, and how to pair
    apply(body);
  }

  // The night's other games Studio follows in the background (board.ts followGames): each gets its own story (Game
  // stats, Score worm, moments) for the Socials tab, from PlayHQ's live scoring. Nothing of them goes on air.
  function followedNote(s: ControlBoard) {
    $<HTMLInputElement>('followOthers').checked = s.followOthers !== false;
    const list = s.followedGames || [];
    const at = (g: Followed) => g.done ? `final ${g.score.home}-${g.score.away}` : g.waiting ? 'PlayHQ slow, trying again soon'
      : g.started ? `${s.periodLabel || 'Q'}${g.period} ${g.score.home}-${g.score.away}` : `from ${String(g.time || '').slice(0, 5) || 'its start'}`;
    $('followedNote').textContent = s.followOthers === false ? 'Off: only the game on the scoreboard gets a story for the Socials tab.'
      : !list.length ? 'Each of the night\'s other games gets its own story for the Socials tab, from PlayHQ. None to follow right now.'
      : `Each gets its own story for the Socials tab, from PlayHQ; nothing goes on air. Following ${list.length}: ${list.map(g => `${g.home} v ${g.away}${g.court ? ` (${g.court})` : ''} ${at(g)}`).join(' · ')}`;
  }

  function apply(s: ControlBoard) {
    state = s; serverOffset = s.serverNow - Date.now();
    $('homeScore').textContent = String(s.home.score ?? 0);
    $('awayScore').textContent = String(s.away.score ?? 0);
    if (document.activeElement !== $<HTMLInputElement>('homeName')) $<HTMLInputElement>('homeName').value = s.home.name;
    if (document.activeElement !== $<HTMLInputElement>('awayName')) $<HTMLInputElement>('awayName').value = s.away.name;
    if (document.activeElement !== $<HTMLInputElement>('refreshSec')) $<HTMLInputElement>('refreshSec').value = String(s.playhqRefreshSec || 5);
    // Blank shows PlayHQ's name for the game's court (in grey); a name typed here is shown instead, for tonight.
    if (document.activeElement !== $<HTMLInputElement>('court')) $<HTMLInputElement>('court').value = s.courtName || '';
    $<HTMLInputElement>('court').placeholder = s.courtPlayhq || 'Court name';
    $('courtNameFrom').textContent = s.courtName ? `Typed here for tonight. Clear it to show PlayHQ's name${s.courtPlayhq ? ` (${s.courtPlayhq})` : ''}.`
      : s.courtPlayhq ? 'From PlayHQ. Type a name to show instead, for tonight.' : '';
    if (document.activeElement !== $<HTMLInputElement>('tickerSpeed')) $<HTMLInputElement>('tickerSpeed').value = String(s.tickerSpeed || 120);
    $<HTMLButtonElement>('srcPlayhq').setAttribute('aria-pressed', String(s.source === 'playhq'));
    $<HTMLButtonElement>('srcManual').setAttribute('aria-pressed', String(s.source === 'manual'));
    $<HTMLButtonElement>('srcPlayhq').disabled = !s.gameId;
    $('sourceNote').textContent = s.source === 'playhq'
      ? `Scores update from PlayHQ every ${s.playhqRefreshSec || 5} seconds during the game (from 2 minutes before it starts until 2 minutes after PlayHQ finishes it), if it's being live-scored there; every 30 seconds once its scoring opens before that, and every 5 minutes otherwise. Pressing a score button switches to manual.`
      : 'Scores only change when you press the buttons here.';
    if (s.playhqWaiting && s.source === 'playhq') $('sourceNote').textContent += ` ${s.playhqWaiting}`;
    if (s.playhqError && s.source === 'playhq') $('sourceNote').textContent += ` Last PlayHQ error: ${s.playhqError}`;
    $('clockWord').textContent = s.clock.running ? 'Stop' : 'Start';
    $<HTMLButtonElement>('clockToggle').classList.toggle('on', s.clock.running);
    if (document.activeElement !== $<HTMLInputElement>('clockLength')) $<HTMLInputElement>('clockLength').value = String(Math.round(s.clock.lengthSec / 60));
    $<HTMLInputElement>('showClock').checked = s.showClock;
    $<HTMLInputElement>('autoSelect').checked = !!s.autoSelect;
    const gi = games.findIndex(g => g.id === s.gameId);
    if (gi >= 0 && document.activeElement !== $<HTMLSelectElement>('games') && $<HTMLSelectElement>('games').value !== String(gi)) $<HTMLSelectElement>('games').value = String(gi);
    if (document.activeElement !== $<HTMLInputElement>('autoCourt')) $<HTMLInputElement>('autoCourt').value = s.autoCourt || '';
    // Where tonight's court came from: the Production Planner, the competition's fallback court, or changed here for tonight.
    const from = ({ plan: 'from the <a href="/planner.html">Production Planner</a>', fallback: 'fallback from <a href="/setup.html">Competitions setup</a>', hand: 'changed by hand for tonight' } as Record<string, string>)[s.courtFrom || ''];
    $('courtFrom').hidden = !from;
    if (from && $('courtFrom').dataset.from !== s.courtFrom) { $('courtFrom').innerHTML = from; $('courtFrom').dataset.from = s.courtFrom || ''; }
    $('autoNote').textContent = s.autoSelect
      ? `${s.autoNote || 'Finding the game…'}${s.autoHold ? '' : ' Picking a game from the list turns this off.'}`
      : `Off, so the game stays as picked from the list${s.court ? ` (now on ${s.court})` : ''}. Tick the box, or change the court, to follow ${s.autoCourt || 'a court'} automatically; it comes back on by itself for the next game night.`;
    $<HTMLInputElement>('followClock').checked = !!s.followPlayhqClock;
    followedNote(s);
    const matchedAgo = s.clockMatchedAt ? s.serverNow - s.clockMatchedAt : Infinity;
    $('clockMatched').hidden = !(matchedAgo < 15000);
    $('clockMatched').textContent = s.followPlayhqClock
      ? 'Scores follow PlayHQ, so "Follow the PlayHQ scorer\'s clock" was turned on too.'
      : 'Scores are manual, so "Follow the PlayHQ scorer\'s clock" was turned off too. The clock buttons work it by hand.';
    $('clockNote').textContent = !s.followPlayhqClock ? 'Clock buttons work it by hand.'
      : s.source !== 'playhq' ? 'Turn on Follow PlayHQ above for this to work.'
      : s.playhqClock ? `PlayHQ: ${s.playhqClock.time} ${String(s.playhqClock.status || '').toLowerCase()}. Pressing a clock button switches it back to manual.`
      : 'Waiting for the PlayHQ scorer to start the clock.';
    buildPeriods(s.rules);
    gameBar(s);
    [...$('periods').querySelectorAll('button')].forEach(b => b.classList.toggle('on', Number(b.dataset.p) === s.period));
    const comp = s.competitionSetup || s.competition || '';
    if ($('compLine').dataset.comp !== comp) {
      $('compLine').dataset.comp = comp;
      $('compLine').replaceChildren(`Competition: `, Object.assign(document.createElement('b'), { textContent: comp }), ' · ',
        Object.assign(document.createElement('a'), { href: '/setup.html', target: '_blank', textContent: 'Change competition, colours and logos' }));
    }
  }

  // The game bar over the scores: the teams, the division, round, court and time (from the games list once it has
  // loaded), the team colours, and the next game when the board switches games by itself.
  function gameBar(s: ControlBoard) {
    const g = games.find(x => x.id === s.gameId);
    $('gameName').textContent = s.home.name || s.away.name ? `${s.home.name || 'Home'} v ${s.away.name || 'Away'}` : 'No game picked';
    $('gameMeta').textContent = (g ? [g.division, g.round, g.court, g.time] : [s.division, s.court]).filter(Boolean).join(' · ');
    for (const side of ['home', 'away']) {
      const c = s.teamColours && s.teamColours[side];
      if (c) $(`${side}Sw`).style.background = c; else $(`${side}Sw`).removeAttribute('style');
    }
    const next = s.autoSelect && /^Next: /.test(s.autoNote || '') ? (s.autoNote || '').replace(/\.$/, '') : '';
    $('nextGame').hidden = !next;
    $('nextGame').textContent = next;
  }
  // Change game… opens the Game section at the bottom, which folds to its title (kept on this Mac).
  const GAME_FOLD = 'studio.controlGameFolded';
  const foldGame = (on: boolean) => { $('gameSection').classList.toggle('folded', on); try { localStorage.setItem(GAME_FOLD, on ? '1' : '0'); } catch {} };
  try { if (localStorage.getItem(GAME_FOLD) === '1') foldGame(true); } catch {}
  $('gameSection').querySelector<HTMLElement>('h2')!.onclick = () => foldGame(!$('gameSection').classList.contains('folded'));
  $<HTMLButtonElement>('changeGame').onclick = () => { foldGame(false); $('gameSection').scrollIntoView({ behavior: 'smooth', block: 'start' }); $<HTMLSelectElement>('games').focus({ preventScroll: true }); };
  // Graphics, Team lists, Finals and More as tabs; the one open is kept on this Mac.
  const TAB_KEY = 'studio.controlTab';
  function showTab(name: string) {
    if (!document.querySelector(`.tab[data-tab="${name}"]`)) name = 'graphics';
    for (const b of $('ctlTabs').querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
    for (const t of document.querySelectorAll<HTMLElement>('.tab')) t.hidden = t.dataset.tab !== name;
    try { localStorage.setItem(TAB_KEY, name); } catch {}
  }
  for (const b of $('ctlTabs').querySelectorAll('button')) b.onclick = () => showTab(b.dataset.tab || '');
  try { showTab(localStorage.getItem(TAB_KEY) || 'graphics'); } catch { showTab('graphics'); }

  // Q1-Q4 or H1-H2 (from the competition setup page), then extra time.
  function buildPeriods(rules?: Rules) {
    const r = rules || { periods: 4, periodLabel: 'Q', periodType: 'quarters' };
    const key = `${r.periods}${r.periodLabel}`;
    if ($('periods').dataset.key === key) return;
    $('periods').dataset.key = key;
    $('periodHeading').textContent = r.periodType === 'halves' ? 'Half and clock' : 'Quarter and clock';
    $('periods').replaceChildren();
    for (let p = 1; p <= r.periods; p++) {
      const b = document.createElement('button');
      b.className = 'alt'; b.dataset.p = String(p); b.textContent = `${r.periodLabel}${p}`;
      b.onclick = () => act({ type: 'period', value: p });
      $('periods').appendChild(b);
    }
    const et = document.createElement('button');
    et.className = 'alt'; et.dataset.p = '5'; et.textContent = 'Extra time';
    et.onclick = () => act({ type: 'period', value: 5 });
    $('periods').appendChild(et);
  }

  function tick() {
    if (!state) return;
    const c = state.clock;
    const elapsed = state.clockElapsedMs + (c.running ? Date.now() + serverOffset - state.serverNow : 0);
    const s = Math.ceil(Math.max(0, c.lengthSec * 1000 - elapsed) / 1000);
    $('clockface').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  // The board arrives over Studio's scene socket as it changes (a press here or on the Stream Deck, a PlayHQ
  // reading), so a change shows at once rather than on the next poll.
  let boardReady = () => {};
  const firstBoard = new Promise<void>(r => { boardReady = r; });
  sceneEvents<unknown, ControlBoard>(null, { board: s => { apply(s); boardReady(); } });

  // The game night every page uses: automatic by date, or one picked here. Each night lists every
  // division's games on that date, whatever round each division is up to.
  const nightName = (date: string) => new Date(date + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
  async function loadRounds(post?: { night: string }) {
    try {
      const res = await fetch('/api/rounds', post ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(post) } : { cache: 'no-store' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      const sel = $<HTMLSelectElement>('round');
      sel.innerHTML = '';
      const auto = document.createElement('option');
      auto.value = ''; auto.textContent = d.auto ? `Automatic: ${nightName(d.auto)} (${d.autoRounds})` : 'Automatic';
      sel.appendChild(auto);
      d.nights.forEach((n: { date: string; summary: string }) => { const o = document.createElement('option'); o.value = n.date; o.textContent = `${nightName(n.date)} · ${n.summary}`; sel.appendChild(o); });
      sel.value = d.choice || '';
      $('roundNote').textContent = d.choice
        ? `Picked by hand: every page uses this game night until you set it back to Automatic.`
        : `Automatic picks the first game night in the next ${d.lookaheadDays} days (counting today), otherwise the last one played. Every division's games that night are listed, whatever round each is on.`;
    } catch (err) { $('roundNote').textContent = `Couldn't load the game nights from PlayHQ (${errText(err)}).`; }
  }
  $<HTMLSelectElement>('round').onchange = async () => { await loadRounds({ night: $<HTMLSelectElement>('round').value }); loadGames(); };
  loadRounds();

  // fresh: Refresh list, which reads the night's games from PlayHQ now rather than from what Studio kept.
  async function loadGames(fresh = false) {
    const sel = $<HTMLSelectElement>('games');
    sel.innerHTML = '<option>Loading this game night\'s games from PlayHQ…</option>';
    try {
      const res = await fetch(fresh ? '/api/games?fresh=1' : '/api/games', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      games = (data as Game[]).sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.time || '').localeCompare(String(b.time || '')) || a.court.localeCompare(b.court));
      sel.innerHTML = '';
      $<HTMLDataListElement>('courtList').innerHTML = [...new Set(games.map(g => g.court).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
        .map(c => `<option value="${c.replace(/"/g, '&quot;')}">`).join('');
      if (!games.length) sel.innerHTML = '<option>No games on this game night. Type team names below instead.</option>';
      games.forEach((g, i) => {
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = [g.division, g.round, g.date, g.time, g.court, `${g.home.name} v ${g.away.name}`].filter(Boolean).join(' · ');
        if (state && state.gameId === g.id) o.selected = true;
        sel.appendChild(o);
      });
      if (state) gameBar(state);
    } catch (err) {
      sel.innerHTML = '';
      const o = document.createElement('option');
      o.textContent = `Couldn't load games from PlayHQ (${errText(err)}). Type team names below instead.`;
      sel.appendChild(o);
    }
  }

  buildPeriods();

  document.querySelectorAll<HTMLButtonElement>('[data-delta]').forEach(b => b.onclick = () => act({ type: 'score', side: b.dataset.side, delta: Number(b.dataset.delta) }));
  $<HTMLInputElement>('autoSelect').onchange = () => act({ type: 'autoSelect', value: $<HTMLInputElement>('autoSelect').checked });
  $<HTMLInputElement>('autoCourt').onchange = () => act({ type: 'autoCourt', value: $<HTMLInputElement>('autoCourt').value.trim() });
  $<HTMLButtonElement>('useGame').onclick = () => { const g = games[Number($<HTMLSelectElement>('games').value)]; if (g) act({ type: 'selectGame', game: g }); };
  $<HTMLButtonElement>('reloadGames').onclick = () => loadGames(true);
  $<HTMLButtonElement>('srcPlayhq').onclick = () => act({ type: 'source', value: 'playhq' });
  $<HTMLButtonElement>('srcManual').onclick = () => act({ type: 'source', value: 'manual' });
  $<HTMLInputElement>('homeName').onchange = () => act({ type: 'setTeams', home: $<HTMLInputElement>('homeName').value });
  $<HTMLInputElement>('awayName').onchange = () => act({ type: 'setTeams', away: $<HTMLInputElement>('awayName').value });
  $<HTMLInputElement>('refreshSec').onchange = () => act({ type: 'playhqRefresh', value: Number($<HTMLInputElement>('refreshSec').value) });
  $<HTMLInputElement>('court').onchange = () => act({ type: 'setTeams', court: $<HTMLInputElement>('court').value.trim() });
  $<HTMLButtonElement>('clockToggle').onclick = () => act({ type: state && state.clock.running ? 'clockStop' : 'clockStart' });
  function setClock() {
    const m = $<HTMLInputElement>('clockSetValue').value.trim().match(/^(\d{1,2})(?:[:.](\d{1,2}))?$/);
    if (!m) { $<HTMLInputElement>('clockSetValue').focus(); return; }
    act({ type: 'clockSet', secondsLeft: Number(m[1]) * 60 + Number(m[2] || 0) });
    $<HTMLInputElement>('clockSetValue').value = '';
  }
  $<HTMLButtonElement>('clockSet').onclick = setClock;
  $<HTMLInputElement>('clockSetValue').onkeydown = e => { if (e.key === 'Enter') setClock(); };
  $<HTMLButtonElement>('clockReset').onclick = () => act({ type: 'clockReset' });
  $<HTMLButtonElement>('clockMinus').onclick = () => act({ type: 'clockAdjust', deltaSec: -10 });
  $<HTMLButtonElement>('clockPlus').onclick = () => act({ type: 'clockAdjust', deltaSec: 10 });
  $<HTMLInputElement>('clockLength').onchange = () => act({ type: 'clockLength', value: Number($<HTMLInputElement>('clockLength').value) * 60 });
  $<HTMLInputElement>('tickerSpeed').onchange = () => act({ type: 'tickerSpeed', value: Number($<HTMLInputElement>('tickerSpeed').value) });
  $<HTMLButtonElement>('tickerSlower').onclick = () => act({ type: 'tickerSpeed', value: 'slower' });
  $<HTMLButtonElement>('tickerFaster').onclick = () => act({ type: 'tickerSpeed', value: 'faster' });
  $<HTMLButtonElement>('tickerNormal').onclick = () => act({ type: 'tickerSpeed', value: 'normal' });
  $<HTMLInputElement>('showClock').onchange = () => act({ type: 'showClock', value: $<HTMLInputElement>('showClock').checked });
  $<HTMLInputElement>('followClock').onchange = () => act({ type: 'followPlayhqClock', value: $<HTMLInputElement>('followClock').checked });
  $<HTMLInputElement>('followOthers').onchange = () => act({ type: 'followOthers', value: $<HTMLInputElement>('followOthers').checked });
  $<HTMLButtonElement>('resetScores').onclick = async () => { if (await askConfirm('Set both scores back to 0?', '', { ok: 'Reset scores' })) act({ type: 'resetScores' }); };
  $<HTMLButtonElement>('resetAll').onclick = async () => { if (await askConfirm('Clear the teams, scores and clock?', '', { ok: 'Clear', danger: true })) act({ type: 'reset' }); };

  // Keyboard scoring: A / Z home, K / M away (Shift for 2), Space for the clock. Only for a plain key press on the
  // page itself: not while typing in a field, not with ⌘, ⌥ or ⌃ held (⌘A is select all, not a home goal), and not
  // when a button has the focus, where Space presses that button.
  document.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target instanceof HTMLElement ? e.target : null;
    if (t && (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A'].includes(t.tagName) || t.isContentEditable)) return;
    const keys: Record<string, [string, number]> = { a: ['home', 1], z: ['home', -1], k: ['away', 1], m: ['away', -1] };
    const k = keys[e.key.toLowerCase()];
    if (k) act({ type: 'score', side: k[0], delta: k[1] * (e.shiftKey ? 2 : 1) });
    if (e.code === 'Space') { e.preventDefault(); $<HTMLButtonElement>('clockToggle').click(); }
  });

  async function pollTeams() {
    try {
      const t: { home: TeamList; away: TeamList; error?: string } = await (await fetch('/api/teams', { cache: 'no-store' })).json();
      const count = (side: 'home' | 'away') => `${t[side].name}: ${t[side].players.length} players${t[side].logo ? '' : ' (no logo found)'}`;
      $('teamsNote').textContent = t.error && !t.home.players.length ? `Not available: ${t.error}` : `${count('home')}. ${count('away')}.${t.error ? ' Last update failed: ' + t.error : ''}`;
      $('teamsNote').classList.toggle('error', !!t.error);
    } catch {}
  }
  pollTeams(); setInterval(pollTeams, 10000);
  firstBoard.then(() => loadGames());
  setInterval(tick, 250);
})();

// Finals: who plays who in each division, and winners picked by hand for finals PlayHQ has no games for.
(function () {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const mk = (tag: string, cls = '', text?: string | null) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  let division = '';

  async function call(url: string, body?: object) {
    const res = await fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function render(d: Finals) {
    const list = $('finGames');
    list.replaceChildren();
    $<HTMLAnchorElement>('finLink').href = `/finals.html?division=${encodeURIComponent(d.divisionNumber || division)}`;
    if (!d.format) { $('finNote').textContent = d.error || 'No finals format for this division.'; return; }
    $('finNote').innerHTML = '';
    $('finNote').append(mk('b', '', d.format.name), ` for ${d.division}: ${d.format.summary} `,
      d.projected ? 'The home and away season isn\'t finished, so the teams are from the ladder as it is now. ' : '',
      d.playhqFinals ? `PlayHQ has ${d.playhqFinals} finals game${d.playhqFinals === 1 ? '' : 's'}.` : 'PlayHQ has no finals games for it yet.',
      d.champion ? ` Champions: ${d.champion.name}.` : '');
    for (const g of d.games) {
      const row = mk('div', 'fin');
      const name = mk('div', 'fin__name', g.name);
      name.append(mk('small', '', g.notNeeded ? 'Not needed' : g.source === 'playhq' ? (g.winner ? 'Result from PlayHQ' : 'On PlayHQ, not finished') : g.manual ? 'Winner picked here' : g.weekName));
      const box = mk('div', 'row');
      const h = g.home.name, a = g.away.name;
      if (g.notNeeded) box.append(mk('span', 'note', 'The series is already decided.'));
      else if (!h || !a) box.append(mk('span', 'note', `${h || g.home.placeholder} v ${a || g.away.placeholder}`));
      else if (g.source === 'playhq' && g.winner) box.append(mk('span', '', `${h} ${g.home.score ?? ''} – ${g.away.score ?? ''} ${a}`));
      else {
        const hs = Object.assign(document.createElement('input'), { type: 'number', min: '0', placeholder: 'score', value: String(g.home.score ?? '') });
        const as = Object.assign(document.createElement('input'), { type: 'number', min: '0', placeholder: 'score', value: String(g.away.score ?? '') });
        const pick = (winner: string) => save({ game: g.id, winner, homeScore: hs.value, awayScore: as.value });
        const hb = mk('button', g.winner === h ? 'on' : 'alt', `${h} won`); hb.onclick = () => pick(h);
        const ab = mk('button', g.winner === a ? 'on' : 'alt', `${a} won`); ab.onclick = () => pick(a);
        box.append(hb, hs, mk('span', '', 'v'), as, ab);
        if (g.manual) { const c = mk('button', 'alt', 'Clear'); c.onclick = () => save({ game: g.id, winner: '' }); box.append(c); }
      }
      row.append(name, box);
      list.append(row);
    }
  }

  async function save(body: { game: string; winner: string; homeScore?: string; awayScore?: string }) {
    try { render(await call('/api/finals/result', { division, ...body })); }
    catch (err) { $('finNote').textContent = `Couldn't save: ${errText(err)}`; console.warn('Finals result:', errText(err)); }
  }

  async function load() {
    try { render(await call(`/api/finals?division=${encodeURIComponent(division)}`)); }
    catch (err) { $('finNote').textContent = `Couldn't load the finals: ${errText(err)}`; console.warn('Finals:', errText(err)); }
  }

  (async () => {
    try {
      const st: { grades: { name: string; division: number | string }[] } = await call('/api/structure');
      $<HTMLSelectElement>('finDivision').replaceChildren(...st.grades.map(g => new Option(g.name, String(g.division))));
      const sb: { division?: string } = await call('/api/scoreboard').catch(() => ({}));
      const mine = st.grades.find(g => g.name === sb.division);
      division = String((mine || st.grades[0])?.division || '1');
      $<HTMLSelectElement>('finDivision').value = division;
    } catch (err) { $('finNote').textContent = `Couldn't load the divisions: ${errText(err)}`; return; }
    $<HTMLSelectElement>('finDivision').onchange = () => { division = $<HTMLSelectElement>('finDivision').value; load(); };
    $<HTMLButtonElement>('finReload').onclick = load;
    load();
  })();
})();

// What makes this file a module (its names its own), as the first line says.
export {};
