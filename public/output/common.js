// FirstPass Studio - the Output page, part 1 of 15: Shared state and helpers for every section: $, the scene as last seen, the selected source, act() sending a change to Studio, and folding sections.
// The page's script is split by section into public/output/, loaded in order by output.html; the files share one
// scope (plain scripts), so a name defined in an earlier part is in reach of a later one.

const $ = id => document.getElementById(id);
// Studio's graphics, offered when adding a page. Page size is what the page is drawn at.
// The graphics Add a page offers, from the one list in pages.js.
const PAGES = STUDIO_GRAPHICS.map(p => [p.name, p.file]);
let scene = { sources: [] };
// The scene as Studio last sent it; scene above is what the Scenes and Sequences sections see (viewFor): every
// scene and sequence, which every output shares, with the current scene and playing sequence of the output picked
// over the Scene View, and (onOut) the outputs where each scene is current and each sequence is playing.
let sceneAll = { sources: [] };
function viewFor(s, o = 'main') {
  if (!s.scenes) return s;
  const main = o === 'main';
  const list = typeof out !== 'undefined' && out && out.outputs || [];
  const o2 = list.find(x => x.id === o);
  const onOut = { scenes: {}, sequences: {} };
  for (const x of list) {
    const m = x.id === 'main';
    const cur = m ? s.current : (s.currentOut || {})[x.id];
    const play = m ? s.playing : (s.playingOut || {})[x.id];
    if (cur) (onOut.scenes[cur] ||= []).push(x);
    if (play) (onOut.sequences[play.id] ||= []).push(x);
  }
  return {
    ...s,
    current: main ? s.current : (s.currentOut || {})[o] || null,
    changed: main ? s.changed : (s.changedOut || {})[o] || [],
    playing: main ? s.playing : (s.playingOut || {})[o] || null,
    pending: main ? s.pending : (s.pendingOut || {})[o] || null,
    // Automatic starts happen on the outputs each sequence plays on.
    nextAuto: s.nextAuto && (s.sequences || []).some(x => x.id === s.nextAuto.id && (x.playsOn || ['main']).includes(o)) ? s.nextAuto : null,
    onOut,
    viewOutput: o,
    viewName: o2 ? o2.name : '',
    // Where its Stream Deck links for what's playing and Next and Previous start: /deck, or /deck/output/<output>.
    viewDeck: main || !o2 ? '/deck' : `/deck/output/${o2.link}`,
    viewColour: o2 ? o2.colour : '',
    viewMany: list.length > 1,
  };
}
// Coloured dots for the outputs where a scene is current or a sequence is playing, once there's more than one output.
function outDots(outs) {
  const box = document.createElement('span');
  box.className = 'outDots';
  if (!scene.viewMany) return box;
  for (const x of outs || []) {
    const i = document.createElement('i');
    i.style.background = x.colour;
    i.title = `On ${x.name}`;
    box.appendChild(i);
  }
  return box;
}
let selected = null;
let editOpen = false; // the selected source's settings are open under its row (the pencil)
let base = location.origin;
// Where Stream Deck links start: base with this Mac's key, /k/<key> (access.js deckPress()), once Studio has said it.
let deckBase = base;
let media = [], mediaLoaded = false;
let adding = null;
const naturalSize = new Map(); // image or video file -> [w, h], for the preview box and Full frame
const ACCEPT = { image: '.png,.jpg,.jpeg,.gif,.webp,.svg', video: '.mp4,.m4v,.webm,.mov' };
let canConvert = false;

const slug = s => String(s || '').toLowerCase().replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const current = () => scene.sources.find(s => s.id === selected) || null;

async function act(action) {
  $('err').textContent = '';
  // Scenes and sequences are played on the output picked over the Scene View.
  if (/^(scene|seq)/.test(action.type) && scene.viewOutput && scene.viewOutput !== 'main' && action.output === undefined) action = { ...action, output: scene.viewOutput };
  try {
    const res = await fetch('/api/scene', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(action) });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || res.statusText);
    show(body);
    return body;
  } catch (err) { $('err').textContent = err.message; console.warn('Scene change failed', action.type, err.message); }
}

