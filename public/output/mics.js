// FirstPass Studio - the Output page, part 7 of 13: Mics: live mics plugged into the Mac or the switcher, their levels, mutes and dips.
// The page's script is split by section into public/output/, loaded in order by output.html; the files share one
// scope (plain scripts), so a name defined in an earlier part is in reach of a later one.

// ─── Mics ──────────────────────────────────────────────────────────────
// The mics Studio keeps (mics.js) and what the output windows hear from them (/api/scene/mics/live, asked every half
// second while this section is open). Each Mac mic goes to the outputs ticked for it (Goes to, Output 1 unless set). The Mac's inputs are listed by that window, or by this page when
// it's open in the Mac app (Find inputs), since a page on another computer would list its own. A mic plugged into
// the switcher picks one of the switcher's audio inputs instead, and its card shows where Studio has its fader.
const onThisMac = ['localhost', '127.0.0.1'].includes(location.hostname);
let micLive = { mixing: false, devices: [], levels: {}, problems: {}, status: '', switcher: { connected: false, inputs: [] }, faders: {} };
const micsOf = () => (scene.mics && scene.mics.mics) || [];
const outputOn = id => { const o = out && out.outputs && out.outputs.find(x => x.id === id); return !!(o && o.on && o.mode !== 'off'); };
const micOuts = m => (m.outputs && m.outputs.length ? m.outputs : ['main']).filter(id => (out?.outputs || []).some(o => o.id === id));
const manyOutputs = () => !!(out && out.outputs && out.outputs.length > 1);
const deviceName = d => d || 'The Mac\'s own input';
const channelName = c => ({ both: 'both channels', left: 'left', right: 'right' })[c] || c;
const onAtem = m => m.on === 'atem';
const atemInputName = id => ((micLive.switcher?.inputs || []).find(i => i.id === id) || {}).name || (id > 1300 && id < 1400 ? `Mic ${id - 1300}` : `input ${id}`);
const micWhere = m => [`#${micsOf().indexOf(m) + 1}`, onAtem(m) ? `switcher: ${m.input ? atemInputName(m.input) : 'no input picked'}` : deviceName(m.device), channelName(m.channel),
  !onAtem(m) && m.lowCut ? 'low cut' : '', m.follow ? '' : 'external mixer, doesn\'t dip', !onAtem(m) && manyOutputs() ? `to ${outputNames(micOuts(m)) || 'no output'}` : ''].filter(Boolean).join(' · ');
const fmtDb = d => d <= -100 ? 'all the way down' : `${d > 0 ? '+' : ''}${d.toFixed(1)} dB`;

