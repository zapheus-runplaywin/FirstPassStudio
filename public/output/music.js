// FirstPass Studio - the Output page, part 6 of 15: Music: the player, playlists and fades.
// The page's script is split by section into public/output/, loaded in order by output.html; the files share one
// scope (plain scripts), so a name defined in an earlier part is in reach of a later one.

// ─── Music ─────────────────────────────────────────────────────────────
// The player Studio keeps (music.js): what's loaded, the buttons, the songs in the media folder, and the playlists.
const tracks = () => media.filter(m => m.kind === 'audio' && !m.converting).map(m => m.name);
const songName = f => String(f || '').replace(/\.[^.]+$/, '');
const playlistsOf = () => scene.playlists || [];
let musicHeard = 0;
const musicPos = m => m.status === 'playing' ? m.pos.sec + (Date.now() - m.pos.at) / 1000 : m.pos.sec;
function renderMusic() {
  const m = scene.music;
  if (!m) return;
  const owner = m.owner === 'supershot' ? { name: 'the super shot period' } : m.owner && sequences().find(s => s.id === m.owner);
  const pl = m.playlist && playlistsOf().find(x => x.id === m.playlist);
  $('player').classList.toggle('on', m.status === 'playing');
  $('mTrack').textContent = m.track ? songName(m.track) : 'Nothing loaded';
  $('mWhere').textContent = [pl ? `${pl.name}, ${m.index + 1} of ${m.queue.length}` : '', owner ? (m.owner === 'supershot' ? `for ${owner.name}` : `for "${owner.name}"`) : '',
    m.video === 'pause' ? 'paused while a video plays its sound' : m.video === 'lower' ? 'lowered while a video plays its sound' : '',
    m.status === 'paused' && !m.video ? 'paused' : m.status === 'stopped' && m.track ? 'stopped' : ''].filter(Boolean).join(' · ');
  const playing = m.status === 'playing' && m.after !== 'pause' && m.after !== 'stop';
  $('mPlay').textContent = playing ? '⏸ Pause' : m.status === 'paused' ? '▶ Carry on' : '▶ Play';
  $('mPlay').disabled = !m.track;
  $('mStop').disabled = m.status === 'stopped';
  $('mPrev').disabled = $('mNext').disabled = m.queue.length < 2;
  $('mMute').classList.toggle('lit', m.muted);
  $('mMute').textContent = m.muted ? 'Muted' : 'Mute';
  $('mDuck').classList.toggle('lit', m.ducked);
  $('mDuck').textContent = m.ducked ? 'Ducked' : 'Duck';
  if (document.activeElement !== $('mVolume')) $('mVolume').value = m.volume;
  const set = scene.musicSettings || {};
  for (const [id, key] of [['mFadeIn', 'fadeInSec'], ['mFadeOut', 'fadeOutSec'], ['mLowerTo', 'lowerTo'], ['mDuckTo', 'duckTo']]) if (document.activeElement !== $(id)) $(id).value = set[key];
  $('mDuckHalf').checked = !!set.duckHalf;
  $('mUnder').value = set.underVideo || 'pause';
  document.querySelector('.mLowerTo').classList.toggle('hidden', $('mUnder').value !== 'lower');
  const pick = $('mTrackPick'), keep = pick.value;
  pick.innerHTML = '';
  if (!tracks().length) pick.add(new Option('No songs yet: add one', ''));
  for (const f of tracks()) pick.add(new Option(songName(f), f, false, f === keep));
  if (document.activeElement !== $('mSuperSong')) {
    const ss = $('mSuperSong');
    ss.innerHTML = '';
    ss.add(new Option('None', ''));
    for (const f of tracks()) ss.add(new Option(songName(f), f));
    if (set.superShotSong && !tracks().includes(set.superShotSong)) ss.add(new Option(`${songName(set.superShotSong)} (missing)`, set.superShotSong));
    ss.value = set.superShotSong || '';
  }
  if (document.activeElement !== $('mSuperVolume')) $('mSuperVolume').value = set.superShotVolume ?? 80;
  // Music plays on: shown once there's more than one output.
  const many = !!(out && out.outputs && out.outputs.length > 1);
  for (const el of document.querySelectorAll('.mOutsRow')) el.classList.toggle('hidden', !many);
  const ticks = JSON.stringify([set.outputs, (out?.outputs || []).map(o => [o.id, o.name, o.colour])]);
  if (many && $('mOuts').dataset.look !== ticks) {
    $('mOuts').dataset.look = ticks;
    outputTicks($('mOuts'), set.outputs, ids => act({ type: 'musicSettings', settings: { outputs: ids } }));
  }
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
$('mPlay').onclick = () => act({ type: 'musicToggle' });
$('mStop').onclick = () => act({ type: 'musicStop' });
$('mPrev').onclick = () => act({ type: 'musicPrev' });
$('mNext').onclick = () => act({ type: 'musicNext' });
$('mMute').onclick = () => act({ type: 'musicMute', value: 'toggle' });
$('mDuck').onclick = () => act({ type: 'musicDuck', value: 'toggle' });
$('mVolume').onchange = () => act({ type: 'musicVolume', value: Number($('mVolume').value) });
$('mLoad').onclick = () => { if ($('mTrackPick').value) act({ type: 'musicLoad', track: $('mTrackPick').value }); };
$('mLoadPlay').onclick = () => { if ($('mTrackPick').value) act({ type: 'musicLoad', track: $('mTrackPick').value, play: true }); };
const musicSettings = () => act({ type: 'musicSettings', settings: { fadeInSec: Number($('mFadeIn').value), fadeOutSec: Number($('mFadeOut').value), underVideo: $('mUnder').value, lowerTo: Number($('mLowerTo').value), duckTo: Number($('mDuckTo').value), duckHalf: $('mDuckHalf').checked,
  superShotSong: $('mSuperSong').value, superShotVolume: Number($('mSuperVolume').value) } });
for (const id of ['mFadeIn', 'mFadeOut', 'mUnder', 'mLowerTo', 'mDuckTo', 'mDuckHalf', 'mSuperSong', 'mSuperVolume']) $(id).onchange = musicSettings;
$('mUpload').onchange = async () => {
  const file = $('mUpload').files[0];
  if (!file) return;
  $('mNote').textContent = `Adding ${file.name}…`;
  try {
    const res = await fetch(`/api/scene/media?name=${encodeURIComponent(file.name)}&level=${$('mLevel').checked ? 1 : 0}`, { method: 'POST', body: file });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || res.statusText);
    await loadMedia();
    $('mTrackPick').value = body.file;
    renderMusic();
  } catch (err) { $('mNote').textContent = `Could not add ${file.name}: ${err.message}`; }
  $('mUpload').value = '';
};

