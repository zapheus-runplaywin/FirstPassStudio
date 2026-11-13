// FirstPass Studio - the Output page, part 5 of 16: Sequences: the list, the editor and its steps, the playing card and game triggers.
// The page's script is split by section into public/output/, loaded in order by output.html; the files share one
// scope (plain scripts), so a name defined in an earlier part is in reach of a later one.

// ─── Sequences ─────────────────────────────────────────────────────────
// Cards for the competition's sequences. The playing one counts its step's time down from when
// Studio last sent the scene, so the page doesn't need to ask.
const sequences = () => scene.sequences || [];
const fmt = (ms: number) => { const t = Math.ceil(Math.max(0, ms) / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const BREAK_SHORT: Record<string, string> = { qt: 'QT', ht: 'HT', '3qt': '3QT' };
const startText = (sq: Sequence) => sq.start.type === 'before' ? `${sq.start.min} min before the start` : sq.start.type === 'break' ? `at ${sq.start.breaks.map(b => BREAK_SHORT[b]).join(' · ')}`
  : sq.start.type === 'fulltime' ? 'at full time' : 'by hand';
const repeatText = (sq: Sequence) => sq.repeat === 'loop' ? 'repeats' : sq.repeat === 'until' && sq.until ? (sq.until.moment === 'resume' ? 'repeats until play resumes' : `repeats until ${sq.until.min} min before`) : 'plays once';
const clockTime = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
let heardAt = 0;
// How long one time through takes: steps' set times and video lengths, sequences inside added up. open: a
// step that waits (Next, the game, a page or video of unknown length), so it's at least that.
function runTime(steps: Step[], seen = new Set<string>()): { sec: number; open: boolean; ads: boolean } {
  let sec = 0, open = false, ads = false;
  for (const st of steps) {
    if (st.kind === 'sequence') {
      const sub = sequences().find(x => x.id === st.sequence);
      if (sub && !seen.has(sub.id)) { const t = runTime(sub.steps, new Set([...seen, sub.id])); sec += t.sec; open = open || t.open; ads = ads || t.ads; }
    } else if (st.kind === 'ads') { open = true; ads = true; }
    else if (st.length.type === 'now') continue;
    else if (st.length.type === 'time') sec += st.length.sec || 0;
    else if (st.length.type === 'done') { const d = stepSeconds(st); if (d) sec += d; else open = true; }
    else open = true;
  }
  return { sec, open, ads };
}
function runText(sq: Sequence) {
  const t = runTime(sq.steps, new Set([sq.id]));
  return !t.sec ? (t.ads ? 'runs as long as its ads' : t.open ? 'runs until Next' : 'runs 0:00') : `runs ${t.open ? 'at least ' : ''}${fmt(t.sec * 1000)}`;
}
// What it does when it ends on the output picked over the Scene View (or on output o): that output's own Then, else the sequence's.
function thenText(sq: Sequence, o = scene.viewOutput || 'main') {
  const then = (sq.thenOn || {})[o] || sq.then;
  if (then.type === 'scene') { const sc = (scene.scenes || []).find(x => x.id === then.scene); return sc ? `then ${sc.name}` : 'then its scene (gone)'; }
  if (then.type === 'sequence') { const nx = sequences().find(x => x.id === then.sequence); return nx ? `then ${nx.name}` : 'then its next sequence (gone)'; }
  return then.type === 'leave' ? 'then leaves it all on' : 'then turns its sources off';
}
// Where it plays, once there's more than one output: a tick per output, in its colour, changed from the card
// itself (it takes effect the next time the sequence starts; what's playing carries on). The last tick stays.
// Each output it plays on (ticked, or playing it now) says how it is there: playing, paused, starting, or stopped (it
// ended there, played out or cut short, and hasn't played again); nothing before it has played there; and
// "output off" while that output isn't sending (it still plays there, for when it's turned on).
function outTicks(sq: Sequence) {
  const box = document.createElement('div');
  box.className = 'seqOuts';
  if (!scene.viewMany) return box;
  const on = sq.playsOn || ['main'];
  const all = sceneAll.scenes ? sceneAll : scene;
  const playOf = (o: string) => o === 'main' ? all.playing : (all.playingOut || {})[o];
  const pendOf = (o: string) => o === 'main' ? all.pending : (all.pendingOut || {})[o];
  box.title = 'The outputs it plays on together: started by itself, or played on any of them';
  const outputs = out?.outputs || [];
  for (const o of outputs) {
    const l = document.createElement('label');
    l.innerHTML = '<input type="checkbox"> <i></i> <span></span>';
    const c = pick<HTMLInputElement>(l, 'input');
    const p = playOf(o.id), w = pendOf(o.id);
    const st = p && p.id === sq.id ? (p.paused ? ['paused', '⏸ Paused'] : ['playing', '▶ Playing']) : w && w.id === sq.id ? ['starting', '⏳ Starting'] : (all.stoppedOn || {})[o.id] === sq.id ? ['stopped', '■ Stopped'] : null;
    if (st) l.append(Object.assign(document.createElement('b'), { className: `seqSt ${st[0]}`, textContent: st[1] }));
    // An output that isn't sending: its dot hollow and "off" by its name (it still plays there, for when it's turned on).
    if (!(o.showing || []).length) {
      l.classList.add('notSending');
      pick(l, 'span').after(Object.assign(document.createElement('small'), { textContent: 'off' }));
      l.title = `${o.name} isn't sending: a sequence still plays there, for when it's turned on`;
    }
    c.checked = on.includes(o.id);
    c.disabled = c.checked && on.length === 1;
    c.onchange = () => act({ type: 'seqUpdate', sequence: sq.id, changes: { playsOn: outputs.map(x => x.id).filter(id => id === o.id ? c.checked : on.includes(id)) } });
    pick(l, 'i').style.cssText = `background:${o.colour};border:2px solid ${o.colour}`;
    pick(l, 'span').textContent = o.name;
    box.append(l);
  }
  return box;
}
let showHidden = false;
try { showHidden = localStorage.getItem('studio.seqShowHidden') === '1'; } catch { /* no storage */ }
$<HTMLButtonElement>('addSeq').onclick = () => openSequence(null);
$<HTMLInputElement>('seqShowHidden').onchange = () => {
  showHidden = $<HTMLInputElement>('seqShowHidden').checked;
  try { localStorage.setItem('studio.seqShowHidden', showHidden ? '1' : '0'); } catch { /* no storage */ }
  renderSequences();
};
function renderSequences() {
  const box = $('seqs'), p = scene.playing, pend = scene.pending;
  box.innerHTML = '';
  $<HTMLInputElement>('seqAuto').checked = scene.auto !== false;
  const na = scene.nextAuto, next = na && sequences().find(s => s.id === na.id);
  $('seqNext').textContent = scene.auto === false ? 'Nothing starts by itself; every sequence still plays by hand.'
    : next && na ? `Next: ${next.name} at ${clockTime(na.at)}, ${next.start.type === 'before' ? next.start.min : 0} min before ${scene.game?.label || 'the game'}`
    : sequences().some(s => s.start.type !== 'hand') ? 'Sequences start by themselves from the scoreboard\'s game and clock.' : '';
  // Hidden sequences stay off the list (unless Show hidden is ticked, or one is playing or about to start).
  const hiddenCount = sequences().filter(s => s.hidden).length;
  $<HTMLLabelElement>('seqShowHiddenRow').classList.toggle('hidden', !hiddenCount);
  $<HTMLInputElement>('seqShowHidden').checked = showHidden;
  pick($<HTMLLabelElement>('seqShowHiddenRow'), 'span').textContent = `Show hidden (${hiddenCount})`;
  for (const sq of sequences()) {
    const run = p && p.id === sq.id;
    const waiting = !run && pend && pend.id === sq.id;
    if (sq.hidden && !showHidden && !run && !waiting) continue;
    const card = document.createElement('div');
    card.className = 'seq' + (run ? ' run' : '') + (run && p.paused ? ' paused' : '') + (waiting ? ' pend' : '');
    card.innerHTML = '<div class="t"><b></b></div><span class="band"></span>';
    pick(card, 'b').textContent = sq.name;
    if (sq.quiet) pick(card, 'b').append(quietMark());
    const swActs = sq.steps.flatMap(st => st.switcher || []);
    if (swActs.length) pick(card, 'b').append(switcherMark(swActs));
    if (sq.hidden) { card.classList.add('hiddenSeq'); pick(card, '.t').append(Object.assign(document.createElement('span'), { className: 'tag', textContent: 'Hidden', title: 'Hidden from the list: plays inside other sequences, by its start, or from the Stream Deck' })); }
    pick(card, '.band').classList.add(sq.colour);
    if (scene.viewMany) card.append(outTicks(sq));
    if (run) {
      const dots = document.createElement('div');
      dots.className = 'dots';
      for (let i = 0; i < p.steps; i++) dots.appendChild(Object.assign(document.createElement('i'), { className: i < p.step ? 'done' : i === p.step ? 'now' : '' }));
      const line = document.createElement('div');
      line.className = 'nowLine';
      line.innerHTML = '<span></span><span class="left"></span>';
      const sc = p.scene && (scene.scenes || []).find(x => x.id === p.scene);
      const names = sc ? `scene ${sc.name}` : p.ad !== undefined ? (p.ad ? `ad: ${p.ad}` : 'no ad to play') : (p.sources || []).map(nameOf).filter(Boolean).join(', ');
      pick(line, 'span').textContent = `${p.step + 1} of ${p.steps}${p.loop ? ` (again ×${p.loop})` : ''}${p.via && p.via.length ? ` · in ${p.via.join(' › ')}` : ''}${names ? ` · ${names}` : ''}`;
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = '<button class="alt next" title="End this step now">Next ⏭</button><button class="alt pause"></button><button class="danger stop">Stop</button>';
      pick<HTMLButtonElement>(row, '.pause').textContent = p.paused ? 'Carry on' : 'Pause';
      pick<HTMLButtonElement>(row, '.next').onclick = () => act({ type: 'seqNext' });
      pick<HTMLButtonElement>(row, '.pause').onclick = () => act({ type: 'seqPauseToggle' });
      pick<HTMLButtonElement>(row, '.stop').onclick = () => act({ type: 'seqStop' });
      pick<HTMLButtonElement>(row, '.stop').title = `Stop it, ${thenText(sq)}`;
      // The whole sequence's time left under the step's.
      const total = document.createElement('div');
      total.className = 'nowLine totalLine';
      total.innerHTML = `<span>${p.repeats ? 'This time round' : 'Total'}</span><span class="left total"></span>`;
      card.append(dots, line, total, row);
      if (p.finishing) pick(line, '.left').dataset.last = '1';
    } else if (waiting) {
      const line = document.createElement('div');
      line.className = 'nowLine';
      line.innerHTML = '<span></span><span class="left pendLeft"></span>';
      pick(line, 'span').textContent = `${pend.reason || 'Starting'} · starts in`;
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = '<button class="now">Start now</button><button class="alt cancel">Cancel</button>';
      pick<HTMLButtonElement>(row, '.now').onclick = () => act({ type: 'seqStartNow' });
      pick<HTMLButtonElement>(row, '.cancel').onclick = () => act({ type: 'seqCancel' });
      card.append(line, row);
    } else {
      const small = document.createElement('small');
      small.textContent = `${startText(sq)} · ${sq.steps.length} step${sq.steps.length === 1 ? '' : 's'} · ${runText(sq)} · ${repeatText(sq)} · ${thenText(sq)}`;
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = '<button class="play">▶ Play</button><button class="alt edit">Edit</button>';
      pick<HTMLButtonElement>(row, '.play').onclick = () => act({ type: 'seqPlay', sequence: sq.id });
      pick<HTMLButtonElement>(row, '.play').disabled = !sq.steps.length;
      pick<HTMLButtonElement>(row, '.edit').onclick = () => openSequence(sq);
      card.append(small, row);
    }
    if (run) { const e = document.createElement('button'); e.className = 'alt'; e.textContent = 'Edit'; e.style.cssText = 'padding:4px 10px;font-size:13px;justify-self:start'; e.onclick = () => openSequence(sq); pick(card, '.row').appendChild(e); }
    box.appendChild(card);
  }
  heardAt = performance.now();
  tickSequence();
  const first = sequences()[0];
  // With no sequences yet, the first steps (the rest is in the user guide).
  $('seqEmpty').hidden = !!first;
  $('seqEmpty').innerHTML = 'A sequence plays sources one after another, each for a set time or until its video or animation finishes: the run-up to a game, a quarter break, full time. '
    + 'Add your sources first, then <b>Add sequence</b>.';
}
function tickSequence() {
  const pend = scene.pending, pl = document.querySelector<HTMLElement>('.seq.pend .pendLeft');
  if (pend && pl) pl.textContent = pend.leftMs === null ? 'after this one' : `${fmt(pend.leftMs - (performance.now() - heardAt))}`;
  const p = scene.playing;
  const left = document.querySelector<HTMLElement>('.seq.run .left');
  if (!p || !left) return;
  const total = document.querySelector<HTMLElement>('.seq.run .total');
  const since = p.paused || p.leftMs === null || p.leftMs === undefined ? 0 : performance.now() - heardAt;
  if (total) total.textContent = totalText(p, since);
  const last = p.finishing ? ', then ends' : '';
  if (p.leftMs === null || p.leftMs === undefined) { left.textContent = p.length === 'next' ? 'waits for Next' : p.length === 'game' ? 'until the game moves on' : ''; return; }
  const ms = p.leftMs - since;
  left.textContent = (p.length === 'done' && !p.ready ? `up to ${fmt(ms)}` : `${fmt(ms)} left`) + last;
}
// The whole sequence's time left (this time round when it repeats): "1:40 left", "at least 1:40 left" when part
// of it waits (Next, the game, a page), "no set time" when all that's left waits.
function totalText(p: Playing, since: number) {
  if (p.totalLeftMs === undefined || p.totalLeftMs === null) return '';
  const ms = p.totalLeftMs - since;
  if (p.totalOpen && ms < 1000) return 'no set time';
  return `${p.totalOpen ? 'at least ' : ''}${fmt(ms)} left`;
}
setInterval(tickSequence, 250);

// The editor works on a copy, saved with Save.
// What the editor works on: a sequence, or a new one (no id yet).
type SeqDraft = Pick<Sequence, 'name' | 'colour' | 'repeat' | 'start' | 'then' | 'playsOn' | 'thenOn' | 'steps'> & Partial<Sequence>;
let draft: SeqDraft | null = null;
// A video's or song's length: Studio's (ffmpeg's), else measured here by this browser when Studio couldn't tell.
const measured = new Map<string, number | null>(); // file -> seconds (null while measuring or if it can't be read here)
function durationOf(f: string) {
  const m = media.find(x => x.name === f);
  if (!m || m.duration) return m?.duration || 0;
  if ((m.kind === 'video' || m.kind === 'audio') && !m.converting && !measured.has(f)) {
    measured.set(f, null);
    const el = document.createElement(m.kind === 'video' ? 'video' : 'audio');
    el.preload = 'metadata';
    el.muted = true;
    el.onloadedmetadata = () => {
      if (!Number.isFinite(el.duration)) return;
      measured.set(f, el.duration);
      el.removeAttribute('src');
      lengthsChanged();
    };
    el.src = '/media/' + encodeURIComponent(f);
  }
  return measured.get(f) || 0;
}
function lengthsChanged() {
  checkThemeLength();
  renderSequences();
  if (draft) renderSteps();
  if (scene.music) renderMusic();
  if (plDraft) renderPlTracks();
}
function openSequence(sq: Sequence | null) {
  // A new one plays on the output picked over the Scene View.
  const d: SeqDraft = draft = sq ? structuredClone(sq) : { name: '', colour: 'purple', repeat: 'once', start: { type: 'hand' }, then: { type: 'off' }, playsOn: [scene.viewOutput || 'main'], thenOn: {}, steps: [] };
  // With more than one output: the outputs it plays on together (each with its own Then), and what plays only on Output 1.
  const outs = scene.viewMany && out ? out.outputs : [];
  $('sqOutNote').classList.toggle('hidden', !outs.length);
  $('sqPlaysOn').innerHTML = '';
  const on = d.playsOn || ['main'];
  for (const o of outs) {
    const l = document.createElement('label');
    l.className = 'inline';
    l.innerHTML = '<input type="checkbox"> <i></i> <span></span>';
    pick<HTMLInputElement>(l, 'input').value = o.id;
    pick<HTMLInputElement>(l, 'input').checked = on.includes(o.id);
    pick<HTMLInputElement>(l, 'input').onchange = () => renderThens();
    pick(l, 'i').style.cssText = `display:inline-block;width:10px;height:10px;border-radius:50%;background:${o.colour}`;
    pick(l, 'span').textContent = o.name;
    $('sqPlaysOn').append(l);
  }
  // Set to play on outputs that have since been removed: those are left out (with all gone, it won't start by itself).
  if (d.startGone && outs.length) $('sqPlaysOn').append(Object.assign(document.createElement('small'), { textContent: "The outputs it played on have been removed: it won't start by itself until you tick one." }));
  $('sqOutNote').textContent = "Started by itself, or played on any output it plays on, it plays on all of them together, and each does its own Then when it ends there. Played on another output, it plays there alone. Music plays only on Output 1; on other outputs it is silent, and Sponsor ads play in that output's own ad sources (counted for sponsors only if its card says so).";
  const start = d.start;
  $<HTMLSelectElement>('sqStart').value = start.type;
  $<HTMLInputElement>('sqStartMin').value = String(start.type === 'before' ? start.min : 10);
  $<HTMLInputElement>('sqAfter').value = String(start.type === 'break' || start.type === 'fulltime' ? start.afterSec : 5);
  document.querySelectorAll<HTMLInputElement>('.sqBreaks input').forEach(c => { c.checked = start.type === 'break' ? start.breaks.includes(c.value) : true; });
  $<HTMLSelectElement>('sqRepeat').value = d.repeat === 'until' && d.until ? `until:${d.until.moment}` : d.repeat;
  $<HTMLInputElement>('sqUntilMin').value = String(d.until?.min ?? 2);
  showStartFields();
  $('sqTitle').textContent = sq ? 'Edit sequence' : 'New sequence';
  $<HTMLInputElement>('sqName').value = d.name;
  $<HTMLSelectElement>('sqColour').innerHTML = '';
  for (const [v, label] of COLOURS) $<HTMLSelectElement>('sqColour').add(new Option(label, v, false, v === d.colour));
  thenOptions($<HTMLSelectElement>('sqThen'), d.then);
  renderThens(true);
  // Music: none, a song or a playlist.
  const mus = $<HTMLSelectElement>('sqMusic');
  mus.innerHTML = '';
  mus.add(new Option('No music of its own', ''));
  for (const f of tracks()) mus.add(new Option(`Song: ${songName(f)}`, `track:${f}`));
  for (const pl of playlistsOf()) mus.add(new Option(`Playlist: ${pl.name}`, `playlist:${pl.id}`));
  const dm = d.music;
  const want = dm ? (dm.playlist ? `playlist:${dm.playlist}` : `track:${dm.track}`) : '';
  if (dm && want && ![...mus.options].some(o => o.value === want)) mus.add(new Option(`${dm.track || dm.playlist} (missing)`, want));
  mus.value = want;
  $<HTMLInputElement>('sqMusicStep').value = String(dm?.startStep || 1);
  $<HTMLInputElement>('sqMusicMark').value = String(dm?.startAtSec || 0);
  $<HTMLInputElement>('sqMusicFade').value = String(dm?.fadeInSec ?? 2);
  $<HTMLInputElement>('sqMusicUnderVideo').checked = !!dm?.underVideo;
  const end = d.musicEnd || { type: 'fade', sec: 3 };
  $<HTMLSelectElement>('sqMusicEnd').value = end.type;
  $<HTMLInputElement>('sqMusicEndSec').value = String(end.sec || 3);
  $<HTMLInputElement>('sqQuiet').checked = !!d.quiet;
  $<HTMLInputElement>('sqHidden').checked = !!d.hidden;
  stopListening();
  showStartFields();
  $<HTMLButtonElement>('sqDelete').classList.toggle('hidden', !sq);
  $<HTMLButtonElement>('sqCopy').classList.toggle('hidden', !sq);
  $('sqErr').textContent = '';
  renderSteps();
  // Video lengths for the hints, measured since the media list was last fetched.
  loadMedia().then(() => { if (draft && !$('sqSteps').contains(document.activeElement)) renderSteps(); });
  if (!$<HTMLDialogElement>('seqDialog').open) $<HTMLDialogElement>('seqDialog').showModal();
  seqGuard.opened();
  if (!sq) $<HTMLInputElement>('sqName').focus();
}
// A row of source chips with an add list; list is the array of source ids it changes.
function sourcePicker(list: string[], holder: HTMLElement) {
  for (const id of list) {
    const s = scene.sources.find(x => x.id === id);
    if (!s) continue;
    const chip = document.createElement('span');
    chip.className = 'chip' + (s.type === 'video' ? ' video' : '');
    chip.append(s.name, Object.assign(document.createElement('button'), { textContent: '×', title: `Take ${s.name} out`, onclick: () => { list.splice(list.indexOf(id), 1); renderSteps(); } }));
    holder.appendChild(chip);
  }
  const sel = document.createElement('select');
  sel.setAttribute('aria-label', 'Add a source');
  sel.add(new Option(list.length ? '+ Add' : '+ Add a source', ''));
  for (const s of scene.sources) if (!list.includes(s.id)) sel.add(new Option(s.name, s.id));
  sel.onchange = () => { if (sel.value) { list.push(sel.value); renderSteps(); } };
  holder.appendChild(sel);
}
function stepHint(st: SourcesStep | SceneStep) {
  if (st.length.type !== 'done') return '';
  const vids = st.sources.map(id => scene.sources.find(s => s.id === id)).filter((s): s is Source => !!s && s.type === 'video');
  const secs = vids.map(v => durationOf(v.file || '')).filter(Boolean);
  if (secs.length) return `video ${fmt(Math.max(...secs) * 1000)}`;
  if (vids.length) return 'video';
  return st.sources.some(id => scene.sources.find(s => s.id === id)?.type === 'browser') ? 'page, up to 1 minute' : 'nothing here ends by itself';
}
function renderSteps() {
  const d = draft;
  if (!d) return;
  const box = $('sqSteps');
  box.innerHTML = '';
  const p = scene.playing;
  if (!d.steps.length) box.innerHTML = '<p class="note" style="margin:0">No steps yet: add sources, a scene or another sequence below.</p>';
  d.steps.forEach((st, i) => {
    const row = document.createElement('div');
    row.className = 'stepRow' + (st.kind === 'scene' ? ' sceneStep' : st.kind === 'sequence' || st.kind === 'ads' ? ' seqStep' : '') + (p && p.id === d.id && p.top === i ? ' cur' : '');
    row.innerHTML = '<span class="num"></span><div class="what"></div><div class="len"><select class="type" aria-label="How long"><option value="now">Then straight on</option><option value="time">For a set time</option><option value="done">Until it finishes</option><option value="next">Until I press Next</option><option value="game">Until the game moves on</option></select>'
      + '<input type="number" class="sec" min="1" max="3600" aria-label="Seconds"><span class="hint"></span><button class="alt up" title="Earlier">↑</button><button class="alt down" title="Later">↓</button><button class="danger del" title="Delete this step">✕</button></div>';
    pick(row, '.num').textContent = String(i + 1);
    const type = pick<HTMLSelectElement>(row, '.type'), sec = pick<HTMLInputElement>(row, '.sec');
    if (st.kind === 'scene') {
      // Go to a scene: a starting or reset point.
      const what = pick(row, '.what');
      const sel = document.createElement('select');
      sel.setAttribute('aria-label', 'Scene');
      sel.add(new Option('Pick a scene', ''));
      for (const sc of scene.scenes || []) sel.add(new Option(sc.name, sc.id));
      if (st.scene && !(scene.scenes || []).some(sc => sc.id === st.scene)) sel.add(new Option('(scene gone)', st.scene));
      sel.value = st.scene || '';
      sel.onchange = () => { st.scene = sel.value; };
      what.append(Object.assign(document.createElement('span'), { className: 'kind', textContent: 'Go to scene' }), sel);
      [...type.options].find(o => o.value === 'done')?.remove();
    } else if (st.kind === 'ads') {
      // Sponsor ads: the next ads in the sponsors' rotation, each as long as it is.
      const what = pick(row, '.what');
      const count = document.createElement('select');
      count.setAttribute('aria-label', 'How many ads');
      for (let n = 1; n <= 5; n++) count.add(new Option(n === 1 ? '1 ad' : `${n} ads`, String(n)));
      count.value = String(st.count || 1);
      count.onchange = () => { st.count = Number(count.value); };
      const house = Object.assign(document.createElement('label'), { className: 'note', title: 'The PIVT and FirstPass Studio ad (ad.html) plays when no sponsor has an ad' });
      const tick = Object.assign(document.createElement('input'), { type: 'checkbox', checked: st.house !== false });
      tick.onchange = () => { st.house = tick.checked; };
      house.append(tick, ' House ad when no sponsor has one');
      what.append(Object.assign(document.createElement('span'), { className: 'kind', textContent: 'Sponsor ads' }), count, house);
      type.remove(); sec.remove();
      pick(row, '.hint').textContent = 'each as long as the ad';
    } else if (st.kind === 'sequence') {
      // Play another sequence here: its steps, with their own lengths.
      const what = pick(row, '.what');
      const sel = document.createElement('select');
      sel.setAttribute('aria-label', 'Sequence');
      sel.add(new Option('Pick a sequence', ''));
      for (const other of sequences()) if (other.id !== d.id && !playsInside(other, d.id || '')) sel.add(new Option(other.name, other.id));
      if (st.sequence && !sequences().some(x => x.id === st.sequence)) sel.add(new Option('(sequence gone)', st.sequence));
      sel.value = st.sequence || '';
      sel.onchange = () => { st.sequence = sel.value; renderSteps(); };
      what.append(Object.assign(document.createElement('span'), { className: 'kind', textContent: 'Play sequence' }), sel);
      type.remove(); sec.remove();
      const sub = sequences().find(x => x.id === st.sequence);
      pick(row, '.hint').textContent = sub ? (sub.steps.length === 1 ? 'its 1 step, with its own length' : `its ${sub.steps.length} steps, with their own lengths`) : '';
    } else {
      sourcePicker(st.sources, pick(row, '.what'));
      [...type.options].find(o => o.value === 'now')?.remove();
    }
    if (st.kind !== 'sequence' && st.kind !== 'ads') {
    type.value = st.length.type;
    sec.value = String(st.length.sec || 20);
    sec.classList.toggle('hidden', st.length.type !== 'time');
    pick(row, '.hint').textContent = st.length.type === 'time' ? 's' : st.kind === 'scene' ? '' : stepHint(st);
    type.onchange = () => { st.length = type.value === 'time' ? { type: 'time', sec: Number(sec.value) || 20 } : { type: type.value }; renderSteps(); };
    sec.oninput = sec.onchange = () => { st.length = { type: 'time', sec: Math.max(1, Math.min(3600, Math.round(Number(sec.value) || 20))) }; };
    }
    // Switcher actions on a source or scene step (shown once a switcher is set up, or the step has some).
    if (st.kind !== 'sequence' && st.kind !== 'ads' && (sw?.setUp || st.switcher?.length)) {
      const add = Object.assign(document.createElement('button'), { className: 'alt swAdd', textContent: '🎥', title: 'Add a switcher action: cut or auto to a camera, a key on or off, fade to black, a macro' });
      add.disabled = (st.switcher || []).length >= SW_MAX;
      add.onclick = () => { st.switcher = [...(st.switcher || []), { type: 'cut', atSec: 0 }]; renderSteps(); };
      pick(row, '.len').insertBefore(add, pick<HTMLButtonElement>(row, '.up'));
      if (st.switcher?.length) row.appendChild(switcherEditor(st.switcher, renderSteps));
    }
    pick<HTMLButtonElement>(row, '.up').disabled = i === 0;
    pick<HTMLButtonElement>(row, '.down').disabled = i === d.steps.length - 1;
    pick<HTMLButtonElement>(row, '.up').onclick = () => { d.steps.splice(i - 1, 0, d.steps.splice(i, 1)[0]); renderSteps(); };
    pick<HTMLButtonElement>(row, '.down').onclick = () => { d.steps.splice(i + 1, 0, d.steps.splice(i, 1)[0]); renderSteps(); };
    pick<HTMLButtonElement>(row, '.del').onclick = () => { d.steps.splice(i, 1); renderSteps(); };
    box.appendChild(row);
  });
  loopHint();
}
// Whether a sequence plays the sequence id somewhere inside it (so id can't play it: no loops).
function playsInside(sq: Sequence | undefined, id: string, seen = new Set<string>()): boolean {
  if (!sq || seen.has(sq.id)) return false;
  seen.add(sq.id);
  return sq.steps.some(st => st.kind === 'sequence' && (st.sequence === id || playsInside(sequences().find(x => x.id === st.sequence), id, seen)));
}
// The Then choices, set to then.
function thenOptions(sel: HTMLSelectElement, then: SeqThen | undefined) {
  sel.innerHTML = '';
  sel.add(new Option('Turn off what it turned on', 'off'));
  sel.add(new Option('Leave everything as it is', 'leave'));
  for (const sc of scene.scenes || []) sel.add(new Option(`Go to scene: ${sc.name}`, `scene:${sc.id}`));
  for (const other of sequences()) if (other.id !== draft?.id) sel.add(new Option(`Play sequence: ${other.name}`, `sequence:${other.id}`));
  sel.value = !then ? 'off' : then.type === 'scene' ? `scene:${then.scene}` : then.type === 'sequence' ? `sequence:${then.sequence}` : then.type;
  if (!sel.value) sel.value = 'off';
}
const thenOf = (v: string): SeqThen => v.startsWith('scene:') ? { type: 'scene', scene: v.slice(6) } : v.startsWith('sequence:') ? { type: 'sequence', sequence: v.slice(9) } : { type: v };
// The outputs ticked under Plays on (the primary with just one output).
const playsOnTicked = () => scene.viewMany ? [...document.querySelectorAll<HTMLInputElement>('#sqPlaysOn input:checked')].map(c => c.value) : ['main'];
// One Then per ticked output once it plays on more than one: the first is #sqThen (the sequence's Then, also
// used on any other output it's played on), the others that output's own. Keeps what's picked as ticks change
// (fresh: the editor has just opened, so nothing's been picked yet).
function renderThens(fresh = false) {
  const box = $('sqThens'), main = $<HTMLSelectElement>('sqThen');
  const picked: Record<string, string> = {};
  if (!fresh) {
    for (const sel of box.querySelectorAll<HTMLSelectElement>('select[data-out]')) picked[sel.dataset.out || ''] = sel.value;
    if (main.dataset.for) picked[main.dataset.for] = main.value;
  }
  box.querySelectorAll('.sqThenRow').forEach(r => { if (r.contains(main)) box.prepend(main); r.remove(); });
  const ticked = playsOnTicked();
  // The first ticked output's Then is the sequence's own: what was picked for it, else what it was set to.
  main.dataset.for = ticked[0] || '';
  if (ticked[0] && picked[ticked[0]]) main.value = picked[ticked[0]];
  else if (ticked[0] && draft?.thenOn?.[ticked[0]]) thenOptions(main, draft.thenOn[ticked[0]]);
  if (ticked.length < 2) return;
  ticked.forEach((o, i) => {
    const x = (out?.outputs || []).find(y => y.id === o);
    // A plain row, not a label: in the Mac app a dropdown inside a label can shut as it opens.
    const row = document.createElement('div');
    row.className = 'sqThenRow';
    row.style.cssText = 'display:flex;align-items:center;gap:4px';
    row.innerHTML = `<i style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${x ? x.colour : '#888'}"></i> <span style="display:inline-block;min-width:140px"></span>`;
    pick(row, 'span').textContent = `On ${x ? x.name : 'a removed output'}`;
    let sel = main;
    if (i > 0) {
      sel = document.createElement('select');
      sel.dataset.out = o;
      thenOptions(sel, draft?.thenOn?.[o] || draft?.then);
      if (picked[o]) sel.value = picked[o];
      sel.onchange = showStartFields;
    }
    row.append(sel);
    box.append(row);
  });
}
// Only the start and repeat settings that fit what's picked.
function showStartFields() {
  const type = $<HTMLSelectElement>('sqStart').value;
  // Where it plays, with more than one output.
  document.querySelectorAll('.sqPlaysOn').forEach(e => e.classList.toggle('hidden', !scene.viewMany));
  const hasMusic = !!$<HTMLSelectElement>('sqMusic').value;
  pick(document, '.sqMusicOn').classList.toggle('hidden', !hasMusic);
  $<HTMLButtonElement>('sqListen').classList.toggle('hidden', !$<HTMLSelectElement>('sqMusic').value.startsWith('track:'));
  // Music plays on Output 1 alone, which (ticked, or not playing it together) does the first Then.
  const chained = $<HTMLSelectElement>('sqThen').value.startsWith('sequence:');
  const cont = [...$<HTMLSelectElement>('sqMusicEnd').options].find(o => o.value === 'continue');
  if (cont) cont.disabled = !chained;
  if (!chained && $<HTMLSelectElement>('sqMusicEnd').value === 'continue') $<HTMLSelectElement>('sqMusicEnd').value = 'fade';
  pick(document, '.sqEndSec').classList.toggle('hidden', !['fade', 'crossfade'].includes($<HTMLSelectElement>('sqMusicEnd').value));
  pick(document, '.sqBefore').classList.toggle('hidden', type !== 'before');
  pick(document, '.sqBreaks').classList.toggle('hidden', type !== 'break' || scene.game?.last === 2);
  pick(document, '.sqAfter').classList.toggle('hidden', type !== 'break' && type !== 'fulltime');
  pick(document, '.sqUntilMin').classList.toggle('hidden', $<HTMLSelectElement>('sqRepeat').value !== 'until:before');
  loopHint();
}
$<HTMLSelectElement>('sqStart').onchange = $<HTMLSelectElement>('sqRepeat').onchange = $<HTMLSelectElement>('sqMusic').onchange = $<HTMLSelectElement>('sqThen').onchange = $<HTMLSelectElement>('sqMusicEnd').onchange = showStartFields;
// Listening for the start mark, on this Mac only (not on air): plays from the mark, Mark here sets it.
const markAudio = new Audio();
function stopListening() { markAudio.pause(); $<HTMLButtonElement>('sqListen').textContent = '▶ Listen'; $<HTMLButtonElement>('sqMarkHere').classList.add('hidden'); }
$<HTMLButtonElement>('sqListen').onclick = () => {
  if (!markAudio.paused) { stopListening(); return; }
  const file = $<HTMLSelectElement>('sqMusic').value.replace(/^track:/, '');
  markAudio.src = '/media/' + encodeURIComponent(file);
  markAudio.currentTime = Number($<HTMLInputElement>('sqMusicMark').value) || 0;
  markAudio.play().then(() => { $<HTMLButtonElement>('sqListen').textContent = '⏸ Stop listening'; $<HTMLButtonElement>('sqMarkHere').classList.remove('hidden'); }).catch((err: unknown) => { $('sqErr').textContent = `Can't play it here: ${err instanceof Error ? err.message : String(err)}`; });
};
$<HTMLButtonElement>('sqMarkHere').onclick = () => { $<HTMLInputElement>('sqMusicMark').value = String(Math.round(markAudio.currentTime * 10) / 10); };
$<HTMLDialogElement>('seqDialog').addEventListener('close', stopListening);
document.querySelectorAll<HTMLInputElement>('.sqBreaks input').forEach(c => { c.onchange = loopHint; });
// How long one time through takes, and for a break sequence how many times it fits in the break.
function loopHint() {
  const hint = $('sqLoop');
  if (!draft) return;
  const { sec, open } = runTime(draft.steps, new Set(draft.id ? [draft.id] : []));
  if (!sec) { hint.textContent = ''; return; }
  let text = `One time through is ${open ? 'at least ' : 'about '}${fmt(sec * 1000)}.`;
  const breaks = scene.game?.breaks;
  if (!open && $<HTMLSelectElement>('sqStart').value === 'break' && breaks) {
    const ticked = [...document.querySelectorAll<HTMLInputElement>('.sqBreaks input:checked')].map(c => c.value);
    const NAMES: Record<string, string> = { qt: 'quarter time', ht: 'half time', '3qt': 'three quarter time' };
    const fits = (scene.game?.last === 2 ? ['ht'] : ticked).filter(b => breaks[b] > 0).map(b => `${NAMES[b]} (${breaks[b]} min) about ${Math.round(breaks[b] * 60 / sec * 2) / 2} times`);
    if (fits.length) text += ` It plays ${fits.join(', ')}, as set in Competitions setup.`;
  }
  hint.textContent = text;
}
function stepSeconds(st: SourcesStep | SceneStep) {
  const secs = st.sources.map(id => scene.sources.find(s => s.id === id)).filter((s): s is Source => !!s && s.type === 'video').map(v => durationOf(v.file || '')).filter(Boolean);
  return secs.length ? Math.max(...secs) : 0;
}
function draftChanges() {
  const type = $<HTMLSelectElement>('sqStart').value, [repeat, moment] = $<HTMLSelectElement>('sqRepeat').value.split(':');
  const start: SeqStart = type === 'before' ? { type, min: Number($<HTMLInputElement>('sqStartMin').value) || 10 }
    : type === 'break' ? { type, breaks: [...document.querySelectorAll<HTMLInputElement>('.sqBreaks input:checked')].map(c => c.value), afterSec: Number($<HTMLInputElement>('sqAfter').value) || 0 }
    : type === 'fulltime' ? { type, afterSec: Number($<HTMLInputElement>('sqAfter').value) || 0 } : { type: 'hand' };
  const mus = $<HTMLSelectElement>('sqMusic').value, endType = $<HTMLSelectElement>('sqMusicEnd').value;
  const musicChoice = !mus ? null : { ...(mus.startsWith('playlist:') ? { playlist: mus.slice(9) } : { track: mus.slice(6) }),
    startStep: Number($<HTMLInputElement>('sqMusicStep').value) || 1, startAtSec: Number($<HTMLInputElement>('sqMusicMark').value) || 0, fadeInSec: Number($<HTMLInputElement>('sqMusicFade').value) || 0,
    ...($<HTMLInputElement>('sqMusicUnderVideo').checked ? { underVideo: true } : {}) };
  return { name: $<HTMLInputElement>('sqName').value.trim(), colour: $<HTMLSelectElement>('sqColour').value, repeat, start, music: musicChoice, quiet: $<HTMLInputElement>('sqQuiet').checked, hidden: $<HTMLInputElement>('sqHidden').checked,
    musicEnd: endType === 'fade' || endType === 'crossfade' ? { type: endType, sec: Number($<HTMLInputElement>('sqMusicEndSec').value) || 3 } : { type: endType },
    ...(repeat === 'until' ? { until: moment === 'before' ? { moment, min: Number($<HTMLInputElement>('sqUntilMin').value) || 0 } : { moment } } : {}),
    then: thenOf($<HTMLSelectElement>('sqThen').value),
    // With one output it plays there (an output it played on that has since been removed is let go).
    playsOn: playsOnTicked(),
    thenOn: Object.fromEntries([...document.querySelectorAll<HTMLSelectElement>('#sqThens select[data-out]')].filter(sel => sel.value !== $<HTMLSelectElement>('sqThen').value).map(sel => [sel.dataset.out, thenOf(sel.value)])),
    steps: draft?.steps || [] };
}
async function saveSequence(andPlay: boolean) {
  const d = draft;
  if (!d) return;
  const changes = draftChanges();
  if (!changes.name) { $('sqErr').textContent = 'Give the sequence a name.'; return; }
  if (!changes.steps.length) { $('sqErr').textContent = 'Add at least one step.'; return; }
  if (changes.steps.some(st => st.kind === 'scene' && !st.scene)) { $('sqErr').textContent = 'Pick a scene for each scene step.'; return; }
  if (changes.steps.some(st => st.kind === 'sequence' && !st.sequence)) { $('sqErr').textContent = 'Pick a sequence for each sequence step.'; return; }
  if (!changes.playsOn.length) { $('sqErr').textContent = 'Tick at least one output it plays on.'; return; }
  if (changes.start.type === 'break' && !changes.start.breaks.length && scene.game?.last !== 2) { $('sqErr').textContent = 'Tick at least one break.'; return; }
  const before = new Set(sequences().map(s => s.id));
  const body = d.id ? await act({ type: 'seqUpdate', sequence: d.id, changes }) : await act({ type: 'seqAdd', changes });
  if (!body) { $('sqErr').textContent = $('err').textContent; return; }
  const id = d.id || (body.sequences || []).find(s => !before.has(s.id))?.id;
  $<HTMLDialogElement>('seqDialog').close();
  draft = null;
  if (andPlay && id) act({ type: 'seqPlay', sequence: id });
}
$<HTMLInputElement>('seqAuto').onchange = () => act({ type: 'seqAuto', value: $<HTMLInputElement>('seqAuto').checked });
$<HTMLButtonElement>('sqAddStep').onclick = () => { draft?.steps.push({ sources: [], length: { type: 'time', sec: 20 } }); renderSteps(); };
$<HTMLButtonElement>('sqAddScene').onclick = () => { draft?.steps.push({ kind: 'scene', scene: '', sources: [], length: { type: 'now' } }); renderSteps(); };
$<HTMLButtonElement>('sqAddSeq').onclick = () => { draft?.steps.push({ kind: 'sequence', sequence: '' }); renderSteps(); };
$<HTMLButtonElement>('sqAddAds').onclick = () => { draft?.steps.push({ kind: 'ads', count: 1, house: true }); renderSteps(); };
$<HTMLButtonElement>('sqSave').onclick = () => saveSequence(false);
$<HTMLButtonElement>('sqTry').onclick = () => saveSequence(true);
$<HTMLButtonElement>('sqCancel').onclick = () => { $<HTMLDialogElement>('seqDialog').close(); draft = null; };
$<HTMLButtonElement>('sqCopy').onclick = async () => { if (draft?.id && await act({ type: 'seqCopy', sequence: draft.id })) { $<HTMLDialogElement>('seqDialog').close(); draft = null; } };
$<HTMLButtonElement>('sqDelete').onclick = async () => {
  if (!draft?.id || !await askConfirm(`Delete the sequence "${draft.name}"?`, 'Its Stream Deck keys will stop working. The sources stay as they are.', { ok: 'Delete', danger: true })) return;
  if (await act({ type: 'seqRemove', sequence: draft.id })) { $<HTMLDialogElement>('seqDialog').close(); draft = null; }
};
$<HTMLDialogElement>('seqDialog').addEventListener('close', () => { draft = null; });
// Escape or leaving the page with changes not saved asks first (unsaved.js).
const seqGuard = unsavedDialog($<HTMLDialogElement>('seqDialog'), {
  what: () => $<HTMLInputElement>('sqName').value.trim() || 'the new sequence', snapshot: draftChanges,
  save: async () => { await saveSequence(false); return !$<HTMLDialogElement>('seqDialog').open; },
});
