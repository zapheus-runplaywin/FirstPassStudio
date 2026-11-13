// FirstPass Studio - the Output page, part 7 of 16: Music: the player, playlists and fades.
// The page's script is split by section into public/output/, loaded in order by output.html; the files share one
// scope (plain scripts), so a name defined in an earlier part is in reach of a later one.

// ─── Music ─────────────────────────────────────────────────────────────
// The player Studio keeps (music.ts): what's loaded, the buttons, the songs in the media folder, and the playlists.
const tracks = () => media.filter(m => m.kind === 'audio' && !m.converting).map(m => m.name);
const songName = (f: unknown) => String(f || '').replace(/\.[^.]+$/, '');
const playlistsOf = () => scene.playlists || [];
let musicHeard = 0;
const musicPos = (m: MusicState) => m.status === 'playing' ? m.pos.sec + (Date.now() - m.pos.at) / 1000 : m.pos.sec;
function renderMusic() {
  const m = scene.music;
  if (!m) return;
  const owner = m.owner === 'supershot' ? { name: 'the super shot period' } : m.owner ? sequences().find(s => s.id === m.owner) : undefined;
  const pl = m.playlist && playlistsOf().find(x => x.id === m.playlist);
  $('player').classList.toggle('on', m.status === 'playing');
  $('mTrack').textContent = m.track ? songName(m.track) : 'Nothing loaded';
  $('mWhere').textContent = [pl ? `${pl.name}, ${m.index + 1} of ${m.queue.length}` : '', owner ? (m.owner === 'supershot' ? `for ${owner.name}` : `for "${owner.name}"`) : '',
    m.video === 'pause' ? 'paused while a video plays its sound' : '',
    m.status === 'paused' && !m.video ? 'paused' : m.status === 'stopped' && m.track ? 'stopped' : ''].filter(Boolean).join(' · ');
  const playing = m.status === 'playing' && m.after !== 'pause' && m.after !== 'stop';
  $<HTMLButtonElement>('mPlay').textContent = playing ? '⏸ Pause' : m.status === 'paused' ? '▶ Carry on' : '▶ Play';
  $<HTMLButtonElement>('mPlay').disabled = !m.track;
  $<HTMLButtonElement>('mStop').disabled = m.status === 'stopped';
  $<HTMLButtonElement>('mPrev').disabled = $<HTMLButtonElement>('mNext').disabled = m.queue.length < 2;
  $<HTMLButtonElement>('mMute').classList.toggle('lit', m.muted);
  $<HTMLButtonElement>('mMute').textContent = m.muted ? 'Muted' : 'Mute';
  $<HTMLButtonElement>('mDuck').classList.toggle('lit', m.ducked);
  $<HTMLButtonElement>('mDuck').textContent = m.ducked ? 'Ducked' : 'Duck';
  if (document.activeElement !== $<HTMLInputElement>('mVolume')) $<HTMLInputElement>('mVolume').value = String(m.volume);
  const set: Partial<MusicSettings> = scene.musicSettings || {};
  for (const [id, key] of [['mFadeIn', 'fadeInSec'], ['mFadeOut', 'fadeOutSec'], ['mQuick', 'quickSec'], ['mDuckTo', 'duckTo']] as const) if (document.activeElement !== $(id)) $<HTMLInputElement>(id).value = String(set[key] ?? '');
  if (Date.now() - mxTicked > 1500) $<HTMLInputElement>('dkMusicVideo').checked = set.underVideo !== 'leave'; // as the mics' ticks (mics.ts)
  if (typeof renderDuck === 'function') renderDuck();
  const trackSel = $<HTMLSelectElement>('mTrackPick'), keep = trackSel.value;
  trackSel.innerHTML = '';
  if (!tracks().length) trackSel.add(new Option('No songs yet: add one', ''));
  for (const f of tracks()) trackSel.add(new Option(songName(f), f, false, f === keep));
  if (document.activeElement !== $<HTMLSelectElement>('mSuperSong')) {
    const ss = $<HTMLSelectElement>('mSuperSong');
    ss.innerHTML = '';
    ss.add(new Option('None', ''));
    for (const f of tracks()) ss.add(new Option(songName(f), f));
    if (set.superShotSong && !tracks().includes(set.superShotSong)) ss.add(new Option(`${songName(set.superShotSong)} (missing)`, set.superShotSong));
    ss.value = set.superShotSong || '';
  }
  if (document.activeElement !== $<HTMLInputElement>('mSuperVolume')) $<HTMLInputElement>('mSuperVolume').value = String(set.superShotVolume ?? 80);
  const busy = media.filter(x => x.kind === 'audio' && x.converting).map(x => x.name);
  $('mNote').textContent = busy.length ? `Evening out the loudness of ${busy.map(songName).join(', ')}…` : '';
  renderPlaylists();
  musicHeard = performance.now();
  tickMusic();
}
function tickMusic() {
  const m = scene.music;
  if (!m) return;
  const pos = m.track && m.status !== 'stopped' ? musicPos(m) : 0;
  const len = m.length || (m.track ? durationOf(m.track) : 0);
  $('mTime').textContent = m.track ? `${fmt(pos * 1000)}${len ? ` / ${fmt(len * 1000)}` : ''}` : '';
  $('mBar').style.width = len ? `${Math.min(100, pos / len * 100)}%` : '0';
}
setInterval(tickMusic, 500);
$<HTMLButtonElement>('mPlay').onclick = () => act({ type: 'musicToggle' });
$<HTMLButtonElement>('mStop').onclick = () => act({ type: 'musicStop' });
$<HTMLButtonElement>('mPrev').onclick = () => act({ type: 'musicPrev' });
$<HTMLButtonElement>('mNext').onclick = () => act({ type: 'musicNext' });
$<HTMLButtonElement>('mMute').onclick = () => act({ type: 'musicMute', value: 'toggle' });
$<HTMLButtonElement>('mDuck').onclick = () => act({ type: 'musicDuck', value: 'toggle' });
$<HTMLInputElement>('mVolume').onchange = () => act({ type: 'musicVolume', value: Number($<HTMLInputElement>('mVolume').value) });
$<HTMLButtonElement>('mLoad').onclick = () => { if ($<HTMLSelectElement>('mTrackPick').value) act({ type: 'musicLoad', track: $<HTMLSelectElement>('mTrackPick').value }); };
$<HTMLButtonElement>('mLoadPlay').onclick = () => { if ($<HTMLSelectElement>('mTrackPick').value) act({ type: 'musicLoad', track: $<HTMLSelectElement>('mTrackPick').value, play: true }); };
// The music's own settings, and its column of the Ducking card (under a video it pauses, or is left: dkMusicVideo; Duck to).
const musicSettings = () => act({ type: 'musicSettings', settings: { fadeInSec: Number($<HTMLInputElement>('mFadeIn').value), fadeOutSec: Number($<HTMLInputElement>('mFadeOut').value), quickSec: Number($<HTMLInputElement>('mQuick').value),
  underVideo: $<HTMLInputElement>('dkMusicVideo').checked ? 'pause' : 'leave', duckTo: Number($<HTMLInputElement>('mDuckTo').value),
  superShotSong: $<HTMLSelectElement>('mSuperSong').value, superShotVolume: Number($<HTMLInputElement>('mSuperVolume').value) } });
