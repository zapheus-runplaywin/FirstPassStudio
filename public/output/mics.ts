// FirstPass Studio - the Output page, part 8 of 16: Mics: live mics plugged into the Mac or the switcher, their levels, mutes and ducking (the word the music uses too; the code and settings keep dip).
// The page's script is split by section into public/output/, loaded in order by output.html; the files share one
// scope (plain scripts), so a name defined in an earlier part is in reach of a later one.

// ─── Mics ──────────────────────────────────────────────────────────────
// The mics Studio keeps (mics.ts) and what the output windows hear from them (/api/scene/mics/live, asked every half
// second while this section is open). The Mac's mics are Output 1's: its window opens and mixes them. The Mac's inputs
// are listed by that window, or by this page when it's open in the Mac app (Find inputs), since a page on another
// computer would list its own. A mic plugged into
// the switcher picks one of the switcher's audio inputs instead, and its card shows where Studio has its fader.
const onThisMac = ['localhost', '127.0.0.1'].includes(location.hostname);
let micLive: MicLive = { mixing: false, devices: [], levels: {}, problems: {}, status: '', switcher: { connected: false, inputs: [] }, faders: {} };
const micsOf = () => (scene.mics && scene.mics.mics) || [];
// Output 1, where the Mac's mics are heard, is on.
const primaryOn = () => { const o = out && out.outputs && out.outputs.find(x => x.id === 'main'); return !!(o && o.on && o.mode !== 'off'); };
const deviceName = (d: string) => d || 'The Mac\'s own input';
const channelName = (c: string) => ({ both: 'both channels', left: 'left', right: 'right' } as Record<string, string>)[c] || c;
const onAtem = (m: { on?: string }) => m.on === 'atem';
const onPhone = (m: { on?: string }) => m.on === 'phone';
const atemInputName = (id: number) => (micLive.switcher?.inputs || []).find(i => i.id === id)?.name || (id > 1300 && id < 1400 ? `Mic ${id - 1300}` : `input ${id}`);
const micWhere = (m: Mic) => [`#${micsOf().indexOf(m) + 1}`, onAtem(m) ? `switcher: ${m.input ? atemInputName(m.input) : 'no input picked'}` : onPhone(m) ? 'phone (backup), on the Commentator page' : deviceName(m.device), onPhone(m) ? '' : channelName(m.channel),
  !onAtem(m) && m.lowCut ? 'low cut' : '', m.follow ? '' : 'never ducks (external mixer)'].filter(Boolean).join(' · ');
const fmtDb = (d: number) => d <= -100 ? 'all the way down' : `${d > 0 ? '+' : ''}${d.toFixed(1)} dB`;

// The status board's Mics line, short enough to read from arm's length: a word, why in grey under it, and its light
// (green heard, amber not heard, waiting or muted, red when the switcher holding them isn't connected).
function micsBoard() {
  const set = scene.mics;
  const mics = (set && set.mics) || [];
  if (!set || !mics.length) return { word: 'No mics', why: 'add them in the Mics section', dot: '' };
  if (set.muted) return { word: 'Muted', why: 'all mics', dot: 'warn' };
  // A phone mic that's lost its connection: the commentator on it is off air until it's back.
  const dropped = mics.filter(m => onPhone(m) && /^Dropped/.test(micLive.problems?.[m.id] || ''));
  if (dropped.length && primaryOn()) return { word: 'Dropped', why: `${dropped.map(m => m.name).join(', ')} · phone lost Studio`, dot: 'bad' };
  // A mic that's heard nothing for a while (a flat battery, a receiver turned off) outranks the rest: it's the one to fix.
  const silent = mics.filter(m => micLive.silent?.[m.id] !== undefined);
  if (silent.length) return { word: 'Silent', why: silent.length > 1 ? `${silent.length} mics · nothing for ${Math.max(...silent.map(m => micLive.silent?.[m.id] || 0))} s`
    : `${silent[0].name} · nothing for ${micLive.silent?.[silent[0].id]} s`, dot: 'warn' };
  const mac = mics.filter(m => !onAtem(m)), atem = mics.filter(onAtem);
  const level = set.level !== 100 ? ` · level ${set.level}%` : '';
  const swWhy = atem.length ? (micLive.switcher?.connected ? 'switcher mics on its faders' : 'switcher not connected') : '';
  if (atem.length && !mac.length) return micLive.switcher?.connected ? { word: 'On the switcher', why: `on its faders${level}`, dot: 'ok' } : { word: 'Not heard', why: 'switcher not connected', dot: 'bad' };
  if (!primaryOn()) return { word: 'Not heard', why: ['Output 1 is off', swWhy].filter(Boolean).join(' · '), dot: 'warn' };
  if (!micLive.mixing) return { word: 'Waiting', why: ['for Output 1 to open them', swWhy].filter(Boolean).join(' · '), dot: 'warn' };
  return { word: 'Heard', why: ['on Output 1', swWhy].filter(Boolean).join(' · ') + level, dot: atem.length && !micLive.switcher?.connected ? 'warn' : 'ok' };
}

