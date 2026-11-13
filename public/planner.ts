// FirstPass Studio - the Production Planner page's script (planner.html loads it as a module, so its names stay its own).
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
// What Studio answers (planner.ts state()): the commentators, tonight, and every game night with its plan.
interface Person { id: string; name: string; guest?: boolean; headshotUrl?: string }
interface Slot { time: string; game: { id: string; home: string; away: string; division?: string; round?: string } | null; people: string[]; changed?: { was: string } | null; runOrder?: string }
interface Night { date: string; court: string; courts: string[]; games: { court: string }[]; slots: Slot[]; from?: string | null; planned?: boolean }
interface Plan {
  pool: Person[]; others: { name: string; from: string; guest?: boolean }[]; nights: Night[]; today: string; next?: string | null; maxPeople: number;
  runOrders: { id: string; name: string; count: number }[]; onAir: { game?: string; gameId?: string; names: string[]; runOrder?: string };
  tonight: { date: string; flags: { text: string; kind: string }[] }; error?: string;
}
// Set by load() before anything is drawn.
let data: Plan;
const opened = new Set<string>();

const games = (n: number) => `${n} game${n === 1 ? '' : 's'}`;
const dayName = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
const showError = (msg: string) => { if (msg) studioStatus(msg, 'error'); };

// Redrawing closes an open list, so a look again waits while one is being used.
const busy = () => ['SELECT', 'INPUT'].includes(document.activeElement?.tagName || '');
const errText = (err: unknown) => err instanceof Error ? err.message : String(err);
async function load({ quiet = false } = {}) {
  if (quiet && busy()) return;
  try {
    const res = await fetch('/api/planner', { cache: 'no-store' });
    const d = await res.json();
    if (d.error) throw new Error(d.error);
    data = d; draw();
  } catch (err) { showError(`Couldn't load the plan: ${errText(err)}`); }
}
// A commentator's headshot, for the Socials tab's Commentary team picture.
function headshot(p: Person) {
  const box = el('label', 'shot');
  box.title = p.headshotUrl ? `Change ${p.name}'s headshot` : `Add a headshot of ${p.name}`;
  if (p.headshotUrl) { const img = box.appendChild(el('img')); img.src = `${p.headshotUrl}?v=${Date.now()}`; img.alt = ''; }
  else box.append(p.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase());
  const input = box.appendChild(el('input')); input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp';
  input.onchange = () => { const f = input.files?.[0]; if (f) addHeadshot(p, f); };
  return box;
}
async function addHeadshot(p: Person, file: File) {
  const ext = (file.name.match(/\.(jpe?g|png|webp)$/i) || [])[1] || (file.type.split('/')[1] || '');
  await send('POST', `/api/planner/headshot?id=${encodeURIComponent(p.id)}&ext=${encodeURIComponent(ext)}`, file);
}
async function send(method: string, path: string, body?: File) {
  try {
    const res = await fetch(path, { method, body });
    const d = await res.json();
    if (d.error) throw new Error(d.error);
    data = d; draw(); studioStatus('Saved');
  } catch (err) { showError(`Couldn't save the headshot: ${errText(err)}`); }
}
async function post(path: string, body: object) {
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const d = await res.json();
    if (d.error) throw new Error(d.error);
    data = d; draw(); studioStatus('Saved');
  } catch (err) { showError(errText(err)); load(); }
}
const person = (id: string) => data.pool.find(p => p.id === id);

