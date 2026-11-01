// FirstPass Studio - the Output page, part 3 of 16: The Sources list: every layer, on and off, the eye (preview) and the pencil (its settings under the row), and the order by dragging.
// The page's script is split by section into public/output/, loaded in order by output.html; the files share one
// scope (plain scripts), so a name defined in an earlier part is in reach of a later one.

// ─── Sources list ──────────────────────────────────────────────────────
let dragId = null; // the source being dragged in the list
// Whether a source is on for an output: the primary's is the source's own visible.
const onFor = (s, o) => o.primary ? s.visible : !!(s.out && s.out[o.id]);
let hideAllOn = 'main'; // the output Hide all clears (set as the list is drawn)
// The eye (preview the source on its own) and the pencil (its settings), as inline icons.
const ICON_EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
// The speaker (a video with sound): the same line style as the eye and pencil, with waves while on and a cross while muted.
const ICON_SOUND = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
const ICON_MUTED = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="m16 9 6 6"/><path d="m22 9-6 6"/></svg>';
const ICON_PEN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
function renderList() {
  const ul = $('sources');
  // The Source settings section lives under the selected source's row while the pencil has it open: park it before
  // the list is drawn again, so it survives, and put it back under the row below.
  $('settingsPark').appendChild($('settings'));
  ul.innerHTML = '';
  // More than one output: the list follows the output picked over the Scene View (its tab), with that output's on and
  // off in its colour on each row. Hide all clears that output too, and its label names it. Never every output at once.
  const all = out && out.outputs && out.outputs.length > 1 ? out.outputs : null;
  const target = all && (all.find(o => o.id === scene.viewOutput) || all[0]);
  hideAllOn = target ? target.id : 'main';
  $('hideAll').textContent = target ? `Hide all on ${target.name}` : 'Hide all';
  $('hideAll').title = target ? `Every source off on ${target.name} only (the output picked over the Scene View)` : 'Every source off';
  if (!scene.sources.length) { editOpen = false; ul.innerHTML = '<li class="empty fp-empty">No sources yet: <b>Add page</b>, <b>Add image</b> or <b>Add video</b> above puts one at the top.</li>'; return; }
  if (!current()) editOpen = false;
  for (const s of scene.sources) {
    const li = document.createElement('li');
    li.className = s.id === selected ? 'sel' : '';
    li.title = 'Top layer first: drag a source up or down to move it between layers';
    // The speaker (videos only) sits left of On/Off, so a row without sound gives its name that room.
    li.innerHTML = '<span class="name"></span><span class="row" style="gap:4px"><button class="alt ico snd hidden"></button><button class="eye"></button></span><span class="row" style="gap:4px">'
      + `<button class="alt ico pvw" title="Preview: open this source on its own" aria-label="Preview">${ICON_EYE}</button>`
      + `<button class="alt ico edit" title="Settings: name, address, position, fade, its Stream Deck links" aria-label="Settings" aria-pressed="false">${ICON_PEN}</button></span>`;
    const eye = li.querySelector('.eye');
    eye.textContent = s.visible ? 'On' : 'Off';
    eye.classList.toggle('on', s.visible);
    eye.title = s.visible ? 'Showing: click to fade it out' : 'Hidden: click to fade it in';
    eye.onclick = e => { e.stopPropagation(); act({ type: 'toggle', id: s.id }); };
    if (target) {
      const on = onFor(s, target);
      eye.className = 'pill' + (on ? ' on' : '');
      eye.style.setProperty('--c', target.colour);
      eye.textContent = on ? 'On' : 'Off';
      eye.title = `${target.name}: ${on ? 'showing, click to fade it out' : 'hidden, click to fade it in'}`;
      eye.onclick = e => { e.stopPropagation(); act({ type: 'toggle', id: s.id, ...(target.primary ? {} : { output: target.id }) }); };
    }
    li.querySelector('.pvw').onclick = e => { e.stopPropagation(); previewSource(s); };
    // The pencil opens this source's settings under its row, and closes them on a second press.
    const open = editOpen && s.id === selected;
    li.querySelector('.edit').setAttribute('aria-pressed', String(open));
    li.querySelector('.edit').onclick = e => { e.stopPropagation(); editOpen = !open; selected = s.id; renderList(); renderForm(true); drawBox(); };
    li.querySelector('.name').textContent = s.name;
    li.querySelector('.name').dataset.full = s.name; // the hover tooltip shows the name without its type tag
    const tag = document.createElement('small');
    tag.textContent = s.type === 'browser' ? 'page' : s.type + (mediaLoaded && !media.some(m => m.name === s.file) ? ' (missing)' : '');
    li.querySelector('.name').appendChild(tag);
    if ((scene.changed || []).includes(s.id)) {
      const chg = document.createElement('span');
      chg.className = 'chg';
      chg.textContent = 'changed';
      chg.title = `Different from the saved ${currentScene()?.name || 'scene'}`;
      li.querySelector('.name').appendChild(chg);
    }
    if (s.type === 'video') {
      const snd = li.querySelector('.snd');
      snd.classList.remove('hidden');
      snd.innerHTML = s.sound ? ICON_SOUND : ICON_MUTED;
      snd.classList.toggle('on', !!s.sound);
      snd.setAttribute('aria-label', s.sound ? 'Sound on' : 'Muted');
      snd.title = s.sound ? 'Sound on: click to mute' : 'Muted: click to turn sound on';
      snd.onclick = e => { e.stopPropagation(); act({ type: 'soundToggle', id: s.id }); };
    }
    // A click on the row selects the source (the dashed box in the Scene View) and opens its settings under it.
    li.onclick = () => { selected = s.id; editOpen = true; renderList(); renderForm(true); drawBox(); };
    // Drag a source up or down the list to move it between layers.
    li.draggable = true;
    li.ondragstart = e => { dragId = s.id; li.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', s.id); };
    li.ondragend = () => { dragId = null; renderList(); };
    li.ondragover = e => {
      if (!dragId || dragId === s.id) return;
      e.preventDefault();
      const after = e.offsetY > li.offsetHeight / 2;
      li.classList.toggle('dropBefore', !after); li.classList.toggle('dropAfter', after);
    };
    li.ondragleave = () => li.classList.remove('dropBefore', 'dropAfter');
    li.ondrop = e => {
      e.preventDefault();
      if (!dragId || dragId === s.id) return;
      const from = scene.sources.findIndex(x => x.id === dragId);
      let to = scene.sources.indexOf(s) + (e.offsetY > li.offsetHeight / 2 ? 1 : 0);
      if (from < to) to--; // the list closes up once the dragged source is taken out
      const id = dragId; dragId = null;
      if (to !== from) act({ type: 'move', id, to });
      else renderList();
    };
    ul.appendChild(li);
    if (open) {
      const ed = document.createElement('li');
      ed.className = 'editor';
      ed.appendChild($('settings'));
      ul.appendChild(ed);
    }
  }
}