function renderMics() {
  const set = scene.mics;
  if (!set) return;
  const mics = set.mics, mac = mics.filter(m => !onAtem(m)), atem = mics.filter(onAtem);
  // The Mac's mics are heard on the outputs they go to while those are on; the switcher's wherever the switcher sends them.
  const outs = [...new Set(mac.flatMap(micOuts))], live = outs.filter(outputOn);
  const macHeard = !mac.length ? '' : !live.length ? `Mac mics not heard: ${outputNames(outs) || 'their outputs'} ${outs.length > 1 ? 'are' : 'is'} off`
    : micLive.mixing ? `Mac mics heard on ${outputNames(live)}` : `Waiting for ${outputNames(live)} to open the Mac mics…`;
  const atemHeard = !atem.length ? '' : micLive.switcher?.connected ? 'switcher mics on its faders' : 'Switcher not connected';
  $('mxHeard').textContent = !mics.length ? 'No mics yet'
    : set.muted ? 'All mics muted'
    : [macHeard, atemHeard].filter(Boolean).join(' · ').replace(/^./, c => c.toUpperCase()) + (set.level !== 100 ? ` (level ${set.level}%)` : '');
  $('mxWhy').textContent = set.dipped && mics.length ? `dipped to ${set.dipTo}%: ${set.why.join(', ')}` : '';
  $('mxBar').classList.toggle('on', !!mics.length && !set.muted && ((mac.length && live.length && micLive.mixing) || (atem.length && micLive.switcher?.connected)));
  $('mxMute').classList.toggle('lit', set.muted);
  $('mxMute').textContent = set.muted ? 'Muted' : 'Mute all';
  $('mxDip').classList.toggle('lit', set.hand);
  $('mxDip').textContent = set.hand ? 'Dipped' : 'Dip';
  if (document.activeElement !== $('mxLevel')) $('mxLevel').value = set.level;
  for (const [id, key] of [['mxDipTo', 'dipTo'], ['mxDown', 'dipDownSec'], ['mxUp', 'dipUpSec']]) if (document.activeElement !== $(id)) $(id).value = set[key];
  for (const [id, key] of [['mxDipMusic', 'dipMusic'], ['mxDipVideo', 'dipVideo'], ['mxDipQuiet', 'dipQuiet']]) $(id).checked = !!set[key];
  $('mxProblem').textContent = micLive.status;
  renderMicList();
  $('micsNote').innerHTML = 'Plug wireless mic receivers (effects mics on court, crowd mics) into the Mac, directly or through an audio interface, and add each one here. '
    + 'Studio mixes each one into the sound of the outputs its <b>Goes to</b> ticks (Output 1 to start; the ticks show once there\'s more than one output) with their music and video sound, so a commentators\' feed can take the effects mics and leave out the commentators\' own. They\'re heard only while those outputs are on, and never in the Scene View, so a speaker near a mic can\'t feed back. '
    + 'The first time, the Mac asks whether FirstPass Studio may use the microphone: allow it (or later in System Settings, Privacy &amp; Security, Microphone). '
    + 'Each mic has its own level (100% is as it comes in, up to 200%), a mute and a <b>Low cut</b> for wind and rumble; <b>Level</b> and <b>Mute all</b> are over all of them, and a limiter stops a shout clipping the stream. '
    + 'Two receivers on one stereo input are two mics: pick Left for one and Right for the other. '
    + 'A mic plugged into the <b>switcher</b> (an ATEM Mini\'s Mic 1 or Mic 2) is mixed by the switcher: Studio moves its fader to the mic\'s level, mutes and dips, and changes nothing else on it (its On, Off or AFV, EQ and dynamics are set in ATEM Software Control, and the input must be On). '
    + 'Move its fader on the switcher or in ATEM Software Control and that becomes the mic\'s level; when Studio connects it takes the faders as they are. For Left and Right, split the input into two mono channels in ATEM Software Control. '
    + 'Like the music\'s duck, the mics <b>dip</b> while music plays, while a video with its sound on plays, and while a scene or sequence with <b>Quiet the music</b> ticked is on (each a tick box), and by hand with <b>Dip</b>. A mic marked <b>Has an external mixer</b> never dips (the mixer does the fading) and stays at its level. '
    + `Stream Deck: <code>${typeof deckBase === 'string' ? deckBase : ''}/deck/mics/mute/toggle</code> (or <code>/on</code>, <code>/off</code>), <code>/deck/mics/dip/toggle</code>, <code>/deck/mics/up</code> and <code>/down</code> (10% a press, or <code>?by=5</code>), <code>/deck/mics/level/80</code>, `
    + 'and one mic by its name or its # on its card: <code>/deck/mic/court-mic/mute/toggle</code>, <code>/deck/mic/1/up</code>, <code>/deck/mic/1/down</code>.';
}

function renderMicList() {
  const box = $('mxList');
  // The meters update in place, so a slider being dragged keeps its place.
  const ids = micsOf().map(m => m.id).join('|');
  if (box.dataset.ids !== ids || box.dataset.look !== micsLook()) {
    box.dataset.ids = ids;
    box.dataset.look = micsLook();
    box.innerHTML = '';
    micsOf().forEach((m, i) => {
      const card = document.createElement('div');
      card.className = 'seq' + (m.muted ? ' off' : '');
      card.dataset.mic = m.id;
      card.innerHTML = '<div class="t"><b></b><button class="alt edit">Edit</button></div><small class="where"></small><div class="mxMeter"><i></i></div>'
        + '<div class="row" style="flex-wrap:nowrap"><button class="alt mute">Mute</button><input type="range" class="lvl" min="0" max="200" style="flex:1;min-width:0" aria-label="Level"><small class="pct" style="min-width:36px;text-align:right"></small></div>';
      card.querySelector('b').textContent = m.name;
      const mute = card.querySelector('.mute');
      mute.textContent = m.muted ? 'Muted' : 'Mute';
      mute.classList.toggle('lit', m.muted);
      mute.onclick = () => act({ type: 'micMute', mic: m.id, value: 'toggle' });
      const lvl = card.querySelector('.lvl');
      lvl.value = m.level;
      card.querySelector('.pct').textContent = `${m.level}%`;
      lvl.oninput = () => { card.querySelector('.pct').textContent = `${lvl.value}%`; };
      lvl.onchange = () => act({ type: 'micLevel', mic: m.id, value: Number(lvl.value) });
      card.querySelector('.edit').onclick = () => openMic(m);
      box.appendChild(card);
    });
    const add = document.createElement('button');
    add.className = 'seq addSeq';
    add.innerHTML = '+ Add mic<small>an input on the Mac or the switcher</small>';
    add.onclick = () => openMic(null);
    add.disabled = micsOf().length >= 8;
    box.appendChild(add);
  }
  meters();
}
// What the cards show, so a change made elsewhere (a Stream Deck press) redraws them.
const micsLook = () => JSON.stringify([micsOf().map(m => [m.name, m.on, m.device, m.input, m.channel, m.level, m.muted, m.lowCut, m.follow, m.outputs]), (out?.outputs || []).map(o => o.name)]);
function meters() {
  for (const card of $('mxList').querySelectorAll('[data-mic]')) {
    const id = card.dataset.mic, problem = micLive.problems[id];
    const m = micsOf().find(x => x.id === id);
    if (!m) continue;
    const bar = card.querySelector('.mxMeter i'), fader = micLive.faders?.[id];
    // The Mac's mics: what comes in, -60 dBFS to 0 across the bar. The switcher's: where its fader is, -60 to +6 dB.
    const db = onAtem(m) ? fader : micLive.levels[id];
    const pct = db === undefined ? 0 : Math.max(0, Math.min(100, onAtem(m) ? (db + 60) / 66 * 100 : (db + 60) / 60 * 100));
    bar.style.width = pct + '%';
    bar.className = onAtem(m) ? '' : db >= -3 ? 'hot' : db >= -12 ? 'warm' : '';
    const where = card.querySelector('.where');
    where.classList.toggle('badText', !!problem);
    where.textContent = problem || micWhere(m) + (onAtem(m) && fader !== undefined ? ` · fader ${fmtDb(fader)}` : '');
  }
}

