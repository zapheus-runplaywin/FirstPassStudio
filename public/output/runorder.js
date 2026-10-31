// FirstPass Studio - the Output page, part 6 of 16: The run order: what plays next tonight, in order.
// The page's script is split by section into public/output/, loaded in order by output.html; the files share one
// scope (plain scripts), so a name defined in an earlier part is in reach of a later one.

// ─── Run order ──────────────────────────────────────────────────────────
// A numbered list of sequences and scenes for the output picked over the Scene View (the primary unless another
// tab is picked). Play next plays the head, Skip drops it; a sequence that ends plays the head itself instead of its
// Then, so the list is the night's plan and each sequence's Then is the fallback when the list runs out. Add… puts a
// scene or sequence at the end; rows drag to reorder (or use their arrows); Saved… loads an order kept under a name
// or saves tonight's. The runner (sequences.js in Studio) owns the list; this only draws it and sends changes.
const roItems = () => {
  const o = scene.viewOutput || 'main';
  return (o === 'main' ? scene.runOrder : (scene.runOrderOut || {})[o]) || [];
};
const roColourOf = it => {
  const x = it.kind === 'scene' ? (scene.scenes || []).find(s => s.id === it.id) : sequences().find(s => s.id === it.id);
  return x ? x.colour : 'grey';
};
let roDrag = null;
function renderRunOrder() {
  const items = roItems(), list = $('roList');
  const head = items.find(it => !it.gone) || null;
  list.innerHTML = '';
  items.forEach((it, i) => {
    const li = document.createElement('li');
    li.className = (it === head ? 'head' : '') + (it.gone ? ' gone' : '');
    li.draggable = true;
    li.dataset.key = it.key;
    li.innerHTML = '<span class="n"></span><span class="what"><b></b><small></small></span><span class="row"><button class="alt up" title="Earlier">↑</button><button class="alt down" title="Later">↓</button><button class="alt del" title="Take it out of the run order">×</button></span>';
    li.querySelector('.n').textContent = i + 1;
    li.querySelector('.n').classList.add(roColourOf(it));
    li.querySelector('b').textContent = it.name;
    li.querySelector('small').textContent = it.gone ? `${it.kind} deleted: skipped when its turn comes` : it.kind === 'scene' ? 'scene' : (() => { const sq = sequences().find(s => s.id === it.id); return sq ? `sequence · ${runText(sq)}` : 'sequence'; })();
    li.querySelector('.up').disabled = i === 0;
    li.querySelector('.down').disabled = i === items.length - 1;
    li.querySelector('.up').onclick = () => act({ type: 'roMove', key: it.key, direction: 'up' });
    li.querySelector('.down').onclick = () => act({ type: 'roMove', key: it.key, direction: 'down' });
    li.querySelector('.del').onclick = () => act({ type: 'roRemove', key: it.key });
    li.ondragstart = e => { roDrag = it.key; li.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; };
    li.ondragend = () => { roDrag = null; list.querySelectorAll('li').forEach(x => x.classList.remove('dragging', 'dropBefore', 'dropAfter')); };
    li.ondragover = e => {
      if (!roDrag || roDrag === it.key) return;
      e.preventDefault();
      const before = e.offsetY < li.offsetHeight / 2;
      li.classList.toggle('dropBefore', before); li.classList.toggle('dropAfter', !before);
    };
    li.ondragleave = () => li.classList.remove('dropBefore', 'dropAfter');
    li.ondrop = e => {
      e.preventDefault();
      if (!roDrag || roDrag === it.key) return;
      const from = items.findIndex(x => x.key === roDrag);
      let to = i + (e.offsetY < li.offsetHeight / 2 ? 0 : 1);
      if (from < to) to--;
      if (from !== to) act({ type: 'roMove', key: roDrag, to });
    };
    list.appendChild(li);
  });
  // Next and Skip, and what Next does right now.
  const p = scene.viewOutput && scene.viewOutput !== 'main' ? (scene.playingOut || {})[scene.viewOutput] : scene.playing;
  $('roNext').disabled = !head && !p;
  $('roSkip').disabled = !head;
  $('roNext').title = head ? `Play ${head.name} now` : p ? 'Nothing queued: ends the sequence playing (its Then)' : 'Nothing queued and nothing playing';
  const second = head ? items.slice(items.indexOf(head) + 1).find(it => !it.gone) : null;
  $('roNote').textContent = head ? `Next: ${head.name}${second ? ` · then ${second.name}` : ' · then each sequence\'s own Then'}` : p ? 'Nothing queued: when this sequence ends it does its own Then' : '';
  $('roEmpty').hidden = !!items.length;
  $('roEmpty').innerHTML = 'Tonight\'s order: <b>Add…</b> puts a scene or sequence at the end (Run-up, Walk out, Live, Quarter time, Live…), or load a saved order. '
    + '<b>Play next</b> plays the head now, and a sequence that ends plays what is queued after it. With nothing here, each sequence does its own <b>Then</b>.';
  // The pickers: Add… lists the scenes and sequences; Saved… the saved orders, with Save as… at the end.
  const add = $('roAdd');
  add.innerHTML = '<option value="">Add…</option>';
  const grp = (label, opts) => { if (!opts.length) return; const g = document.createElement('optgroup'); g.label = label; for (const [v, t] of opts) g.append(new Option(t, v)); add.append(g); };
  grp('Sequences', sequences().filter(s => !s.hidden || showHidden).map(s => [`sequence:${s.id}`, s.name]));
  grp('Scenes', (scene.scenes || []).map(s => [`scene:${s.id}`, s.name]));
  const saved = $('roSaved');
  saved.innerHTML = '<option value="">Saved…</option>';
  for (const o of scene.runOrders || []) saved.append(new Option(`${o.name} (${o.count})`, `load:${o.id}`));
  if (items.length) saved.append(new Option('Save tonight\'s order as…', 'save'));
  if ((scene.runOrders || []).length) saved.append(new Option('Delete a saved order…', 'delete'));
  if (items.length) saved.append(new Option('Clear the run order', 'clear'));
}
$('roNext').onclick = () => act({ type: 'roNext' });
$('roSkip').onclick = () => act({ type: 'roSkip' });
$('roAdd').onchange = () => {
  const [kind, id] = $('roAdd').value.split(':');
  $('roAdd').value = '';
  if (kind && id) act({ type: 'roAdd', kind, id });
};
$('roSaved').onchange = async () => {
  const v = $('roSaved').value;
  $('roSaved').value = '';
  const items = roItems();
  if (v.startsWith('load:')) {
    const o = (scene.runOrders || []).find(x => x.id === v.slice(5));
    if (!o) return;
    if (items.length && !await askConfirm(`Load "${o.name}" in place of the ${items.length} item${items.length === 1 ? '' : 's'} queued now?`, 'What is queued is dropped; the sequence playing carries on.', { ok: 'Load' })) return;
    act({ type: 'roLoad', order: o.id });
  } else if (v === 'save') {
    const name = await askText('Name tonight\'s run order (an order of that name is replaced)', '');
    if (name) act({ type: 'roSave', name });
  } else if (v === 'delete') {
    const orders = scene.runOrders || [];
    const pick = await askChoice('Delete which saved run order?', 'Tonight\'s list stays as it is.', [...orders.map(o => ({ value: o.id, label: o.name, danger: true })), { value: '', label: 'Cancel', alt: true }]);
    if (pick) act({ type: 'roDeleteOrder', order: pick });
  } else if (v === 'clear') {
    if (await askConfirm(`Clear the ${items.length} item${items.length === 1 ? '' : 's'} in the run order?`, 'The sequence playing carries on and does its own Then when it ends.', { ok: 'Clear', danger: true })) act({ type: 'roClear' });
  }
};
