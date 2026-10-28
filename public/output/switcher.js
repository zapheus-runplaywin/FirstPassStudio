// FirstPass Studio - the Output page, part 8 of 13: Switcher: the ATEM switcher Studio controls, its inputs and keys in tally colours, picking it, each output's key on it (Into the switcher as, with its settings check), and the switcher actions on steps and scenes.
// The page's script is split by section into public/output/, loaded in order by output.html; the files share one
// scope (plain scripts), so a name defined in an earlier part is in reach of a later one.

// ─── Switcher ──────────────────────────────────────────────────────────
// What switcher.js says (over the scene's socket, as it changes): whether one is set up and answering, its
// inputs (red on program, green on preview) and its upstream and downstream keys (red while on air).
let sw = null;
let swFormOpen = false;
let swWithCams = ''; // the output cards' On air with ... as last drawn
const swTime = ms => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
async function swPost(path, body) {
  $('swErr').textContent = '';
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
    const json = await res.json();
    if (!res.ok) $('swErr').textContent = json.error || res.statusText;
    // A refusal's error is why it was refused, not the connection's, so it isn't drawn as the switcher's state. Nor
    // is an answer older than what the scene's socket has drawn since (connected while the answer was on its way).
    else if (json && json.state && !(sw && json.rev < sw.rev)) showSwitcher(json);
    return json;
  } catch (err) { $('swErr').textContent = `Studio isn't answering: ${err.message}`; }
}
const swDo = body => swPost('/api/switcher', body);
function swButton(text, cls, title, onclick) {
  const b = document.createElement('button');
  b.textContent = text;
  if (cls) b.className = cls;
  if (title) b.title = title;
  b.onclick = onclick;
  return b;
}
function showSwitcher(s) {
  sw = s;
  const live = s.state === 'connected';
  const name = s.pick ? s.pick.name || s.pick.address : '';
  const [dot, text] = !s.setUp ? ['', 'Not set up']
    : live ? ['ok', `<b>${hEsc(s.model)}</b> connected`]
    : s.state === 'connecting' ? ['warn', `Connecting to <b>${hEsc(name)}</b>…`]
    : s.state === 'error' ? ['bad', `<span class="badText">${hEsc(s.error)}</span>`]
    : ['bad', `<span class="badText">${hEsc(name)} not answering since ${swTime(s.since)}${s.error && s.error !== 'Not answering' ? ` (${hEsc(s.error)})` : ''}, trying again</span>`];
  $('swDot').className = `hdot ${dot}`;
  $('swText').innerHTML = text;
  $('swRetry').classList.toggle('hidden', !s.setUp || live || s.state === 'connecting');
  $('swSetup').textContent = swFormOpen ? 'Done' : s.setUp ? 'Change' : 'Set up';
  $('swLive').classList.toggle('hidden', !live);
  if (live) {
    const plural = (n, one) => `${n === 1 ? 'one' : n} ${one}${n === 1 ? '' : 's'}`;
    $('swHas').textContent = `${s.inputs.length} inputs, ${plural(s.usk.length, 'upstream key')}, ${plural(s.dsk.length, 'downstream key')}`
      + `${s.ftb ? ' · faded to black' : ''}${s.inTransition ? ' · in a transition' : ''}`;
    const box = $('swInputs');
    box.innerHTML = '';
    for (const i of s.inputs) {
      const cls = i.id === s.program ? 'prg' : i.id === s.preview ? 'pvw' : '';
      box.appendChild(swButton(i.name, cls, i.id === s.program ? `${i.name} is on program` : `Put ${i.name} on preview`, () => swDo({ type: 'preview', input: i.id })));
    }
    // The stinger: the scene's Stinger page, played on the output on a downstream key (Output 1 unless another one that's on is) with
    // the cut underneath, and that output's line-up.
    const on = (s.stingerOutput || {}).name || 'Output 1';
    const off = s.stingerOutput && s.stingerOutput.on === false;
    $('swStinger').disabled = !s.stinger;
    $('swStinger').title = s.stinger ? `Play "${s.stinger}" on ${on} and cut to the preview input underneath it` : 'Add the Stinger page as a source first (+ Add, Studio pages)';
    $('swLineupTest').disabled = !s.stinger;
    $('swLineupLabel').textContent = `line-up for ${on}`;
    $('swStingerName').textContent = off ? `${on} is off: turn it on for stinger cuts. Until then a stinger is a plain cut, 3 s late.`
      : s.stinger ? `"${s.stinger}" on ${on}, cut in the middle of its cover (from its own settings), at ${s.fps} frames a second`
      : 'Add the Stinger page as a source to cut under it; without one, a stinger is an auto.';
    if (document.activeElement !== $('swLineup')) $('swLineup').value = s.lineup || 0;
    $('swFtb').classList.toggle('on', s.ftb);
    $('swFtb').textContent = s.ftb ? 'Faded to black' : 'Fade to black';
    $('swUskLabel').classList.toggle('hidden', !s.usk.length);
    $('swDskLabel').classList.toggle('hidden', !s.dsk.length);
    const usk = $('swUsk'), dsk = $('swDsk');
    usk.innerHTML = '';
    dsk.innerHTML = '';
    // A key an output comes into is underlined in its colour, and says whose it is.
    const keyButton = (b, keyer) => {
      const o = (s.keys || []).find(x => x.keyer === keyer);
      if (o) { b.classList.add('outKey'); b.style.setProperty('--c', o.colour); b.title = `${o.name}'s key. ${b.title}${o.withCamera ? ` · ${o.withCamera}` : ''}`; }
      return b;
    };
    s.usk.forEach((on, k) => usk.appendChild(keyButton(swButton(`Key ${k + 1}`, on ? 'on' : '', `Upstream key ${k + 1} ${on ? 'off' : 'on'} (a cut)`, () => swDo({ type: 'usk', key: k + 1, on: 'toggle' })), `usk${k + 1}`)));
    s.dsk.forEach((on, k) => {
      dsk.appendChild(keyButton(swButton(`DSK ${k + 1}`, on ? 'on' : '', `Downstream key ${k + 1} ${on ? 'off' : 'on'} (a cut)`, () => swDo({ type: 'dsk', key: k + 1, on: 'toggle' })), `dsk${k + 1}`));
      dsk.appendChild(swButton('Auto', 'alt', `Downstream key ${k + 1} ${on ? 'off' : 'on'} at its own rate`, () => swDo({ type: 'dsk', key: k + 1, on: 'auto' })));
    });
  }
  $('swFollow').checked = s.follow !== false;
  const paired = (s.keys || []).filter(k => k.cameras && k.cameras.length);
  $('swFollowNote').textContent = paired.length ? paired.map(k => `${k.name}: ${k.withCamera}`).join(' · ')
    : 'Pick the cameras an output goes with (under Video output, Into the switcher as) and its key comes on with them.';
  // Picking the switcher: what was found on the network, or a typed address.
  $('swForm').classList.toggle('hidden', !swFormOpen);
  $('swForget').classList.toggle('hidden', !s.setUp);
  $('swFind').disabled = s.finding || !s.canFind;
  $('swFind').textContent = s.finding ? 'Looking…' : 'Look for switchers';
  $('swFindNote').textContent = !s.canFind ? 'Looking for switchers needs a Mac: type its address instead.'
    : s.finding ? '' : s.found.length ? '' : 'None found yet. Is the switcher on, and on the same network as this Mac?';
  const list = $('swFound');
  list.innerHTML = '';
  for (const f of s.found) {
    const li = document.createElement('li');
    const using = s.pick && s.pick.kind === 'found' && s.pick.name === f.name;
    li.className = using ? 'sel' : '';
    li.innerHTML = `<span><b>${hEsc(f.name)}</b>${f.model && f.model !== f.name ? ` (${hEsc(f.model)})` : ''} <small style="color:var(--fp-muted)">${hEsc(f.address || f.host)}</small></span>`;
    li.appendChild(using ? Object.assign(document.createElement('span'), { textContent: 'In use', className: 'note' }) : swButton('Use this one', '', '', () => swDo({ type: 'use', name: f.name })));
    list.appendChild(li);
  }
  if (document.activeElement !== $('swAddress') && s.pick && s.pick.kind === 'address') $('swAddress').value = s.pick.port === 9910 ? s.pick.address : `${s.pick.address}:${s.pick.port}`;
  swOutKey();
  // The output cards say On air with Court: redrawn only when that changes, not on every cut.
  const withCams = (s.keys || []).map(k => `${k.output}:${k.withCamera}`).join('|');
  if (withCams !== swWithCams && out && out.outputs) { swWithCams = withCams; renderOutputs(out, selectedOutput()); }
}
$('swSetup').onclick = () => {
  swFormOpen = !swFormOpen;
  if (sw) showSwitcher(sw);
  if (swFormOpen && sw && sw.canFind && !sw.found.length) swPost('/api/switcher/find');
};
$('swFind').onclick = () => { showSwitcher({ ...sw, finding: true }); swPost('/api/switcher/find'); };
$('swUseAddress').onclick = () => swDo({ type: 'use', address: $('swAddress').value });
$('swAddress').onkeydown = e => { if (e.key === 'Enter') $('swUseAddress').click(); };
$('swForget').onclick = () => { if (confirm('Forget this switcher? Studio stops controlling it until you pick it again.')) swDo({ type: 'forget' }); };
$('swRetry').onclick = () => swDo({ type: 'reconnect' });
$('swCut').onclick = () => swDo({ type: 'cut' });
$('swAuto').onclick = () => swDo({ type: 'auto' });
$('swStinger').onclick = () => swDo({ type: 'stinger' });
$('swLineup').onchange = () => swDo({ type: 'lineup', frames: Number($('swLineup').value) || 0 });
$('swLineupTest').onclick = () => {
  const on = (sw && sw.stingerOutput || {}).name || 'Output 1';
  if (confirm(`Test the line-up? This plays the stinger on ${on} and cuts program to the preview input, 2 frames after the stinger covers the frame. Do it before you\'re live. If you see the old picture before the bands cover it, add frames; if the bands are late on screen, take frames off.`)) swDo({ type: 'lineupTest' });
};
$('swFtb').onclick = () => swDo({ type: 'ftb' });

