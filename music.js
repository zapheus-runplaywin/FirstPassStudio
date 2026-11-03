// FirstPass Studio - music: one player for the stream's music, its playlists, and the music sequences play.
//
// The player plays audio files from the media folder (MP3, M4A, AAC, WAV, AIFF), one at a time, alone or
// from a playlist (a named list of tracks, shuffled or not, looping or not). Studio keeps the player's
// state and Output 1's scene.html plays it: the music is Output 1's (the production feed), so it takes the same
// route as Output 1's video sound (the Mac's sound output, the SDI, a sound copy, or the Scene View while Output 1
// is off) and is never heard twice. The other outputs never play it, and a sequence playing on them alone never
// starts, stops or ducks it.
//
// Where a track is: pos { sec, at } is the position (sec) at time at (ms), so a page opened part way
// through starts in the right place. Fades: gain { from, to, at, ms } is the fade the pages follow,
// from 0 (silent) to 1 (full). The volume, mute and duck sit on top of that. The duck fades too, over the
// fade out time (and back up over the fade in time): duck { from, to, at, ms } goes from 0 (not ducked) to 1 (down at the Duck to level).
//
// Other things change the music:
//   - A video with its sound on: by default the music fades out and pauses, then fades back in from where
//     it paused once the video ends (or lowers to a level, or carries on: a player setting).
//   - A sequence can bring its own music: a track or playlist that starts at one of its steps, from a
//     start mark, with a fade in, and ends with the sequence (fading or cut) or carries on into the
//     sequence it hands over to. Going to a scene or another sequence fades it out over its Music ends time (or
//     cuts it, when that's Cut). Cut to a sequence with music of its own, the old song fades out under the new one
//     (tail: a crossfade). A sequence's music plays while the sequence plays on Output 1; one playing on other
//     outputs too has its music driven by Output 1's runner alone.
//   - "Ducks the music" on a scene or sequence (an interview on court): whatever music is playing (the player's
//     or a sequence's) ducks low and keeps playing until the next scene, sequence or step without it.
//   - A stinger with ?music=quiet or ?music=duck (stinger.html; the Switcher card's Music under it), on the output the stinger
//     plays on (scene.js stingerMusic): the music ducks quickly as it sweeps in, so it's down
//     by the time the frame is covered. quiet leaves it down for the scene cut to under it (as a scene that ducks the music does,
//     until the next scene, sequence or step without it); dip brings it back up as the stinger leaves.
//   - The super shot song (a setting, with its own volume): when the scoreboard's super shot period starts
//     (the last minutes of a quarter, in a division with super shots) it cuts in over whatever is playing,
//     round and round, and fades out over the fade out time when the period ends.
//
// Saved as music.json in the data folder: the playlists and the player's settings. What's playing isn't.

'use strict';

const fs = require('fs');
const datadir = require('./datadir');
const savefile = require('./savefile');

const FILE = datadir.file('music.json');
const AUDIO_TYPES = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav', '.aif': 'audio/aiff', '.aiff': 'audio/aiff' };
// Under a video with sound the music pauses, or is left as it is (the Ducking card). An older 'lower' pauses.
const UNDER_VIDEO = ['pause', 'leave'];
// Three fade times, all in Music Settings: Fade in, Fade out, and Quick. Quick is how long the music takes to get out of
// the way of a video's sound and to come back, and how fast a stinger with ?music=dip brings it back up as it leaves.
// Fade out is also how long a sequence's music fades when something else stops it and its Music ends gives no time
// (it carries on into the next sequence).
// A track whose length isn't known yet is checked again after this.
const UNKNOWN_MS = 5000;

let log = () => {};
let api = null; // { duration(file), files(), changed(), quiet(on) }
let playlists = [];
let settings = { fadeInSec: 2, fadeOutSec: 4, quickSec: 1, volume: 80, underVideo: 'pause', duckTo: 25, superShotSong: '', superShotVolume: 80 };
// The super shot song plays as this owner; superFired is the game and quarter it last started for.
const SUPER = 'supershot';
let superFired = null;
let p = blank();
let endTimer = null, fadeTimer = null;
// The song fading out under a sequence's new music (a crossfade): { track, pos, gain, playId, volume }.
let tail = null, tailTimer = null;

