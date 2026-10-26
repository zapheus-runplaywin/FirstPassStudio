// FirstPass Studio - the Output page, part 1 of 12: Shared state and helpers for every section: $, the scene as last seen, the selected source, act() sending a change to Studio.
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
    // Automatic starts happen on the output each sequence starts by itself on.
    nextAuto: s.nextAuto && (s.sequences || []).some(x => x.id === s.nextAuto.id && (x.startOn || 'main') === o) ? s.nextAuto : null,
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
let base = location.origin;
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

// ─── Health strip ───────────────────────────────────────────────────────
// One line under the title from /api/health: the game and what Studio follows, how long since PlayHQ
// answered (amber when a reading is overdue, red after a minute of errors), the clock, the video output.
const hEsc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const ago = ms => ms === null ? 'not yet' : ms < 1500 ? 'just now' : ms < 90000 ? `${Math.round(ms / 1000)} s ago` : `${Math.round(ms / 60000)} min ago`;
async function health() {
  let h;
  try { h = await (await fetch('/api/health', { cache: 'no-store' })).json(); }
  catch { $('healthDot').className = 'hdot bad'; $('healthPlayhq').innerHTML = '<span class="badText">Studio isn\'t answering</span>'; $('health').hidden = false; return; }
  $('healthGame').innerHTML = h.game ? `<b>${hEsc(h.game.label)}</b>${h.game.court ? ` on ${hEsc(h.game.court)}` : ''}` : `<b>${hEsc(h.competition || 'No competition')}</b>: no game picked`;
  const p = h.playhq;
  let text, cls = 'hdot ok';
  if (!h.game || h.source !== 'playhq') { text = 'Scores by hand'; cls = 'hdot off'; }
  else if (p.waiting) text = p.waiting.replace(/^Electronic scoring starts .*?, so /, 'PlayHQ ');
  else if (p.finished) text = `Following PlayHQ · game finished (${hEsc(p.status.toLowerCase().replace(/_/g, ' '))})`;
  else if (p.state === 'bad') { text = `<span class="badText">PlayHQ failing for ${ago(p.readAgoMs)}: ${hEsc(p.error)}</span>`; cls = 'hdot bad'; }
  else if (p.state === 'warn') { text = `<span class="warnText">PlayHQ last answered ${ago(p.readAgoMs)}${p.error ? `: ${hEsc(p.error)}` : ''}</span>`; cls = 'hdot warn'; }
  else text = `Following PlayHQ · read ${ago(p.readAgoMs)}`;
  $('healthDot').className = cls;
  $('healthPlayhq').innerHTML = text;
  $('healthClock').textContent = h.game ? `Clock ${h.clock.following ? 'follows the scorer' : 'by hand'}${h.clock.running ? ', running' : ''}` : '';
  $('healthOut').textContent = h.output.on ? `Output on (${h.output.mode})` : 'Output off';
  $('health').hidden = false;
}
health(); setInterval(health, 2000);
