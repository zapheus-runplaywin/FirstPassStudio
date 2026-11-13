// FirstPass Studio - the scene's script (scene.html loads it as a module, so its names stay its own).

declare global {
  interface Window {
    setSilent: (on: boolean) => void;
    soundState: () => { videos: number; pages: number; blocked: boolean; music: boolean };
    musicPlayers: () => Record<string, { src: string; playing: boolean; volume: number; at: number }>;
    sceneSound: () => SceneSound;
    webkitAudioContext?: typeof AudioContext;
  }
  // Newer than the DOM types here: the device a mixer plays to (Chromium), and how little an input buffers.
  interface AudioContextOptions { sinkId?: string }
  interface AudioContext { setSinkId(id: string): Promise<void> }
  interface MediaTrackConstraintSet { latency?: ConstrainDouble }
}

// A source as this window draws it: its layer, the source as last drawn, and how far it has got (token: the last
// change, so one made while a page loads wins).
interface Layer {
  el: HTMLElement; src: Source; token: number; shown: boolean; loaded: string;
  pageShow?: number; playShow?: number; soundOut?: { at: number; ms: number; showSeq: number } | null;
  sound?: ReturnType<typeof StudioSfx.run> | null;
}
// A Mac mic's device, a phone's connection, and a mic's chain into the mix.
interface MicDevice { stream: MediaStream | null; source: MediaStreamAudioSourceNode | null; splitter: ChannelSplitterNode | null; error: string; opening: boolean }
interface PhoneMic extends MicDevice {
  session: string; pc: RTCPeerConnection; player: HTMLAudioElement | null; state: string;
  back: MediaStreamAudioDestinationNode | null; wired: Set<AudioNode>;
}
interface MicChain {
  src: MicDevice; channel: string; from: AudioNode; out: number; input: GainNode; filter: BiquadFilterNode; gain: GainNode;
  meter: AnalyserNode; data: Float32Array<ArrayBuffer>; peak?: number;
}
// For the tests (window.sceneSound): this window's sound as it stands.
interface SceneSound {
  silent: boolean; sinkId: string | null; copyError: string; micsHere: boolean; micCtx: AudioContext | null; playCtx: AudioContext | null;
  micChains: Map<string, MicChain>; micDevices: Map<string, MicDevice>; phones: Map<string, PhoneMic>; layers: Map<string, Layer>;
}
// A phone's offer (/api/phonemic/offers).
interface PhoneOffer { mic: string; session: string; sdp: string }

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = $('stage');
const layers = new Map<string, Layer>();
const LOAD_WAIT_MS = 2500; // longest a page waits to finish loading before it fades in anyway
let first = true;
const params = new URLSearchParams(location.search);
// An output other than the primary (?output=<id>): its own sources on and off, and their sound.
const outputId = /^[a-z0-9]{1,20}$/i.test(params.get('output') || '') && params.get('output') !== 'main' ? params.get('output') : '';
const here = outputId || 'main';
// The music and the mics play on Output 1 alone (or in its sound copy).
const primary = here === 'main';
// An output's sound copy (see the top): the device it plays to, by the name macOS gives it.
const copying = params.get('copy') === '1';
const copyTo = copying ? params.get('sink') || '' : '';
const copyMics = new Set(copying ? (params.get('mics') || '').split(',').filter(Boolean) : []);
const copyAll = copying && params.get('mics') === 'all'; // every Mac mic (Output 1's main destination)
const copyMain = copying && params.get('main') === '1'; // the output's main destination: reports the mics' meters
let sinkId = copying ? null : ''; // the copy's device once found ('' plays to the Mac's sound output, as every other window does)
// Another program's copy of an output (?canvas=1, the canvas links on the Devices tab): it only watches, so it plays no
// sound unless ?sound=1 asks for it (the recording it goes over has its own). Like the Output page's preview, it never
// mixes in the Mac's mics or tells the switcher a stinger started (those are the app's own output windows, ?fit=1).
const canvas = params.get('canvas') === '1';
let silent = params.get('mute') === '1' || copying || (canvas && params.get('sound') !== '1'); // the Output page's preview and the key output play no sound; a copy waits for its device
// A source as this window sees it: on the primary output its own visible and showSeq; on another output
// whether it's on for that output, and that output's showSeq.
const forOutput = (s: Source): Source => !outputId ? s : { ...s, visible: !!(s.out && s.out[outputId]), showSeq: (s.outSeq && s.outSeq[outputId]) || 0 };
// A sound copy (?copy=1) unmutes with this once its device is found, and mutes again if it goes, without a reload.
// A browser that won't play sound until the page is clicked pauses a video as it's unmuted (or
// refuses to play it): it then plays muted, and soundState() says so.
let blocked = false;
window.setSilent = (on: boolean) => {
  silent = !!on;
  for (const L of layers.values()) {
    const v = L.el.querySelector('video');
    if (!v) continue;
    const wasMuted = v.muted;
    v.muted = !L.src.sound || silent;
    if (!wasMuted || v.muted || !L.src.visible) continue;
    blocked = false;
    const fallBack = () => { blocked = true; v.muted = true; v.play().catch(() => {}); };
    if (v.paused) v.play().catch((err: unknown) => { if (err instanceof Error && err.name === 'NotAllowedError') fallBack(); });
    // A sound copy is allowed to play sound (the app opens it so), so a video still loading there isn't muted.
    setTimeout(() => { if (!copying && L.src.visible && v.paused && !v.ended) fallBack(); }, 300);
  }
  renderTail(tailMusic);
  renderMusic(music);
  pageSoundLevel();
};
// For the tests: how many shown videos play sound here, and whether the browser blocks it.
window.soundState = () => {
  let videos = 0;
  for (const L of layers.values()) if (L.src && L.src.type === 'video' && L.src.visible && L.src.sound) videos++;
  const pages = [...layers.values()].filter(L => L.sound && L.src.visible).length;
  const wants = videos > 0 || (!!music && music.status === 'playing');
  return { videos, pages, blocked: blocked || (pages > 0 && !!sfxCtx && sfxCtx.state === 'suspended') || (wants && !!playCtx && playCtx.state === 'suspended'), music: !!music && music.status === 'playing' };
};
// The Output page switching its Scene View to another output loads that output's page beside the one showing, standing
// by, and swaps once it has drawn, so the picture carries straight on.
window.standbyReady = () => !first;
// For the tests: what the music and the song fading out under it (a crossfade) are playing here.
window.musicPlayers = () => [audio, tail].map(el => ({ src: decodeURIComponent((el.getAttribute('src') || '').replace('/media/', '')), playing: !el.paused, volume: el.volume, at: el.currentTime }))
  .reduce((o, x, i) => Object.assign(o, { [i ? 'tail' : 'music']: x }), {});
