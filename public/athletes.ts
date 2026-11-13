// FirstPass Studio - the Athletes page's script (athletes.html loads it as a module, so its names stay its own).
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
// What Studio answers (athletes.ts): the teams and photos, a team's athletes, or every athlete.
interface Photo { file: string; url: string; v?: number | string }
interface TeamRef { name: string; division?: string; logo?: string }
interface GamesRow { division?: string; club?: string; games?: number | string; asOf?: string }
interface Career { division: string; total: number; season: number; lines: { club?: string; games: number; asOf?: string; since: number }[] }
interface Athlete {
  name: string; photo?: string; photoOk?: boolean; silhouette: string; position?: string; captain?: boolean; number: string; positions: string[];
  games: number; teams?: { team: string; division: string }[]; career?: Career[]; positionsPlayed?: string[]; positionsTyped?: string[];
  records?: GamesRow[]; gender: string; genderFrom?: string; genderSetByHand?: boolean;
}
interface TeamView { team: string; all?: boolean; athletes: Athlete[]; logo?: string; error?: string; division?: string; gamesRead?: number; divisions?: string[] }
interface TeamsAnswer { photos: Photo[]; current: string[]; currentDivision?: string; teams: TeamRef[]; folder: string; error?: string; competition: string }
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string | null) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
const errText = (err: unknown) => err instanceof Error ? err.message : String(err);
const key = (s: string) => String(s || '').toLowerCase().replace(/['’`]/g, '').split(/[^a-z0-9]+/).filter(Boolean).sort().join(' ');
const fileKey = (f: string) => key(f.replace(/\.[a-z0-9]+$/i, ''));
let allTeams: TeamRef[] = [];
let photos: Photo[] = [], team: TeamView | null = null, current: string[] = [], currentDivision = '', fresh = new Set<string>(); // fresh: just dropped in, matching nobody on the team shown

async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, { cache: 'no-store', ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data.error && !data.teams && !data.athletes)) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// Makes a photo at most 1000 px on its longest side before saving it. PNG, WebP and GIF stay PNG
// (keeps a transparent background); JPEG stays JPEG. SVG is saved as it is.
async function shrink(file: File): Promise<{ blob: Blob; ext: string }> {
  if (/svg/.test(file.type)) return { blob: file, ext: 'svg' };
  const png = !/jpe?g/.test(file.type);
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d')?.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>(r => c.toBlob(r, png ? 'image/png' : 'image/jpeg', 0.9));
    if (blob && (scale < 1 || blob.size < file.size)) return { blob, ext: png ? 'png' : 'jpg' };
  } catch (err) { console.warn(`Could not resize ${file.name}:`, errText(err)); }
  return { blob: file, ext: (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || 'jpg').toLowerCase() };
}

async function upload(file: File, athlete?: string) {
  const { blob, ext } = await shrink(file);
  const q = athlete ? `athlete=${encodeURIComponent(athlete)}&ext=${ext}` : `file=${encodeURIComponent(file.name.replace(/\.[a-z0-9]+$/i, '') + '.' + ext)}`;
  return api<{ name: string }>(`/api/athletes/photo?${q}`, { method: 'POST', body: blob });
}

function teamButton(t: TeamRef) {
  const b = el('button');
  b.type = 'button';
  if (t.logo) { const i = el('img'); i.src = t.logo; i.alt = ''; b.appendChild(i); }
  b.appendChild(document.createTextNode(t.name));
  if (current.includes(t.name) && (!currentDivision || t.division === currentDivision)) b.appendChild(el('span', 'live', 'On now'));
  b.onclick = () => openTeam(t.name, t.division || '');
  // A club can have a team of the same name in more than one division, so the division is part of it.
  b.dataset.team = teamId(t.name, t.division);
  return b;
}

const teamId = (name: string, division?: string) => `${division || ''}|${name}`;