async function pollMics() {
  if (isFolded($('micsSection')) || document.hidden || !micsOf().length && !$('mxDialog').open) return;
  try { micLive = await (await fetch('/api/scene/mics/live', { cache: 'no-store' })).json(); } catch { return; }
  renderMics();
  if ($('mxDialog').open) fillDevices();
}
setInterval(pollMics, 500);
$('micsSection').addEventListener('fold', e => { if (e.detail.open) pollMics(); });

$('mxMute').onclick = () => act({ type: 'micsMute', value: 'toggle' });
$('mxDip').onclick = () => act({ type: 'micsDip', value: 'toggle' });
$('mxLevel').onchange = () => act({ type: 'micsLevel', value: Number($('mxLevel').value) });
const micsSettings = () => act({ type: 'micsSettings', settings: { dipTo: Number($('mxDipTo').value), dipDownSec: Number($('mxDown').value), dipUpSec: Number($('mxUp').value),
  dipMusic: $('mxDipMusic').checked, dipVideo: $('mxDipVideo').checked, dipQuiet: $('mxDipQuiet').checked } });
for (const id of ['mxDipTo', 'mxDown', 'mxUp', 'mxDipMusic', 'mxDipVideo', 'mxDipQuiet']) $(id).onchange = micsSettings;

// ─── The mic editor ─────────────────────────────────────────────────────
let mxDraft = null;
function openMic(m) {
  mxDraft = m ? { ...m } : { name: '', on: 'mac', device: micLive.devices[0] || '', input: 0, channel: 'both', lowCut: true, follow: true, outputs: ['main'] };
  const ticks = () => outputTicks($('mxOuts'), mxDraft.outputs, ids => { mxDraft.outputs = ids; ticks(); });
  ticks();
  $('mxOn').value = mxDraft.on || 'mac';
  $('mxTitle').textContent = m ? 'Edit mic' : 'Add a mic';
  $('mxName').value = mxDraft.name;
  $('mxChannel').value = mxDraft.channel;
  $('mxLowCut').checked = mxDraft.lowCut;
  $('mxMixer').checked = !mxDraft.follow; // an external mixer does the fading
  $('mxDelete').classList.toggle('hidden', !m);
  $('mxErr').textContent = '';
  routeFields();
  fillDevices();
  if (!$('mxDialog').open) $('mxDialog').showModal();
  mxGuard.opened();
  // In the Mac app, list the inputs straight away if the Mac has already let Studio use them.
  if (onThisMac && !micLive.devices.length && mxDraft.on !== 'atem') findInputs(false);
}
// The fields for where the mic is plugged in: the Mac (its devices, Find inputs, low cut) or the switcher (its inputs).
function routeFields() {
  const atem = $('mxOn').value === 'atem';
  $('mxFind').classList.toggle('hidden', atem || !onThisMac);
  $('mxLowCutRow').classList.toggle('hidden', atem);
  for (const el of document.querySelectorAll('.mxOutsRow')) el.classList.toggle('hidden', atem || !manyOutputs());
  $('mxFindNote').textContent = atem ? (micLive.switcher?.connected ? 'Studio moves this input\'s fader on the switcher; set its On, EQ and dynamics in ATEM Software Control. For Left or Right, split the input into two mono channels there.' : 'The switcher isn\'t connected: connect it in the Switcher section to list its inputs.')
    : onThisMac ? '' : 'The inputs listed are the ones Output 1 can see. To list them before Output 1 is on, open this page in the Studio app and press Find inputs.';
}
$('mxOn').onchange = () => { $('mxDevice').innerHTML = ''; delete $('mxDevice').dataset.list; routeFields(); fillDevices(); };
function fillDevices() {
  const sel = $('mxDevice');
  if ($('mxOn').value === 'atem') {
    const want = sel.options.length && sel.dataset.kind === 'atem' ? sel.value : String(mxDraft?.input || '');
    const list = (micLive.switcher?.inputs || []).map(i => [String(i.id), i.name + (i.split ? ' (split in two)' : '')]);
    if (want && want !== '0' && !list.some(([v]) => v === want)) list.push([want, `${atemInputName(Number(want))} (not on the switcher)`]);
    const now = 'atem|' + list.map(x => x.join(':')).join('|');
    if (sel.dataset.list === now) return;
    sel.dataset.list = now; sel.dataset.kind = 'atem';
    sel.innerHTML = '';
    if (!list.length) sel.add(new Option('No switcher inputs yet', ''));
    for (const [v, label] of list) sel.add(new Option(label, v, false, v === want));
    return;
  }
  const want = sel.options.length && sel.dataset.kind === 'mac' ? sel.value : mxDraft ? mxDraft.device : '';
  const names = [...new Set(['', ...micLive.devices, ...(want ? [want] : [])])];
  const now = names.join('|');
  if (sel.dataset.list === now) return;
  sel.dataset.list = now; sel.dataset.kind = 'mac';
  sel.innerHTML = '';
  for (const n of names) sel.add(new Option(n === '' ? 'The Mac\'s own input (as set in Sound settings)' : n + (micLive.devices.includes(n) ? '' : ' (not plugged in)'), n, false, n === want));
}
// Lists the Mac's inputs from this page (only in the Mac app, on this Mac). ask: ask the Mac's permission if need be.
async function findInputs(ask = true) {
  if (!navigator.mediaDevices) return;
  $('mxFindNote').textContent = '';
  try {
    let list = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
    if (list.every(d => !d.label)) {
      if (!ask) return;
      (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach(t => t.stop());
      list = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
    }
    const devices = list.filter(d => d.deviceId !== 'default' && d.deviceId !== 'communications').map(d => d.label).filter(Boolean);
    const res = await fetch('/api/scene/mics/devices', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ devices }) });
    micLive = await res.json();
    fillDevices();
    $('mxFindNote').textContent = devices.length ? `Found ${devices.length} input${devices.length === 1 ? '' : 's'}.` : 'The Mac has no audio inputs plugged in.';
  } catch (err) {
    $('mxFindNote').textContent = err.name === 'NotAllowedError' ? 'The Mac hasn\'t let Studio use the mics: allow FirstPass Studio in System Settings, Privacy & Security, Microphone, then press Find inputs again.'
      : `Couldn't list the inputs: ${err.message}`;
  }
}
$('mxFind').onclick = () => findInputs(true);
const mxChanges = () => {
  const atem = $('mxOn').value === 'atem';
  return { name: $('mxName').value.trim(), on: atem ? 'atem' : 'mac', ...(atem ? { input: Number($('mxDevice').value) || 0 } : { device: $('mxDevice').value }),
    channel: $('mxChannel').value, lowCut: $('mxLowCut').checked, follow: !$('mxMixer').checked, ...(atem ? {} : { outputs: mxDraft?.outputs || ['main'] }) };
};
$('mxCancel').onclick = () => { $('mxDialog').close(); };
$('mxDialog').addEventListener('close', () => { mxDraft = null; $('mxDevice').innerHTML = ''; delete $('mxDevice').dataset.list; });
const mxGuard = unsavedDialog($('mxDialog'), {
  what: () => $('mxName').value.trim() || 'the new mic',
  snapshot: mxChanges,
  save: async () => { await $('mxSave').onclick(); return !$('mxDialog').open; },
});
$('mxSave').onclick = async () => {
  const changes = mxChanges();
  if (!changes.name) { $('mxErr').textContent = 'Give the mic a name, such as Court mic.'; return; }
  if (changes.on === 'atem' && !changes.input) { $('mxErr').textContent = 'Pick the switcher\'s input the mic is plugged into (connect the switcher first).'; return; }
  const body = mxDraft.id ? await act({ type: 'micUpdate', mic: mxDraft.id, changes }) : await act({ type: 'micAdd', changes });
  if (!body) { $('mxErr').textContent = $('err').textContent; return; }
  $('mxDialog').close();
};
$('mxDelete').onclick = async () => {
  if (!mxDraft?.id || !await askConfirm(`Delete the mic "${mxDraft.name}"?`, 'Studio stops mixing it in.', { ok: 'Delete', danger: true })) return;
  if (await act({ type: 'micRemove', mic: mxDraft.id })) $('mxDialog').close();
};