function blank() {
  return { queue: [], index: 0, playlist: null, loop: false, status: 'stopped', pos: { sec: 0, at: 0 }, gain: { from: 1, to: 1, at: 0, ms: 0 },
    playId: 0, muted: false, ducked: null, duck: { from: 0, to: 0, at: 0, ms: 0 }, video: null, owner: null, after: null };
}

const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const slug = s => String(s || '').toLowerCase().replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const newId = () => Math.random().toString(36).slice(2, 10);
const cleanFile = f => String(f || '').split(/[\\/]/).pop().replace(/^\.+/, '');
const isAudio = f => !!AUDIO_TYPES[require('path').extname(String(f || '')).toLowerCase()];
const now = () => Date.now();
// The seconds a fade takes: the one asked for, else the player's fade in or fade out time.
const given = v => v !== undefined && v !== null && v !== '';
const fadeIn = v => given(v) ? clamp(v, 0, 60, settings.fadeInSec) : settings.fadeInSec;
const fadeOut = v => given(v) ? clamp(v, 0, 60, settings.fadeOutSec) : settings.fadeOutSec;

// ─── Saving ──────────────────────────────────────────────────────────────
function cleanPlaylist(pl, existing = {}) {
  const s = { ...existing, ...pl };
  const out = {
    id: String(existing.id || s.id || newId()).replace(/[^a-z0-9]/gi, '').slice(0, 20) || newId(),
    name: '',
    tracks: (Array.isArray(s.tracks) ? s.tracks : []).map(cleanFile).filter(isAudio).slice(0, 500),
    shuffle: !!s.shuffle,
    loop: s.loop === undefined ? true : !!s.loop,
  };
  const base = String(s.name || '').trim().slice(0, 60) || 'Playlist';
  const taken = new Set(playlists.filter(x => x.id !== out.id).map(x => slug(x.name)));
  out.name = base;
  for (let i = 2; taken.has(slug(out.name)) || !slug(out.name); i++) out.name = `${base} ${i}`;
  return out;
}
function cleanSettings(v) {
  const s = { ...settings, ...(v && typeof v === 'object' ? v : {}) };
  return {
    // A music.json from before fade in and out were separate has one fadeSec: fade in over it, out over twice it.
    fadeInSec: clamp(s.fadeInSec ?? s.fadeSec, 0, 30, 2),
    fadeOutSec: clamp(s.fadeOutSec ?? (s.fadeSec === undefined ? undefined : Number(s.fadeSec) * 2), 0, 30, 4),
    quickSec: clamp(s.quickSec, 0, 10, 1),
    volume: Math.round(clamp(s.volume, 0, 100, 80)),
    underVideo: UNDER_VIDEO.includes(s.underVideo) ? s.underVideo : 'pause',
    duckTo: Math.round(clamp(s.duckTo, 0, 100, 25)),
    // An older music.json's lowerTo (Lower the music, now pause) and duckHalf (Duck over half the fade times) are dropped.
    superShotSong: cleanFile(s.superShotSong),
    superShotVolume: Math.round(clamp(s.superShotVolume, 0, 100, 80)),
    // An older music.json's outputs (Music plays on) is dropped: the music is Output 1's.
  };
}
function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    settings = cleanSettings(saved.settings);
    playlists = [];
    for (const pl of Array.isArray(saved.playlists) ? saved.playlists : []) if (pl && typeof pl === 'object') playlists.push(cleanPlaylist(pl));
  } catch (err) {
    if (err.code !== 'ENOENT') log('warn', 'music', `Could not read music.json, starting with no playlists: ${err.message}`);
  }
}
function save() {
  try { savefile.writeJsonSync(FILE, { settings, playlists }); }
  catch (err) { log('error', 'music', `Could not save music.json: ${err.message}`); }
}

