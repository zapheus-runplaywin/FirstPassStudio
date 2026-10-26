// FirstPass Studio - the Output page, part 3 of 12: The Sources list: every layer, on and off, order, and the Stream Deck links.
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
function renderList() {
  const ul = $('sources');
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
  if (!scene.sources.length) { ul.innerHTML = '<li class="empty">No sources yet. Add a page, an image or a video.</li>'; return; }
  for (const s of scene.sources) {
    const li = document.createElement('li');
    li.className = s.id === selected ? 'sel' : '';
    li.innerHTML = '<span class="grip" title="Drag to move it up or down the layers">⋮⋮</span><button class="eye"></button><button class="alt pvw" title="Preview: open this source on its own">PVW</button><span class="name"></span><span class="row" style="gap:4px"><button class="alt snd hidden"></button><button class="alt up" title="Move up">↑</button><button class="alt down" title="Move down">↓</button></span>';
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
    const i = scene.sources.indexOf(s);
    li.querySelector('.up').disabled = i === 0;
    li.querySelector('.down').disabled = i === scene.sources.length - 1;
    li.querySelector('.up').onclick = e => { e.stopPropagation(); act({ type: 'move', id: s.id, direction: 'up' }); };
    li.querySelector('.down').onclick = e => { e.stopPropagation(); act({ type: 'move', id: s.id, direction: 'down' }); };
    li.onclick = () => { selected = s.id; renderList(); renderForm(true); drawBox(); };
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
  }
}