if (/^[0-9a-f]{6}$/i.test(params.get('bg') || '')) document.documentElement.style.background = document.body.style.background = '#' + params.get('bg');
if (params.get('key') === '1') { document.body.classList.add('key'); document.documentElement.style.background = document.body.style.background = '#000'; }
// Full screen on a display: scale the 1920 x 1080 frame to fit the window, centred.
if (params.get('fit') === '1') {
  document.body.classList.add('fit');
  const fit = () => {
    const k = Math.min(innerWidth / 1920, innerHeight / 1080);
    Object.assign(document.documentElement.style, { width: '100vw', height: '100vh' });
    Object.assign(document.body.style, { width: '100vw', height: '100vh' });
    Object.assign(stage.style, { transformOrigin: '0 0', transform: `translate(${(innerWidth - 1920 * k) / 2}px, ${(innerHeight - 1080 * k) / 2}px) scale(${k})` });
  };
  addEventListener('resize', fit);
  fit();
}

// Runs fn on the next frame, so a layer fades in rather than just appearing. A window that's hidden or
// covered (the popped-out Scene View behind the Output page) gets no frames, so a timer stands in:
// otherwise it would show nothing new until it was looked at again.
const nextFrame = (fn: () => void) => {
  let done = false;
  const once = () => { if (!done) { done = true; fn(); } };
  requestAnimationFrame(once);
  setTimeout(once, 100);
};

const addressOf = (s: Source) => { const url = s.url || ''; return /^https?:\/\//i.test(url) ? url : '/' + url; };

// A video finished, or a page animated away: the helper switches the source off (once, however many
// scene windows say so). showSeq names the time it came on, so a late word can't turn off a new showing.
function tellDone(src: Source, showSeq: number | undefined) {
  if (copying) return;
  fetch('/api/scene', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'ended', id: src.id, loadSeq: src.loadSeq, showSeq, ...(outputId ? { output: outputId } : {}) }) }).catch(() => {});
}
// Pages that animate away say so with done.js (postMessage { studio: 'done' }); pages with sound (the intro and
// outro) send their plan with pagesound.js (postMessage { studio: 'sound', plan }).
// The stinger says when it covers the frame (stinger.html): each output's own video output windows (the app opens
// them with ?fit=1: the display, its key, NDI) pass it to the switcher with their output, and the switcher listens
// to the output the stinger plays on and cuts underneath; the first word wins. A
// preview (the Output page's, the Scene View) runs somewhere else and may start a little earlier or later, so it doesn't.
addEventListener('message', e => {
  if (!e.data || e.data.studio !== 'stinger' || params.get('fit') !== '1') return;
  fetch('/api/switcher', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'stingerStarted', cover: e.data.cover, output: outputId || 'main' }) }).catch(() => {});
});
addEventListener('message', e => {
  if (!e.data || (e.data.studio !== 'done' && e.data.studio !== 'sound')) return;
  for (const L of layers.values()) {
    const f = L.el.querySelector('iframe');
    if (!f || f.contentWindow !== e.source) continue;
    if (e.data.studio === 'sound') { if (L.src.visible) playPageSound(L, e.data.plan); continue; }
    // A page loaded fresh each time it's shown names that showing; one kept loaded names this one.
    if (L.src.visible && L.shown) tellDone(L.src, L.src.reloadOnShow ? L.pageShow : L.src.showSeq);
  }
});
// Page sound (sfx.js): every scene window plays it, and a silent one (the preview, the key output, a sound copy waiting
// for its device) at no volume, so a sound copy can unmute part way through. It stops when the source goes off.
let sfxCtx: AudioContext | null = null, sfxOut: GainNode | null = null;
function pageSoundLevel() {
  if (!sfxOut || !sfxCtx) return;
  const t = sfxCtx.currentTime;
  sfxOut.gain.cancelScheduledValues(t);
  sfxOut.gain.setTargetAtTime(silent ? 0 : 1, t, .05);
}
function playPageSound(L: Layer, plan: SfxPlan | null) {
  if (typeof StudioSfx === 'undefined' || !plan || sinkId === null) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  if (!sfxCtx || !sfxOut) {
    sfxCtx = copying ? new Ctx({ sinkId }) : new Ctx();
    sfxOut = sfxCtx.createGain();
    sfxOut.gain.value = silent ? 0 : 1;
    sfxOut.connect(sfxCtx.destination);
    meterFrom(sfxCtx, sfxOut, true);
  }
  if (sfxCtx.state === 'suspended') sfxCtx.resume().catch(() => {});
  stopPageSound(L, .1);
  L.sound = StudioSfx.run(sfxCtx, sfxOut, { ...plan, onBlocked: () => { blocked = true; } });
}
function stopPageSound(L: Layer, fade = .4) {
  if (L.sound) { L.sound.stop(fade); L.sound = null; }
}