function findPlaylist(ref) {
  const r = String(ref || '');
  return playlists.find(x => x.id === r) || playlists.find(x => slug(x.name) === slug(r)) || null;
}
// A track by file name, or by its name as a link spells it (pre-game-bed for "Pre-game bed.mp3").
function findTrack(ref, files) {
  const r = cleanFile(ref);
  if (files.includes(r)) return r;
  return files.find(f => slug(f.replace(/\.[^.]+$/, '')) === slug(r)) || files.find(f => slug(f) === slug(r)) || null;
}

// ─── Playing ─────────────────────────────────────────────────────────────
const track = () => p.queue[p.index] || null;
const position = () => p.status === 'playing' ? p.pos.sec + (now() - p.pos.at) / 1000 : p.pos.sec;
// Where a fade or duck is now. Fades ease in and out (scene.html uses the same curve), so one that
// changes part way carries on from where it is heard.
const ease = x => x * x * (3 - 2 * x);
function along(e) {
  if (!e.ms || now() >= e.at + e.ms) return e.to;
  return e.from + (e.to - e.from) * ease(Math.max(0, (now() - e.at) / e.ms));
}
const gainNow = () => along(p.gain);
function fadeTo(to, sec) { p.gain = { from: gainNow(), to, at: now(), ms: Math.round(sec * 1000) }; }
const duckNow = () => along(p.duck);
// Ducks (why: 'hand' or 'quiet') over the fade out time, or brings the music back up (null) over the fade in
// time, unless told otherwise.
function setDuck(why, fade) {
  p.ducked = why;
  const to = why ? 1 : 0;
  if (p.duck.to === to) return;
  const sec = given(fade) ? (why ? fadeOut(fade) : fadeIn(fade)) : (why ? settings.fadeOutSec : settings.fadeInSec);
  p.duck = { from: duckNow(), to, at: now(), ms: Math.round(sec * 1000) };
}

// After a fade out: stop or pause once it's silent.
function afterFade(sec, then) {
  clearTimeout(fadeTimer);
  fadeTimer = null;
  p.after = then;
  if (sec > 0) fadeTimer = setTimeout(() => { fadeTimer = null; finishFade(); api.changed(); }, sec * 1000);
  else finishFade();
}
function finishFade() {
  const then = p.after;
  p.after = null;
  if (then === 'stop') halt();
  if (then === 'pause' || then === 'video') { p.pos = { sec: position(), at: now() }; p.status = 'paused'; clearTimeout(endTimer); }
}
function halt() {
  clearTimeout(endTimer);
  clearTimeout(fadeTimer);
  fadeTimer = null;
  p.status = 'stopped';
  p.pos = { sec: 0, at: now() };
  p.after = null;
  p.video = null;
  p.owner = null;
}

