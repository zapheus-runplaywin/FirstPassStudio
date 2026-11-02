// FirstPass Studio - the Output page, part 6 of 16: The run order: what has played tonight, what's on air, and what plays next, in order.
// The page's script is split by section into public/output/, loaded in order by output.html; the files share one
// scope (plain scripts), so a name defined in an earlier part is in reach of a later one.

// ─── Run order ──────────────────────────────────────────────────────────
// Above Scenes and Sequences: a numbered list of sequences and scenes for the output picked over the Scene View (the primary unless another
// tab is picked). Play next plays the head, Skip drops it; a sequence that ends plays the head itself instead of its
// Then, so the list is the night's plan and each sequence's Then is the fallback when the list runs out. Add… puts a
// scene or sequence at the end; rows drag to reorder (or use their arrows); Saved… loads an order kept under a name
// or saves tonight's. The runner (sequences.js in Studio) owns the list; this only draws it and sends changes.
// Above the queue, like a playlist: the last of what the run order has played tonight, greyed with a tick, then
// what's on air now in the on-air orange (the sequence playing with its step and time left, else the scene on),
// so a glance says where the night is (Matt, 2 Nov 2026).
const roItems = () => {
  const o = scene.viewOutput || 'main';
  return (o === 'main' ? scene.runOrder : (scene.runOrderOut || {})[o]) || [];
};
const roPlayedItems = () => {
  const o = scene.viewOutput || 'main';
  return (o === 'main' ? scene.runOrderPlayed : (scene.runOrderPlayedOut || {})[o]) || [];
};
const RO_PLAYED_SHOWN = 2; // played rows shown above what's on air; the rest fold behind "N earlier"
let roAllPlayed = false;
const roColourOf = it => {
  const x = it.kind === 'scene' ? (scene.scenes || []).find(s => s.id === it.id) : sequences().find(s => s.id === it.id);
  return x ? x.colour : 'grey';
};
// A sequence that plays on other outputs too: a line for each, in its colour, saying what it does there after the
// sequence. Play next starts it on all of them; when the run order moves on by itself, an output joins only if
// nothing is playing there. After it, each other output follows its own run order, else its own Then.
function roAlsoOn(sq) {
  const here = scene.viewOutput || 'main', list = (out && out.outputs) || [];
  if (!sq || !scene.viewMany) return [];
  return (sq.playsOn || ['main']).filter(o => o !== here).map(o => list.find(x => x.id === o)).filter(Boolean).map(o => {
    const q = ((o.id === 'main' ? scene.runOrder : (scene.runOrderOut || {})[o.id]) || []).filter(x => !x.gone);
    const line = document.createElement('small');
    line.className = 'also';
    line.style.setProperty('--c', o.colour || 'var(--fp-muted)');
    line.textContent = `also on ${o.name} · ${q.length ? `then its own run order (${q[0].name})` : thenText(sq, o.id)}`;
    return line;
  });
}
// The played rows and the ON AIR row. What's on air is the sequence playing on the picked output, else its scene;
// when the run order played it, its own played row becomes the ON AIR row.
function renderPlayed() {
  const box = $('roPlayed'), p = scene.playing, sc = !p ? currentScene() : null;
  const air = p ? { kind: 'sequence', id: p.id } : sc ? { kind: 'scene', id: sc.id } : null;
  const played = roPlayedItems(), last = played[played.length - 1];
  const fromOrder = !!(air && last && last.kind === air.kind && last.id === air.id);
  const done = fromOrder ? played.slice(0, -1) : played;
  box.innerHTML = '';
  const row = (cls, n, colour) => {
    const li = document.createElement('li');
    li.className = cls;
    li.innerHTML = '<span class="n"></span><span class="what"><b></b><small></small></span><span></span>';
    li.querySelector('.n').textContent = n;
    if (colour) li.querySelector('.n').classList.add(colour);
    box.append(li);
    return li;
  };
  if (done.length > RO_PLAYED_SHOWN) {
    const li = document.createElement('li');
    li.className = 'earlier';
    const b = document.createElement('button');
    b.textContent = roAllPlayed ? 'Show only the last two played' : `${done.length - RO_PLAYED_SHOWN} played earlier tonight: show`;
    b.onclick = () => { roAllPlayed = !roAllPlayed; renderPlayed(); };
    li.append(b);
    box.append(li);
  }
  for (const it of roAllPlayed ? done : done.slice(-RO_PLAYED_SHOWN)) {
    const li = row('done', '✓', roColourOf(it));
    li.querySelector('b').textContent = it.name;
    li.querySelector('small').textContent = `${it.kind} · played ${clockTime(it.at)}`;
  }
  if (!air) return;
  const li = row('air', '●');
  const b = li.querySelector('b');
  b.append(Object.assign(document.createElement('span'), { className: 'tag', textContent: p && p.paused ? 'ON AIR · PAUSED' : 'ON AIR' }));
  b.append(p ? (sequences().find(s => s.id === p.id)?.name || 'A sequence') : sc.name);
  b.title = b.textContent;
  const when = fromOrder ? ` · since ${clockTime(last.at)}` : '';
  if (p) {
    const ssc = p.scene && (scene.scenes || []).find(x => x.id === p.scene);
    const names = ssc ? ssc.name : p.ad !== undefined ? (p.ad ? `ad: ${p.ad}` : 'no ad to play') : (p.sources || []).map(nameOf).filter(Boolean).join(', ');
    li.querySelector('small').textContent = `step ${p.step + 1} of ${p.steps}${names ? ` · ${names}` : ''}${when}`;
    const dots = document.createElement('div');
    dots.className = 'dots';
    for (let i = 0; i < p.steps; i++) dots.appendChild(Object.assign(document.createElement('i'), { className: i < p.step ? 'done' : i === p.step ? 'now' : '' }));
    li.querySelector('.what').append(dots);
    li.lastChild.className = 'airLeft';
    li.lastChild.innerHTML = '<b></b><small></small>';
  } else li.querySelector('small').textContent = `scene${when}`;
  roTick();
}
// The ON AIR row's time left: the step's, big, and the whole sequence's under it (like its card's).
function roTick() {
  const p = scene.playing, el = document.querySelector('#roPlayed li.air .airLeft');
  if (!p || !el) return;
  const since = p.paused || p.leftMs === null || p.leftMs === undefined ? 0 : performance.now() - heardAt;
  const left = p.leftMs === null || p.leftMs === undefined ? (p.length === 'next' ? 'waits' : p.length === 'game' ? 'game' : '') : fmt(p.leftMs - since);
  el.firstChild.textContent = left;
  const total = totalText(p, since);
  el.lastChild.textContent = total ? `${p.repeats ? 'This time round' : 'Total'} ${total}` : '';
}
setInterval(roTick, 250);
let roDrag = null;
function renderRunOrder() {
  renderPlayed();
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
    if (!it.gone && it.kind === 'sequence') li.querySelector('.what').append(...roAlsoOn(sequences().find(s => s.id === it.id)));
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
  // Play next and Skip, and what Play next does right now (▶ the head, ⏭ what follows it).
  const p = scene.viewOutput && scene.viewOutput !== 'main' ? (scene.playingOut || {})[scene.viewOutput] : scene.playing;
  $('roNext').disabled = !head && !p;
  $('roSkip').disabled = !head;
  $('roNext').title = head ? `Play ${head.name} now` : p ? 'Nothing queued: ends the sequence playing (its Then)' : 'Nothing queued and nothing playing';
  const second = head ? items.slice(items.indexOf(head) + 1).find(it => !it.gone) : null;
  $('roNote').textContent = head ? `▶ ${head.name}${second ? `  ⏭ ${second.name}` : '  ⏭ each sequence\'s own Then'}` : p ? 'Nothing queued: when this sequence ends it does its own Then' : '';
  $('roEmpty').hidden = !!items.length || !!roPlayedItems().length;
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
  if (items.length || roPlayedItems().length) saved.append(new Option('Clear the run order', 'clear'));
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
    const what = items.length ? `the ${items.length} item${items.length === 1 ? '' : 's'} queued and what has played` : 'what the run order has played tonight';
    if (await askConfirm(`Clear ${what}?`, 'What\'s on air carries on; a sequence playing does its own Then when it ends.', { ok: 'Clear', danger: true })) act({ type: 'roClear' });
  }
};