// ─── Health ─────────────────────────────────────────────────────────────
// /api/health every 2 s: the game and what Studio follows, how long since PlayHQ answered, the clock, the outputs,
// the recording. The status board beside the picture (output/board.js) draws it.
let lastHealth = null, lastHealthAt = 0; // the last /api/health answer, for the status board
async function health() {
  try { lastHealth = await (await fetch('/api/health', { cache: 'no-store' })).json(); lastHealthAt = Date.now(); }
  catch { lastHealth = null; }
  if (typeof renderBoard === 'function') renderBoard();
}
health(); setInterval(health, 2000);

// ─── Folding sections ──────────────────────────────────────────────────
// Every section folds down to its header row, with its arrow or a click on its title, and stays folded on this Mac
// (localStorage) until it's opened again. Buttons in a header row (Output on, the switcher's status) stay in reach
// while folded, and a section's dialogs sit outside the fold, so its editor still opens. The Media folder starts
// folded. A link to a section (output.html#mediaSection) opens it. A section sends itself a 'fold' event as it
// folds or opens, so it can catch up on what it skipped while hidden.
const FOLD_KEY = 'studio.outputFolded';
let foldedNow = (() => { try { const v = JSON.parse(localStorage.getItem(FOLD_KEY)); return Array.isArray(v) ? v : ['media']; } catch { return ['media']; } })();
const isFolded = sec => sec.classList.contains('folded');
function setFolded(sec, on, save = true) {
  sec.classList.toggle('folded', on);
  const b = sec.querySelector(':scope > .secHead .fold');
  b.setAttribute('aria-expanded', String(!on));
  b.title = on ? 'Show this section' : 'Fold this section away';
  if (save) {
    foldedNow = [...document.querySelectorAll('section[data-fold].folded')].map(s => s.dataset.fold);
    try { localStorage.setItem(FOLD_KEY, JSON.stringify(foldedNow)); } catch { /* no storage */ }
  }
  sec.dispatchEvent(new CustomEvent('fold', { detail: { open: !on } }));
}
for (const sec of document.querySelectorAll('section[data-fold]')) {
  const h2 = sec.querySelector(':scope > .secHead h2');
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'fold'; b.textContent = '▾';
  b.setAttribute('aria-label', `Show or fold ${h2.textContent}`);
  const title = document.createElement('span');
  title.className = 'foldTitle';
  h2.before(title);
  title.append(b, h2);
  b.onclick = h2.onclick = () => setFolded(sec, !isFolded(sec));
  setFolded(sec, foldedNow.includes(sec.dataset.fold) && location.hash !== `#${sec.id}`, false);
}

// Ticks for the outputs something plays on (the music, a mic): box is filled with one tick per output, in its colour,
// with chosen ticked; onChange(ids) gets the new list. One stays ticked, so it always plays somewhere.
function outputTicks(box, chosen, onChange) {
  const list = typeof out !== 'undefined' && out && out.outputs || [];
  const on = chosen && chosen.length ? chosen : ['main'];
  box.className = 'seqOuts outTicks';
  box.innerHTML = '';
  for (const o of list) {
    const l = document.createElement('label');
    l.innerHTML = '<input type="checkbox"> <i></i> <span></span>';
    const c = l.querySelector('input');
    c.checked = on.includes(o.id);
    c.disabled = c.checked && on.filter(id => list.some(x => x.id === id)).length === 1;
    c.onchange = () => onChange(list.map(x => x.id).filter(id => id === o.id ? c.checked : on.includes(id)));
    l.querySelector('i').style.cssText = `background:${o.colour};border:2px solid ${o.colour}`;
    l.querySelector('span').textContent = o.name;
    box.append(l);
  }
}
// The outputs' names, for a list of output ids.
const outputNames = ids => { const list = typeof out !== 'undefined' && out && out.outputs || []; return (ids && ids.length ? ids : ['main']).map(id => list.find(o => o.id === id)?.name).filter(Boolean).join(', '); };
