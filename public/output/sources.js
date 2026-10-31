// FirstPass Studio - the Output page, part 3 of 16: The Sources list: every layer, on and off, the eye (preview) and the pencil (its settings under the row), and the order by dragging.
// The page's script is split by section into public/output/, loaded in order by output.html; the files share one
// scope (plain scripts), so a name defined in an earlier part is in reach of a later one.

// ─── Sources list ──────────────────────────────────────────────────────
let dragId = null; // the source being dragged in the list
// With more than one output, which outputs' on and off buttons the list shows: 'all', or one output's id.
let outFilter = (() => { try { return localStorage.getItem('outputFilter') || 'all'; } catch { return 'all'; } })();
$('outFilter').onchange = () => {
  outFilter = $('outFilter').value;
  try { localStorage.setItem('outputFilter', outFilter); } catch {}
  renderList();
};
// Whether a source is on for an output: the primary's is the source's own visible.
const onFor = (s, o) => o.primary ? s.visible : !!(s.out && s.out[o.id]);
let hideAllOn = 'main'; // the output Hide all clears (set as the list is drawn)
// The eye (preview the source on its own) and the pencil (its settings), as inline icons.
const ICON_EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICON_PEN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
function renderList() {
  const ul = $('sources');
  // The Source settings section lives under the selected source's row while the pencil has it open: park it before
  // the list is drawn again, so it survives, and put it back under the row below.
  $('settingsPark').appendChild($('settings'));
  ul.innerHTML = '';
  // More than one output: one on and off button per output, in its colour, instead of the one On button.
  const all = out && out.outputs && out.outputs.length > 1 ? out.outputs : null;
  $('outFilterRow').classList.toggle('hidden', !all);
  if (all) {
    if (!all.some(o => o.id === outFilter)) outFilter = 'all';
    $('outFilter').innerHTML = '';
    $('outFilter').add(new Option('All outputs', 'all'));
    for (const o of all) $('outFilter').add(new Option(`${o.slot} · ${o.name}`, o.id));
    $('outFilter').value = outFilter;
  }
  const shown = all ? all.filter(o => outFilter === 'all' || o.id === outFilter) : null;
  // Hide all acts on one output and says which: the one the list shows when Show is set to one, else the one picked
  // over the Scene View (where scene and sequence clicks go). Never every output at once.
  const filtered = all && outFilter !== 'all' && all.find(o => o.id === outFilter);
  const target = all && (filtered || all.find(o => o.id === scene.viewOutput) || all[0]);
  hideAllOn = target ? target.id : 'main';
  $('hideAll').textContent = target ? `Hide all on ${target.name}` : 'Hide all';
  $('hideAll').title = target ? `Every source off on ${target.name} only (${filtered ? 'the output the list shows' : 'the output picked over the Scene View'})` : 'Every source off';
  if (!scene.sources.length) { editOpen = false; ul.innerHTML = '<li class="empty fp-empty">No sources yet: <b>Add page</b>, <b>Add image</b> or <b>Add video</b> above puts one at the top.</li>'; return; }
  if (!current()) editOpen = false;
  for (const s of scene.sources) {
    const li = document.createElement('li');
    li.className = s.id === selected ? 'sel' : '';
    li.title = 'Top layer first: drag a source up or down to move it between layers';
    li.innerHTML = '<span class="name"></span><button class="eye"></button><span class="row" style="gap:4px"><button class="alt snd hidden"></button>'
      + `<button class="alt ico pvw" title="Preview: open this source on its own" aria-label="Preview">${ICON_EYE}</button>`
      + `<button class="alt ico edit" title="Settings: name, address, position, fade, its Stream Deck links" aria-label="Settings" aria-pressed="false">${ICON_PEN}</button></span>`;
    const eye = li.querySelector('.eye');
    eye.textContent = s.visible ? 'On' : 'Off';
    eye.classList.toggle('on', s.visible);
    eye.title = s.visible ? 'Showing: click to fade it out' : 'Hidden: click to fade it in';
    eye.onclick = e => { e.stopPropagation(); act({ type: 'toggle', id: s.id }); };
    if (shown) {
      const pills = document.createElement('span');
      pills.className = 'pills';
      for (const o of shown) {
        const on = onFor(s, o);
        const b = document.createElement('button');
        b.className = 'pill' + (on ? ' on' : '');
        b.style.setProperty('--c', o.colour);
        b.textContent = shown.length === 1 ? (on ? 'On' : 'Off') : String(o.slot);
        b.title = `${o.name}: ${on ? 'showing, click to fade it out' : 'hidden, click to fade it in'}`;
        b.onclick = e => { e.stopPropagation(); act({ type: 'toggle', id: s.id, ...(o.primary ? {} : { output: o.id }) }); };
        pills.appendChild(b);
      }
      eye.replaceWith(pills);
    }
    li.querySelector('.pvw').onclick = e => { e.stopPropagation(); previewSource(s); };
    // The pencil opens this source's settings under its row, and closes them on a second press.
    const open = editOpen && s.id === selected;
    li.querySelector('.edit').setAttribute('aria-pressed', String(open));
    li.querySelector('.edit').onclick = e => { e.stopPropagation(); editOpen = !open; selected = s.id; renderList(); renderForm(true); drawBox(); };
    li.querySelector('.name').textContent = s.name;
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
      snd.textContent = s.sound ? '🔊' : '🔇';
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