for (const id of ['mFadeIn', 'mFadeOut', 'mQuick', 'mDuckTo', 'mSuperSong', 'mSuperVolume']) $(id).onchange = musicSettings;
$<HTMLInputElement>('dkMusicVideo').onchange = () => { mxTicked = Date.now(); musicSettings(); };
$<HTMLInputElement>('mUpload').onchange = async () => {
  const file = $<HTMLInputElement>('mUpload').files?.[0];
  if (!file) return;
  $('mNote').textContent = `Adding ${file.name}…`;
  try {
    const res = await fetch(`/api/scene/media?name=${encodeURIComponent(file.name)}&level=${$<HTMLInputElement>('mLevel').checked ? 1 : 0}`, { method: 'POST', body: file });
    const body: { error?: string; file?: string } = await res.json();
    if (!res.ok) throw new Error(body.error || res.statusText);
    await loadMedia();
    $<HTMLSelectElement>('mTrackPick').value = body.file || '';
    renderMusic();
  } catch (err) { $('mNote').textContent = `Could not add ${file.name}: ${err instanceof Error ? err.message : String(err)}`; }
  $<HTMLInputElement>('mUpload').value = '';
};

function renderPlaylists() {
  const box = $('playlists'), m = scene.music;
  box.innerHTML = '';
  for (const pl of playlistsOf()) {
    const card = document.createElement('div');
    const on = m && m.playlist === pl.id && m.status !== 'stopped';
    card.className = 'seq' + (on ? ' run' : '');
    card.innerHTML = '<div class="t"><b></b></div><small></small><div class="row"><button class="play">▶ Play</button><button class="alt load">Load</button><button class="alt edit">Edit</button></div>';
    pick(card, 'b').textContent = pl.name;
    const lens = pl.tracks.map(durationOf);
    const runs = lens.reduce((a, b) => a + b, 0);
    pick(card, 'small').textContent = `${pl.tracks.length} song${pl.tracks.length === 1 ? '' : 's'}${runs ? ` · ${lens.includes(0) ? 'at least ' : ''}${fmt(runs * 1000)}` : ''}${pl.shuffle ? ' · shuffled' : ''}${pl.loop ? ' · starts again' : ''}`;
    pick<HTMLButtonElement>(card, '.play').onclick = () => act({ type: 'musicPlaylist', playlist: pl.id, play: true });
    pick<HTMLButtonElement>(card, '.play').disabled = pick<HTMLButtonElement>(card, '.load').disabled = !pl.tracks.length;
    pick<HTMLButtonElement>(card, '.load').onclick = () => act({ type: 'musicPlaylist', playlist: pl.id });
    pick<HTMLButtonElement>(card, '.edit').onclick = () => openPlaylist(pl);
    box.appendChild(card);
  }
  const add = document.createElement('button');
  add.className = 'seq addSeq';
  add.innerHTML = '+ New playlist<small>songs played one after another</small>';
  add.onclick = () => openPlaylist(null);
  box.appendChild(add);
}
// The playlist being edited, or a new one (no id yet).
let plDraft: (Omit<Playlist, 'id'> & { id?: string }) | null = null;
function openPlaylist(pl: Playlist | null) {
  const d = plDraft = pl ? structuredClone(pl) : { name: '', tracks: [], shuffle: false, loop: true };
  $('plTitle').textContent = pl ? 'Edit playlist' : 'New playlist';
  $<HTMLInputElement>('plName').value = d.name;
  $<HTMLInputElement>('plShuffle').checked = d.shuffle;
  $<HTMLInputElement>('plLoop').checked = d.loop;
  $<HTMLButtonElement>('plDelete').classList.toggle('hidden', !pl);
  $('plErr').textContent = '';
  loadMedia().then(renderPlTracks);
  renderPlTracks();
  if (!$<HTMLDialogElement>('plDialog').open) $<HTMLDialogElement>('plDialog').showModal();
  plGuard.opened();
}
function renderPlTracks() {
  const d = plDraft;
  if (!d) return;
  const box = $('plTracks');
  box.innerHTML = '';
  // Each song's length and the running total up to the end of it (in this order; shuffled, it's the total that counts).
  let total = 0, unknown = 0;
  d.tracks.forEach((f, i) => {
    const row = document.createElement('div');
    row.className = 'stepRow';
    row.innerHTML = '<span class="num"></span><div class="what"></div><div class="len"><span class="hint"></span><button class="alt up" title="Earlier">↑</button><button class="alt down" title="Later">↓</button><button class="danger del" title="Take it out">✕</button></div>';
    pick(row, '.num').textContent = String(i + 1);
    pick(row, '.what').textContent = songName(f) + (tracks().includes(f) ? '' : ' (missing)');
    const len = durationOf(f);
    if (len) total += len; else unknown++;
    pick(row, '.hint').textContent = len ? `${fmt(len * 1000)} · ${unknown ? 'at least ' : ''}${fmt(total * 1000)} in` : 'length not known yet';
    pick<HTMLButtonElement>(row, '.up').disabled = i === 0;
    pick<HTMLButtonElement>(row, '.down').disabled = i === d.tracks.length - 1;
    pick<HTMLButtonElement>(row, '.up').onclick = () => { d.tracks.splice(i - 1, 0, d.tracks.splice(i, 1)[0]); renderPlTracks(); };
    pick<HTMLButtonElement>(row, '.down').onclick = () => { d.tracks.splice(i + 1, 0, d.tracks.splice(i, 1)[0]); renderPlTracks(); };
    pick<HTMLButtonElement>(row, '.del').onclick = () => { d.tracks.splice(i, 1); renderPlTracks(); };
    box.appendChild(row);
  });
  $('plTotal').textContent = d.tracks.length ? `Runs ${unknown ? 'at least ' : ''}${fmt(total * 1000)} · ${d.tracks.length} song${d.tracks.length === 1 ? '' : 's'}` : '';
  const sel = $<HTMLSelectElement>('plAdd');
  sel.innerHTML = '';
  sel.add(new Option(tracks().length ? '+ Add a song' : 'No songs yet: add them in Music first', ''));
  for (const f of tracks()) sel.add(new Option(songName(f), f));
}
$<HTMLSelectElement>('plAdd').onchange = () => { if (plDraft && $<HTMLSelectElement>('plAdd').value) { plDraft.tracks.push($<HTMLSelectElement>('plAdd').value); renderPlTracks(); } };
$<HTMLButtonElement>('plCancel').onclick = () => { $<HTMLDialogElement>('plDialog').close(); };
$<HTMLDialogElement>('plDialog').addEventListener('close', () => { plDraft = null; });
const plGuard = unsavedDialog($<HTMLDialogElement>('plDialog'), {
  what: () => $<HTMLInputElement>('plName').value.trim() || 'the new playlist',
  snapshot: () => ({ name: $<HTMLInputElement>('plName').value.trim(), shuffle: $<HTMLInputElement>('plShuffle').checked, loop: $<HTMLInputElement>('plLoop').checked, tracks: plDraft?.tracks }),
  save: async () => { await savePlaylist(); return !$<HTMLDialogElement>('plDialog').open; },
});
async function savePlaylist() {
  const d = plDraft;
  if (!d) return;
  const changes = { name: $<HTMLInputElement>('plName').value.trim(), shuffle: $<HTMLInputElement>('plShuffle').checked, loop: $<HTMLInputElement>('plLoop').checked, tracks: d.tracks };
  if (!changes.name) { $('plErr').textContent = 'Give the playlist a name.'; return; }
  const body = d.id ? await act({ type: 'playlistUpdate', playlist: d.id, changes }) : await act({ type: 'playlistAdd', changes });
  if (!body) { $('plErr').textContent = $('err').textContent; return; }
  $<HTMLDialogElement>('plDialog').close();
}
$<HTMLButtonElement>('plSave').onclick = savePlaylist;
$<HTMLButtonElement>('plDelete').onclick = async () => {
  if (!plDraft?.id || !await askConfirm(`Delete the playlist "${plDraft.name}"?`, 'The songs stay in the media folder.', { ok: 'Delete', danger: true })) return;
  if (await act({ type: 'playlistRemove', playlist: plDraft.id })) $<HTMLDialogElement>('plDialog').close();
};
