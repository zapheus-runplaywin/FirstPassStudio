// FirstPass Studio - the Output page, part 4 of 16: Scenes: saved looks for the sources, going to one, the changed list, and each tile's settings, copy and delete.
// The page's script is split by section into public/output/, loaded in order by output.html; the files share one
// scope (plain scripts), so a name defined in an earlier part is in reach of a later one.

// ─── Scenes ───────────────────────────────────────────────────────────
// A scene sets each source on or off, or leaves it as it is (not in its states). Going to one
// changes only what differs; the server says which sources have changed since (scene.changed).
// In the order scenes and sequences are listed: pre-game, live stream, quarter time, post-game, ads.
const COLOURS = [['green', 'Green: pre-game'], ['blue', 'Blue: live stream'], ['purple', 'Purple: quarter time'], ['grey', 'Grey: post-game'], ['yellow', 'Yellow: ads']];
const currentScene = () => (scene.scenes || []).find(s => s.id === scene.current) || null;
const nameOf = (id: string) => scene.sources.find(s => s.id === id)?.name || '';
const ICON_COPY = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const ICON_BIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';
function sceneCounts(sc: Scene) {
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
    pick(b, 'b').textContent = sc.name;
    if (sc.quiet) pick(b, 'b').append(quietMark());
    if (sc.switcher?.length) pick(b, 'b').append(switcherMark(sc.switcher));
    pick(b, 'b').append(outDots(scene.onOut?.scenes[sc.id]));
    pick(b, 'small').textContent = sceneCounts(sc);
    pick(b, '.band').classList.add(sc.colour);
    b.title = sc.id === scene.current ? (changed.length ? `Go back to ${sc.name} as saved` : `${sc.name} is on now`) : `Go to ${sc.name}`;
    b.onclick = () => act({ type: 'sceneGo', scene: sc.id });
    // Its actions, along the foot of the tile: settings, copy, delete.
    const tile = document.createElement('div');
    tile.className = 'sceneTile';
    const acts = document.createElement('span');
    acts.className = 'sceneActs';
    acts.innerHTML = `<button class="alt ico edit" title="Settings: name, colour, ducks the music, switcher">${ICON_PEN}</button>`
      + `<button class="alt ico copy" title="Copy this scene">${ICON_COPY}</button>`
      + `<button class="alt ico del" title="Delete this scene">${ICON_BIN}</button>`;
    pick<HTMLButtonElement>(acts, '.edit').setAttribute('aria-label', `Settings for ${sc.name}`);
    pick<HTMLButtonElement>(acts, '.copy').setAttribute('aria-label', `Copy ${sc.name}`);
    pick<HTMLButtonElement>(acts, '.del').setAttribute('aria-label', `Delete ${sc.name}`);
    pick<HTMLButtonElement>(acts, '.edit').onclick = () => editScene(sc);
    pick<HTMLButtonElement>(acts, '.copy').onclick = () => act({ type: 'sceneCopy', scene: sc.id });
    pick<HTMLButtonElement>(acts, '.del').onclick = () => deleteScene(sc);
    tile.append(b, acts);
    box.appendChild(tile);
  }
  // What's different from the current scene, and the three ways out.
  const drift = $('drift');
  drift.classList.toggle('hidden', !(cur && changed.length));
  if (cur && changed.length) {
    const what = changed.map(id => `${nameOf(id)} ${scene.sources.find(s => s.id === id)?.visible ? 'on' : 'off'}`).join(', ');
    drift.innerHTML = '<span>⚠ <b></b> <span></span></span><button class="back"></button><button class="alt over"></button><button class="alt asNew">Save as new scene</button>';
    pick(drift, 'b').textContent = `${changed.length} change${changed.length === 1 ? '' : 's'} from saved ${cur.name}:`;
    pick(drift, 'span span').textContent = what + '.';
    pick<HTMLButtonElement>(drift, '.back').textContent = 'Back to saved';
    pick<HTMLButtonElement>(drift, '.back').title = `Go back to ${cur.name} exactly as it was saved`;
    pick<HTMLButtonElement>(drift, '.back').onclick = () => act({ type: 'sceneAgain' });
    pick<HTMLButtonElement>(drift, '.over').textContent = `Save over ${cur.name}`;
    pick<HTMLButtonElement>(drift, '.over').title = `Keep what's on now as ${cur.name}'s saved state`;
    pick<HTMLButtonElement>(drift, '.over').onclick = () => act({ type: 'sceneCapture', scene: cur.id });
    pick<HTMLButtonElement>(drift, '.asNew').onclick = saveNewScene;
  }
  // With no scenes yet, the first steps (the rest is in the user guide).
  $('scenesEmpty').hidden = !!scenes.length;
  $('scenesEmpty').innerHTML = 'A scene is a saved look: which sources are on and which are off. Set the sources up, then <b>Add scene</b> saves what\'s on now under a name '
    + '(Pre-game, Live, Quarter time, Full time…). Going to a scene, here or from the Stream Deck, puts the graphics back to that look.';
  // Keep an open settings dialog in step: its switcher button, or close it if its scene went (deleted elsewhere).
  if ($<HTMLDialogElement>('sceneDialog').open) {
    const open = scenes.find(x => x.id === sdScene?.id);
    if (open) sdSwitcherButton(open); else $<HTMLDialogElement>('sceneDialog').close();
  }
}
// 🤫 beside the name of a scene or sequence with Ducks the music ticked.
function quietMark() {
  const m = Object.assign(document.createElement('span'), { textContent: ' 🤫', title: 'Ducks the music' });
  m.setAttribute('role', 'img'); m.setAttribute('aria-label', 'Ducks the music');
  return m;
}
async function saveNewScene() {
  const name = await askText('Name the new scene (what\'s on now is saved in it)', '');
  if (name) act({ type: 'sceneSave', name });
}
$<HTMLButtonElement>('addScene').onclick = saveNewScene;