function renderPlaylists() {
  const box = $('playlists'), m = scene.music;
  box.innerHTML = '';
  for (const pl of playlistsOf()) {
    const card = document.createElement('div');
    const on = m && m.playlist === pl.id && m.status !== 'stopped';
    card.className = 'seq' + (on ? ' run' : '');
    card.innerHTML = '<div class="t"><b></b></div><small></small><div class="row"><button class="play">▶ Play</button><button class="alt load">Load</button><button class="alt edit">Edit</button></div>';
    card.querySelector('b').textContent = pl.name;
    const lens = pl.tracks.map(durationOf);
    const runs = lens.reduce((a, b) => a + b, 0);
    card.querySelector('small').textContent = `${pl.tracks.length} song${pl.tracks.length === 1 ? '' : 's'}${runs ? ` · ${lens.includes(0) ? 'at least ' : ''}${fmt(runs * 1000)}` : ''}${pl.shuffle ? ' · shuffled' : ''}${pl.loop ? ' · starts again' : ''}`;
    card.querySelector('.play').onclick = () => act({ type: 'musicPlaylist', playlist: pl.id, play: true });
    card.querySelector('.play').disabled = card.querySelector('.load').disabled = !pl.tracks.length;
    card.querySelector('.load').onclick = () => act({ type: 'musicPlaylist', playlist: pl.id });
    card.querySelector('.edit').onclick = () => openPlaylist(pl);
    box.appendChild(card);
  }
  const add = document.createElement('button');
  add.className = 'seq addSeq';
  add.innerHTML = '+ New playlist<small>songs played one after another</small>';
  add.onclick = () => openPlaylist(null);
  box.appendChild(add);
}
let plDraft = null;
function openPlaylist(pl) {
  plDraft = pl ? JSON.parse(JSON.stringify(pl)) : { name: '', tracks: [], shuffle: false, loop: true };
  $('plTitle').textContent = pl ? 'Edit playlist' : 'New playlist';
  $('plName').value = plDraft.name;
  $('plShuffle').checked = plDraft.shuffle;
  $('plLoop').checked = plDraft.loop;
  $('plDelete').classList.toggle('hidden', !pl);
  $('plErr').textContent = '';
  loadMedia().then(renderPlTracks);
  renderPlTracks();
  if (!$('plDialog').open) $('plDialog').showModal();
  plGuard.opened();
}
function renderPlTracks() {
  if (!plDraft) return;
  const box = $('plTracks');
  box.innerHTML = '';
  // Each song's length and the running total up to the end of it (in this order; shuffled, it's the total that counts).
  let total = 0, unknown = 0;
  plDraft.tracks.forEach((f, i) => {
    const row = document.createElement('div');
    row.className = 'stepRow';
    row.innerHTML = '<span class="num"></span><div class="what"></div><div class="len"><span class="hint"></span><button class="alt up" title="Earlier">↑</button><button class="alt down" title="Later">↓</button><button class="danger del" title="Take it out">✕</button></div>';
    row.querySelector('.num').textContent = i + 1;
    row.querySelector('.what').textContent = songName(f) + (tracks().includes(f) ? '' : ' (missing)');
    const len = durationOf(f);
    if (len) total += len; else unknown++;
    row.querySelector('.hint').textContent = len ? `${fmt(len * 1000)} · ${unknown ? 'at least ' : ''}${fmt(total * 1000)} in` : 'length not known yet';
    row.querySelector('.up').disabled = i === 0;
    row.querySelector('.down').disabled = i === plDraft.tracks.length - 1;
    row.querySelector('.up').onclick = () => { plDraft.tracks.splice(i - 1, 0, plDraft.tracks.splice(i, 1)[0]); renderPlTracks(); };
    row.querySelector('.down').onclick = () => { plDraft.tracks.splice(i + 1, 0, plDraft.tracks.splice(i, 1)[0]); renderPlTracks(); };
    row.querySelector('.del').onclick = () => { plDraft.tracks.splice(i, 1); renderPlTracks(); };
    box.appendChild(row);
  });
  $('plTotal').textContent = plDraft.tracks.length ? `Runs ${unknown ? 'at least ' : ''}${fmt(total * 1000)} · ${plDraft.tracks.length} song${plDraft.tracks.length === 1 ? '' : 's'}` : '';
  const sel = $('plAdd');
  sel.innerHTML = '';
  sel.add(new Option(tracks().length ? '+ Add a song' : 'No songs yet: add them in Music first', ''));
  for (const f of tracks()) sel.add(new Option(songName(f), f));
}
$('plAdd').onchange = () => { if ($('plAdd').value) { plDraft.tracks.push($('plAdd').value); renderPlTracks(); } };
$('plCancel').onclick = () => { $('plDialog').close(); };
$('plDialog').addEventListener('close', () => { plDraft = null; });
const plGuard = unsavedDialog($('plDialog'), {
  what: () => $('plName').value.trim() || 'the new playlist',
  snapshot: () => ({ name: $('plName').value.trim(), shuffle: $('plShuffle').checked, loop: $('plLoop').checked, tracks: plDraft.tracks }),
  save: async () => { await $('plSave').onclick(); return !$('plDialog').open; },
});
$('plSave').onclick = async () => {
  const changes = { name: $('plName').value.trim(), shuffle: $('plShuffle').checked, loop: $('plLoop').checked, tracks: plDraft.tracks };
  if (!changes.name) { $('plErr').textContent = 'Give the playlist a name.'; return; }
  const body = plDraft.id ? await act({ type: 'playlistUpdate', playlist: plDraft.id, changes }) : await act({ type: 'playlistAdd', changes });
  if (!body) { $('plErr').textContent = $('err').textContent; return; }
  $('plDialog').close();
};
$('plDelete').onclick = async () => {
  if (!plDraft?.id || !await askConfirm(`Delete the playlist "${plDraft.name}"?`, 'The songs stay in the media folder.', { ok: 'Delete', danger: true })) return;
  if (await act({ type: 'playlistRemove', playlist: plDraft.id })) $('plDialog').close();
};