// When the track playing ends: the next in the queue, round again if it loops, else stop.
function scheduleEnd() {
  clearTimeout(endTimer);
  endTimer = null;
  if (p.status !== 'playing' || !track()) return;
  const len = api.duration(track());
  const id = p.playId;
  if (!len) { endTimer = setTimeout(() => { if (p.playId === id) scheduleEnd(); }, UNKNOWN_MS); return; }
  endTimer = setTimeout(() => { if (p.playId === id) { trackEnded(); api.changed(); } }, Math.max(0, (len - position()) * 1000));
}
function trackEnded() {
  if (p.index + 1 < p.queue.length) { p.index++; start(0, 0); return; }
  if (p.loop && p.queue.length) { p.index = 0; if (p.playlist && findPlaylist(p.playlist)?.shuffle) p.queue = shuffled(p.queue); start(0, 0); return; }
  log('info', 'music', `${track()} finished, music stopped`);
  halt();
}
function start(fromSec, fadeIn) {
  clearTimeout(fadeTimer);
  fadeTimer = null;
  p.after = null;
  p.playId++;
  p.status = 'playing';
  p.pos = { sec: Math.max(0, fromSec), at: now() };
  p.gain = fadeIn > 0 ? { from: 0, to: 1, at: now(), ms: Math.round(fadeIn * 1000) } : { from: 1, to: 1, at: now(), ms: 0 };
  log('info', 'music', `Playing ${track()}${fromSec ? ` from ${Math.round(fromSec)} s` : ''}${fadeIn ? `, fading in over ${fadeIn} s` : ''}`);
  scheduleEnd();
}
function shuffled(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function loadTrack(file, owner = null, loop = false) {
  halt();
  Object.assign(p, { queue: [file], index: 0, playlist: null, loop, owner });
}
function loadPlaylist(pl, owner = null) {
  halt();
  Object.assign(p, { queue: pl.shuffle ? shuffled(pl.tracks) : [...pl.tracks], index: 0, playlist: pl.id, loop: pl.loop, owner });
}

function play(fade, fromSec = 0) {
  if (!track()) return 'Load a track or a playlist first.';
  start(fromSec, fadeIn(fade));
  return null;
}
function stop(fade) {
  if (p.status === 'stopped') return null;
  const sec = p.status === 'paused' ? 0 : fadeOut(fade);
  // Already fading out to a stop: a second stop can make it sooner, never later (the fade it's in keeps its time).
  if (p.after === 'stop' && p.gain.to === 0 && sec * 1000 >= p.gain.at + p.gain.ms - now()) return null;
  log('info', 'music', `Stopping ${track()}${sec ? `, fading out over ${sec} s` : ''}`);
  fadeTo(0, sec);
  afterFade(sec, 'stop');
  return null;
}
function pause(fade) {
  if (p.status !== 'playing') return p.status === 'paused' ? null : 'No music is playing.';
  const sec = fadeOut(fade);
  fadeTo(0, sec);
  afterFade(sec, 'pause');
  return null;
}
function resume(fade) {
  if (p.status === 'playing' && !p.after) return null;
  if (p.status === 'stopped') return play(fade);
  const sec = fadeIn(fade);
  clearTimeout(fadeTimer);
  fadeTimer = null;
  p.after = null;
  p.video = null; // carried on by hand: a video's sound no longer brings it back
  if (p.status === 'paused') { p.status = 'playing'; p.pos = { sec: p.pos.sec, at: now() }; }
  fadeTo(1, sec);
  log('info', 'music', `Carried on with ${track()}`);
  scheduleEnd();
  return null;
}
function skip(by, fade) {
  if (!p.queue.length) return 'Load a playlist first.';
  let i = p.index + by;
  if (i < 0 || i >= p.queue.length) {
    if (!p.loop) return null;
    i = (i + p.queue.length) % p.queue.length;
  }
  const playing = p.status === 'playing' && p.after !== 'stop' && p.after !== 'pause';
  p.index = i;
  if (playing) start(0, fade === undefined ? 0 : clamp(fade, 0, 60, 0));
  else { const owner = p.owner; halt(); p.owner = owner; }
  return null;
}

// How long a sequence's music fades when stopped with no Music ends time of its own: the Fade out time.
const stopFadeSec = () => settings.fadeOutSec;

// ─── What else changes the music ─────────────────────────────────────────
// A video with its sound on is showing (or not any more).
function videoSound(on) {
  if (on) {
    if (p.video || p.status !== 'playing' || p.after) return false;
    if (settings.underVideo === 'leave') return false;
    p.video = 'pause';
    log('info', 'music', 'A video with sound is on: music fades out and pauses');
    fadeTo(0, settings.quickSec); afterFade(settings.quickSec, 'video');
    return true;
  }
  if (!p.video) return false;
  const was = p.video;
  p.video = null;
  log('info', 'music', 'The video with sound is off: music comes back');
  if (was === 'pause' && (p.status === 'paused' || p.after === 'video')) {
    clearTimeout(fadeTimer);
    fadeTimer = null;
    p.after = null;
    if (p.status === 'paused') { p.status = 'playing'; p.pos = { sec: p.pos.sec, at: now() }; }
    fadeTo(1, settings.quickSec);
    scheduleEnd();
  }
  return true;
}

// A stinger with ?music=quiet or dip came on (on true, sec: how long it takes to cover the frame) or went off.
function stinger(mode, on, sec) {
  if (on) {
    if (p.status === 'stopped' || p.ducked) return false;
    setDuck(mode === 'dip' ? 'stinger' : 'quiet', sec);
    log('info', 'music', `Stinger: music ducked${mode === 'dip' ? ' until it ends' : ' for the next scene'}`);
    return true;
  }
  if (p.ducked !== 'stinger') return false;
  setDuck(null, settings.quickSec);
  log('info', 'music', 'Stinger ended: music back up');
  return true;
}

// A scene or sequence with "Ducks the music" ticked started (quiet true), or one without it (false).
function quiet(on) {
  api?.quiet?.(!!on); // the mics dip with it (mics.js)
  if (on) {
    // A stinger's dip becomes this scene's quiet, so the music stays down when the stinger ends.
    if (p.ducked === 'stinger') { p.ducked = 'quiet'; return true; }
    if (p.status !== 'stopped' && !p.ducked) { setDuck('quiet'); log('info', 'music', 'Ducked for the scene or sequence'); return true; }
    return false;
  }
  if (p.ducked !== 'quiet') return false;
  setDuck(null);
  log('info', 'music', 'Music back up after the scene or sequence that ducked it');
  return true;
}

// A sequence's music: { track | playlist, startAtSec, fadeInSec } starting now (fading in over fadeSec instead, when
// given: started under the end of a video, it fades in for what's left of the video).
function playFor(seqId, m, fadeSec) {
  const files = api.files();
  const pl = m.playlist ? findPlaylist(m.playlist) : null;
  const file = !pl && m.track ? findTrack(m.track, files) : null;
  if (!pl && !file) { log('warn', 'music', `The sequence's music (${m.playlist || m.track}) isn't there any more`); return; }
  // Its own music already playing (handed on from the sequence before): leave it.
  if (p.status === 'playing' && !p.after && (pl ? p.playlist === pl.id : p.playlist === null && track() === file)) { p.owner = seqId; return; }
  // The music before is fading out (its sequence ended or was cut away from): it fades on under this one.
  if (p.status === 'playing' && p.after === 'stop' && p.gain.to === 0) startTail();
  if (pl) loadPlaylist(pl, seqId); else loadTrack(file, seqId, true);
  start(Number(m.startAtSec) || 0, fadeSec ?? (Number(m.fadeInSec) || 0));
}
// The sequence that owns the music ended or stopped: fade (sec) or cut (0).
function stopFor(seqId, sec) {
  if (!p.owner || p.owner !== seqId || p.status === 'stopped') return false;
  stop(sec);
  return true;
}
// The song fading out now carries on as the tail, to the end of its fade, while the new music starts.
function startTail() {
  const left = p.gain.at + p.gain.ms - now();
  if (left <= 0 || !track()) return;
  clearTimeout(tailTimer);
  tail = { track: track(), pos: { sec: position(), at: now() }, gain: p.gain, playId: p.playId,
    volume: p.owner === SUPER ? settings.superShotVolume : settings.volume };
  tailTimer = setTimeout(() => { tailTimer = null; tail = null; api.changed(); }, left);
  log('info', 'music', `${tail.track} fades out under the new music`);
}
// The music carries on into the next sequence.
function handOver(fromId, toId) { if (p.owner === fromId) p.owner = toId; }

// The scoreboard each second: { id, period, superShot (in the super shot period now), running }. The super shot
// song cuts in once the period's clock is running (once per quarter, so stopping it by hand keeps it stopped)
// and fades out when the period ends. Returns whether the music changed.
function superShotPeriod(g) {
  const key = g ? `${g.id}:${g.period}` : null;
  if (g && g.superShot) {
    if (!g.running || superFired === key || !settings.superShotSong) return false;
    superFired = key;
    const file = findTrack(settings.superShotSong, api.files());
    if (!file) { log('warn', 'music', `The super shot song (${settings.superShotSong}) isn't in the media folder`); return false; }
    log('info', 'music', `Super shot period: ${file} cuts in`);
    loadTrack(file, SUPER, true);
    start(0, 0);
    return true;
  }
  if (p.owner !== SUPER || p.status === 'stopped' || p.after === 'stop') return false;
  log('info', 'music', 'Super shot period over: its song fades out');
  stop();
  return true;
}

// ─── Changes from the Output page and the Stream Deck ────────────────────
// Returns an error, null when done, or undefined when it isn't a music change.
function apply(a) {
  const files = () => api.files();
  switch (a.type) {
    case 'musicLoad': {
      const file = findTrack(a.track, files());
      if (!file) return `No track "${a.track || ''}" in the media folder.`;
      loadTrack(file, null, !!a.loop);
      log('info', 'music', `Loaded ${file}`);
      return a.play ? play(a.fade) : null;
    }
    case 'musicPlaylist': {
      const pl = findPlaylist(a.playlist);
      if (!pl) return `No playlist "${a.playlist || ''}".`;
      if (!pl.tracks.length) return `The playlist "${pl.name}" has no tracks.`;
      loadPlaylist(pl);
      log('info', 'music', `Loaded the playlist "${pl.name}"`);
      return a.play ? play(a.fade) : null;
    }
    case 'musicPlay': return play(a.fade, Number(a.from) || 0);
    case 'musicStop': return stop(a.fade);
    case 'musicPause': return pause(a.fade);
    case 'musicResume': return resume(a.fade);
    case 'musicToggle': return p.status === 'playing' && !p.after ? pause(a.fade) : p.status === 'paused' ? resume(a.fade) : play(a.fade);
    case 'musicNext': return skip(1, a.fade);
    case 'musicPrev': return skip(-1, a.fade);
    case 'musicJump': {
      const i = Math.round(Number(a.index));
      if (!(i >= 0 && i < p.queue.length)) return 'No such track in the queue.';
      p.index = i;
      return play(a.fade);
    }
    case 'musicFade': return stop(a.fade === undefined ? settings.fadeOutSec || 3 : a.fade);
    case 'musicMute': p.muted = a.value === 'toggle' ? !p.muted : !!a.value && a.value !== 'off'; return null;
    case 'musicDuck': {
      const on = a.value === 'toggle' ? !p.ducked : !!a.value && a.value !== 'off';
      setDuck(on ? 'hand' : null, a.fade);
      return null;
    }
    case 'musicVolume': settings = cleanSettings({ ...settings, volume: a.value }); save(); return null;
    case 'musicSettings': settings = cleanSettings(a.settings); save(); return null;
    case 'playlistAdd': {
      const pl = cleanPlaylist({ ...(a.changes || {}), id: undefined }, { id: newId() });
      playlists.push(pl);
      save();
      log('info', 'music', `Made playlist "${pl.name}"`);
      return null;
    }
    case 'playlistUpdate': {
      const pl = findPlaylist(a.playlist);
      if (!pl) return `No playlist "${a.playlist || ''}".`;
      const { id, ...changes } = a.changes || {};
      playlists[playlists.indexOf(pl)] = cleanPlaylist(changes, pl);
      save();
      return null;
    }
    case 'playlistRemove': {
      const pl = findPlaylist(a.playlist);
      if (!pl) return `No playlist "${a.playlist || ''}".`;
      playlists.splice(playlists.indexOf(pl), 1);
      if (p.playlist === pl.id) p.playlist = null;
      save();
      log('info', 'music', `Deleted playlist "${pl.name}"`);
      return null;
    }
    case 'musicEnded':
      // A page says the track ended before Studio's timer did (its length wasn't known).
      if (Number(a.playId) === p.playId && p.status === 'playing') trackEnded();
      return null;
    default:
      return undefined;
  }
}

// /deck/music/load/<track>, /deck/music/playlist/<name>, /deck/music/play|stop|pause|resume|toggle|next|prev|fade,
// /deck/music/mute/on|off|toggle and /deck/music/duck/on|off|toggle; ?fade=N (seconds, 0 cuts) on any of them.
function deck(parts, q = {}) {
  const [what, verb, arg] = parts;
  if (what !== 'music' || !verb) return null;
  const fade = q.fade !== undefined && q.fade !== '' ? Number(q.fade) : undefined;
  const SIMPLE = { play: 'musicPlay', stop: 'musicStop', pause: 'musicPause', resume: 'musicResume', toggle: 'musicToggle', next: 'musicNext', prev: 'musicPrev', previous: 'musicPrev', fade: 'musicFade' };
  let action = null;
  if (SIMPLE[verb] && !arg) action = { type: SIMPLE[verb], fade };
  else if (verb === 'load' && arg) action = { type: 'musicLoad', track: arg, fade, play: q.play !== undefined };
  else if (verb === 'playlist' && arg) action = { type: 'musicPlaylist', playlist: arg, fade, play: q.play !== undefined };
  else if ((verb === 'mute' || verb === 'duck') && ['on', 'off', 'toggle'].includes(arg || 'toggle')) action = { type: verb === 'mute' ? 'musicMute' : 'musicDuck', value: arg || 'toggle', fade };
  if (!action) return null;
  const error = apply(action);
  if (error) return { status: /^No (track|playlist) /.test(error) ? 404 : 409, error };
  return { body: { ok: true, track: track(), status: p.status, muted: p.muted, ducked: !!p.ducked } };
}

function state() {
  return {
    music: {
      track: track(), queue: p.queue, index: p.index, playlist: p.playlist, loop: p.loop,
      // Paused for a video's sound counts as playing for the buttons: it comes back by itself.
      status: p.status, after: p.after, pos: p.pos, gain: p.gain, playId: p.playId,
      muted: p.muted, ducked: !!p.ducked, duckedBy: p.ducked || null, duck: p.duck, video: p.video, owner: p.owner, tail,
      volume: p.owner === SUPER ? settings.superShotVolume : settings.volume, duckTo: settings.duckTo,
      length: track() ? api.duration(track()) : null,
    },
    playlists,
    musicSettings: settings,
  };
}

// A file the Output page's Media list is removing from the media folder: where the player uses it (onAir while
// it's the song playing or paused), and taking it out of the playlists, the super shot song and the queue.
function uses(file) {
  const out = playlists.filter(pl => pl.tracks.includes(file)).map(pl => ({ type: 'playlist', name: pl.name }));
  if (settings.superShotSong === file) out.push({ type: 'superShot', name: 'Super shot song' });
  if (p.queue.includes(file)) out.push({ type: 'player', name: 'The music player', onAir: p.status !== 'stopped' && track() === file });
  return out;
}
function forget(file) {
  for (const pl of playlists) pl.tracks = pl.tracks.filter(t => t !== file);
  if (settings.superShotSong === file) settings.superShotSong = '';
  if (p.queue.includes(file)) {
    const cur = track();
    const at = p.queue.slice(0, p.index).filter(t => t !== file).length;
    p.queue = p.queue.filter(t => t !== file);
    p.index = cur !== file ? p.queue.indexOf(cur) : Math.min(at, Math.max(0, p.queue.length - 1));
    if (cur === file) p.pos = { sec: 0, at: now() };
    if (!p.queue.length) p.playlist = null;
  }
  save();
}

function init(logger, hooks) {
  log = logger || log;
  api = hooks;
  load();
}

module.exports = { init, apply, uses, forget, deck, state, videoSound, quiet, stinger, playFor, stopFor, handOver, superShotPeriod, isAudio, AUDIO_TYPES, stopFadeSec };