async function loadTeams() {
  try {
    const d = await api<TeamsAnswer>('/api/athletes');
    photos = d.photos; current = d.current; currentDivision = d.currentDivision || ''; allTeams = d.teams;
    $('folder').textContent = d.folder;
    const box = $('teams');
    box.replaceChildren();
    if (!d.teams.length) box.appendChild(el('span', 'help error', d.error || 'No teams found on PlayHQ for this competition.'));
    const all = teamButton({ name: 'All athletes' });
    all.onclick = () => openAll();
    all.dataset.team = '*';
    box.appendChild(all);
    let division: string | undefined;
    for (const t of d.teams) {
      if (t.division !== division) { division = t.division; const h = el('div', 'help', division || ''); h.style.flexBasis = '100%'; h.style.fontWeight = '700'; box.appendChild(h); }
      box.appendChild(teamButton(t));
    }
    $('teamsNote').textContent = `${d.competition}${current.length ? ` · On Scoreboard control now: ${current.join(' v ')}` : ''}`;
    renderLibrary();
    const qs = new URLSearchParams(location.search);
    const want = qs.get('team') || current[0];
    const wantDivision = qs.get('team') ? qs.get('division') : currentDivision;
    // A link without a division opens the team's first division.
    const pick = want && d.teams.find(t => t.name === want && (!wantDivision || t.division === wantDivision)) || d.teams.find(t => t.name === want);
    if (want === '*') openAll(); else if (want) openTeam(want, (pick ? pick.division : wantDivision) || '');
  } catch (err) {
    console.warn('Athletes page: teams unavailable:', errText(err));
    $('teams').replaceChildren(el('span', 'help error', `Couldn't load the teams: ${errText(err)}`));
  }
}

// Every athlete seen in the competition, once each, whatever divisions and teams they play in.
async function openAll() {
  for (const b of document.querySelectorAll<HTMLButtonElement>('.teams button')) b.setAttribute('aria-pressed', String(b.dataset.team === '*'));
  $('teamBox').hidden = false;
  $('teamName').textContent = 'All athletes';
  $('teamLogo').replaceChildren();
  $<HTMLInputElement>('search').hidden = false;
  $('athletes').replaceChildren();
  history.replaceState(null, '', '?team=*');
  try {
    const d = await api<{ athletes: Athlete[] }>('/api/athletes?all=1');
    team = { team: 'All athletes', all: true, athletes: d.athletes };
    const multi = d.athletes.filter(a => new Set((a.teams || []).map(t => t.division)).size > 1).length;
    $('teamInfo').textContent = `${d.athletes.length} athletes seen in line ups so far, ${multi} of them in more than one division. ` +
      'Each athlete has one photo, used in every division and team they play for. Open a team to read its line ups from PlayHQ.';
    $('teamInfo').className = 'help';
    renderAthletes();
    renderLibrary();
  } catch (err) {
    $('teamInfo').textContent = `Couldn't list the athletes: ${errText(err)}`;
    $('teamInfo').className = 'help error';
  }
}

// The team asked for last: an answer for one asked before it is dropped.
let teamAsked = '';
async function openTeam(name: string, division: string) {
  for (const b of document.querySelectorAll<HTMLButtonElement>('.teams button')) b.setAttribute('aria-pressed', String(b.dataset.team === teamId(name, division)));
  $('teamBox').hidden = false;
  $<HTMLInputElement>('search').hidden = true;
  $('teamName').textContent = name;
  $('teamInfo').textContent = 'Reading line ups from PlayHQ…';
  $('athletes').replaceChildren();
  const query = `team=${encodeURIComponent(name)}${division ? `&division=${encodeURIComponent(division)}` : ''}`;
  history.replaceState(null, '', '?' + query);
  const asked = teamAsked = query;
  try {
    const d = await api<TeamView>(`/api/athletes?${query}`);
    if (teamAsked !== asked) return; // another team was picked meanwhile
    team = d;
    const logo = $('teamLogo');
    logo.replaceChildren();
    if (team.logo) { const i = el('img'); i.src = team.logo; i.alt = ''; logo.appendChild(i); }
    const have = team.athletes.filter(a => a.photo).length;
    $('teamInfo').textContent = team.error ? team.error :
      `${team.division} · ${team.athletes.length} athletes from ${team.gamesRead} line up${team.gamesRead === 1 ? '' : 's'} · ${have} with a photo`;
    $('teamInfo').className = team.error ? 'help error' : 'help';
    renderAthletes();
    renderLibrary();
  } catch (err) {
    console.warn(`Athletes page: ${name} unavailable:`, errText(err));
    $('teamInfo').textContent = `Couldn't read ${name}'s line ups: ${errText(err)}`;
    $('teamInfo').className = 'help error';
  }
}