function draw() {
  // Tonight's flags: Scoreboard control on another court, or a game picked by hand that isn't in the plan.
  $('flags').replaceChildren(...data.tonight.flags.map(f => {
    const p = el('p', 'fp-callout warn', f.text + ' ');
    const a = p.appendChild(el('a', '', f.kind === 'court' ? 'Change it on Scoreboard control' : 'Move the commentators below'));
    a.href = f.kind === 'court' ? '/control.html' : `#night-${data.tonight.date}`;
    if (f.kind !== 'court') a.onclick = () => { opened.add(data.tonight.date); draw(); };
    return p;
  }));
  const on = data.onAir;
  $('onair').hidden = !on.game;
  $('onair').innerHTML = '';
  if (on.game) {
    $('onair').append('On the scoreboard now: ', el('b', '', on.game), ' · ', on.names.length ? `on the mic ${on.names.join(', ')}` : 'nobody planned on the mic');
    const ro = on.runOrder && data.runOrders.find(o => o.id === on.runOrder);
    if (ro) $('onair').append(` · run order ${ro.name}`);
  }

  // The pool.
  $('pool').replaceChildren(...(data.pool.length ? data.pool.map(p => {
    const row = el('div', 'person');
    const shot = el('span', 'shotwrap'); shot.append(headshot(p));
    if (p.headshotUrl) {
      const off = el('button', 'alt small shot__off', '×'); off.title = `Remove ${p.name}'s headshot`;
      off.onclick = () => send('DELETE', `/api/planner/headshot?id=${encodeURIComponent(p.id)}`);
      shot.append(off);
    }
    row.append(shot, el('span', 'person__name', p.name));
    const lab = el('label');
    const tick = lab.appendChild(el('input')); tick.type = 'checkbox'; tick.checked = !!p.guest;
    tick.onchange = () => savePool(data.pool.map(x => x.id === p.id ? { ...x, guest: tick.checked } : x));
    lab.append(' Guest');
    const rm = el('button', 'alt small', '×'); rm.title = `Take ${p.name} out of the list (and every night)`;
    rm.onclick = async () => { if (await askConfirm(`Take ${p.name} out of the commentators?`, "They come out of every night they're planned for.", { ok: 'Take out', danger: true })) savePool(data.pool.filter(x => x.id !== p.id)); };
    row.append(lab, rm);
    row.ondragover = e => { e.preventDefault(); row.classList.add('over'); };
    row.ondragleave = () => row.classList.remove('over');
    row.ondrop = e => { e.preventDefault(); row.classList.remove('over'); const f = e.dataTransfer?.files[0]; if (f) addHeadshot(p, f); };
    return row;
  }) : [el('p', 'fp-empty', 'No commentators yet. Add the people who call your games.')]));
  $<HTMLDataListElement>('others').replaceChildren(...data.others.filter(o => !data.pool.some(p => p.name.toLowerCase() === o.name.toLowerCase()))
    .map(o => { const opt = el('option'); opt.value = o.name; opt.label = `from ${o.from}`; return opt; }));

  // The nights.
  if (!data.nights.length) {
    const empty = el('section');
    empty.append(el('p', 'fp-empty', 'PlayHQ has no game nights for this season yet.'));
    $('nights').replaceChildren(empty);
    return;
  }
  if (!opened.size && data.next) opened.add(data.next);
  $('nights').replaceChildren(...data.nights.map(drawNight));
}

function drawNight(n: Night) {
  const d = el('details', `night${n.date < data.today ? ' past' : ''}`);
  d.id = `night-${n.date}`;
  d.open = opened.has(n.date);
  d.ontoggle = () => { if (d.open) opened.add(n.date); else opened.delete(n.date); };
  const s = d.appendChild(el('summary'));
  s.append(el('span', 'night__date', dayName(n.date) + (n.date === data.today ? ' (today)' : '')));
  const people = n.slots.reduce((t, x) => t + x.people.length, 0);
  s.append(el('span', 'night__what', n.court ? `${n.court}, ${games(n.slots.filter(x => x.game).length)}` : `${games(n.games.length)}, no court picked`));
  if (n.from) s.append(el('span', 'night__badge', `Same as ${dayName(n.from)}`));
  const warn = n.slots.filter(x => x.changed).length + (n.court ? n.slots.filter(x => x.game && !x.people.length).length : 0);
  if (warn && n.date >= data.today) s.append(el('span', 'night__badge warn', `${warn} to check`));
  else if (n.court && !people) s.append(el('span', 'night__badge warn', 'Nobody on the mic'));

  const body = d.appendChild(el('div', 'night__body'));
  const row = body.appendChild(el('div', 'row'));
  const lab = row.appendChild(el('label', '', 'Court Studio streams '));
  const sel = lab.appendChild(el('select'));
  sel.append(new Option('Pick a court', ''));
  for (const c of n.courts) { const o = sel.appendChild(el('option', '', `${c} (${games(n.games.filter(g => g.court === c).length)})`)); o.value = c; }
  if (n.court && !n.courts.includes(n.court)) { const o = sel.appendChild(el('option', '', `${n.court} (no games now)`)); o.value = n.court; }
  sel.value = n.court;
  sel.onchange = () => saveNight(n, { court: sel.value });
  if (n.planned && data.nights.some(x => x.date < n.date && x.planned)) {
    const back = row.appendChild(el('button', 'alt small', 'Same as the night before'));
    back.title = 'Forget this night\'s own plan, and take the plan of the last planned night before it';
    back.onclick = () => post('/api/planner/night', { date: n.date, clear: true });
  }
  if (!n.court) { body.append(el('p', 'help', 'Pick the court to see its games and plan who is on the mic.')); return d; }
  if (!n.slots.length) body.append(el('p', 'help', `No games on ${n.court} that night. Pick another court.`));
  for (const slot of n.slots) body.append(drawSlot(n, slot));
  if (n.from) body.append(el('p', 'help', `Planned the same as ${dayName(n.from)}, game by game. Change anything here and this night keeps a plan of its own.`));
  return d;
}

