// FirstPass Studio - the Output page, part 14 of 16: The status board beside the picture: everything at a glance.
// The page's script is split by section into public/output/, loaded in order by output.html; the files share one
// scope (plain scripts), so a name defined in an earlier part is in reach of a later one.
//
// Like a switcher's multiview: one board, read from arm's length, that says what is on and what needs a hand. The game
// row (the score, with the team names), then seven lines in two columns, each a light, a word, a bar or meter and a time: the sequence playing and the
// next one armed (or the run order's head), the music and the mics (with their duck), the switcher and the recording (with Record games on or off),
// and the next game across both columns. It draws from what the page already has: /api/health (common.js, every 2 s), the scene (sceneAll), the
// outputs (out), the switcher (sw) and the mics' live levels (micLive), and counts the clocks down between reads.
const boardEsc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const boardMmss = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
// A countdown that may be hours or days away: 4:05 under an hour, 1:12:05 under a day, then 2 days (never 2892:22).
const boardLeft = ms => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 3600) return boardMmss(ms);
  if (s < 86400) return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  const d = Math.floor(s / 86400);
  return `${d} day${d === 1 ? '' : 's'}`;
};
// A time of day, with the day when it isn't today: "7:30 pm", "7:30 pm Tue".
const boardAt = ms => {
  const d = new Date(ms);
  return `${clockTime(ms)}${d.toDateString() === new Date().toDateString() ? '' : ` ${d.toLocaleDateString([], { weekday: 'short' })}`}`;
};
const boardAgo = ms => ms == null ? 'not yet' : ms < 1500 ? 'just now' : ms < 90000 ? `${Math.round(ms / 1000)} s ago` : `${Math.round(ms / 60000)} min ago`;
// The time sits to the right; with below, it goes under the words instead (the music's "0:47 / 3:25" is too wide
// for a column, and squeezed the song's name to nothing; a countdown beside a sequence's name did the same). With wrap,
// the name runs to two lines before it is cut (the grey line under it always may). more is a further line under the
// grey one (the next game's switch time, the mics' duck), and full makes the line span both columns.
const boardLine = (lbl, dot, main, sub, bar, tm, extra = '', { below = false, wrap = false, more = '', full = false } = {}) =>
  `<div class="line${full ? ' full' : ''}"><span class="dot ${dot}"></span><span class="lbl">${lbl}</span><span class="txt"><b${wrap ? ' class="wrap"' : ''}>${main}</b>${sub ? `<small>${sub}</small>` : ''}${more}${below && tm ? `<span class="tm under">${tm}</span>` : ''}${bar || ''}</span><span class="tm">${below ? '' : tm || ''}${extra}</span></div>`;
const boardBar = (pct, cls = '') => pct == null ? '' : `<span class="bar ${cls}"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></span>`;