function photoOf(name: string) {
  const hit = photos.find(p => fileKey(p.file) === key(name));
  return hit ? hit.url + '?v=' + (hit.v || '') : null;
}

function renderAthletes() {
  const box = $('athletes');
  if (!team) return;
  const shown = team;
  box.replaceChildren();
  const find = team.all ? key($<HTMLInputElement>('search').value) : '';
  for (const a of team.athletes) {
    if (find && !find.split(' ').every(w => key(a.name).split(' ').some(n => n.startsWith(w)))) continue;
    const card = el('div', 'ath');
    const ph = el('div', 'ath__photo');
    const src = photoOf(a.name);
    // No photo: the generic silhouette for the athlete's gender.
    const i = el('img'); i.src = src || a.silhouette; i.alt = src ? a.name : ''; ph.appendChild(i);
    if (!src) card.classList.add('missing');
    if (src && !a.photoOk) card.classList.add('unapproved');
    if (a.position) ph.appendChild(el('span', 'ath__pos', a.position));
    card.appendChild(ph);
    const body = el('div', 'ath__body');
    body.appendChild(el('div', 'ath__name', a.name + (a.captain ? ' (C)' : '')));
    if (!team.all) body.appendChild(el('div', 'ath__meta', [a.number !== '' ? `#${a.number}` : '', a.positions.length ? a.positions.join(', ') : 'Position unknown', `${a.games} line up${a.games === 1 ? '' : 's'} this season`].filter(Boolean).join(' · ')));
    // Other teams and divisions: the same athlete and the same photo.
    const others = (a.teams || []).filter(t => shown.all || t.team !== shown.team || t.division !== shown.division);
    if (others.length) body.appendChild(el('div', 'ath__teams', (shown.all ? '' : 'Also plays for ') + others.map(t => `${t.team} (${t.division})`).join(', ')));
    body.appendChild(statsLine(a));
    body.appendChild(genderPicker(a));
    body.appendChild(approvalTick(a));
    const buttons = el('div', 'ath__buttons');
    const edit = el('button', 'small alt', 'Games');
    edit.title = 'Games and positions played';
    edit.onclick = () => editStats(a);
    const add = el('label', 'btn small' + (src ? ' alt' : ''), src ? 'Change' : 'Add photo');
    const input = el('input'); input.type = 'file'; input.accept = 'image/*';
    input.onchange = () => { const f = input.files?.[0]; if (f) setPhoto(a.name, f); };
    add.appendChild(input);
    buttons.appendChild(add);
    buttons.appendChild(edit);
    if (src) {
      const rm = el('button', 'small danger', 'Remove');
      rm.onclick = () => { const p = photos.find(p => fileKey(p.file) === key(a.name)); if (p) removePhoto(p.file); };
      buttons.appendChild(rm);
    }
    body.appendChild(buttons);
    card.appendChild(body);
    // Drop a photo straight onto an athlete.
    card.ondragover = e => { e.preventDefault(); card.classList.add('over'); };
    card.ondragleave = () => card.classList.remove('over');
    card.ondrop = e => { e.preventDefault(); e.stopPropagation(); card.classList.remove('over'); const f = e.dataTransfer?.files[0]; if (f) setPhoto(a.name, f); };
    box.appendChild(card);
  }
  if (!team.athletes.length) box.appendChild(el('p', 'fp-empty', 'No athletes yet. PlayHQ lists athletes once a line up has been entered for one of the team\'s games.'));
}

// Whether the athlete has approved their photo's use: without it graphics show the silhouette.
function approvalTick(a: Athlete) {
  const l = el('label', 'ath__ok');
  const c = el('input'); c.type = 'checkbox'; c.checked = !!a.photoOk;
  c.onchange = () => approve([a.name], c.checked);
  l.append(c, 'Approved for photo use');
  l.title = 'Tick once the athlete (or their parent or guardian) has agreed to their photo being used on the stream and social media.';
  return l;
}
async function approve(names: string[], approved: boolean) {
  try {
    await api('/api/athletes/approval', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ athletes: names, approved }) });
    for (const a of team?.athletes || []) if (names.includes(a.name)) a.photoOk = approved;
  } catch (err) { tell("Couldn't save that", errText(err)); }
  renderAthletes();
}