function create(s: Source): Layer {
  const el = document.createElement('div');
  el.className = 'layer';
  el.dataset.id = s.id;
  if (s.type === 'browser') {
    const f = document.createElement('iframe');
    f.setAttribute('allowtransparency', 'true');
    f.setAttribute('scrolling', 'no');
    f.allow = 'autoplay';
    f.title = s.name;
    el.appendChild(f);
  } else if (s.type === 'video') {
    // A sound copy plays it in a video element too, as the output does: the Mac's sound-only player stayed silent
    // for some video files (an AD on 3 Nov), with no error to say so.
    const v = document.createElement('video');
    playThrough(v);
    v.playsInline = true;
    v.preload = 'auto';
    v.muted = true;
    // Tell the helper when a video ends, so one set to hide when done fades out everywhere, and a
    // sequence waiting for it moves on.
    v.addEventListener('ended', () => {
      const L = layers.get(s.id), src = L && L.src;
      if (src && src.visible && !src.loop) tellDone(src, L.playShow);
    });
    el.appendChild(v);
  } else {
    el.appendChild(document.createElement('img'));
  }
  stage.appendChild(el);
  // Not drawn yet: update() puts the source in at once (no loadSeq, so the first showing isn't a restart).
  return { el, src: { ...s, visible: false, loadSeq: undefined }, token: 0, shown: false, loaded: '' };
}