// ─── Into the switcher as: the output's key on the switcher ──────────────
// In the Video output setup (drawn here, as it needs the switcher): the key the picked output comes into (the usual
// one: Output 1 on downstream key 1, the others on upstream keys 2 to 4, a chroma output on an upstream key) and
// the inputs its fill and key are plugged into. switcher.js checks that key's settings in the switcher against what
// the output sends; Set up this key for me changes them (only when pressed). Called when the switcher or the outputs change.
const SW_KEYERS = [['dsk1', 'Downstream key 1'], ['dsk2', 'Downstream key 2'], ['usk1', 'Upstream key 1'], ['usk2', 'Upstream key 2'], ['usk3', 'Upstream key 3'], ['usk4', 'Upstream key 4']];
function swOutKey() {
  const so = selectedOutput();
  const show = !!so && so.mode !== 'off';
  for (const el of document.querySelectorAll('.forSw')) el.classList.toggle('hidden', !show);
  if (!show) return;
  const live = swLive();
  const chroma = so.signal === 'chroma';
  const none = so.keyerNow === 'none';
  const has = k => !live || (k.startsWith('usk') ? sw.usk.length : sw.dsk.length) >= Number(k.slice(3));
  const usual = SW_KEYERS.find(([k]) => k === (chroma || !so.primary ? `usk${so.slot}` : 'dsk1'));
  const keyers = [['', `The usual (${usual ? usual[1] : 'Upstream key'})`], ...SW_KEYERS.map(([k, t]) => [k, has(k) ? t : `${t} (not on the ${sw.model})`]),
    ['none', 'Not keyed by the switcher']];
  const sel = $('outKeyer');
  const keyersKey = keyers.map(x => x.join(':')).join('|');
  if (sel.dataset.k !== keyersKey) { sel.innerHTML = keyers.map(([v, t]) => `<option value="${v}">${hEsc(t)}</option>`).join(''); sel.dataset.k = keyersKey; }
  sel.value = so.keyer || '';
  // The switcher's inputs (cameras and other things plugged in), or Input 1 to 8 until it's connected.
  const inputs = live ? sw.inputs.map(i => [i.id, `${i.id} · ${i.name}`]) : Array.from({ length: 8 }, (_, k) => [k + 1, `Input ${k + 1}`]);
  const fillIn = (id, value) => {
    const opts = [[0, 'Pick an input'], ...inputs];
    if (value && !opts.some(([v]) => v === value)) opts.push([value, `Input ${value} (not on this switcher)`]);
    const html = opts.map(([v, t]) => `<option value="${v}">${hEsc(t)}</option>`).join('');
    if ($(id).dataset.k !== html) { $(id).innerHTML = html; $(id).dataset.k = html; }
    $(id).value = String(value || 0);
  };
  fillIn('outSwFill', so.swFill);
  fillIn('outSwKey', so.swKey);
  $('outSwFillLabel').textContent = chroma ? 'on' : 'fill on';
  for (const el of document.querySelectorAll('.forSwIn')) el.classList.toggle('hidden', none);
  for (const el of document.querySelectorAll('.forSwKey')) el.classList.toggle('hidden', none || chroma);
  // The check, from switcher.js.
  const c = live ? (sw.keys || []).find(k => k.output === so.id) : null;
  const box = $('outKeyCheck');
  let html;
  if (none) html = 'Studio leaves the switcher\'s keys alone for this output.';
  else if (!sw || !sw.setUp) html = 'Set up the switcher (under Switcher, below) and Studio checks the key\'s settings for this output.';
  else if (!live) html = 'Studio checks the key\'s settings once the switcher is answering.';
  else if (!c) html = '';
  else if (c.problems.length) html = `<span class="badText">${hEsc(c.label)} won't key ${hEsc(so.name)} yet:</span><ul>${c.problems.map(p => `<li>${hEsc(p)}</li>`).join('')}</ul>`;
  else if (c.fixes.length) html = `<span class="badText">${hEsc(c.label)} isn't set up for ${hEsc(so.name)}:</span><ul>${c.fixes.map(f => `<li>${hEsc(f)}</li>`).join('')}</ul>`;
  else html = `<span class="okText">✓ ${hEsc(c.label)} is set up for ${hEsc(so.name)}</span>${chroma ? ': pick the key colour with ATEM Software Control\'s sample picker' : ''}.`;
  box.innerHTML = html;
  $('outKeySetup').classList.toggle('hidden', !c || !c.fixes.length || !!c.problems.length);
  $('outKeySetup').title = c && c.fixes.length ? `Changes ${c.label} on the switcher: ${c.fixes.join('; ')}` : '';
  // The cameras it goes with, for an output on an upstream key (a downstream key is over every camera).
  const usk = !none && so.keyerNow.startsWith('usk');
  for (const el of document.querySelectorAll('.forSwCams')) el.classList.toggle('hidden', !usk);
  if (usk) {
    // Every input but the outputs' own fills and keys.
    const taken = new Set(out.outputs.flatMap(x => [x.swFill, x.swKey]).filter(Boolean));
    const cams = inputs.filter(([id]) => !taken.has(id));
    for (const id of so.swCameras || []) if (!cams.some(([v]) => v === id)) cams.push([id, `Input ${id} (not on this switcher)`]);
    const html = cams.map(([id, t]) => `<label><input type="checkbox" value="${id}"${(so.swCameras || []).includes(id) ? ' checked' : ''}> ${hEsc(t)}</label>`).join('');
    const box = $('outSwCams');
    if (box.dataset.k !== html) {
      box.innerHTML = html;
      box.dataset.k = html;
      for (const cb of box.querySelectorAll('input')) cb.onchange = () => setOut({ swCameras: [...box.querySelectorAll('input:checked')].map(x => Number(x.value)) });
    }
    $('outSwCamsNote').textContent = !(so.swCameras || []).length ? 'No cameras picked: Studio leaves this key alone. Pick some and Studio\'s cuts take the key on with them and off with the others.'
      : `${c && c.withCamera ? `${c.withCamera}. ` : ''}Studio's cuts, autos and stingers take the key on with these cameras and off with the others, on the same frame${sw && sw.follow === false ? '' : ', and it follows cuts made on the switcher a frame or two later (Keys follow the camera)'}.`;
  }
  // These change nothing being sent, so they stay free while the output is on.
  for (const el of document.querySelectorAll('#outKeyer, #outSwFill, #outSwKey, #outKeySetup, #outSwCams input')) el.disabled = false;
}
$('outKeyer').onchange = () => setOut({ keyer: $('outKeyer').value });
$('swFollow').onchange = () => swDo({ type: 'follow', on: $('swFollow').checked });
$('outSwFill').onchange = () => setOut({ swFill: Number($('outSwFill').value) || 0 });
$('outSwKey').onchange = () => setOut({ swKey: Number($('outSwKey').value) || 0 });
$('outKeySetup').onclick = () => {
  const so = selectedOutput();
  const c = so && sw && (sw.keys || []).find(k => k.output === so.id);
  if (!c) return;
  const air = c.onAir ? `\n\n${c.label} is on air now, so the change shows on the programme straight away.` : '';
  const restart = c.want && c.want.straightOff && so.on ? `\n\nUnticking Straight restarts ${so.name}'s Blackmagic output, so its picture drops for a moment.` : '';
  if (confirm(`Set up ${c.label} on the ${sw.model} for ${so.name}?\n\n${c.fixes.join('\n')}\n\nIts clip, gain, mask and position are left as they are, and so is whether it's on air.${air}${restart}`)) swDo({ type: 'keySetup', output: so.id });
};

