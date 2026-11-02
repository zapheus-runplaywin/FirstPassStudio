// FirstPass Studio - the Output page, part 14 of 16: The status board beside the picture: everything at a glance.
// The page's script is split by section into public/output/, loaded in order by output.html; the files share one
// scope (plain scripts), so a name defined in an earlier part is in reach of a later one.
//
// Like a switcher's multiview: one board, read from arm's length, that says what is on and what needs a hand. The game
// row (the PlayHQ line, status, ping, bandwidth and data, over the score with the team names), then seven lines in two columns, each a light, a word, a bar or meter and a time: the sequence playing and the
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

// Bytes as people read them: 820 B, 14.2 KB, 1.3 MB.
const boardBytes = n => {
  n = Math.max(0, Number(n) || 0);
  if (n < 1000) return `${Math.round(n)} B`;
  if (n < 1e6) return `${(n / 1000).toFixed(n < 1e4 ? 1 : 0)} KB`;
  return `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`;
};
// The ping's light: green under half a second, amber to a second and a half, red slower or with no answer.
const PING_OK_MS = 500, PING_SLOW_MS = 1500;
// The PlayHQ chips, on one line: status, ping, how often it's checked, bandwidth and data (the last three as icons). Status says the same as the bar's PlayHQ dot.
function boardPlayhq(h) {
  const p = h.playhq || {}, n = p.net || {};
  // lbl is a word, or an icon (ic) for the chips that are numbers alone, so the line fits on one row.
  const chip = (cls, dot, lbl, val, tip) => `<span class="pqchip ${cls}" title="${boardEsc(tip)}">${dot == null ? '' : `<span class="dot ${dot}"></span>`}${lbl.startsWith('<svg') ? lbl : `<span class="k">${lbl}</span>`}<b>${val}</b></span>`;
  const ic = (label, d) => `<svg class="ic" viewBox="0 0 16 16" aria-label="${label}"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  let sDot = 'ok', sWord = 'Answering', sTip = p.readAgoMs != null ? `Last live score ${boardAgo(p.readAgoMs)}` : 'PlayHQ is answering';
  if (!h.game) { sDot = ''; sWord = 'No game'; sTip = 'No game picked, so the live score isn\'t read'; }
  else if (h.source !== 'playhq') { sDot = ''; sWord = 'By hand'; sTip = 'Scores are by hand, so the live score isn\'t read'; }
  else if (p.waiting) { sDot = ''; sWord = 'Waiting'; sTip = `PlayHQ isn't scoring this game yet. ${p.waiting}`; }
  else if (p.state === 'bad') { sDot = 'bad'; sWord = 'Failing'; sTip = p.error || 'PlayHQ has been failing for a minute'; }
  else if (p.state === 'warn') { sDot = 'warn'; sWord = 'Overdue'; sTip = `A reading is overdue (last ${boardAgo(p.readAgoMs)})`; }
  let pDot = '', pVal = '–', pTip = 'Nothing asked of PlayHQ yet';
  if (n.failed) { pDot = 'bad'; pVal = 'No answer'; pTip = 'The last request to PlayHQ got no answer'; }
  else if (n.pingMs != null) {
    pDot = n.pingMs < PING_OK_MS ? 'ok' : n.pingMs < PING_SLOW_MS ? 'warn' : 'bad';
    pVal = `${n.pingMs} ms`;
    pTip = `How long PlayHQ took to answer, ${boardAgo(n.pingAgoMs)}`;
  }
  // How often PlayHQ is checked (Check PlayHQ every, on Scoreboard control): an icon and the seconds, grey while
  // nothing is being checked (by hand, no game, not scoring yet).
  const checking = h.game && h.source === 'playhq' && !p.waiting;
  const rSec = p.refreshSec;
  const rVal = rSec == null ? '–' : `${rSec % 1 ? rSec.toFixed(1) : rSec} s`;
  const refresh = `<span class="pqchip rf${checking ? '' : ' idle'}" title="${boardEsc(checking ? `Checks PlayHQ every ${rVal}` : `Would check PlayHQ every ${rVal}; nothing is being checked now`)}">`
    + `<svg class="ic" viewBox="0 0 16 16" aria-label="Checks every"><path d="M13.5 8a5.5 5.5 0 0 1-9.6 3.7M2.5 8a5.5 5.5 0 0 1 9.6-3.7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M12.6 1.6v3h-3M3.4 14.4v-3h3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><b>${rVal}</b></span>`;
  return `<span class="pqrow">${chip(`st ${sDot}`, sDot, 'PlayHQ', sWord, sTip)}${chip(`ping ${pDot}`, pDot, 'Ping', pVal, pTip)}${refresh}`
    // Bandwidth: a download arrow and the rate; data: a disc stack and the total since on air.
    + `${chip('bw', null, ic('Bandwidth', 'M8 2v8M4.5 6.5 8 10l3.5-3.5M3 13.5h10'), `${boardBytes(n.bytesPerSec)}/s`, 'Bandwidth: downloaded from PlayHQ a second, over the last minute')}`
    + `${chip('data', null, ic('Data', 'M3 4c0-1.1 2.2-2 5-2s5 .9 5 2-2.2 2-5 2-5-.9-5-2zM3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2'), boardBytes(n.bytes), `Data: downloaded from PlayHQ since Studio went on air (${n.requests || 0} requests)`)}</span>`;
}

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
  // The PlayHQ line above the score: the link, the ping, the download a second over the last minute and the total
  // since Studio went on air (/api/health playhq.net, from playhqnet.js).
  const pqLine = h ? boardPlayhq(h) : '';
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
  // Why the music is ducked, so it isn't mistaken for the mics' duck: a quiet scene or sequence, a stinger, or by hand.
  const mDuck = m.ducked ? `ducked${({ quiet: ' · quiet scene', stinger: ' · stinger', hand: ' · by hand' })[m.duckedBy] || ''}` : '';
  const mFlags = [m.muted ? 'muted' : '', mDuck].filter(Boolean).join(' · ');
  const musicLine = boardLine('Music', musicOn ? 'live' : m.status === 'paused' ? 'warn' : '', boardEsc($('mTrack') ? $('mTrack').textContent : 'Music'), m.track ? mFlags : 'nothing loaded',
    m.length ? boardBar(($('mBar') && parseFloat($('mBar').style.width)) || 0) : null, m.track && $('mTime') ? `${mSym}${boardEsc($('mTime').textContent)}` : '', '', { below: true, wrap: true });
  const meters = [...document.querySelectorAll('#mxList .mxMeter i')];
  const level = meters.length ? Math.max(...meters.map(i => parseFloat(i.style.width) || 0)) : null;
  const hot = meters.some(i => i.classList.contains('hot')), warm = meters.some(i => i.classList.contains('warm'));
  const mx = s.mics || {};
  // The mics' duck is an amber line on the Mics line, only while they are ducked (at full level there's nothing to say).
  const dipWhy = mx.dipped ? boardEsc((mx.why || []).join ? (mx.why || []).join(', ') : mx.why || '') : '';
  const mb = scene.mics ? micsBoard() : { word: 'Mics', why: '', dot: '' };
  const micsLine = boardLine('Mics', mx.dipped && mb.dot === 'ok' ? 'warn' : mb.dot, boardEsc(mb.word), boardEsc(mb.why),
    level == null ? null : `<span class="bar meter"><i class="${hot ? 'hot' : warm ? 'warm' : ''}" style="width:${level}%"></i></span>`, '', '',
    { wrap: true, more: mx.dipped ? `<small class="dip">ducked to ${boardEsc(mx.dipTo ?? '')}%${dipWhy ? ` · ${dipWhy}` : ''}</small>` : '' });
  const prg = swOn && sw.inputs ? sw.inputs.find(i => i.id === sw.program) : null, pvw = swOn && sw.inputs ? sw.inputs.find(i => i.id === sw.preview) : null;
  const swLine = boardLine('Switcher', swOn ? 'ok' : sw && sw.setUp ? 'bad' : '', swOn ? `PGM ${boardEsc(prg ? prg.name : '?')}` : sw && sw.setUp ? 'Not answering' : 'Not set up',
    swOn ? `PVW ${boardEsc(pvw ? pvw.name : '?')} · ${boardEsc(sw.model || '')}` : sw && sw.setUp ? boardEsc(sw.model || '') : 'cuts and keys from the Switcher section', null, '');
  const r = (h && h.recording) || {};
  // A recording's name is its date, time and teams; the board keeps the teams (the Recordings tab has the rest).
  const recLine = boardLine('Recording', r.on ? 'bad' : '', r.on ? boardEsc(r.name.replace(/\.jsonl(\.gz)?$/, '').replace(/^\d{4}-\d\d-\d\d \d{4} /, '')) : r.record ? 'Waiting for a game' : 'Off',
    r.on ? 'recording this game' : r.record ? 'each PlayHQ game on air' : 'not recording games', null, '', '',
    { wrap: true, more: `<button class="alt" id="boardRecord" title="${r.record ? 'Stop recording games (the recording in progress ends)' : 'Record each PlayHQ game on air'}">${r.record ? 'Stop' : 'Record'}</button>` });
  const auto = h && h.autoNote ? h.autoNote.replace(/\s*Picking a game.*$/, '') : '';
  // The next game in three lines: the teams, the game's time, and when the board switches to it. It spans the board.
  const an = h && h.autoNext;
  const nextGame = an
    ? boardLine('Next game', '', `${boardEsc(an.home)} v ${boardEsc(an.away)}`, an.startAt ? `game at ${boardEsc(boardAt(an.startAt))}` : '', null, '', '',
      { wrap: true, full: true, more: an.switchAt ? `<small>switches at ${boardEsc(boardAt(an.switchAt))}</small>` : '' })
    : boardLine('Next game', '', auto ? boardEsc(auto.replace(/^Next:\s*/, '')) : h && h.game ? 'Picked by hand' : 'No game',
      auto ? '' : 'Scoreboard control picks the next one', null, '', '', { wrap: true, full: true });
  box.innerHTML = `<div class="game">${pqLine}${game}</div><div class="sgrid">${seqLine}${armedLine}${musicLine}${micsLine}${swLine}${recLine}${nextGame}</div>`;
  const rb = $('boardRecord');
  if (rb) rb.onclick = async () => {
    rb.disabled = true;
    try { await fetch('/api/recordings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ record: !r.record }) }); await health(); }
    catch (err) { studioStatus(`Couldn't change recording: ${err.message}`, 'error'); }
  };
}
// The clocks count down between reads, and the music bar follows its player.
setInterval(() => { if (!document.hidden) renderBoard(); }, 1000);