function renderBoard() {
  const box = $('board');
  if (!box) return;
  const h = lastHealth;
  const since = h ? Date.now() - lastHealthAt : 0;
  const left = ms => ms == null ? null : Math.max(0, ms - since);
  const outs = (out && out.outputs) || [];
  const s = sceneAll || {};
  // (The outputs, the switcher and REC are the bar's chips, on every page.)
  const swOn = sw && sw.state === 'connected';
  // The game: the score with the team names. (PlayHQ, the quarter and the clock are the bar's chips, on every page.)
  let game = '';
  if (!h) game = '<span class="pq bad"><span class="dot bad"></span>Studio isn\'t answering</span>';
  else if (!h.game) game = `<span class="pq"><span class="dot"></span>${boardEsc(h.competition || 'No competition')}: no game picked</span>`;
  else {
    const sc = h.score || {};
    game = `<span class="score" title="${boardEsc(h.game.label)}${h.game.court ? ` · ${boardEsc(h.game.court)}` : ''}"><span class="tname">${boardEsc(sc.homeName || '')}</span><span class="num">${sc.home ?? ''} – ${sc.away ?? ''}</span><span class="tname away">${boardEsc(sc.awayName || '')}</span></span>`;
  }
  // Sequence playing, and the next one armed.
  const pl = h && h.playing;
  const seqLine = pl
    ? boardLine('Sequence', pl.paused ? 'warn' : 'live', boardEsc(pl.name || 'Sequence'), `step ${pl.step} of ${pl.steps}${pl.paused ? ' · paused' : ''}${pl.totalLeftMs != null ? ` · ${boardMmss(left(pl.totalLeftMs))} in all${pl.totalOpen ? '+' : ''}` : ''}`,
      boardBar(pl.steps ? (pl.step - (pl.leftMs != null ? 0.5 : 0)) / pl.steps * 100 : null), pl.leftMs != null ? boardLeft(pl.paused ? pl.leftMs : left(pl.leftMs)) : '', '', { below: true, wrap: true })
    : boardLine('Sequence', '', 'Nothing playing', s.current && (s.scenes || []).find(x => x.id === s.current) ? `scene: ${boardEsc((s.scenes || []).find(x => x.id === s.current).name)}` : '', null, '', '', { wrap: true });
  // The run order line: a triggered start counting down, else the run order (▶ what Play next plays, ⏭ what follows),
  // else the next start before the game, else nothing armed. "Next" is left to the Sequences panel's step button.
  const ar = h && h.armed;
  const ro = (s.runOrder || []).filter(it => !it.gone);
  const next = !ar && s.nextAuto && (s.sequences || []).find(x => x.id === s.nextAuto.id);
  const sym = c => `<span class="sym">${c}</span>`;
  const armedLine = ar
    ? boardLine('Armed', 'ok', boardEsc(ar.name || 'sequence'), ar.leftMs == null ? 'after the one playing' : 'counting down', null, ar.leftMs == null ? '' : `in ${boardLeft(left(ar.leftMs))}`, '', { below: true, wrap: true })
    : ro.length ? boardLine('Run order', 'ok', `${sym('▶')}${boardEsc(ro[0].name)}`, ro[1] ? `${sym('⏭')}${boardEsc(ro[1].name)}${ro.length > 2 ? ` · ${ro.length - 2} more` : ''}` : 'last in the run order', null, '', '', { wrap: true })
    : next ? boardLine('Starts by itself', 'ok', boardEsc(next.name), `at ${boardEsc(boardAt(s.nextAuto.at))}${next.start && next.start.min ? ` · ${next.start.min} min before the game` : ''}`, null, s.nextAuto.at ? `in ${boardLeft(s.nextAuto.at - Date.now())}` : '', '', { below: true, wrap: true })
    : boardLine('Run order', '', 'Empty', s.seqAuto === false || (s.sequences || []).every(x => !x.start || x.start.type === 'hand') ? 'sequences start by hand' : 'sequences start by hand or by their triggers', null, '', '', { wrap: true });
  // Music and mics: from what their own sections already drew.
  const m = s.music || {};
  const musicOn = m.status === 'playing';
  // Playing, paused or stopped is a symbol by the time (▶ ❚❚ ■), as on the player, rather than a word.
  const mSym = musicOn ? '<span class="sym">▶</span>' : m.status === 'paused' ? '<span class="sym">❚❚</span>' : m.track ? '<span class="sym">■</span>' : '';
  const mFlags = [m.muted ? 'muted' : '', m.ducked ? 'ducked' : ''].filter(Boolean).join(' · ');
  const musicLine = boardLine('Music', musicOn ? 'live' : m.status === 'paused' ? 'warn' : '', boardEsc($('mTrack') ? $('mTrack').textContent : 'Music'), m.track ? mFlags : 'nothing loaded',
    m.length ? boardBar(($('mBar') && parseFloat($('mBar').style.width)) || 0) : null, m.track && $('mTime') ? `${mSym}${boardEsc($('mTime').textContent)}` : '', '', { below: true, wrap: true });
  const meters = [...document.querySelectorAll('#mxList .mxMeter i')];
  const level = meters.length ? Math.max(...meters.map(i => parseFloat(i.style.width) || 0)) : null;
  const hot = meters.some(i => i.classList.contains('hot')), warm = meters.some(i => i.classList.contains('warm'));
  const mx = s.mics || {};
  // The mics' duck is an amber line on the Mics line, only while they are ducked (at full level there's nothing to say).
  const dipWhy = mx.dipped ? boardEsc((mx.why || []).join ? (mx.why || []).join(', ') : mx.why || '') : '';
  const micsLine = boardLine('Mics', mx.dipped ? 'warn' : meters.length ? (mx.muted ? 'warn' : 'ok') : '', boardEsc($('mxHeard') ? $('mxHeard').textContent : 'Mics'), '',
    level == null ? null : `<span class="bar meter"><i class="${hot ? 'hot' : warm ? 'warm' : ''}" style="width:${level}%"></i></span>`, '', '',
    { more: mx.dipped ? `<small class="dip">ducked to ${boardEsc(mx.dipTo ?? '')}%${dipWhy ? ` · ${dipWhy}` : ''}</small>` : '' });
  const prg = swOn && sw.inputs ? sw.inputs.find(i => i.id === sw.program) : null, pvw = swOn && sw.inputs ? sw.inputs.find(i => i.id === sw.preview) : null;
  const swLine = boardLine('Switcher', swOn ? 'ok' : sw && sw.setUp ? 'bad' : '', swOn ? `PGM ${boardEsc(prg ? prg.name : '?')}` : sw && sw.setUp ? 'Not answering' : 'Not set up',
    swOn ? `PVW ${boardEsc(pvw ? pvw.name : '?')} · ${boardEsc(sw.model || '')}` : sw && sw.setUp ? boardEsc(sw.model || '') : 'cuts and keys from the Switcher section', null, '');
  const r = (h && h.recording) || {};
  const recLine = boardLine('Recording', r.on ? 'bad' : '', r.on ? boardEsc(r.name.replace(/\.jsonl(\.gz)?$/, '')) : r.record ? 'Waiting for a game' : 'Off',
    r.on ? 'recording this game' : r.record ? 'records each PlayHQ game on air' : 'games are not recorded', null, '',
    `<button class="alt" id="boardRecord" title="${r.record ? 'Stop recording games (the recording in progress ends)' : 'Record each PlayHQ game on air'}">${r.record ? 'Stop' : 'Record'}</button>`);
  const auto = h && h.autoNote ? h.autoNote.replace(/\s*Picking a game.*$/, '') : '';
  // The next game in three lines: the teams, the game's time, and when the board switches to it. It spans the board.
  const an = h && h.autoNext;
  const nextGame = an
    ? boardLine('Next game', '', `${boardEsc(an.home)} v ${boardEsc(an.away)}`, an.startAt ? `game at ${boardEsc(boardAt(an.startAt))}` : '', null, '', '',
      { wrap: true, full: true, more: an.switchAt ? `<small>switches at ${boardEsc(boardAt(an.switchAt))}</small>` : '' })
    : boardLine('Next game', '', auto ? boardEsc(auto.replace(/^Next:\s*/, '')) : h && h.game ? 'Picked by hand' : 'No game',
      auto ? '' : 'Scoreboard control picks the next one', null, '', '', { wrap: true, full: true });
  box.innerHTML = `<div class="game">${game}</div><div class="sgrid">${seqLine}${armedLine}${musicLine}${micsLine}${swLine}${recLine}${nextGame}</div>`;
  const rb = $('boardRecord');
  if (rb) rb.onclick = async () => {
    rb.disabled = true;
    try { await fetch('/api/recordings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ record: !r.record }) }); await health(); }
    catch (err) { studioStatus(`Couldn't change recording: ${err.message}`, 'error'); }
  };
}
// The clocks count down between reads, and the music bar follows its player.
setInterval(() => { if (!document.hidden) renderBoard(); }, 1000);
