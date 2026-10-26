// FirstPass Studio - the Output page, part 7 of 12: Switcher: the ATEM switcher Studio controls, its inputs and keys in tally colours, and picking it.
// The page's script is split by section into public/output/, loaded in order by output.html; the files share one
// scope (plain scripts), so a name defined in an earlier part is in reach of a later one.

// ─── Switcher ──────────────────────────────────────────────────────────
// What switcher.js says (over the scene's socket, as it changes): whether one is set up and answering, its
// inputs (red on program, green on preview) and its upstream and downstream keys (red while on air).
let sw = null;
let swFormOpen = false;
const swTime = ms => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
async function swPost(path, body) {
  $('swErr').textContent = '';
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
    const json = await res.json();
    if (!res.ok) $('swErr').textContent = json.error || res.statusText;
    if (json && json.state) showSwitcher(json);
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
    $('swFtb').classList.toggle('on', s.ftb);
    $('swFtb').textContent = s.ftb ? 'Faded to black' : 'Fade to black';
    $('swUskLabel').classList.toggle('hidden', !s.usk.length);
    $('swDskLabel').classList.toggle('hidden', !s.dsk.length);
    const usk = $('swUsk'), dsk = $('swDsk');
    usk.innerHTML = '';
    dsk.innerHTML = '';
    s.usk.forEach((on, k) => usk.appendChild(swButton(`Key ${k + 1}`, on ? 'on' : '', `Upstream key ${k + 1} ${on ? 'off' : 'on'} (a cut)`, () => swDo({ type: 'usk', key: k + 1, on: 'toggle' }))));
    s.dsk.forEach((on, k) => {
      dsk.appendChild(swButton(`DSK ${k + 1}`, on ? 'on' : '', `Downstream key ${k + 1} ${on ? 'off' : 'on'} (a cut)`, () => swDo({ type: 'dsk', key: k + 1, on: 'toggle' })));
      dsk.appendChild(swButton('Auto', 'alt', `Downstream key ${k + 1} ${on ? 'off' : 'on'} at its own rate`, () => swDo({ type: 'dsk', key: k + 1, on: 'auto' })));
    });
  }
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
$('swFtb').onclick = () => swDo({ type: 'ftb' });