// Loads (or reloads) a browser source's page; resolves when it has loaded, or after LOAD_WAIT_MS.
function loadPage(L: Layer, s: Source) {
  const f = L.el.querySelector('iframe');
  if (!f) return Promise.resolve();
  // A sound copy leaves out pages from other websites: their own sound would play on the Mac's speakers, not the copy's device.
  if (copying && /^https?:\/\//i.test(s.url || '')) { L.loaded = `${addressOf(s)}#${s.loadSeq}`; L.pageShow = s.showSeq; return Promise.resolve(); }
  const want = `${addressOf(s)}#${s.loadSeq}`;
  L.loaded = want;
  L.pageShow = s.showSeq;
  stopPageSound(L, .1);
  return new Promise<void>(resolve => {
    const done = () => { clearTimeout(t); f.removeEventListener('load', done); resolve(); };
    const t = setTimeout(done, LOAD_WAIT_MS);
    f.addEventListener('load', done);
    f.src = addressOf(s);
  });
}
function unloadPage(L: Layer) {
  const f = L.el.querySelector('iframe');
  if (f && L.loaded) { f.src = 'about:blank'; L.loaded = ''; }
}

async function update(L: Layer, s: Source, z: number) {
  const old = L.src;
  L.src = s;
  const el = L.el;
  el.style.zIndex = String(z);
  el.style.left = s.x + 'px';
  el.style.top = s.y + 'px';
  el.style.transform = `scale(${s.scale / 100})`;
  el.style.transitionDuration = (first ? 0 : s.fadeMs) + 'ms';
  if (s.type === 'browser') {
    el.style.width = s.width + 'px';
    el.style.height = s.height + 'px';
  } else {
    const media = el.querySelector<HTMLImageElement | HTMLVideoElement>('img, video');
    const want = '/media/' + encodeURIComponent(s.file || '');
    if (media && media.getAttribute('src') !== want) media.src = want;
  }
  if (s.type === 'video') return updateVideo(L, s, old);

  const token = ++L.token;
  const pageKey = s.type === 'browser' ? `${addressOf(s)}#${s.loadSeq}` : '';
  if (s.visible) {
    // A page loads when it's shown (fresh each time),
    // or once and kept running with reloadOnShow off. Restart reloads it either way.
    const needsLoad = s.type === 'browser' && (L.loaded !== pageKey || (s.reloadOnShow && !L.shown));
    if (needsLoad) await loadPage(L, s);
    if (token !== L.token) return; // changed again while loading
    L.shown = true;
    nextFrame(() => { if (token === L.token) el.classList.add('on'); });
  } else {
    el.classList.remove('on');
    L.shown = false;
    stopPageSound(L, Math.max(.1, (first ? 0 : s.fadeMs) / 1000));
    if (s.type === 'browser') {
      if (!s.reloadOnShow && L.loaded !== pageKey) loadPage(L, s); // keep it ready to show at once
      else if (s.reloadOnShow) setTimeout(() => { if (token === L.token) unloadPage(L); }, first ? 0 : s.fadeMs + 50);
    }
  }
}

// Where a video showing on this output since playAt has got to (sec): 0 for a page there as it started.
const playedFor = (s: Source) => { const at = s.playAt && s.playAt[here]; const t = at ? (Date.now() - at) / 1000 : 0; return t > 1 ? t : 0; };
function joinAt(v: HTMLVideoElement, s: Source) {
  const go = () => {
    let t = playedFor(s);
    const d = v.duration;
    if (t && isFinite(d) && d > 0) t = s.loop ? t % d : Math.min(t, d);
    try { v.currentTime = t; } catch {}
  };
  go();
  // Its length isn't known until it loads: place it again once it is.
  if (playedFor(s) && !(v.readyState >= 1)) v.addEventListener('loadedmetadata', go, { once: true });
}
// Videos play while shown and pause once faded out. They start from the top each time
// they're shown (unless restartOnShow is off) and on Restart; sound follows the source.
function updateVideo(L: Layer, s: Source, old: Source) {
  const v = L.el.querySelector('video'), el = L.el;
  if (!v) return;
  const token = ++L.token;
  v.loop = !!s.loop;
  v.muted = !s.sound || silent;
  // Its sound fading out under the next music (sequences.ts planCross), for this showing only.
  const f = s.soundOut && s.soundOut[here];
  L.soundOut = f && f.showSeq === s.showSeq ? f : null;
  v.volume = videoVolume(L, s);
  const restarted = old.loadSeq !== undefined && old.loadSeq !== s.loadSeq;
  if (s.visible) {
    // From the top, or where the output has got to when this page joins part way through (a Scene View opened,
    // or switched to this output, while it plays), so a view never restarts what the output is playing.
    if (restarted || (!L.shown && s.restartOnShow)) joinAt(v, s);
    if (!L.shown) L.playShow = s.showSeq;
    wakeMixer();
    if (v.paused || v.ended) v.play().catch((err: unknown) => {
      // A browser that won't autoplay with sound still plays it muted.
      if (err instanceof Error && err.name === 'NotAllowedError' && !v.muted) { v.muted = true; blocked = true; v.play().catch(() => {}); console.warn(`Video "${s.name}" is playing muted: this browser blocks sound until the page is clicked`); }
      else console.warn(`Video "${s.name}" would not play: ${err instanceof Error ? err.message : err}`);
    });
    // A sound copy says in the log when a video's sound isn't playing there a moment later, as nothing else would show it.
    if (copying && s.sound && !silent) setTimeout(() => {
      if (token === L.token && L.src.visible && (v.paused || v.muted || !(v.currentTime > 0))) console.warn(`Sound copy: "${s.name}" isn't playing its sound to ${copyTo}${v.error ? ` (${v.error.message || `media error ${v.error.code}`})` : v.muted ? ' (muted)' : ''}`);
    }, 2000);
    L.shown = true;
    nextFrame(() => { if (token === L.token) el.classList.add('on'); });
  } else {
    el.classList.remove('on');
    L.shown = false;
    setTimeout(() => { if (token === L.token) v.pause(); }, first ? 0 : s.fadeMs + 50);
  }
}

// ─── Music (music.ts) ───────────────────────────────────────────────────
// Studio keeps the player: the track, where it is (pos: sec at time at), and its fade (gain: from, to,
// at, ms). Output 1's scene windows play it, unless silent, so the music goes wherever Output 1's video sound goes.
// Two players: audio plays the music, tail the song fading out under it when one sequence's music takes over from
// another's (a crossfade). As a crossfade starts the element playing the old song becomes tail, so it fades on without
// a gap, and the other element picks up the new music.
let audio = new Audio(), tail = new Audio();
audio.preload = tail.preload = 'auto';
audio.volume = tail.volume = 0; // up as the fade says (a page standing by never plays a moment at full volume)
// Every player in this window, for its mixer.
const players = (): HTMLMediaElement[] => [audio, tail, ...[...layers.values()].map(L => L.el.querySelector('video')).filter(v => v !== null)];
let music: MusicState | null = null, musicPlayId = -1, level = 0, tailMusic: MusicTail | null = null, tailPlayId = -1;
const musicPos = (m: { status: string; pos: { sec: number; at: number } }) => m.status === 'playing' ? m.pos.sec + (Date.now() - m.pos.at) / 1000 : m.pos.sec;
// Fades ease in and out (no sudden start or stop) and follow how loud they sound: a straight line in
// volume sounds like nothing much happens and then the music drops away at the end.
const ease = (x: number) => x * x * (3 - 2 * x);
const along = (e: Ease, t: number) => !e.ms || t >= e.at + e.ms ? e.to : e.from + (e.to - e.from) * ease(Math.max(0, (t - e.at) / e.ms));
const heard = (x: number) => x * x * x; // 0..1 along the fade to volume, close to even steps in loudness
function musicGain(m: MusicState | null) {
  if (!m || m.status === 'stopped') return 0;
  const t = Date.now();
  // The duck fades too, over the fade out or in time (duck: 0 up, 1 down at duckTo), evenly in loudness between
  // the two levels; a Studio without it just switches.
  const down = m.duck ? along(m.duck, t) : m.ducked ? 1 : 0;
  const low = Math.max(m.duckTo / 100, 0.01);
  const duck = down >= 1 ? m.duckTo / 100 : Math.pow(low, down);
  return heard(along(m.gain, t)) * (m.volume / 100) * duck * (m.muted ? 0 : 1);
}
// The song fading out under the new one: its own fade, at the volume it played at, muted and ducked as the music is.
function tailGain(tm: MusicTail | null) {
  if (!tm) return 0;
  return heard(along(tm.gain, Date.now())) * (tm.volume / 100) * (music?.muted ? 0 : 1);
}
// A video's volume: its own, down the fade when its sound is fading out under the next music (evenly in loudness).
function videoVolume(L: Layer, s: Source) {
  const f = L.soundOut;
  return Math.max(0, Math.min(1, ((s.volume ?? 100) / 100) * (f ? heard(along({ from: 1, to: 0, at: f.at, ms: f.ms }, Date.now())) : 1)));
}
// The volume follows the fade, easing mute and the video lowering in and out.
setInterval(() => {
  for (const L of layers.values()) if (L.soundOut && L.src) { const v = L.el.querySelector('video'); if (v) v.volume = videoVolume(L, L.src); }
  const target = silent ? 0 : musicGain(music);
  level += (target - level) * 0.25;
  if (Math.abs(target - level) < 0.001) level = target;
  audio.volume = Math.max(0, Math.min(1, level));
  tail.volume = Math.max(0, Math.min(1, silent ? 0 : tailGain(tailMusic)));
}, 25);
function seek(el: HTMLMediaElement, sec: number, posNow: () => number) {
  if (el.readyState >= 1) { try { el.currentTime = sec; } catch {} return; }
  el.addEventListener('loadedmetadata', () => { try { el.currentTime = posNow(); } catch {} }, { once: true });
}
function play(el: HTMLMediaElement, what: string) {
  wakeMixer();
  if (el.paused) el.play().catch((err: unknown) => {
    if (err instanceof Error && err.name === 'NotAllowedError') { blocked = true; console.warn(`${what} is waiting: this browser blocks sound until the page is clicked`); }
    else console.warn(`${what} would not play: ${err instanceof Error ? err.message : err}`);
  });
}
// tm: the song fading out under the new music, when it plays on this output.
function renderTail(tm: MusicTail | null) {
  // The crossfade starts: the element playing that song carries on as the tail.
  if (tm && tm.playId === musicPlayId && tm.playId !== tailPlayId) {
    [audio, tail] = [tail, audio];
    tailPlayId = musicPlayId;
    musicPlayId = -1;
    level = 0;
  }
  tailMusic = tm && !silent ? tm : null;
  if (!tailMusic) { if (!tail.paused) tail.pause(); tail.removeAttribute('src'); tailPlayId = -1; return; }
  const want = '/media/' + encodeURIComponent(tailMusic.track);
  if (tail.getAttribute('src') !== want) tail.src = want;
  const pos = musicPos({ ...tailMusic, status: 'playing' });
  if (tailMusic.playId !== tailPlayId || Math.abs(tail.currentTime - pos) > 1.5) seek(tail, pos, () => tailMusic ? musicPos({ ...tailMusic, status: 'playing' }) : pos);
  tailPlayId = tailMusic.playId;
  play(tail, 'The music fading out');
}
function renderMusic(m: MusicState | null | undefined) {
  music = m || null;
  if (!music || !music.track || music.status === 'stopped' || silent) { if (!audio.paused) audio.pause(); if (!music || !music.track) audio.removeAttribute('src'); return; }
  const want = '/media/' + encodeURIComponent(music.track);
  if (audio.getAttribute('src') !== want) audio.src = want;
  const pos = musicPos(music);
  if (music.playId !== musicPlayId || Math.abs(audio.currentTime - pos) > 1.5) seek(audio, pos, () => music ? musicPos(music) : pos);
  musicPlayId = music.playId;
  if (music.status === 'playing') play(audio, 'Music');
  if (music.status === 'paused' && !audio.paused) audio.pause();
}
// Studio moves on when the track's length is up; this covers a track whose length it couldn't measure.
for (const el of [audio, tail]) el.addEventListener('ended', () => {
  if (el === audio && music && music.status === 'playing' && !copying) fetch('/api/scene', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'musicEnded', playId: music.playId }) }).catch(() => {});
});