// Games played per division and positions played, as on the graphics.
function statsLine(a: Athlete) {
  const box = el('div', 'ath__stats');
  const games = (a.career || []).map(c => `${c.division} ${c.total}`).join(' · ');
  if (games) { box.appendChild(el('b', '', 'Games: ')); box.appendChild(document.createTextNode(games)); box.appendChild(el('br')); }
  if ((a.positionsPlayed || []).length) { box.appendChild(el('b', '', 'Played: ')); box.appendChild(document.createTextNode((a.positionsPlayed || []).join(', '))); }
  return box;
}

const fmtDate = (d: string) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const POSITIONS = ['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK'];

// Edits an athlete's games played (per division, optionally per club, as of a date) and positions played.
function editStats(a: Athlete) {
  const dlg = $<HTMLDialogElement>('statsDialog');
  $('statsName').textContent = a.name;
  const typed = new Set(a.positionsTyped || []);
  const seen = new Set((a.positionsPlayed || []).filter(p => !typed.has(p)));
  const pos = $('statsPositions');
  pos.replaceChildren();
  for (const p of POSITIONS) {
    const l = el('label', seen.has(p) ? 'seen' : '');
    const c = el('input'); c.type = 'checkbox'; c.value = p; c.checked = typed.has(p) || seen.has(p); c.disabled = seen.has(p);
    if (seen.has(p)) l.title = 'In a PlayHQ line up this season';
    l.append(c, p);
    pos.appendChild(l);
  }
  const divisions = [...new Set([...allTeams.map(t => t.division), ...(a.career || []).map(c => c.division), ...(team?.divisions || [])])].filter((d): d is string => !!d);
  const rows = $<HTMLTableSectionElement>('statsRows');
  rows.replaceChildren();
  const addRow = (r: GamesRow) => {
    const tr = el('tr');
    const div = el('select');
    divisions.forEach(d => div.appendChild(new Option(d, d)));
    if (r.division && !divisions.includes(r.division)) div.appendChild(new Option(r.division, r.division));
    div.value = r.division || (a.teams && a.teams[0] ? a.teams[0].division : divisions[0] || '');
    const club = el('select');
    const fillClubs = () => {
      const keep = club.value || r.club || '';
      club.replaceChildren(new Option('All clubs', ''));
      allTeams.filter(t => t.division === div.value).forEach(t => club.appendChild(new Option(t.name, t.name)));
      if (keep && ![...club.options].some(o => o.value === keep)) club.appendChild(new Option(keep, keep));
      club.value = keep;
    };
    div.onchange = () => { club.value = ''; fillClubs(); };
    fillClubs();
    const games = el('input'); games.type = 'number'; games.min = '0'; games.value = r.games != null ? String(r.games) : '';
    const asOf = el('input'); asOf.type = 'date'; asOf.value = r.asOf || '';
    const rm = el('button', 'small danger', '×'); rm.type = 'button'; rm.onclick = () => tr.remove();
    for (const x of [div, club, games, asOf, rm]) { const td = el('td'); td.appendChild(x); tr.appendChild(td); }
    rows.appendChild(tr);
  };
  (a.records || []).forEach(addRow);
  $<HTMLButtonElement>('statsAdd').onclick = () => addRow({ asOf: new Date().toISOString().slice(0, 10) });
  const totals = $('statsTotals');
  totals.replaceChildren();
  for (const c of a.career || []) {
    const parts = c.lines.map(l => `${l.club ? l.club + ': ' : ''}${l.games}${l.asOf ? ` to ${fmtDate(l.asOf)} + ${l.since} since` : ''}`);
    totals.appendChild(el('div', '', `${c.division}: ${c.total} games` + (parts.length ? ` (${parts.join('; ')})` : ` (${c.season} this season on PlayHQ)`)));
  }
  if (!totals.childNodes.length) totals.textContent = 'No games yet.';
  $('statsError').textContent = '';
  $<HTMLButtonElement>('statsSave').onclick = saveStats = async () => {
    const { records, positions } = statsInDialog();
    try {
      const d = await api<Pick<Athlete, 'career' | 'positionsPlayed' | 'positionsTyped' | 'records'>>('/api/athletes/stats', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ athlete: a.name, records, positions }) });
      Object.assign(a, { career: d.career, positionsPlayed: d.positionsPlayed, positionsTyped: d.positionsTyped, records: d.records });
      dlg.close();
      renderAthletes();
    } catch (err) { $('statsError').textContent = errText(err); }
  };
  dlg.showModal();
  statsGuard.opened();
}
// Saves the games dialog's athlete (set as it opens).
let saveStats = async () => {};
// What the games dialog holds now.
function statsInDialog() {
  const records = [...$<HTMLTableSectionElement>('statsRows').children].map(tr => {
    const [div, club, games, asOf] = tr.querySelectorAll<HTMLSelectElement | HTMLInputElement>('select, input');
    return { division: div.value, club: club.value, games: games.value, asOf: asOf.value };
  }).filter(r => r.games !== '');
  const positions = [...$('statsPositions').querySelectorAll<HTMLInputElement>('input:checked:not(:disabled)')].map(c => c.value);
  return { records, positions };
}
// Escape or leaving the page with changes not saved asks first (unsaved.js).
const statsGuard = unsavedDialog($<HTMLDialogElement>('statsDialog'), {
  what: () => `${$('statsName').textContent}'s games`, snapshot: statsInDialog,
  save: async () => { await saveStats(); return !$<HTMLDialogElement>('statsDialog').open; },
});