function renderMics() {
  const set = scene.mics;
  if (!set) return;
  const mics = set.mics, mac = mics.filter(m => !onAtem(m)), atem = mics.filter(onAtem);
  // The Mac's mics are heard on Output 1 while it's on; the switcher's wherever the switcher sends them.
  const macHeard = !mac.length ? '' : !primaryOn() ? 'Mac mics not heard: Output 1 is off'
    : micLive.mixing ? 'Mac mics heard on Output 1' : 'Waiting for Output 1 to open the Mac mics…';
  const atemHeard = !atem.length ? '' : micLive.switcher?.connected ? 'switcher mics on its faders' : 'Switcher not connected';
  $('mxHeard').textContent = !mics.length ? 'No mics yet'
    : set.muted ? 'All mics muted'
    : [macHeard, atemHeard].filter(Boolean).join(' · ').replace(/^./, c => c.toUpperCase()) + (set.level !== 100 ? ` (level ${set.level}%)` : '');
  $('mxWhy').textContent = set.dipped && mics.length ? `ducked to ${set.dipTo}%: ${set.why.join(', ')}` : '';
  $('mxBar').classList.toggle('on', !!mics.length && !set.muted && ((!!mac.length && primaryOn() && micLive.mixing) || (!!atem.length && micLive.switcher?.connected)));
  $<HTMLButtonElement>('mxMute').classList.toggle('lit', set.muted);
  $<HTMLButtonElement>('mxMute').textContent = set.muted ? 'Muted' : 'Mute all';
  $<HTMLButtonElement>('mxDip').classList.toggle('lit', !!set.hand);
  $<HTMLButtonElement>('mxDip').textContent = set.hand ? 'Ducked' : 'Duck';
  if (document.activeElement !== $<HTMLInputElement>('mxLevel')) $<HTMLInputElement>('mxLevel').value = String(set.level);
  for (const [id, key] of [['mxDipTo', 'dipTo'], ['mxDown', 'dipDownSec'], ['mxUp', 'dipUpSec']] as const) if (document.activeElement !== $(id)) $<HTMLInputElement>(id).value = String(set[key]);
  // A tick just clicked keeps what was clicked until its own save comes back, so an update already on its way (from
  // the box changed a moment before) can't untick it.
  if (Date.now() - mxTicked > 1500) for (const [id, key] of [['mxDipMusic', 'dipMusic'], ['mxDipVideo', 'dipVideo'], ['mxDipQuiet', 'dipQuiet']] as const) $<HTMLInputElement>(id).checked = !!set[key];
  $('mxProblem').textContent = micLive.status;
  renderMicList();
  renderDuck();
}

