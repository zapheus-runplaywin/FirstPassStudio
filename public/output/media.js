// FirstPass Studio - the Output page, part 10 of 11: The media folder: every file, where it is used, and Remove.
// The page's script is split by section into public/output/, loaded in order by output.html; the files share one
// scope (plain scripts), so a name defined in an earlier part is in reach of a later one.

// ─── The media folder: every file, where it's used, and Remove ───────────
const KIND_NAMES = { audio: 'Song or sound', video: 'Video', image: 'Image' };
const size = b => b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
const useName = u => ({
  source: `Source “${u.name}”`, theme: `Theme of “${u.name}”`, sequence: `Sequence “${u.name}” music${u.competition ? ` (${u.competition})` : ''}`,
  playlist: `Playlist “${u.name}”`, superShot: 'Super shot song', player: 'Loaded in the music player', sponsor: `Sponsor “${u.name}” ad`,
}[u.type] || u.name) + (u.onAir ? ' (on air now)' : '');
let library = [];
async function loadLibrary() {
  try { library = (await (await fetch('/api/scene/media?uses=1')).json()).media || []; } catch { library = []; }
  renderLibrary();
}
function renderLibrary() {
  const list = $('mediaList'), kind = $('mediaKind').value, shown = library.filter(m => !kind || m.kind === kind);
  $('mediaCount').textContent = library.length ? `${library.length} file${library.length === 1 ? '' : 's'}, ${size(library.reduce((t, m) => t + (m.size || 0), 0))}` : '';
  list.innerHTML = '';
  if (!shown.length) { list.innerHTML = `<li class="empty">${library.length ? 'None of those.' : 'Nothing in the media folder yet.'}</li>`; return; }
  for (const m of shown) {
    const li = document.createElement('li');
    li.innerHTML = '<div><div class="name"></div><div class="uses"></div></div><button class="danger">Remove</button>';
    li.querySelector('.name').textContent = m.name;
    const small = document.createElement('small');
    small.textContent = [KIND_NAMES[m.kind], m.duration ? fmt(m.duration * 1000) : '', m.size ? size(m.size) : '', m.converting ? 'converting…' : ''].filter(Boolean).join(' · ');
    li.querySelector('.name').append(small);
    const uses = m.uses || [];
    li.querySelector('.uses').innerHTML = uses.length ? 'Used by: ' : 'Not used';
    uses.forEach((u, i) => { const b = document.createElement(u.onAir ? 'b' : 'span'); b.textContent = (i ? ', ' : '') + useName(u); li.querySelector('.uses').append(b); });
    li.querySelector('button').onclick = () => removeMedia(m.name);
    list.append(li);
  }
}
async function removeMedia(name) {
  $('mediaErr').textContent = '';
  await loadLibrary(); // where it's used now, not when the list was drawn
  const m = library.find(x => x.name === name);
  if (!m) return;
  const uses = m.uses || [];
  if (uses.some(u => u.onAir)) { $('mediaErr').textContent = `${name} is on air now (${uses.filter(u => u.onAir).map(useName).join(', ')}). Turn it off first.`; return; }
  if (!confirm(`Remove ${name} from the media folder? This can't be undone.`
    + (uses.length ? `\n\nIt's used by:\n${uses.map(u => '• ' + useName(u)).join('\n')}\n\nPlaylists, the super shot song and sponsors' ads let go of it. Sources, page themes and sequence music keep its name, shown as missing, until you pick another file.` : ''))) return;
  try {
    const res = await fetch(`/api/scene/media?name=${encodeURIComponent(name)}&force=1`, { method: 'DELETE' });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || res.statusText);
    console.log(`Removed ${name} from the media folder`);
  } catch (err) { $('mediaErr').textContent = `Couldn't remove ${name}: ${err.message}`; }
  await loadMedia();
}
$('mediaKind').onchange = renderLibrary;
$('mediaBox').ontoggle = () => { if ($('mediaBox').open) loadLibrary(); };
// The Sponsors page links here to remove ads' files.
if (location.hash === '#mediaSection') $('mediaBox').open = true;
// Adding a source: a dialog, so it's clear the choices are for the new source. It goes above the selected
// source (or on top), and is selected once added, ready to set up.
const usedPages = () => new Set(scene.sources.filter(x => x.type === 'browser').map(x => String(x.url).split('?')[0].replace(/^\/+/, '')));
function fillPages() {
  const used = usedPages(), sel = $('newPage'), keep = sel.value;
  sel.innerHTML = '';
  const unused = PAGES.filter(p => !used.has(p[1])), inScene = PAGES.filter(p => used.has(p[1]));
  for (const [label, list] of [['Not in the scene yet', unused], ['Already in the scene', inScene]]) {
    if (!list.length) continue;
    const g = document.createElement('optgroup');
    g.label = label;
    for (const [name, page] of list) g.appendChild(new Option(name, page));
    sel.appendChild(g);
  }
  sel.add(new Option('Another address…', ''));
  sel.value = [...sel.options].some(o => o.value === keep && keep) ? keep : (unused[0] || inScene[0] || ['', ''])[1];
  $('newUrl').value = sel.value;
  $('addAllUnused').textContent = `Add all unused pages (${unused.length})`;
  $('addAllUnused').disabled = !unused.length;
}
function openAdd(type) {
  adding = type;
  $('addErr').textContent = '';
  $('addTitle').textContent = { browser: 'Add a page', image: 'Add an image', video: 'Add a video' }[type];
  const s = current();
  $('addWhere').textContent = s ? `It goes above "${s.name}", hidden.` : 'It goes on top, hidden.';
  $('addBrowserForm').classList.toggle('hidden', type !== 'browser');
  $('addMediaForm').classList.toggle('hidden', type === 'browser');
  if (type === 'browser') fillPages();
  else {
    $('newFileLabel').textContent = type === 'video' ? 'Video' : 'Image';
    $('upload').accept = ACCEPT[type];
    loadMedia();
  }
  $('addDialog').showModal();
}
function closeAdd() { adding = null; if ($('addDialog').open) $('addDialog').close(); }
$('addDialog').addEventListener('close', () => { adding = null; });
$('addBrowser').onclick = () => openAdd('browser');
$('addImage').onclick = () => openAdd('image');
$('addVideo').onclick = () => openAdd('video');
$('addCancel').onclick = closeAdd;
$('newPage').onchange = () => { $('newUrl').value = $('newPage').value; };
// Adds the sources above the selected one and selects the first of them.
async function addSources(sources) {
  $('addErr').textContent = '';
  const before = new Set(scene.sources.map(x => x.id));
  const body = await act({ type: 'add', sources, before: selected || undefined });
  if (!body) { $('addErr').textContent = $('err').textContent; return; }
  const added = body.sources.find(x => !before.has(x.id));
  if (added) selected = added.id;
  closeAdd(); renderList(); renderForm(true); drawBox();
}
$('addAllUnused').onclick = () => {
  const used = usedPages();
  const list = PAGES.filter(p => !used.has(p[1])).map(([name, url]) => ({ type: 'browser', url, name }));
  if (list.length) addSources(list);
};
$('upload').onchange = async () => {
  const file = $('upload').files[0];
  if (!file) return;
  $('addErr').textContent = '';
  $('mediaNote').textContent = `Adding ${file.name} to the media folder…`;
  try {
    const res = await fetch('/api/scene/media?name=' + encodeURIComponent(file.name), { method: 'POST', body: file });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || res.statusText);
    if (body.cantConvert) $('addErr').textContent = `${body.file} is in the media folder, but it can only play once it's converted, and this copy of Studio has no ffmpeg (the Mac app includes one; from a copy of the code run vendor/ffmpeg/build.sh or brew install ffmpeg).`;
    await loadMedia(body.file);
  } catch (err) { $('addErr').textContent = `Could not add ${file.name}: ${err.message}`; mediaNote(); }
  $('upload').value = '';
};
$('addGo').onclick = async () => {
  let source;
  if (adding === 'browser') {
    const url = $('newUrl').value.trim();
    if (!url) { $('addErr').textContent = 'Pick a page or type an address.'; return; }
    const known = PAGES.find(p => p[1] === url);
    source = { type: 'browser', url, name: known ? known[0] : undefined };
  } else {
    if (!$('newFile').value) { $('addErr').textContent = `Add ${adding === 'video' ? 'a video' : 'an image'} to the media folder first.`; return; }
    const m = media.find(x => x.name === $('newFile').value);
    source = { type: adding, file: m && m.converted ? m.converted : $('newFile').value };
  }
  addSources([source]);
};

async function copy(text, btn) {
  try { await navigator.clipboard.writeText(text); } catch { prompt('Copy this link', text); return; }
  const was = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = was; }, 1200);
}

let wasConverting = '';
function show(s) {
  scene = s;
  // A conversion started or finished: refresh the media lists.
  const now = (s.converting || []).join('|');
  if (now !== wasConverting) { wasConverting = now; loadMedia(); }
  if (selected && !current()) selected = null;
  renderList(); renderForm(); drawBox(); renderScenes(); renderSequences(); renderMusic();
  // A source added, renamed or removed while the editor is open.
  if (draft && $('seqDialog').open && !$('sqSteps').contains(document.activeElement)) renderSteps();
}

// Follow the scene live, so Stream Deck presses show here too.
sceneEvents(show);

// Live viewers on the competition's streams (Competitions setup, Live viewers), read by Studio while on air.
