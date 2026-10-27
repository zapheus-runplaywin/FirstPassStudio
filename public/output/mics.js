// FirstPass Studio - the Output page, part 7 of 13: Mics: live mics plugged into the Mac, their levels, mutes and dips.
// The page's script is split by section into public/output/, loaded in order by output.html; the files share one
// scope (plain scripts), so a name defined in an earlier part is in reach of a later one.

// ─── Mics ──────────────────────────────────────────────────────────────
// The mics Studio keeps (mics.js) and what the primary output's window hears from them (/api/scene/mics/live, asked
// every half second while this section is open). The Mac's inputs are listed by that window, or by this page when
// it's open in the Mac app (Find inputs), since a page on another computer would list its own.
const onThisMac = ['localhost', '127.0.0.1'].includes(location.hostname);
let micLive = { mixing: false, devices: [], levels: {}, problems: {}, status: '' };
const micsOf = () => (scene.mics && scene.mics.mics) || [];
const primaryOn = () => { const o = out && out.outputs && out.outputs.find(x => x.id === 'main'); return !!(o && o.on && o.mode !== 'off'); };
const deviceName = d => d || 'The Mac\'s own input';
const channelName = c => ({ both: 'both channels', left: 'left', right: 'right' })[c] || c;

function renderMics() {
  const set = scene.mics;
  if (!set) return;
  const mics = set.mics;
  $('mxHeard').textContent = !mics.length ? 'No mics yet'
    : set.muted ? 'All mics muted'
    : !primaryOn() ? 'Not heard: Output 1 is off'
    : micLive.mixing ? `Heard on Output 1${set.level !== 100 ? ` at ${set.level}%` : ''}` : 'Waiting for Output 1 to open the mics…';
  $('mxWhy').textContent = set.dipped && mics.length ? `dipped to ${set.dipTo}%: ${set.why.join(', ')}` : '';
  $('mxBar').classList.toggle('on', !!mics.length && !set.muted && primaryOn() && micLive.mixing);
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
    + 'Studio mixes them into the sound of <b>Output 1</b> with the music and video sound, so they go out wherever that sound goes. They\'re heard only while Output 1 is on, and never in the Scene View, so a speaker near a mic can\'t feed back. '
    + 'The first time, the Mac asks whether FirstPass Studio may use the microphone: allow it (or later in System Settings, Privacy &amp; Security, Microphone). '
    + 'Each mic has its own level (100% is as it comes in, up to 200%), a mute and a <b>Low cut</b> for wind and rumble; <b>Level</b> and <b>Mute all</b> are over all of them, and a limiter stops a shout clipping the stream. '
    + 'Two receivers on one stereo input are two mics: pick Left for one and Right for the other. '
    + 'Like the music\'s duck, the mics <b>dip</b> while music plays, while a video with its sound on plays, and while a scene or sequence with <b>Quiet the music</b> ticked is on (each a tick box), and by hand with <b>Dip</b>. A mic with <b>Follows the dips</b> off stays at its level. '
    + `Stream Deck: <code>${typeof base === 'string' ? base : ''}/deck/mics/mute/toggle</code> (or <code>/on</code>, <code>/off</code>), <code>/deck/mics/dip/toggle</code>, <code>/deck/mics/up</code> and <code>/down</code> (10% a press, or <code>?by=5</code>), <code>/deck/mics/level/80</code>, `
    + 'and one mic by its name or number: <code>/deck/mic/court-mic/mute/toggle</code>, <code>/deck/mic/1/up</code>, <code>/deck/mic/1/down</code>.';
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
    add.innerHTML = '+ Add mic<small>an input plugged into the Mac</small>';
    add.onclick = () => openMic(null);
    add.disabled = micsOf().length >= 8;
    box.appendChild(add);
  }
  meters();
}
// What the cards show, so a change made elsewhere (a Stream Deck press) redraws them.
const micsLook = () => JSON.stringify(micsOf().map(m => [m.name, m.device, m.channel, m.level, m.muted, m.lowCut, m.follow]));
function meters() {
  for (const card of $('mxList').querySelectorAll('[data-mic]')) {
    const id = card.dataset.mic, db = micLive.levels[id], problem = micLive.problems[id];
    const bar = card.querySelector('.mxMeter i');
    // -60 dBFS to 0 across the bar.
    const pct = db === undefined ? 0 : Math.max(0, Math.min(100, (db + 60) / 60 * 100));
    bar.style.width = pct + '%';
    bar.className = db >= -3 ? 'hot' : db >= -12 ? 'warm' : '';
    const where = card.querySelector('.where');
    where.classList.toggle('badText', !!problem);
    const m = micsOf().find(x => x.id === id);
    if (m) where.textContent = problem || [`Mic ${micsOf().indexOf(m) + 1}`, deviceName(m.device), channelName(m.channel), m.lowCut ? 'low cut' : '', m.follow ? '' : 'doesn\'t dip'].filter(Boolean).join(' · ');
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
  mxDraft = m ? { ...m } : { name: '', device: micLive.devices[0] || '', channel: 'both', lowCut: true, follow: true };
  $('mxTitle').textContent = m ? 'Edit mic' : 'Add a mic';
  $('mxName').value = mxDraft.name;
  $('mxChannel').value = mxDraft.channel;
  $('mxLowCut').checked = mxDraft.lowCut;
  $('mxFollow').checked = mxDraft.follow;
  $('mxDelete').classList.toggle('hidden', !m);
  $('mxErr').textContent = '';
  $('mxFind').classList.toggle('hidden', !onThisMac);
  $('mxFindNote').textContent = onThisMac ? '' : 'The inputs listed are the ones Output 1 can see. To list them before Output 1 is on, open this page in the Studio app and press Find inputs.';
  fillDevices();
  if (!$('mxDialog').open) $('mxDialog').showModal();
  mxGuard.opened();
  // In the Mac app, list the inputs straight away if the Mac has already let Studio use them.
  if (onThisMac && !micLive.devices.length) findInputs(false);
}
function fillDevices() {
  const sel = $('mxDevice');
  const want = sel.options.length ? sel.value : mxDraft ? mxDraft.device : '';
  const names = [...new Set(['', ...micLive.devices, ...(want ? [want] : [])])];
  const now = names.join('|');
  if (sel.dataset.list === now) return;
  sel.dataset.list = now;
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
const mxChanges = () => ({ name: $('mxName').value.trim(), device: $('mxDevice').value, channel: $('mxChannel').value, lowCut: $('mxLowCut').checked, follow: $('mxFollow').checked });
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
  const body = mxDraft.id ? await act({ type: 'micUpdate', mic: mxDraft.id, changes }) : await act({ type: 'micAdd', changes });
  if (!body) { $('mxErr').textContent = $('err').textContent; return; }
  $('mxDialog').close();
};
$('mxDelete').onclick = async () => {
  if (!mxDraft?.id || !confirm(`Delete the mic "${mxDraft.name}"? Studio stops mixing it in.`)) return;
  if (await act({ type: 'micRemove', mic: mxDraft.id })) $('mxDialog').close();
};