// The Ducking card's line while it's folded: how low the music and the mics go, and what takes each down.
function renderDuck() {
  const m = scene.musicSettings, x = scene.mics;
  const mWhy = [m?.underVideo !== 'leave' ? 'pauses under a video' : '', 'ducks for a scene or sequence'].filter(Boolean).join(', ');
  const xWhy = [x?.dipVideo ? 'a video' : '', x?.dipQuiet ? 'a scene or sequence' : '', x?.dipMusic ? 'music' : ''].filter(Boolean);
  $('dkSummary').textContent = `Music to ${m?.duckTo ?? 25}% (${mWhy}) · mics to ${x?.dipTo ?? 30}%${xWhy.length ? ` for ${xWhy.join(', ')}` : ' by hand only'}`;
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
      pick(card, 'b').textContent = m.name;
      const mute = pick<HTMLButtonElement>(card, '.mute');
      mute.textContent = m.muted ? 'Muted' : 'Mute';
      mute.classList.toggle('lit', m.muted);
      mute.onclick = () => act({ type: 'micMute', mic: m.id, value: 'toggle' });
      const lvl = pick<HTMLInputElement>(card, '.lvl');
      lvl.value = String(m.level);
      pick(card, '.pct').textContent = `${m.level}%`;
      lvl.oninput = () => { pick(card, '.pct').textContent = `${lvl.value}%`; };
      lvl.onchange = () => act({ type: 'micLevel', mic: m.id, value: Number(lvl.value) });
      pick<HTMLButtonElement>(card, '.edit').onclick = () => openMic(m);
      box.appendChild(card);
    });
    const add = document.createElement('button');
    add.className = 'seq addSeq';
    add.innerHTML = '+ Add mic<small>an input on the Mac or the switcher</small>';
    add.onclick = () => openMic(null);
    add.disabled = micsOf().length >= 8;
    box.appendChild(add);
    // A phone as a backup commentator mic: its QR code. The phone adds itself when it starts.
    const phone = document.createElement('button');
    phone.className = 'seq addSeq';
    phone.id = 'mxPhone';
    phone.innerHTML = '+ Phone mic<small>backup: a commentator\'s phone as their headset</small>';
    phone.onclick = showPhoneMic;
    phone.disabled = micsOf().length >= 8;
    box.appendChild(phone);
  }
  meters();
}
// What the cards show, so a change made elsewhere (a Stream Deck press) redraws them.
const micsLook = () => JSON.stringify([micsOf().map(m => [m.name, m.on, m.device, m.input, m.channel, m.level, m.muted, m.lowCut, m.follow])]);
function meters() {
  for (const card of $('mxList').querySelectorAll<HTMLElement>('[data-mic]')) {
    const id = card.dataset.mic || '', problem = micLive.problems[id];
    const m = micsOf().find(x => x.id === id);
    if (!m) continue;
    const bar = pick(card, '.mxMeter i'), fader = micLive.faders?.[id], heard = micLive.levels[id];
    // What comes in, -60 dBFS to 0 across the bar: the Mac's mics from Output 1's window, the switcher's from the switcher.
    // A switcher mic also shows where its fader is, as a mark (-60 to +6 dB); a switcher that sends no levels shows
    // the fader as the bar, as before.
    const atem = onAtem(m), levelOf = atem ? (heard !== undefined ? heard : fader) : heard, asFader = atem && heard === undefined;
    const pct = levelOf === undefined ? 0 : Math.max(0, Math.min(100, asFader ? (levelOf + 60) / 66 * 100 : (levelOf + 60) / 60 * 100));
    bar.style.width = pct + '%';
    bar.className = asFader || levelOf === undefined ? '' : levelOf >= -3 ? 'hot' : levelOf >= -12 ? 'warm' : '';
    let mark: HTMLElement | null = card.querySelector<HTMLElement>('.mxMeter b');
    if (atem && heard !== undefined && fader !== undefined) {
      if (!mark) { mark = document.createElement('b'); mark.title = 'Its fader on the switcher'; pick(card, '.mxMeter').append(mark); }
      mark.style.left = `calc(${Math.max(0, Math.min(100, (fader + 60) / 66 * 100))}% - 1px)`;
    } else if (mark) mark.remove();
    const where = pick(card, '.where'), silent = !problem && micLive.silent?.[id];
    where.classList.toggle('badText', !!problem);
    where.classList.toggle('warnText', !!silent);
    where.textContent = problem || (silent ? `Silent for ${silent} s · check its receiver and battery` : '') || micWhere(m) + (atem && heard !== undefined ? ` · hearing ${fmtDb(heard)}` : '') + (atem && fader !== undefined ? ` · fader ${fmtDb(fader)}` : '');
  }
}