// ─── Mics (mics.ts) ─────────────────────────────────────────────────────
// Live mics plugged into the Mac, mixed into the sound here. Only Output 1's own window in the app (?fit=1, not
// silent, not the key) opens them: never a Scene View, where a speaker near a mic would feed back, and never twice. Each mic: its device's channel (both mixed to one, or left or right), a low cut, its level (with
// the master level, mutes and the dip on top); then all of them through a limiter. The browser's call
// processing (echo cancelling, noise suppression, automatic level) is off: it would pump the crowd noise.
// A sound copy opens only the mics ticked for it (?mics=).
// A phone mic (on: 'phone', the Commentator page) comes over the network instead (phonemic.ts): the window mixing
// Output 1's main sound (its own, or its main sound copy's) answers the phone and mixes it like a Mac input.
const micsHere = copying || (params.get('fit') === '1' && params.get('mute') !== '1' && params.get('key') !== '1');
const phoneHost = micsHere && primary && (copying ? copyMain : true);
let micCtx: AudioContext | null = null, micBus: GainNode | null = null, micSet: MicsState | null = null;
const micDevices = new Map<string, MicDevice>(); // by the device's name
const micChains = new Map<string, MicChain>(); // by the mic's id
const phones = new Map<string, PhoneMic>(); // by the phone mic's id
const micProblem: Record<string, string> = {};
let micStatus = '';
function micContext(): AudioContext {
  if (micCtx) return micCtx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = micCtx = new Ctx({ latencyHint: 'interactive', ...(copying && sinkId !== null ? { sinkId } : {}) });
  micBus = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = .002; limiter.release.value = .15;
  micBus.connect(limiter);
  limiter.connect(ctx.destination);
  meterFrom(ctx, limiter);
  return ctx;
}
async function audioInputs() {
  const list = await navigator.mediaDevices.enumerateDevices();
  return list.filter(d => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
}
// Opens a device by the name macOS gives it ('' is the Mac's default input). Names show only once the Mac has let
// Studio use the mics, so the first time asks for any input, then looks again.
async function openDevice(name: string) {
  const d: MicDevice = { stream: null, source: null, splitter: null, error: '', opening: true };
  micDevices.set(name, d);
  try {
    let id = '';
    if (name) {
      let found = (await audioInputs()).find(x => x.label === name);
      if (!found && (await audioInputs()).every(x => !x.label)) {
        (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach(t => t.stop());
        found = (await audioInputs()).find(x => x.label === name);
      }
      if (!found) throw Object.assign(new Error(`${name} isn't plugged in`), { name: 'NotFoundError' });
      id = found.deviceId;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: {
      ...(id ? { deviceId: { exact: id } } : {}), echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      channelCount: { ideal: 2 }, latency: { ideal: .01 } } });
    if (micDevices.get(name) !== d) { stream.getTracks().forEach(t => t.stop()); return; }
    const ctx = micContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    d.stream = stream;
    const source = d.source = ctx.createMediaStreamSource(stream);
    source.connect(d.splitter = ctx.createChannelSplitter(2));
    stream.getAudioTracks().forEach(t => t.addEventListener('ended', () => { if (micDevices.get(name) === d) { closeDevice(name); renderMics(micSet); } }));
  } catch (err) {
    const why = err instanceof Error ? err : new Error(String(err));
    d.error = why.name === 'NotAllowedError' ? 'The Mac hasn\'t let Studio use the mics: allow FirstPass Studio in System Settings, Privacy & Security, Microphone'
      : why.name === 'NotFoundError' || why.name === 'OverconstrainedError' ? `${name || 'The Mac\'s input'} isn't plugged in` : `Couldn't open ${name || 'the Mac\'s input'}: ${why.message}`;
    console.warn('Mics:', d.error);
  }
  d.opening = false;
  renderMics(micSet);
}
function closeDevice(name: string) {
  const d = micDevices.get(name);
  if (!d) return;
  micDevices.delete(name);
  if (d.stream) d.stream.getTracks().forEach(t => t.stop());
  if (d.source) d.source.disconnect();
}
function dropChain(id: string) {
  const c = micChains.get(id);
  if (!c) return;
  micChains.delete(id);
  try { c.from.disconnect(c.input, c.out); } catch {}
  try { c.input.disconnect(); c.gain.disconnect(); } catch {}
}
function micChain(m: Mic, d: MicDevice & { source: MediaStreamAudioSourceNode; splitter: ChannelSplitterNode }): MicChain {
  const ctx = micContext();
  // Both channels mixed down to one; or one channel of the device.
  const input = ctx.createGain();
  const from = m.channel === 'both' ? d.source : d.splitter, out = m.channel === 'right' ? 1 : 0;
  if (m.channel === 'both') { input.channelCount = 1; input.channelCountMode = 'explicit'; input.channelInterpretation = 'speakers'; }
  from.connect(input, out);
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  const meter = ctx.createAnalyser();
  meter.fftSize = 1024;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  input.connect(filter); filter.connect(meter); filter.connect(gain); if (micBus) gain.connect(micBus);
  return { src: d, channel: m.channel, from, out, input, filter, gain, meter, data: new Float32Array(meter.fftSize) };
}
// How far down the dip is now, 0 (up) to 1 (down at dipTo), easing as the music's duck does.
function micGain(set: MicsState, m: Mic) {
  if (set.muted || m.muted) return 0;
  let g = (m.level / 100) * (set.level / 100);
  if (m.follow && set.dip) {
    const down = along(set.dip, Date.now());
    const low = Math.max(set.dipTo / 100, 0.01);
    g *= down >= 1 ? set.dipTo / 100 : Math.pow(low, down);
  }
  return g;
}
// Where a mic's sound comes from here: its Mac device, or its phone's connection.
const micSource = (m: Mic): MicDevice | undefined => m.on === 'phone' ? phones.get(m.id) : micDevices.get(m.device);
function renderMics(set: MicsState | null | undefined) {
  micSet = set || null;
  // The switcher mixes its own; a phone mic only in the window that answers it.
  const want = micsHere && micSet && sinkId !== null ? micSet.mics.filter(m => m.on !== 'atem' && (m.on !== 'phone' || phoneHost) && (copying ? copyAll || copyMics.has(m.id) : primary)) : [];
  const names = new Set(want.filter(m => m.on !== 'phone').map(m => m.device));
  for (const id of [...phones.keys()]) if (!want.some(m => m.id === id && m.on === 'phone')) closePhone(id);
  for (const name of [...micDevices.keys()]) if (!names.has(name)) closeDevice(name);
  for (const [id, c] of micChains) {
    const m = want.find(x => x.id === id);
    if (!m || micSource(m) !== c.src || m.channel !== c.channel || !c.src?.source) dropChain(id);
  }
  for (const k of Object.keys(micProblem)) delete micProblem[k];
  for (const m of want) {
    const d = micSource(m);
    if (m.on === 'phone' && !d?.source) { micProblem[m.id] = d?.error || (d ? 'Connecting to the phone…' : 'Waiting for the phone: open the Commentator page on it and press Start'); continue; }
    if (!d) { openDevice(m.device); continue; }
    if (d.error) { micProblem[m.id] = d.error; continue; }
    if (!d.source || !d.splitter) continue;
    const c = micChains.get(m.id) || micChain(m, { ...d, source: d.source, splitter: d.splitter });
    micChains.set(m.id, c);
    c.filter.frequency.value = m.lowCut ? 100 : 10;
  }
  micStatus = Object.values(micProblem)[0] || '';
  wireReturns();
}
// ─── Phone mics (phonemic.ts) ───
// Takes each phone's offer, answers it, and mixes the sound that comes in. The answer has every address in it (on one
// network they're there at once), so nothing else goes back and forth. A dropped connection says so on the mic's card
// (and the board); the phone starts again by itself.
function closePhone(id: string) {
  const p = phones.get(id);
  if (!p) return;
  phones.delete(id);
  try { p.pc.close(); } catch {}
  if (p.source) p.source.disconnect();
  if (p.player) { p.player.srcObject = null; }
  const back = p.back;
  if (back) for (const n of p.wired) try { n.disconnect(back); } catch {}
}
// What each phone hears back: Output 1's program (the players and page sounds, as this window plays them) and every
// other mic at its level, never the phone's own voice (it would come back late). Wired again whenever the mics change.
let progIn: MediaStreamAudioSourceNode | null = null;
function wireReturns() {
  if (!micCtx) return;
  if (!progIn) { const st = programStream(); if (st) progIn = micCtx.createMediaStreamSource(st); }
  for (const [id, p] of phones) {
    const back = p.back;
    if (!back) continue;
    const want = new Set<AudioNode>([...(progIn ? [progIn] : []), ...[...micChains].filter(([cid]) => cid !== id).map(([, c]) => c.gain)]);
    for (const n of p.wired) if (!want.has(n)) { try { n.disconnect(back); } catch {} p.wired.delete(n); }
    for (const n of want) if (!p.wired.has(n)) { n.connect(back); p.wired.add(n); }
  }
}
// Asks for the Opus sound a voice wants: one channel, a steady 96 kb/s, nothing dropped between words.
const opusFor = (sdp: string) => sdp.replace(/a=fmtp:(\d+) ([^\r\n]*useinbandfec=1[^\r\n]*)/g, (_all, pt: string, rest: string) => `a=fmtp:${pt} ${rest.replace(/;?(maxaveragebitrate|usedtx|stereo)=\d+/g, '')};stereo=0;maxaveragebitrate=96000;usedtx=0`);
async function answerPhone(o: PhoneOffer) {
  const m = micSet && micSet.mics.find(x => x.id === o.mic && x.on === 'phone');
  if (!m) return;
  closePhone(o.mic);
  const pc = new RTCPeerConnection({ iceServers: [] });
  const back = micContext().createMediaStreamDestination();
  back.channelCount = 2;
  const p: PhoneMic = { session: o.session, pc, stream: null, player: null, source: null, splitter: null, error: '', state: 'connecting', back, wired: new Set(), opening: false };
  phones.set(o.mic, p);
  // (back: the sound going back to the phone.)
  wireReturns();
  pc.ontrack = e => {
    if (phones.get(o.mic) !== p) return;
    const stream = e.streams[0] || new MediaStream([e.track]);
    // A little less buffering than the browser keeps by default: it's a voice going to air.
    try { e.receiver.jitterBufferTarget = 40; } catch {}
    // Chromium hands a network stream to Web Audio only while something plays it: a silent player does.
    const player = p.player = new Audio();
    player.muted = true;
    player.srcObject = stream;
    player.play().catch(() => {});
    const ctx = micContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    p.stream = stream;
    const source = p.source = ctx.createMediaStreamSource(stream);
    source.connect(p.splitter = ctx.createChannelSplitter(2));
    renderMics(micSet);
  };
  pc.onconnectionstatechange = () => {
    if (phones.get(o.mic) !== p) return;
    p.state = pc.connectionState;
    if (p.state === 'connected') p.error = '';
    if (p.state === 'disconnected' || p.state === 'failed' || p.state === 'closed') {
      p.error = 'Dropped: the phone lost Studio (it tries again by itself; check it is still on the Commentator page and the Wi-Fi)';
      if (p.source) { p.source.disconnect(); p.source = null; }
    }
    renderMics(micSet);
  };
  try {
    await pc.setRemoteDescription({ type: 'offer', sdp: o.sdp });
    // A phone that wants to hear Studio offers both ways: send it the program back on the same connection.
    const tr = pc.getTransceivers()[0];
    if (tr && /sendrecv|recvonly/.test(o.sdp.match(/a=(sendrecv|sendonly|recvonly)/)?.[1] || '')) {
      tr.direction = 'sendrecv';
      await tr.sender.replaceTrack(back.stream.getAudioTracks()[0]);
    }
    const answer = await pc.createAnswer();
    await pc.setLocalDescription({ type: 'answer', sdp: opusFor(answer.sdp || '') });
    // Every address, then the answer (a second at most: on one network they're there at once).
    await new Promise<void>(r => { if (pc.iceGatheringState === 'complete') return r(); pc.addEventListener('icegatheringstatechange', () => pc.iceGatheringState === 'complete' && r()); setTimeout(r, 1000); });
    await fetch(`/api/phonemic/${encodeURIComponent(o.session)}/answer`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sdp: pc.localDescription?.sdp }) });
  } catch (err) {
    p.error = `Couldn't connect to the phone: ${err instanceof Error ? err.message : err}`;
    console.warn('Phone mic:', p.error);
    renderMics(micSet);
  }
}
if (phoneHost && window.RTCPeerConnection) {
  setInterval(async () => {
    if (!micSet || sinkId === null) return;
    let offers: PhoneOffer[] = [];
    try { offers = ((await (await fetch('/api/phonemic/offers', { cache: 'no-store' })).json()) as { offers?: PhoneOffer[] }).offers || []; } catch { return; }
    for (const o of offers) if (phones.get(o.mic)?.session !== o.session) answerPhone(o);
  }, 1000);
}

