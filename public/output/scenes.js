// FirstPass Studio - the Output page, part 4 of 11: Scenes: saved looks for the sources, going to one, and the changed list.
// The page's script is split by section into public/output/, loaded in order by output.html; the files share one
// scope (plain scripts), so a name defined in an earlier part is in reach of a later one.

// ─── Scenes ───────────────────────────────────────────────────────────
// A scene sets each source on or off, or leaves it as it is (not in its states). Going to one
// changes only what differs; the server says which sources have changed since (scene.changed).
// In the order scenes and sequences are listed: pre-game, live stream, quarter time, post-game, ads.
const COLOURS = [['green', 'Green: pre-game'], ['blue', 'Blue: live stream'], ['purple', 'Purple: quarter time'], ['grey', 'Grey: post-game'], ['yellow', 'Yellow: ads']];
const currentScene = () => (scene.scenes || []).find(s => s.id === scene.current) || null;
const nameOf = id => scene.sources.find(s => s.id === id)?.name || '';
let editing = false;
function sceneCounts(sc) {
  const v = Object.values(sc.states);
  const on = v.filter(x => x === 'on').length, off = v.filter(x => x === 'off').length, left = scene.sources.length - on - off;
  if (!on && !off) return 'changes nothing';
  return [on && `${on} on`, off && `${off} off`, left && `${left} left as is`].filter(Boolean).join(' · ');
}
function renderScenes() {
  const scenes = scene.scenes || [], cur = currentScene(), changed = scene.changed || [];
  const box = $('scenes');
  box.innerHTML = '';
  for (const sc of scenes) {
    const b = document.createElement('button');
    b.className = 'scene' + (sc.id === scene.current ? ' cur' : '') + (sc.id === scene.current && changed.length ? ' changed' : '');
    b.innerHTML = '<b></b><small></small><span class="band"></span>';
    b.querySelector('b').textContent = sc.name;
    if (sc.quiet) b.querySelector('b').append(quietMark());
    b.querySelector('small').textContent = sceneCounts(sc);
    b.querySelector('.band').classList.add(sc.colour);
    b.title = sc.id === scene.current ? (changed.length ? `Go back to ${sc.name} as saved` : `${sc.name} is on now`) : `Go to ${sc.name}`;
    b.onclick = () => act({ type: 'sceneGo', scene: sc.id });
    box.appendChild(b);
  }
  const add = document.createElement('button');
  add.className = 'scene addScene';
  add.innerHTML = "+ Save what's on now<small>as a new scene</small>";
  add.onclick = saveNewScene;
  box.appendChild(add);

  // What's different from the current scene, and the three ways out.
  const drift = $('drift');
  drift.classList.toggle('hidden', !(cur && changed.length));
  if (cur && changed.length) {
    const what = changed.map(id => `${nameOf(id)} ${scene.sources.find(s => s.id === id)?.visible ? 'on' : 'off'}`).join(', ');
    drift.innerHTML = '<span>⚠ <b></b> <span></span></span><button class="back"></button><button class="alt over"></button><button class="alt asNew">Save as new scene</button>';
    drift.querySelector('b').textContent = `${changed.length} change${changed.length === 1 ? '' : 's'} from saved ${cur.name}:`;
    drift.querySelector('span span').textContent = what + '.';
    drift.querySelector('.back').textContent = 'Back to saved';
    drift.querySelector('.back').title = `Go back to ${cur.name} exactly as it was saved`;
    drift.querySelector('.back').onclick = () => act({ type: 'sceneAgain' });
    drift.querySelector('.over').textContent = `Save over ${cur.name}`;
    drift.querySelector('.over').title = `Keep what's on now as ${cur.name}'s saved state`;
    drift.querySelector('.over').onclick = () => act({ type: 'sceneCapture', scene: cur.id });
    drift.querySelector('.asNew').onclick = saveNewScene;
  }
  $('scenesNote').innerHTML = scenes.length
    ? 'Click a scene to go to it: it turns sources on and off to match, and a source that\'s already on stays on (it isn\'t reloaded). '
      + 'Turning sources on and off by hand changes them everywhere and shows them as <b>changed</b>; click the scene again or <b>Back to saved</b> to put them back. '
      + 'Scenes are listed by colour (pre-game, live stream, quarter time, post-game, ads), then name, and the Stream Deck\'s Next and Previous go in that order (they stop at the ends). A source you add later is off in every scene. '
      + `Stream Deck: <code>${base}/deck/scene/${encodeURIComponent(slug(scenes[0].name))}</code>, <code>/deck/scene/next</code>, <code>/deck/scene/prev</code> and <code>/deck/scene/again</code> (back to saved).`
    : 'A scene is a saved look: which sources are on and which are off. Set the sources up below, then <b>Save what\'s on now</b> and name it '
      + '(Pre-game, Live, Quarter time, Full time…). Going to a scene, here or from the Stream Deck, puts the graphics back to that look.';
  $('editScenes').classList.toggle('hidden', !scenes.length);
  $('editScenes').textContent = editing ? 'Done' : 'Edit scenes';
  if (!scenes.length) editing = false;
  $('sceneGrid').classList.toggle('hidden', !editing);
  if (editing) renderGrid();
}
// 🤫 beside the name of a scene or sequence with Quiet the music ticked.
function quietMark() {
  const m = Object.assign(document.createElement('span'), { textContent: ' 🤫', title: 'Quiets the music' });
  m.setAttribute('role', 'img'); m.setAttribute('aria-label', 'Quiets the music');
  return m;
}
async function saveNewScene() {
  const name = await askText('Name the new scene (what\'s on now is saved in it)', '');
  if (name) act({ type: 'sceneSave', name });
}
$('editScenes').onclick = () => { editing = !editing; renderScenes(); };