// Folded, the section still asks every 2 s, so the board's Mics line can say when a mic goes silent.
let micPolls = 0;
async function pollMics() {
  if (document.hidden || !micsOf().length && !$<HTMLDialogElement>('mxDialog').open) return;
  if (isFolded($('micsSection')) && micPolls++ % 4) return;
  try { micLive = await (await fetch('/api/scene/mics/live', { cache: 'no-store' })).json(); } catch { return; }
  renderMics();
  if ($<HTMLDialogElement>('mxDialog').open) fillDevices();
}
setInterval(pollMics, 500);
$('micsSection').addEventListener('fold', e => { if (e.detail.open) pollMics(); });

$<HTMLButtonElement>('mxMute').onclick = () => act({ type: 'micsMute', value: 'toggle' });
$<HTMLButtonElement>('mxDip').onclick = () => act({ type: 'micsDip', value: 'toggle' });
$<HTMLInputElement>('mxLevel').onchange = () => act({ type: 'micsLevel', value: Number($<HTMLInputElement>('mxLevel').value) });
const micsSettings = () => act({ type: 'micsSettings', settings: { dipTo: Number($<HTMLInputElement>('mxDipTo').value), dipDownSec: Number($<HTMLInputElement>('mxDown').value), dipUpSec: Number($<HTMLInputElement>('mxUp').value),
  dipMusic: $<HTMLInputElement>('mxDipMusic').checked, dipVideo: $<HTMLInputElement>('mxDipVideo').checked, dipQuiet: $<HTMLInputElement>('mxDipQuiet').checked } });
for (const id of ['mxDipTo', 'mxDown', 'mxUp', 'mxDipMusic', 'mxDipVideo', 'mxDipQuiet']) $(id).onchange = () => { if ($<HTMLInputElement>(id).type === 'checkbox') mxTicked = Date.now(); micsSettings(); };

// ─── The mic editor ─────────────────────────────────────────────────────
let mxDraft: MicDraft | null = null;
// The Commentator page's QR code, by the secure link: a phone's browser gives a page the mic only over https.
async function showPhoneMic() {
  try {
    const got = await (await fetch('/api/phone-link?page=%2Fcommentator.html', { cache: 'no-store' })).json();
    if (got.error) throw new Error(got.error);
    const secure = /^https:/.test(got.link);
    $('pmSecure').hidden = secure;
    $('pmSecure').innerHTML = secure ? '' : 'Turn on the <b>Secure phone link</b> on the <a href="/api.html">Devices tab</a> first: a phone lets a page use its mic only over https. This QR code works once it says Ready.';
    $('pmCode').innerHTML = got.svg;
    $('pmLink').textContent = got.link;
    if (!$<HTMLDialogElement>('pmDialog').open) $<HTMLDialogElement>('pmDialog').showModal();
  } catch (err) { $('err').textContent = `Couldn't make the QR code: ${err instanceof Error ? err.message : String(err)}`; }
}
$<HTMLButtonElement>('pmDone').onclick = () => $<HTMLDialogElement>('pmDialog').close();
$<HTMLDialogElement>('pmDialog').addEventListener('click', e => { if (e.target === $<HTMLDialogElement>('pmDialog')) $<HTMLDialogElement>('pmDialog').close(); });