if (micsHere) {
  // The levels follow the settings and the dip.
  setInterval(() => {
    if (!micCtx || !micSet) return;
    const t = micCtx.currentTime;
    for (const [id, c] of micChains) {
      const m = micSet.mics.find(x => x.id === id);
      if (m) c.gain.gain.setTargetAtTime(micGain(micSet, m), t, .03);
      // The loudest moment since the last report, as it comes in (before the level).
      c.meter.getFloatTimeDomainData(c.data);
      for (const v of c.data) c.peak = Math.max(c.peak || 0, Math.abs(v));
    }
  }, 25);
  // Tell Studio what this window hears, for the Output page: each mic's loudest moment (dBFS) in the last half second.
  setInterval(async () => {
    if ((copying && !copyMain) || !primary || !micSet || !micSet.mics.some(m => m.on !== 'atem')) return;
    const levels: Record<string, number> = {};
    for (const [id, c] of micChains) {
      levels[id] = c.peak ? 20 * Math.log10(c.peak) : -100;
      c.peak = 0;
    }
    let devices: string[] = [];
    try { devices = (await audioInputs()).map(d => d.label).filter(Boolean); } catch {}
    fetch('/api/scene/mics/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ output: here, devices, levels, problems: micProblem, status: micStatus }) }).catch(() => {});
  }, 500);
  // A device plugged in or out: try the mics again.
  navigator.mediaDevices?.addEventListener('devicechange', () => {
    for (const [name, d] of [...micDevices]) if (d.error && !d.opening) micDevices.delete(name);
    renderMics(micSet);
  });
}

// ─── The players' mixer, and how loud this window plays (the status board's Sound out) ───
// Every window that plays sound (an output's own window, a sound copy) plays its players (the music, the song fading
// out under it, the videos) through one mixer, on its device: the Mac's sound output, or the copy's device. The
// mixer is what the status board's meter and a phone's Hear Studio (phonemic.ts) hear, so they follow every song and
// video with nothing taken per song. (Copies taken from each player, as before, lost the next song in a playlist
// on the Mac and played it twice on the speakers.) The page sounds and the mics have their own mixers, copied in
// for the meter. Each player is wired in for good the first time, at its own volume. Windows that play nothing (the
// Output page's preview, the key output, a window muted for its sound copies, another program's canvas) have no mixer.
// Every half second the window says how loud it is (each side's loudest moment, 0 to 1) and what the device plays
// at (its sample rate and channels): POST /api/outputs/level.
const meterOn = !canvas && (copying || params.get('mute') !== '1');
let playCtx: AudioContext | null = null, playBus: GainNode | null = null, meterBus: GainNode | null = null;
let meterSides: { a: AnalyserNode; data: Float32Array<ArrayBuffer> }[] | null = null;
// The program without the mics (the players and the page sounds), for what a phone mic hears back.
let progBus: GainNode | null = null, progOut: MediaStreamAudioDestinationNode | null = null;
const playing = new WeakSet<HTMLMediaElement>(); // the players wired into the mixer
const meterPeak = [0, 0];
let meterRate = 0, meterChannels = 0;
// The mixer: made at once on the Mac's sound output, and in a sound copy once its device is found (it plays nothing
// until then, so nothing is heard on the Mac's speakers).
function playContext() {
  if (playCtx || !meterOn || (copying && sinkId === null)) return playCtx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = playCtx = new Ctx({ latencyHint: 'interactive', ...(copying && sinkId !== null ? { sinkId } : {}) });
  playBus = ctx.createGain();
  playBus.connect(ctx.destination);
  progBus = ctx.createGain();
  progBus.channelCount = 2; progBus.channelCountMode = 'explicit'; // a mono player counts on both sides
  playBus.connect(progBus);
  progOut = ctx.createMediaStreamDestination();
  progBus.connect(progOut);
  meterBus = ctx.createGain();
  meterBus.channelCount = 2; meterBus.channelCountMode = 'explicit';
  progBus.connect(meterBus);
  const split = ctx.createChannelSplitter(2);
  meterBus.connect(split);
  meterSides = [0, 1].map(i => {
    const a = ctx.createAnalyser();
    a.fftSize = 1024;
    split.connect(a, i);
    return { a, data: new Float32Array(a.fftSize) };
  });
  players().forEach(playThrough);
  return playCtx;
}
// A player into the mixer (once: it then plays only through it).
function playThrough(el: HTMLMediaElement) {
  const ctx = playContext();
  if (!ctx || !playBus || playing.has(el)) return;
  playing.add(el);
  ctx.createMediaElementSource(el).connect(playBus);
}
// A browser that won't play sound until the page is clicked starts the mixer paused: it goes once it may.
function wakeMixer() {
  if (playCtx && playCtx.state === 'suspended') playCtx.resume().catch(() => {});
}
// A mixer's sound (the page sounds', the mics') into the meter as well; program: it's part of the program a phone
// mic hears back (the page sounds), not a mic.
function meterFrom(ctx: AudioContext, node: AudioNode, program = false) {
  const mixer = playContext(), to = program ? progBus : meterBus;
  if (!mixer || !to) return;
  const copy = ctx.createMediaStreamDestination();
  node.connect(copy);
  mixer.createMediaStreamSource(copy.stream).connect(to);
}
// This window's program without its mics, as a stream (null where nothing plays: no mixer here).
const programStream = () => (playContext() && progOut ? progOut.stream : null);
// What the device plays at: a moment's mixer made for it says its sample rate and how many channels it has.
function meterDevice() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!meterOn || !Ctx || (copying && sinkId === null)) return;
  try {
    const probe = new Ctx(sinkId ? { sinkId } : {});
    meterRate = probe.sampleRate;
    meterChannels = probe.destination.maxChannelCount;
    probe.close().catch(() => {});
  } catch {}
}
if (meterOn) {
  playContext();
  meterDevice();
  navigator.mediaDevices?.addEventListener('devicechange', () => setTimeout(meterDevice, 500)); // the Mac's sound output may have changed
  setInterval(() => {
    if (!meterSides) return;
    meterSides.forEach((side, i) => {
      side.a.getFloatTimeDomainData(side.data);
      for (const v of side.data) if (Math.abs(v) > meterPeak[i]) meterPeak[i] = Math.abs(v);
    });
  }, 25);
  setInterval(() => {
    const peak = [...meterPeak];
    meterPeak[0] = meterPeak[1] = 0;
    if (copying ? sinkId === null : silent) return;
    fetch('/api/outputs/level', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ output: here, device: copying ? copyTo : 'own', peak, rate: meterRate, channels: meterChannels }) }).catch(() => {});
  }, 500);
}

