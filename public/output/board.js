// FirstPass Studio - the Output page, part 14 of 16: The status board beside the picture: everything at a glance.
// The page's script is split by section into public/output/, loaded in order by output.html; the files share one
// scope (plain scripts), so a name defined in an earlier part is in reach of a later one.
//
// Like a switcher's multiview: one board, read from arm's length, that says what is on and what needs a hand. The game
// row (PlayHQ and how long since it answered, the score, the quarter and clock), then eight lines in two columns, each a light, a word, a bar or meter and a time: the sequence playing and the
// next one armed (or the run order's head), the music and the mics, the mics' dip and the switcher, the recording (with Record games on or off) and
// the next game. It draws from what the page already has: /api/health (common.js, every 2 s), the scene (sceneAll), the
// outputs (out), the switcher (sw) and the mics' live levels (micLive), and counts the clocks down between reads.
const boardEsc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const boardMmss = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const boardAgo = ms => ms == null ? 'not yet' : ms < 1500 ? 'just now' : ms < 90000 ? `${Math.round(ms / 1000)} s ago` : `${Math.round(ms / 60000)} min ago`;
// The time sits to the right; with below, it goes under the words instead (the music's "0:47 / 3:25" is too wide
// for a column, and squeezed the song's name to nothing).
const boardLine = (lbl, dot, main, sub, bar, tm, extra = '', below = false) =>
  `<div class="line"><span class="dot ${dot}"></span><span class="lbl">${lbl}</span><span class="txt"><b>${main}</b>${sub ? `<small>${sub}</small>` : ''}${below && tm ? `<span class="tm under">${tm}</span>` : ''}${bar || ''}</span><span class="tm">${below ? '' : tm || ''}${extra}</span></div>`;
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
  // The game: PlayHQ, the score, the clock.
  let game = '';
  if (!h) game = '<span class="pq bad"><span class="dot bad"></span>Studio isn\'t answering</span>';
  else if (!h.game) game = `<span class="pq"><span class="dot"></span>${boardEsc(h.competition || 'No competition')}: no game picked</span>`;
  else {
    const p = h.playhq || {}, c = h.clock || {};
    let dot = 'ok', text, cls = '';
    if (h.source !== 'playhq') { dot = ''; text = 'Scores by hand'; }
    else if (p.waiting) { dot = ''; text = 'PlayHQ · not scoring yet'; }
    else if (p.finished) text = 'PlayHQ · game finished';
    else if (p.state === 'bad') { dot = 'bad'; cls = 'bad'; text = `PlayHQ failing for ${boardAgo(p.readAgoMs)}`; }
    else if (p.state === 'warn') { dot = 'warn'; cls = 'warn'; text = `PlayHQ overdue · ${boardAgo(p.readAgoMs == null ? null : p.readAgoMs + since)}`; }
    else text = `PlayHQ · ${boardAgo(p.readAgoMs == null ? null : p.readAgoMs + since)}`;
    const clock = c.left != null ? `${boardEsc(c.periodLabel || 'Q')}${boardEsc(c.period)} ${boardMmss(c.left * 1000 - (c.running ? since : 0))}` : '';
    const sc = h.score || {};
    game = `<span class="pq ${cls}" title="${boardEsc(h.game.label)}${h.game.court ? ` · ${boardEsc(h.game.court)}` : ''}"><span class="dot ${dot}"></span>${text}</span><span class="sclock" title="${c.following ? 'The clock follows the scorer' : 'The clock by hand'}${c.running ? ', running' : ''}">${clock}</span>`
      + `<span class="score"><span class="tname">${boardEsc(sc.homeName || '')}</span><span class="num">${sc.home ?? ''} – ${sc.away ?? ''}</span><span class="tname away">${boardEsc(sc.awayName || '')}</span></span>`;
  }
  // Sequence playing, and the next one armed.
  const pl = h && h.playing;
  const seqLine = pl
    ? boardLine('Sequence', pl.paused ? 'warn' : 'live', boardEsc(pl.name || 'Sequence'), `step ${pl.step} of ${pl.steps}${pl.paused ? ' · paused' : ''}${pl.totalLeftMs != null ? ` · ${boardMmss(left(pl.totalLeftMs))} in all${pl.totalOpen ? '+' : ''}` : ''}`,
      boardBar(pl.steps ? (pl.step - (pl.leftMs != null ? 0.5 : 0)) / pl.steps * 100 : null), pl.leftMs != null ? boardMmss(pl.paused ? pl.leftMs : left(pl.leftMs)) : '')
    : boardLine('Sequence', '', 'Nothing playing', s.current && (s.scenes || []).find(x => x.id === s.current) ? `scene: ${boardEsc((s.scenes || []).find(x => x.id === s.current).name)}` : '', null, '');
  // Next: a triggered start counting down, else the head of the run order (what Next plays, and what follows it),
  // else the next start before the game, else nothing armed.
  const ar = h && h.armed;
  const ro = (s.runOrder || []).filter(it => !it.gone);
  const next = !ar && s.nextAuto && (s.sequences || []).find(x => x.id === s.nextAuto.id);
  const armedLine = ar
    ? boardLine('Next', 'ok', `Armed: ${boardEsc(ar.name || 'sequence')}`, ar.leftMs == null ? 'after the one playing' : 'counting down', null, ar.leftMs == null ? '' : `in ${boardMmss(left(ar.leftMs))}`)
    : ro.length ? boardLine('Next', 'ok', boardEsc(ro[0].name), ro[1] ? `then ${boardEsc(ro[1].name)}${ro.length > 2 ? ` · ${ro.length - 2} more` : ''}` : 'last in the run order', null, '')
    : next ? boardLine('Next', 'ok', boardEsc(next.name), `at ${boardEsc(clockTime(s.nextAuto.at))}${next.start && next.start.min ? ` · ${next.start.min} min before the game` : ''}`, null, s.nextAuto.at ? `in ${boardMmss(Math.max(0, s.nextAuto.at - Date.now()))}` : '')
    : boardLine('Next', '', s.seqAuto === false || (s.sequences || []).every(x => !x.start || x.start.type === 'hand') ? 'Nothing armed' : 'Nothing armed yet', (s.sequences || []).length ? 'run order empty; sequences start by hand or by their triggers' : 'no sequences yet', null, '');
  // Music and mics: from what their own sections already drew.
  const m = s.music || {};
  const musicOn = m.status === 'playing';
  // Playing, paused or stopped is a symbol by the time (▶ ❚❚ ■), as on the player, rather than a word.
  const mSym = musicOn ? '<span class="sym">▶</span>' : m.status === 'paused' ? '<span class="sym">❚❚</span>' : m.track ? '<span class="sym">■</span>' : '';
  const mFlags = [m.muted ? 'muted' : '', m.ducked ? 'ducked' : ''].filter(Boolean).join(' · ');
  const musicLine = boardLine('Music', musicOn ? 'live' : m.status === 'paused' ? 'warn' : '', boardEsc($('mTrack') ? $('mTrack').textContent : 'Music'), m.track ? mFlags : 'nothing loaded',
    m.length ? boardBar(($('mBar') && parseFloat($('mBar').style.width)) || 0) : null, m.track && $('mTime') ? `${mSym}${boardEsc($('mTime').textContent)}` : '', '', true);
  const meters = [...document.querySelectorAll('#mxList .mxMeter i')];
  const level = meters.length ? Math.max(...meters.map(i => parseFloat(i.style.width) || 0)) : null;
  const hot = meters.some(i => i.classList.contains('hot')), warm = meters.some(i => i.classList.contains('warm'));
  const mx = s.mics || {};
  const micsLine = boardLine('Mics', meters.length ? (mx.muted ? 'warn' : 'ok') : '', boardEsc($('mxHeard') ? $('mxHeard').textContent : 'Mics'), boardEsc($('mxWhy') ? $('mxWhy').textContent : ''),
    level == null ? null : `<span class="bar meter"><i class="${hot ? 'hot' : warm ? 'warm' : ''}" style="width:${level}%"></i></span>`, '');
  const dipLine = boardLine('Dip', mx.dipped ? 'warn' : '', mx.dipped ? `Dipped to ${mx.dipTo ?? ''}%` : 'Full level', mx.dipped ? boardEsc((mx.why || []).join ? (mx.why || []).join(', ') : mx.why || '') : 'the mics dip while music or a video with sound plays', null, '');
  const prg = swOn && sw.inputs ? sw.inputs.find(i => i.id === sw.program) : null, pvw = swOn && sw.inputs ? sw.inputs.find(i => i.id === sw.preview) : null;
  const swLine = boardLine('Switcher', swOn ? 'ok' : sw && sw.setUp ? 'bad' : '', swOn ? `PGM ${boardEsc(prg ? prg.name : '?')}` : sw && sw.setUp ? 'Not answering' : 'Not set up',
    swOn ? `PVW ${boardEsc(pvw ? pvw.name : '?')} · ${boardEsc(sw.model || '')}` : sw && sw.setUp ? boardEsc(sw.model || '') : 'cuts and keys from the Switcher section', null, '');
  const r = (h && h.recording) || {};
  const recLine = boardLine('Recording', r.on ? 'bad' : '', r.on ? boardEsc(r.name.replace(/\.jsonl(\.gz)?$/, '')) : r.record ? 'Waiting for a game' : 'Off',
    r.on ? 'recording this game' : r.record ? 'records each PlayHQ game on air' : 'games are not recorded', null, '',
    `<button class="alt" id="boardRecord" title="${r.record ? 'Stop recording games (the recording in progress ends)' : 'Record each PlayHQ game on air'}">${r.record ? 'Stop' : 'Record'}</button>`);
  const auto = h && h.autoNote ? h.autoNote.replace(/\s*Picking a game.*$/, '') : '';
  const nextGame = boardLine('Next game', '', auto ? boardEsc(auto.replace(/^Next:\s*/, '').replace(/,?\s*switches at.*$/, '')) : h && h.game ? 'Picked by hand' : 'No game',
    auto && /switches at/.test(auto) ? boardEsc(auto.replace(/^.*switches at\s*/, 'switches at ')) : auto ? '' : 'Scoreboard control picks the next one', null, '');
  box.innerHTML = `<div class="game">${game}</div><div class="sgrid">${seqLine}${armedLine}${musicLine}${micsLine}${dipLine}${swLine}${recLine}${nextGame}</div>`;
  const rb = $('boardRecord');
  if (rb) rb.onclick = async () => {
    rb.disabled = true;
    try { await fetch('/api/recordings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ record: !r.record }) }); await health(); }
    catch (err) { studioStatus(`Couldn't change recording: ${err.message}`, 'error'); }
  };
}
// The clocks count down between reads, and the music bar follows its player.
setInterval(() => { if (!document.hidden) renderBoard(); }, 1000);