function drawSlot(n: Night, slot: Slot) {
  const r = el('div', 'slot');
  if (slot.game && slot.game.id === data.onAir.gameId) r.classList.add('onair');
  r.append(el('div', 'slot__time', slot.time));
  const right = r.appendChild(el('div'));
  const g = right.appendChild(el('div', 'slot__game', slot.game ? `${slot.game.home} v ${slot.game.away} ` : 'No game at this time any more '));
  if (slot.game) g.append(el('small', '', [slot.game.division, slot.game.round].filter(Boolean).join(', ')));
  if (slot.changed) right.append(el('div', 'flag', slot.game ? `Fixture changed: this was ${slot.changed.was}. Check the commentators still suit.` : `${slot.changed.was} has moved off this court or night. Move its commentators to its new slot, or take them out.`));
  else if (slot.game && !slot.people.length) right.append(el('div', 'flag soft', 'Nobody on the mic yet'));
  const missing = slot.runOrder && !data.runOrders.some(o => o.id === slot.runOrder);
  if (missing) right.append(el('div', 'flag', 'Its run order has been deleted. Pick another, or None.'));
  const seats = right.appendChild(el('div', 'seats'));
  for (const id of slot.people) {
    const p = person(id); if (!p) continue;
    const chip = seats.appendChild(el('span', `seat${p.guest ? ' guest' : ''}`, p.name + (p.guest ? ' (guest)' : '')));
    const x = chip.appendChild(el('button', '', '×')); x.title = `Take ${p.name} off this game`;
    x.onclick = () => saveNight(n, { slot: slot.time, people: slot.people.filter(i => i !== id) });
  }
  const free = data.pool.filter(p => !slot.people.includes(p.id));
  if (slot.people.length < data.maxPeople && (data.pool.length ? free.length : true)) {
    const wrap = seats.appendChild(el('span', 'seat', ''));
    wrap.style.padding = '0'; wrap.style.background = 'transparent';
    const pick = wrap.appendChild(el('select'));
    pick.append(new Option(data.pool.length ? '+ Add' : 'Add commentators first', ''));
    for (const p of free) { const o = pick.appendChild(el('option', '', p.name + (p.guest ? ' (guest)' : ''))); o.value = p.id; }
    pick.disabled = !data.pool.length;
    pick.onchange = () => { if (pick.value) saveNight(n, { slot: slot.time, people: [...slot.people, pick.value] }); };
  }
  // The run order: a saved one (the Output page's Saved…) loads into Output 1's run order when the game loads.
  if (slot.game) {
    const ro = right.appendChild(el('label', 'runorder', 'Run order '));
    const sel = ro.appendChild(el('select'));
    sel.title = 'Loads into the Output page\'s run order when this game comes up on the scoreboard, in place of what is queued';
    sel.append(new Option(data.runOrders.length ? 'None' : 'None (save one on the Output page)', ''));
    for (const o of data.runOrders) sel.append(new Option(`${o.name} (${o.count})`, o.id));
    if (missing) sel.append(new Option('Deleted run order', slot.runOrder || ''));
    sel.value = slot.runOrder || '';
    sel.onchange = () => saveNight(n, { slot: slot.time, runOrder: sel.value });
  }
  return r;
}

// Saves a night whole: its court, and every slot's people and run order (a changed slot's from change).
function saveNight(n: Night, change: { court?: string; slot?: string; people?: string[]; runOrder?: string }) {
  const court = change.court !== undefined ? change.court : n.court;
  if (!court) return post('/api/planner/night', { date: n.date, clear: true });
  const slots: Record<string, { people: string[]; runOrder: string }> = {};
  if (court === n.court) for (const s of n.slots) {
    const mine = s.time === change.slot;
    slots[s.time] = { people: mine && change.people ? change.people : s.people, runOrder: mine && change.runOrder !== undefined ? change.runOrder : s.runOrder || '' };
  }
  opened.add(n.date);
  post('/api/planner/night', { date: n.date, court, slots });
}
function savePool(pool: { name: string; guest?: boolean; id?: string }[]) { post('/api/planner/pool', { pool }); }
function addPerson() {
  const name = $<HTMLInputElement>('newName').value.trim();
  if (!name) return;
  if (data.pool.some(p => p.name.toLowerCase() === name.toLowerCase())) { showError(`${name} is already in the list.`); return; }
  const other = data.others.find(o => o.name.toLowerCase() === name.toLowerCase());
  $<HTMLInputElement>('newName').value = '';
  savePool([...data.pool, { name: other ? other.name : name, guest: other ? other.guest : false }]);
}
$<HTMLButtonElement>('addBtn').onclick = addPerson;
$<HTMLInputElement>('newName').onkeydown = e => { if (e.key === 'Enter') addPerson(); };

load();
// The game on the scoreboard changes through the night: look again (at most every few seconds) for the flags.
let lastGame: string | undefined;
// A run order saved, renamed or deleted on the Output page shows in the games' Run order lists.
let lastOrders: string | undefined;
const ordersKey = (sc: SceneState) => JSON.stringify((sc.runOrders || []).map(o => [o.id, o.name, o.count]));
sceneEvents<SceneState, { gameId?: string; autoCourt?: string; autoSelect?: boolean }>(sc => { const k = ordersKey(sc); if (lastOrders !== undefined && k !== lastOrders) load({ quiet: true }); lastOrders = k; }, { board: b => { const k = `${b.gameId}|${b.autoCourt}|${b.autoSelect}`; if (lastGame !== undefined && k !== lastGame) load({ quiet: true }); lastGame = k; } });
setInterval(() => load({ quiet: true }), 60000); // PlayHQ's fixture changes too

// What makes this file a module (its names its own), as the first line says.
export {};