// Deleting a scene, from the bin on its tile or its settings.
async function deleteScene(sc: Scene) {
  if (!await askConfirm(`Delete the scene "${sc.name}"?`, 'Are you sure? Its Stream Deck keys will say gone. The sources stay as they are.', { ok: 'Delete', danger: true })) return false;
  return !!await act({ type: 'sceneRemove', scene: sc.id });
}

// One scene's settings, from the pencil on its tile: name, colour, Ducks the music and its switcher actions.
// What it turns on and off is changed by Save over (the bar under the scenes) instead.
let sdScene: Scene | null = null;
for (const [v, label] of COLOURS) $<HTMLSelectElement>('sdColour').add(new Option(label, v));
function editScene(sc: Scene) {
  sdScene = sc;
  $('sdTitle').textContent = sc.name;
  $<HTMLInputElement>('sdName').value = sc.name;
  $<HTMLSelectElement>('sdColour').value = sc.colour;
  $<HTMLInputElement>('sdQuiet').checked = !!sc.quiet;
  sdSwitcherButton(sc);
  $<HTMLDialogElement>('sceneDialog').showModal();
  sdGuard.opened();
}
// Its switcher actions (once a switcher is set up, or it has some), in a dialog of their own.
function sdSwitcherButton(sc: Scene) {
  const swb = $<HTMLButtonElement>('sdSwitcher');
  swb.classList.toggle('hidden', !(sw?.setUp || sc.switcher?.length));
  swb.textContent = sc.switcher?.length ? `🎥 Switcher (${sc.switcher.length})` : '🎥 Switcher';
  swb.title = sc.switcher?.length ? `Switcher: ${sc.switcher.map(swActText).join(', ')}` : 'Cut to a camera, a key on or off, fade to black or a macro when this scene is picked';
}
const sdValues = () => ({ name: $<HTMLInputElement>('sdName').value.trim() || sdScene?.name || '', colour: $<HTMLSelectElement>('sdColour').value, quiet: $<HTMLInputElement>('sdQuiet').checked });
$<HTMLButtonElement>('sdSwitcher').onclick = () => { const sc = sdScene; if (sc) editSceneSwitcher((scene.scenes || []).find(x => x.id === sc.id) || sc); };
$<HTMLInputElement>('sdName').onkeydown = e => { if (e.key === 'Enter') $<HTMLButtonElement>('sdSave').click(); };
async function sdSave() {
  if (sdScene && await act({ type: 'sceneUpdate', scene: sdScene.id, changes: sdValues() })) $<HTMLDialogElement>('sceneDialog').close();
}
$<HTMLButtonElement>('sdSave').onclick = sdSave;
$<HTMLButtonElement>('sdCancel').onclick = () => $<HTMLDialogElement>('sceneDialog').close();
$<HTMLButtonElement>('sdCopy').onclick = async () => { if (sdScene && await act({ type: 'sceneCopy', scene: sdScene.id })) $<HTMLDialogElement>('sceneDialog').close(); };
$<HTMLButtonElement>('sdDelete').onclick = async () => { if (sdScene && await deleteScene(sdScene)) $<HTMLDialogElement>('sceneDialog').close(); };
const sdGuard = unsavedDialog($<HTMLDialogElement>('sceneDialog'), {
  what: () => `${sdScene?.name || 'the scene'}'s settings`,
  snapshot: () => sdScene && sdValues(),
  save: async () => { await sdSave(); return !$<HTMLDialogElement>('sceneDialog').open; },
});