// Which silhouette an athlete without a photo gets: PlayHQ's gender, or one picked here.
function genderPicker(a: Athlete) {
  const sel = el('select', 'ath__gender');
  // Unless picked here: PlayHQ's gender for the athlete, else that of a men's or women's division they play in.
  const fromPlayhq = a.genderSetByHand ? '' : a.gender;
  const source = a.genderFrom === 'division' ? 'PlayHQ division' : 'PlayHQ';
  sel.appendChild(new Option(`${fromPlayhq ? (fromPlayhq === 'female' ? 'Female' : 'Male') : 'Not known'} (${source})`, ''));
  sel.appendChild(new Option('Female', 'female'));
  sel.appendChild(new Option('Male', 'male'));
  sel.value = a.genderSetByHand ? a.gender : '';
  sel.title = 'Used when there is no photo';
  sel.onchange = async () => {
    try {
      const d = await api<Pick<Athlete, 'gender' | 'genderFrom' | 'genderSetByHand' | 'silhouette'>>('/api/athletes/gender', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ athlete: a.name, gender: sel.value }) });
      Object.assign(a, { gender: d.gender, genderFrom: d.genderFrom, genderSetByHand: d.genderSetByHand, silhouette: d.silhouette });
      renderAthletes();
    } catch (err) { tell("Studio couldn't do that", errText(err)); }
  };
  const wrap = el('label', 'ath__meta', 'Silhouette ');
  wrap.appendChild(sel);
  return wrap;
}

function renderLibrary() {
  const box = $('library');
  box.replaceChildren();
  const names = team ? team.athletes.map(a => a.name) : [];
  const known = new Set(names.map(key));
  // Photos just dropped in that matched nobody come first, so they can be given to an athlete.
  for (const p of [...photos].sort((a, b) => Number(fresh.has(b.file)) - Number(fresh.has(a.file)))) {
    const mine = known.has(fileKey(p.file));
    const card = el('div', 'pic' + (fresh.has(p.file) && !mine ? ' unmatched' : ''));
    const i = el('img'); i.src = p.url + '?v=' + (p.v || ''); i.alt = ''; card.appendChild(i);
    card.appendChild(el('div', '', p.file));
    if (team && mine) card.appendChild(el('span', 'tag', `${team.team} athlete`));
    else if (fresh.has(p.file)) card.appendChild(el('span', 'tag', `Just added: not a ${team ? team.team : ''} athlete's name`));
    if (team && !mine && names.length) {
      const sel = el('select');
      sel.appendChild(new Option(`Give to a ${team.team} athlete…`, ''));
      names.forEach(n => sel.appendChild(new Option(n, n)));
      sel.onchange = () => { if (sel.value) assign(p.file, sel.value); };
      card.appendChild(sel);
    }
    const rm = el('button', 'small danger', 'Remove');
    rm.onclick = () => removePhoto(p.file);
    card.appendChild(rm);
    box.appendChild(card);
  }
  $('libraryNote').textContent = photos.length
    ? `${photos.length} photo${photos.length === 1 ? '' : 's'} saved for this competition. Each one is matched to the athlete with the same name in any team.`
    : 'No photos yet.';
}