function openMic(m: Mic | null) {
  const draft: MicDraft = mxDraft = m ? { ...m } : { name: '', on: 'mac', device: micLive.devices[0] || '', input: 0, channel: 'both', lowCut: true, follow: true };
  // A phone mic stays a phone's (it comes from the Commentator page); the others pick the Mac or the switcher.
  pick($<HTMLSelectElement>('mxOn'), '[value="phone"]').hidden = draft.on !== 'phone';
  $<HTMLSelectElement>('mxOn').disabled = draft.on === 'phone';
  $<HTMLSelectElement>('mxOn').value = draft.on || 'mac';
  $('mxTitle').textContent = m ? 'Edit mic' : 'Add a mic';
  $<HTMLInputElement>('mxName').value = draft.name;
  $<HTMLSelectElement>('mxChannel').value = draft.channel;
  $<HTMLInputElement>('mxLowCut').checked = draft.lowCut;
  $<HTMLInputElement>('mxMixer').checked = !draft.follow; // an external mixer does the fading
  mixerNote();
  $<HTMLButtonElement>('mxDelete').classList.toggle('hidden', !m);
  $('mxErr').textContent = '';
  routeFields();
  fillDevices();
  if (!$<HTMLDialogElement>('mxDialog').open) $<HTMLDialogElement>('mxDialog').showModal();
  mxGuard.opened();
  // In the Mac app, list the inputs straight away if the Mac has already let Studio use them.
  if (onThisMac && !micLive.devices.length && draft.on !== 'atem') findInputs(false);
}
// The fields for where the mic is plugged in: the Mac (its devices, Find inputs, low cut) or the switcher (its inputs).
function routeFields() {
  const atem = $<HTMLSelectElement>('mxOn').value === 'atem', phone = $<HTMLSelectElement>('mxOn').value === 'phone';
  for (const e of document.querySelectorAll('#mxDialog .mxPlug')) e.classList.toggle('hidden', phone);
  $<HTMLButtonElement>('mxFind').classList.toggle('hidden', atem || !onThisMac);
  $<HTMLLabelElement>('mxLowCutRow').classList.toggle('hidden', atem);
  $('mxFindNote').textContent = phone ? 'The phone sends its mic over the network to Output 1. To use another phone, press + Phone mic and scan the code with it.' : atem ? (micLive.switcher?.connected ? 'Studio moves this input\'s fader on the switcher; set its On, EQ and dynamics in ATEM Software Control. For Left or Right, split the input into two mono channels there.' : 'The switcher isn\'t connected: connect it in the Switcher section to list its inputs.')
    : onThisMac ? '' : 'The inputs listed are the ones Output 1 can see. To list them before Output 1 is on, open this page in the Studio app and press Find inputs.';
}
$<HTMLSelectElement>('mxOn').onchange = () => { $<HTMLSelectElement>('mxDevice').innerHTML = ''; delete $<HTMLSelectElement>('mxDevice').dataset.list; routeFields(); fillDevices(); };
function fillDevices() {
  const sel = $<HTMLSelectElement>('mxDevice');
  if ($<HTMLSelectElement>('mxOn').value === 'atem') {
    const want = sel.options.length && sel.dataset.kind === 'atem' ? sel.value : String(mxDraft?.input || '');
    const list = (micLive.switcher?.inputs || []).map((i): [string, string] => [String(i.id), i.name + (i.split ? ' (split in two)' : '')]);
    if (want && want !== '0' && !list.some(([v]) => v === want)) list.push([want, `${atemInputName(Number(want))} (not on the switcher)`]);
    const now = 'atem|' + list.map(x => x.join(':')).join('|');
    if (sel.dataset.list === now) return;
    sel.dataset.list = now; sel.dataset.kind = 'atem';
    sel.innerHTML = '';
    if (!list.length) sel.add(new Option('No switcher inputs yet', ''));
    for (const [v, label] of list) sel.add(new Option(label, v, false, v === want));
    return;
  }
  const want = sel.options.length && sel.dataset.kind === 'mac' ? sel.value : mxDraft?.device || '';
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
    $('mxFindNote').textContent = err instanceof Error && err.name === 'NotAllowedError' ? 'The Mac hasn\'t let Studio use the mics: allow FirstPass Studio in System Settings, Privacy & Security, Microphone, then press Find inputs again.'
      : `Couldn't list the inputs: ${err instanceof Error ? err.message : String(err)}`;
  }
}
$<HTMLButtonElement>('mxFind').onclick = () => findInputs(true);
// A mic through an external mixer: the music sent to that mixer (a destination in Sound goes to) can come back in through it.
const mixerNote = () => $('mxMixerNote').classList.toggle('hidden', !$<HTMLInputElement>('mxMixer').checked);
$<HTMLInputElement>('mxMixer').addEventListener('change', mixerNote);
const mxChanges = (): { name: string; on?: string; input?: number; device?: string; channel?: string; lowCut: boolean; follow: boolean } => {
  const atem = $<HTMLSelectElement>('mxOn').value === 'atem';
  if ($<HTMLSelectElement>('mxOn').value === 'phone') return { name: $<HTMLInputElement>('mxName').value.trim(), lowCut: $<HTMLInputElement>('mxLowCut').checked, follow: !$<HTMLInputElement>('mxMixer').checked };
  return { name: $<HTMLInputElement>('mxName').value.trim(), on: atem ? 'atem' : 'mac', ...(atem ? { input: Number($<HTMLSelectElement>('mxDevice').value) || 0 } : { device: $<HTMLSelectElement>('mxDevice').value }),
    channel: $<HTMLSelectElement>('mxChannel').value, lowCut: $<HTMLInputElement>('mxLowCut').checked, follow: !$<HTMLInputElement>('mxMixer').checked };
};
$<HTMLButtonElement>('mxCancel').onclick = () => { $<HTMLDialogElement>('mxDialog').close(); };
$<HTMLDialogElement>('mxDialog').addEventListener('close', () => { mxDraft = null; $<HTMLSelectElement>('mxDevice').innerHTML = ''; delete $<HTMLSelectElement>('mxDevice').dataset.list; });
const mxGuard = unsavedDialog($<HTMLDialogElement>('mxDialog'), {
  what: () => $<HTMLInputElement>('mxName').value.trim() || 'the new mic',
  snapshot: mxChanges,
  save: async () => { await mxSave(); return !$<HTMLDialogElement>('mxDialog').open; },
});
async function mxSave() {
  const changes = mxChanges();
  if (!changes.name) { $('mxErr').textContent = 'Give the mic a name, such as Court mic.'; return; }
  if (changes.on === 'atem' && !changes.input) { $('mxErr').textContent = 'Pick the switcher\'s input the mic is plugged into (connect the switcher first).'; return; }
  const body = mxDraft?.id ? await act({ type: 'micUpdate', mic: mxDraft.id, changes }) : await act({ type: 'micAdd', changes });
  if (!body) { $('mxErr').textContent = $('err').textContent; return; }
  $<HTMLDialogElement>('mxDialog').close();
}
$<HTMLButtonElement>('mxSave').onclick = mxSave;
$<HTMLButtonElement>('mxDelete').onclick = async () => {
  if (!mxDraft?.id || !await askConfirm(`Delete the mic "${mxDraft.name}"?`, 'Studio stops mixing it in.', { ok: 'Delete', danger: true })) return;
  if (await act({ type: 'micRemove', mic: mxDraft.id })) $<HTMLDialogElement>('mxDialog').close();
};