// The Edit scenes grid: sources down the side, scenes across. Each cell goes On, Off, Leave as is.
// It changes the saved scenes only, never what's on now.
const NEXT_STATE = { on: 'off', off: 'leave', leave: 'on' };
function renderGrid() {
  const scenes = scene.scenes || [];
  const grid = $('sceneGrid');
  // Keep a name box someone is typing in.
  const typing = document.activeElement?.dataset?.scene;
  if (typing && grid.contains(document.activeElement)) return;
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  head.appendChild(Object.assign(document.createElement('th'), { textContent: 'Source' }));
  scenes.forEach((sc, i) => {
    const th = document.createElement('th');
    th.innerHTML = '<input maxlength="60"><div class="row"><select></select></div><div class="row"><button class="alt copy">Copy</button><button class="danger del">Delete</button></div><label class="quietMusic" style="font-weight:400;font-size:12px"><input type="checkbox"> Quiet the music</label>';
    const input = th.querySelector('input');
    input.value = sc.name; input.dataset.scene = sc.id; input.setAttribute('aria-label', 'Scene name');
    input.onchange = () => act({ type: 'sceneUpdate', scene: sc.id, changes: { name: input.value } });
    input.onkeydown = e => { if (e.key === 'Enter') input.blur(); };
    const sel = th.querySelector('select');
    sel.setAttribute('aria-label', 'Stream Deck colour');
    for (const [v, label] of COLOURS) sel.add(new Option(label, v, false, v === sc.colour));
    sel.onchange = () => act({ type: 'sceneUpdate', scene: sc.id, changes: { colour: sel.value } });
    const quiet = th.querySelector('.quietMusic input');
    quiet.checked = !!sc.quiet;
    quiet.title = 'Going to this scene ducks the music (or fades out a sequence\'s music), for an interview on court';
    quiet.onchange = () => act({ type: 'sceneUpdate', scene: sc.id, changes: { quiet: quiet.checked } });
    th.querySelector('.copy').onclick = () => act({ type: 'sceneCopy', scene: sc.id });
    th.querySelector('.del').onclick = () => {
      if (confirm(`Delete the scene "${sc.name}"? Its Stream Deck keys will say gone. The sources stay as they are.`)) act({ type: 'sceneRemove', scene: sc.id });
    };
    head.appendChild(th);
  });
  const body = table.createTBody();
  for (const s of scene.sources) {
    const tr = body.insertRow();
    tr.insertCell().textContent = s.name;
    for (const sc of scenes) {
      const td = tr.insertCell();
      if (sc.id === scene.current) td.className = 'cur';
      const state = sc.states[s.id] || 'leave';
      const b = document.createElement('button');
      b.className = 'cell ' + state;
      b.textContent = { on: 'On', off: 'Off', leave: 'Leave' }[state];
      b.title = `${s.name} in ${sc.name}: ${{ on: 'turned on', off: 'turned off', leave: 'left as it is' }[state]}. Click to change.`;
      b.onclick = () => act({ type: 'sceneUpdate', scene: sc.id, changes: { states: { [s.id]: NEXT_STATE[state] } } });
      td.appendChild(b);
    }
  }
  grid.innerHTML = '';
  grid.appendChild(table);
  const note = document.createElement('p');
  note.className = 'note';
  note.style.margin = '8px';
  note.innerHTML = 'Click a cell to change it: <b>On</b>, <b>Off</b> or <b>Leave</b> (going to the scene doesn\'t touch that source). '
    + 'This changes the saved scenes, not what\'s on now. The tinted column is the scene that\'s on now. The colour is the Stream Deck colour group for the scene\'s keys.';
  grid.appendChild(note);
}