async function refreshPhotos() {
  const d = await api<{ photos: Photo[] }>('/api/athletes?photos=only').catch(() => null);
  if (d) photos = d.photos.map(p => ({ ...p, v: Date.now() }));
  if (team) renderAthletes();
  renderLibrary();
}

async function setPhoto(name: string, file: File) {
  try { await upload(file, name); }
  catch (err) { tell(`Couldn't save the photo for ${name}`, errText(err)); console.warn('Athlete photo upload failed:', errText(err)); }
  refreshPhotos();
}

async function removePhoto(file: string) {
  if (!await askConfirm(`Remove ${file}?`, "This deletes it from the competition's photos folder.", { ok: 'Remove', danger: true })) return;
  try { await api(`/api/athletes/photo?file=${encodeURIComponent(file)}`, { method: 'DELETE' }); }
  catch (err) { tell("Studio couldn't do that", errText(err)); }
  refreshPhotos();
}

async function assign(file: string, athlete: string) {
  try { await api('/api/athletes/rename', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file, athlete }) }); }
  catch (err) { tell("Studio couldn't do that", errText(err)); }
  refreshPhotos();
}

async function bulk(files: File[]) {
  const names = team ? team.athletes.map(a => a.name) : [];
  let matched = 0, other = 0;
  const failed: string[] = [];
  for (const f of files) {
    try {
      const saved = await upload(f);
      if (names.some(n => key(n) === fileKey(saved.name))) matched++; else { other++; fresh.add(saved.name); }
    } catch (err) { failed.push(`${f.name} (${errText(err)})`); }
  }
  $('bulkNote').textContent = [`${matched} matched ${team ? team.team + ' athletes' : 'athletes'}.`,
    other ? `${other} didn't match a ${team ? team.team : ''} athlete: give them to an athlete in the photo library below.` : '',
    failed.length ? `Not saved: ${failed.join(', ')}.` : ''].filter(Boolean).join(' ');
  $('bulkNote').className = failed.length ? 'help error' : 'help';
  if (failed.length) console.warn('Athlete photos not saved:', failed.join(', '));
  refreshPhotos();
}

const drop = $('bulk');
drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); bulk([...e.dataTransfer?.files || []].filter(f => /^image\//.test(f.type))); };
$<HTMLInputElement>('bulkFile').onchange = () => bulk([...$<HTMLInputElement>('bulkFile').files || []]);
$<HTMLInputElement>('otherFile').onchange = () => {
  const input = $<HTMLInputElement>('otherFile'), name = $<HTMLInputElement>('otherName').value.trim(), file = input.files?.[0];
  if (!name) { tell('Type the athlete\'s name first.'); input.value = ''; return; }
  if (file) setPhoto(name, file).then(() => { $<HTMLInputElement>('otherName').value = ''; input.value = ''; });
};
// Dropping a photo anywhere else shouldn't open it in the browser.
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => e.preventDefault());
$<HTMLInputElement>('search').oninput = () => renderAthletes();
$<HTMLButtonElement>('approveAll').onclick = () => { if (team) approve(team.athletes.map(a => a.name), true); };
$<HTMLButtonElement>('unapproveAll').onclick = async () => {
  const shown = team;
  if (shown && await askChoice('Take approval away from every athlete listed?',
    'Their photos come off the stream and the Socials pictures until approved again.', [{ label: 'Cancel', value: '', alt: true }, { label: 'Approve none', value: 'none' }]) === 'none') approve(shown.athletes.map(a => a.name), false);
};
loadTeams();

// What makes this file a module (its names its own), as the first line says.
export {};