// ─── A sound copy's device ──────────────────────────────────────────────
// Finds the device by name (names show once the Mac has let Studio use the mics), moves every player to it, then
// lets the sound play. Says how it's doing every few seconds, for the Output page; a device plugged in or out looks again.
let copyError = '';
async function findSink() {
  try {
    const outs = async () => (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
    let list = await outs();
    if (list.every(d => !d.label)) {
      (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach(t => t.stop());
      list = await outs();
    }
    const found = list.find(d => d.label === copyTo);
    if (!found) throw new Error(`${copyTo} isn't plugged in`);
    if (found.deviceId === sinkId) { copyError = ''; return; }
    const moving = sinkId !== null;
    sinkId = found.deviceId;
    // The players' mixer is made for the device the first time (with every player in it), and moved after that, as
    // are the page sounds' and the mics' mixers.
    if (playCtx) await playCtx.setSinkId(sinkId); else playContext();
    if (sfxCtx) await sfxCtx.setSinkId(sinkId);
    if (micCtx) await micCtx.setSinkId(sinkId);
    meterDevice();
    copyError = '';
    if (!moving) { renderMics(micSet); window.setSilent(false); }
  } catch (err) {
    copyError = err instanceof Error && err.name === 'NotAllowedError' ? 'The Mac hasn\'t let Studio use its sound devices: allow FirstPass Studio in System Settings, Privacy & Security, Microphone' : err instanceof Error ? err.message : String(err);
    console.warn('Sound copy:', copyError);
    // Gone (unplugged): stop, rather than play on the Mac's own speakers, until it's back.
    if (sinkId !== null) { sinkId = null; window.setSilent(true); renderMics(micSet); }
  }
  tellCopy();
}
const tellCopy = () => fetch('/api/outputs/copy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ output: here, device: copyTo, error: copyError || (sinkId === null ? 'Looking for the device' : '') }) }).catch(() => {});
if (copying) {
  findSink();
  setInterval(tellCopy, 5000);
  navigator.mediaDevices?.addEventListener('devicechange', findSink);
}

function render(scene: SceneState) {
  const seen = new Set();
  scene.sources.forEach((s, i) => {
    seen.add(s.id);
    let L = layers.get(s.id);
    if (L && L.src.type !== s.type) { L.el.remove(); L = undefined; }
    if (!L) { L = create(s); layers.set(s.id, L); }
    update(L, forOutput(s), scene.sources.length - i);
  });
  for (const [id, L] of layers) if (!seen.has(id)) { stopPageSound(L, .1); L.el.remove(); layers.delete(id); }
  const tm = scene.music?.tail;
  renderTail(primary && tm ? tm : null);
  renderMusic(primary ? scene.music : null);
  renderMics(scene.mics);
  first = false;
}

// For the tests: whether this window is silent, the copy's device (and why it isn't found), the mixers, and the mics,
// phones and layers it has open.
window.sceneSound = () => ({ silent, sinkId, copyError, micsHere, micCtx, playCtx, micChains, micDevices, phones, layers });

sceneEvents<SceneState>(render);

// What makes this file a module (its names its own), as the first line says.
export {};