// ─── Switcher actions on sequence steps and scenes ───────────────────────
// A step or a scene can carry up to 8 (switcher.js cleanActions): cut or auto to an input, an input on
// preview, a key on or off, fade to black, a macro, each as it starts or some seconds in. The editor offers
// what the connected switcher has; what it hasn't is greyed with the reason, and skipped if it's saved.
const SW_TYPES = [['cut', 'Cut to'], ['auto', 'Auto to'], ['stinger', 'Stinger to'], ['preview', 'Put on preview'], ['usk', 'Upstream key'], ['dsk', 'Downstream key'], ['ftb', 'Fade to black'], ['macro', 'Run macro']];
const SW_MAX = 8;
const swLive = () => !!sw && sw.state === 'connected';
const swCount = (n, one) => `${n === 1 ? 'one' : n || 'no'} ${one}${n === 1 ? '' : 's'}`;
const swInputName = a => { const i = swLive() && sw.inputs.find(x => x.id === a.input); return i ? i.name : a.name || `Input ${a.input}`; };
// One action in words ("Cut to Court", "DSK 1 on (auto) at 2 s").
function swActText(a) {
  const to = a.input ? swInputName(a) : 'preview';
  const what = a.type === 'cut' ? `Cut to ${to}` : a.type === 'auto' ? `Auto to ${to}` : a.type === 'stinger' ? `Stinger to ${to}` : a.type === 'preview' ? `${swInputName(a)} on preview`
    : a.type === 'usk' ? `Key ${a.key} ${a.on}` : a.type === 'dsk' ? `DSK ${a.key} ${a.on}${a.mix ? ' (auto)' : ''}`
    : a.type === 'ftb' ? (a.on === 'off' ? 'Back from black' : 'Fade to black') : `Macro ${a.macro}`;
  return a.atSec ? `${what} at ${a.atSec} s` : what;
}
// Why the connected switcher can't do an action (so it's skipped), or ''.
function swProblem(a) {
  if (!swLive()) return '';
  if (a.input && !sw.inputs.some(i => i.id === a.input)) return `The ${sw.model} has no input ${a.input}, so this is skipped.`;
  const keys = a.type === 'usk' ? sw.usk.length : a.type === 'dsk' ? sw.dsk.length : null;
  const label = a.type === 'usk' ? 'upstream key' : 'downstream key';
  if (keys !== null && a.key > keys) return `The ${sw.model} has ${swCount(keys, label)}, so ${label} ${a.key} is skipped.`;
  return '';
}
// 🎥 beside a scene's name, or on a step, with what it does to the switcher.
function switcherMark(list) {
  const m = Object.assign(document.createElement('span'), { textContent: ' 🎥', className: 'swMark' + (list.some(swProblem) ? ' bad' : '') });
  const text = `Switcher: ${list.map(swActText).join(', ')}`;
  m.title = text;
  m.setAttribute('role', 'img'); m.setAttribute('aria-label', text);
  return m;
}
function swSelect(label, options, value, onchange) {
  const sel = document.createElement('select');
  sel.setAttribute('aria-label', label);
  for (const [v, text, disabled, title] of options) {
    const o = new Option(text, v);
    if (disabled) { o.disabled = true; o.title = title || ''; }
    sel.add(o);
  }
  sel.value = String(value ?? '');
  sel.onchange = () => onchange(sel.value);
  return sel;
}
// The editor for a list of actions, changed in place; redraw() after a change that alters its rows.
function switcherEditor(list, redraw) {
  const box = document.createElement('div');
  box.className = 'swActs';
  const live = swLive();
  const inputs = live ? sw.inputs.map(i => [i.id, i.name]) : Array.from({ length: 8 }, (_, k) => [k + 1, `Input ${k + 1}`]);
  list.forEach((a, n) => {
    const row = document.createElement('div');
    row.className = 'swAct';
    const types = SW_TYPES.map(([v, text]) => {
      const none = live && ((v === 'usk' && !sw.usk.length) || (v === 'dsk' && !sw.dsk.length));
      return [v, text, none, none ? `The ${sw.model} has no ${v === 'usk' ? 'upstream' : 'downstream'} keys` : ''];
    });
    row.appendChild(swSelect('Switcher action', types, a.type, v => {
      for (const k of ['input', 'name', 'key', 'on', 'mix', 'macro']) delete a[k];
      a.type = v;
      if (v === 'preview') { a.input = inputs[0][0]; a.name = inputs[0][1]; }
      if (v === 'usk' || v === 'dsk') { a.key = 1; a.on = 'on'; }
      if (v === 'ftb') a.on = 'on';
      if (v === 'macro') a.macro = 1;
      redraw();
    }));
    if (['cut', 'auto', 'stinger', 'preview'].includes(a.type)) {
      const opts = inputs.map(([id, name]) => [id, name]);
      if (a.input && !opts.some(([id]) => id === a.input)) opts.push([a.input, `${a.name || `Input ${a.input}`} (not on this switcher)`]);
      if (a.type !== 'preview') opts.unshift(['', "what's on preview"]);
      row.appendChild(swSelect('Input', opts, a.input || '', v => {
        if (!v) { delete a.input; delete a.name; } else { a.input = Number(v); a.name = (opts.find(([id]) => String(id) === v) || [])[1] || ''; }
        redraw();
      }));
    } else if (a.type === 'usk' || a.type === 'dsk') {
      const have = live ? (a.type === 'usk' ? sw.usk.length : sw.dsk.length) : (a.type === 'usk' ? 4 : 2);
      const keys = Array.from({ length: Math.max(have, a.key || 1) }, (_, k) => [k + 1, `${a.type === 'usk' ? 'Key' : 'DSK'} ${k + 1}`, k >= have, live ? `The ${sw.model} hasn't this key` : '']);
      row.appendChild(swSelect('Key', keys, a.key, v => { a.key = Number(v); redraw(); }));
      row.appendChild(swSelect('On or off', [['on', 'on'], ['off', 'off'], ['toggle', 'toggle']], a.on, v => { a.on = v; }));
      if (a.type === 'dsk') {
        const mix = Object.assign(document.createElement('label'), { className: 'note', title: 'Fade the key in or out at its own rate, rather than a cut' });
        const tick = Object.assign(document.createElement('input'), { type: 'checkbox', checked: !!a.mix });
        tick.onchange = () => { if (tick.checked) a.mix = true; else delete a.mix; };
        mix.append(tick, ' at its rate');
        row.appendChild(mix);
      }
    } else if (a.type === 'ftb') {
      row.appendChild(swSelect('Fade', [['on', 'Fade to black'], ['off', 'Fade back from black']], a.on, v => { a.on = v; }));
    } else if (a.type === 'macro') {
      const num = Object.assign(document.createElement('input'), { type: 'number', min: 1, max: 100, value: a.macro || 1 });
      num.setAttribute('aria-label', 'Macro number');
      num.onchange = () => { a.macro = Math.max(1, Math.min(100, Math.round(Number(num.value) || 1))); num.value = a.macro; };
      row.appendChild(num);
    }
    const at = Object.assign(document.createElement('label'), { className: 'note', title: 'Seconds after the step starts or the scene is picked (0: straight away)' });
    const sec = Object.assign(document.createElement('input'), { type: 'number', min: 0, max: 60, step: 0.1, value: a.atSec || 0 });
    sec.onchange = () => { a.atSec = Math.round(Math.max(0, Math.min(60, Number(sec.value) || 0)) * 10) / 10; sec.value = a.atSec; };
    at.append('at ', sec, ' s');
    row.appendChild(at);
    row.appendChild(Object.assign(document.createElement('button'), { className: 'alt', textContent: '✕', title: 'Take this switcher action out', onclick: () => { list.splice(n, 1); redraw(); } }));
    const problem = swProblem(a);
    if (problem) row.appendChild(Object.assign(document.createElement('span'), { className: 'error swProblem', textContent: problem }));
    box.appendChild(row);
  });
  const foot = document.createElement('div');
  foot.className = 'row';
  if (list.length < SW_MAX) foot.appendChild(Object.assign(document.createElement('button'), { className: 'alt', textContent: '+ Switcher action', onclick: () => { list.push({ type: 'cut', atSec: 0 }); redraw(); } }));
  foot.appendChild(Object.assign(document.createElement('span'), { className: 'note', textContent: (live ? '' : 'Connect the switcher (under Switcher) to pick from its own inputs and keys. ')
    + 'Done in order as it starts, or at the seconds set; only when it plays on Output 1. If the switcher isn\'t answering, they\'re skipped and logged, never done late.' }));
  box.appendChild(foot);
  return box;
}

// A scene's switcher actions, from the Edit scenes grid.
let swScene = null; // { id, list } being edited
function editSceneSwitcher(sc) {
  swScene = { id: sc.id, list: JSON.parse(JSON.stringify(sc.switcher || [])) };
  if (!swScene.list.length) swScene.list.push({ type: 'cut', atSec: 0 });
  $('swSceneTitle').textContent = `Switcher when ${sc.name} is picked`;
  drawSceneSwitcher();
  $('swSceneDialog').showModal();
}
function drawSceneSwitcher() {
  const box = $('swSceneActs');
  box.innerHTML = '';
  box.appendChild(switcherEditor(swScene.list, drawSceneSwitcher));
}
$('swSceneSave').onclick = async () => {
  if (await act({ type: 'sceneUpdate', scene: swScene.id, changes: { switcher: swScene.list } })) $('swSceneDialog').close();
};
$('swSceneCancel').onclick = () => $('swSceneDialog').close();
