// FirstPass Studio - sequences: the scene's sources played one after another, built on the Output page.
//
// A sequence is a list of steps. Each step turns on one or more sources and stays for a length: a set
// time (a still graphic or a page), until its videos and animations finish, or until Next is pressed.
// A step can instead go to a scene (a starting or reset point: the scene's sources become the base the
// next steps play over, and they stay on after the sequence like any scene's), or play another sequence
// in its place (a mini sequence built once and used in many). Played sequences are flattened into one
// list of steps when the sequence starts; a sequence can never end up inside itself.
// When the last step ends the sequence plays again (repeat) or does its Then: go to a scene, turn off what it turned on, or leave it all.
//
// It only ever turns off sources it turned on itself, so a source put on by hand is left alone, and
// manual controls keep working: Next, Pause and Stop, a source turned
// off by hand moves to the next step, and going to a scene stops the sequence. One plays at a time on each output.
//
// With more than one output (outputs.js), sequences are shared: any sequence plays on any output, picked
// when it's played (a.output), turning its sources on and off there. Each output has its own runner, so one
// sequence can play on each at once (the same one on two, even). A sequence that starts by itself starts
// on its startOn output (the primary unless set, and the primary when that output has gone). Only the
// primary plays music: on another output a sequence plays its steps silently, and its Sponsor ads steps
// play nothing (go straight on).
//
// Sequences belong to the competition in use (sequences.json in its folder) and refer to the scene's
// shared sources and scenes by id. The runner lives here in Studio, not in a page, so it keeps time
// with the Output page closed. What's playing isn't saved: after a restart nothing is playing.
//
// Game triggers: a sequence can start by itself N minutes before the picked game's scheduled start
// (only when Studio was running at that moment: opened inside the window, it's left to the operator),
// at quarter time, half time or three quarter time, or at full time, a few seconds after the siren.
// The moments come from the scoreboard Studio already keeps (server.js calls game() each second with
// the clock, quarter and start time), so there are no extra PlayHQ calls. A triggered start waits
// its few seconds as "pending", with Start now and Cancel. Automatic starts sit behind one switch, remembered between launches; with it
// off nothing starts by itself. A step can last until the game moves on (the clock starts, or a break
// or full time comes), and a sequence can repeat until play resumes or until N minutes before the start:
// it finishes the step on screen, then ends.

'use strict';

const fs = require('fs');
const path = require('path');
const datadir = require('./datadir');
const savefile = require('./savefile');
const music = require('./music');

const COLOURS = ['blue', 'green', 'grey', 'yellow', 'purple'];
// Scenes and sequences are listed by their colour group, in the order of a stream (pre-game, live stream,
// quarter time, post-game, ads), then by name. Stream Deck Next and Previous go in this order too.
const COLOUR_ORDER = ['green', 'blue', 'purple', 'grey', 'yellow'];
const byColour = (a, b) => (COLOUR_ORDER.indexOf(a.colour) - COLOUR_ORDER.indexOf(b.colour)) || String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: 'base' });
const LENGTHS = ['time', 'done', 'next', 'game', 'now'];
const KINDS = ['sources', 'scene', 'sequence', 'ads'];
// How deep sequences inside sequences go, and how many steps one can flatten to.
const MAX_DEPTH = 8, MAX_FLAT = 1000;
const REPEATS = ['once', 'loop', 'until'];
const STARTS = ['hand', 'before', 'break', 'fulltime'];
const BREAKS = ['qt', 'ht', '3qt'];
const BREAK_NAMES = { qt: 'quarter time', ht: 'half time', '3qt': 'three quarter time' };
const THENS = ['scene', 'off', 'leave', 'sequence'];
const MUSIC_ENDS = ['fade', 'cut', 'continue'];
// Sequence link names that are the playing-sequence links instead (/deck/sequence/next).
const RESERVED = new Set(['next', 'advance', 'stop', 'pause', 'resume', 'now', 'cancel', 'auto']);
// Until it finishes stops waiting after this: a page that never says it's done, a video of unknown length.
const PAGE_LIMIT_MS = 60000, VIDEO_LIMIT_MS = 10 * 60000, VIDEO_SPARE_MS = 3000;
// A clock at 0:00 counts as the siren once it has stayed there this long (a scorer's correction
// can touch 0:00 for a moment).
const SETTLE_MS = 3000;

let log = () => {};
let api = null;       // the scene, from scene.js
let fileOf = () => null;
let file = null;      // sequences.json of the competition in use
let list = [];
// The runner of the output being worked on (here): the functions below use these. Each output's are kept
// in runners while another's are in use; within() switches.
let run = null;       // what's playing
let timer = null;
let fadeTimer = null; // starts a music fade out early, so it's done as the step (and the music with it) ends
let pending = null;   // a triggered start waiting its few seconds: { id, reason, at, afterEnd }
let pendTimer = null;
const PRIMARY = 'main';
let here = PRIMARY;
const runners = new Map(); // output id -> { run, timer, fadeTimer, pending, pendTimer }
let auto = true;      // the Automatic sequences switch
let settingsFile = null;
let game = null;      // the latest scoreboard reading, from game()
let watch = null;     // what's been seen of that game: { id, fired, ranIn, everRan, zeroAt, running, period, onBreak }
let studioStartedAt = Date.now(); // when Studio started: a "before the start" moment passed before then is skipped

const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const slug = s => String(s || '').toLowerCase().replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const newId = () => Math.random().toString(36).slice(2, 10);
const cleanId = (id, fallback) => String(id || '').replace(/[^a-z0-9]/gi, '').slice(0, 20) || fallback;
const ids = v => [...new Set((Array.isArray(v) ? v : []).map(x => cleanId(x, '')).filter(Boolean))].slice(0, 50);

// ─── One runner per output ───────────────────────────────────────────────
function stash() { runners.set(here, { run, timer, fadeTimer, pending, pendTimer }); }
function unstash() { ({ run = null, timer = null, fadeTimer = null, pending = null, pendTimer = null } = runners.get(here) || {}); }
// Runs fn with output out's runner in use.
function within(out, fn) {
  out = out || PRIMARY;
  if (out === here) return fn();
  const was = here;
  stash(); here = out; unstash();
  try { return fn(); } finally { stash(); here = was; unstash(); }
}
// fn for every output with a runner.
function each(fn) { for (const out of new Set([here, ...runners.keys()])) within(out, fn); }
// A timer's callback, run with the runner that set it.
const bound = fn => { const out = here; return () => within(out, fn); };
// The output a sequence starts by itself on: its startOn, or the primary when that output has gone.
const outOf = sq => sq && sq.startOn && sq.startOn !== PRIMARY && api?.hasOutput?.(sq.startOn) ? sq.startOn : PRIMARY;
// Music is the primary's alone: another output's sequences play theirs silently.
const SILENT = { stopFor() {}, quiet() {}, playFor() {}, handOver() {} };
const sound = () => here === PRIMARY ? music : SILENT;

function uniqueName(name, id) {
  const base = String(name || '').trim().slice(0, 60) || 'Sequence';
  const taken = new Set([...RESERVED, ...list.filter(s => s.id !== id).map(s => slug(s.name))]);
  if (!taken.has(slug(base)) && slug(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(slug(`${base} ${i}`))) return `${base} ${i}`;
}

// A step: sources (kind left out), a scene to go to, or another sequence played in its place (no length:
// its own steps have theirs). 'now' (straight on) is for scene steps.
function cleanStep(st) {
  const s = st && typeof st === 'object' ? st : {};
  const kind = KINDS.includes(s.kind) ? s.kind : 'sources';
  const id = cleanId(s.id, newId());
  if (kind === 'sequence') return { id, kind, sequence: cleanId(s.sequence, '') };
  // Sponsor ads: the next count ads in the sponsors' rotation, each as long as it is; house: the house ad
  // (ad.html) plays when no sponsor has an ad.
  if (kind === 'ads') return { id, kind, count: Math.round(clamp(s.count, 1, 5, 1)), house: s.house !== false };
  const l = s.length && typeof s.length === 'object' ? s.length : {};
  let type = LENGTHS.includes(l.type) ? l.type : kind === 'scene' ? 'now' : 'time';
  if (type === 'now' && kind !== 'scene') type = 'time';
  const length = type === 'time' ? { type, sec: Math.round(clamp(l.sec, 1, 3600, 20)) } : { type };
  if (kind === 'scene') return { id, kind, scene: cleanId(s.scene, ''), sources: [], length };
  return { id, sources: ids(s.sources), length };
}
function cleanStart(v) {
  const s = v && typeof v === 'object' ? v : {};
  const type = STARTS.includes(s.type) ? s.type : 'hand';
  if (type === 'before') return { type, min: Math.round(clamp(s.min, 1, 120, 10)) };
  const afterSec = Math.round(clamp(s.afterSec, 0, 120, 5));
  if (type === 'fulltime') return { type, afterSec };
  if (type === 'break') {
    const breaks = BREAKS.filter(b => Array.isArray(s.breaks) && s.breaks.includes(b));
    return { type, breaks: breaks.length ? breaks : [...BREAKS], afterSec };
  }
  return { type };
}
// A sequence's music: a track or a playlist, starting at a step (from 1), from a start mark, with a fade in.
function cleanMusic(v) {
  const m = v && typeof v === 'object' ? v : null;
  if (!m || (!m.track && !m.playlist)) return null;
  return {
    ...(m.playlist ? { playlist: cleanId(m.playlist, '') } : { track: String(m.track).split(/[\\/]/).pop().slice(0, 200) }),
    startStep: Math.round(clamp(m.startStep, 1, 100, 1)),
    startAtSec: Math.round(clamp(m.startAtSec, 0, 3600, 0) * 10) / 10,
    fadeInSec: clamp(m.fadeInSec, 0, 30, 2),
  };
}
// How the music ends with the sequence: fade out (sec), cut, or carry on into the sequence it hands over to.
function cleanMusicEnd(v) {
  const e = v && typeof v === 'object' ? v : {};
  const type = MUSIC_ENDS.includes(e.type) ? e.type : 'fade';
  return type === 'fade' ? { type, sec: clamp(e.sec, 0.5, 30, 3) } : { type };
}
function cleanUntil(v) {
  const u = v && typeof v === 'object' ? v : {};
  return u.moment === 'before' ? { moment: 'before', min: Math.round(clamp(u.min, 0, 120, 2)) } : { moment: 'resume' };
}

// Fills in and tidies every setting, so a hand-edited or older sequences.json is always usable.
function clean(input, existing = {}) {
  const s = { ...existing, ...input };
  const then = s.then && typeof s.then === 'object' ? s.then : {};
  const out = {
    id: cleanId(existing.id || s.id, newId()),
    name: '',
    colour: COLOURS.includes(s.colour) ? s.colour : 'blue',
    repeat: REPEATS.includes(s.repeat) ? s.repeat : 'once',
    start: cleanStart(s.start),
    then: THENS.includes(then.type) ? { type: then.type, ...(then.type === 'scene' ? { scene: cleanId(then.scene, '') } : then.type === 'sequence' ? { sequence: cleanId(then.sequence, '') } : {}) } : { type: 'off' },
    music: cleanMusic(s.music),
    musicEnd: cleanMusicEnd(s.musicEnd),
    quiet: !!s.quiet,
    hidden: !!s.hidden,  // left off the Output page's list (a mini sequence used inside others)
    startOn: cleanId(s.startOn, PRIMARY), // the output it starts by itself on (outputs.js), the primary unless set
    steps: (Array.isArray(s.steps) ? s.steps : []).slice(0, 100).map(cleanStep),
  };
  // Sources once kept on for the whole sequence (a scene step does that now) join each of its source steps.
  const kept = ids(s.keepOn);
  if (kept.length) for (const st of out.steps) if (!st.kind || st.kind === 'sources') st.sources = [...new Set([...kept, ...st.sources])];
  if (out.repeat === 'until') out.until = cleanUntil(s.until);
  out.name = uniqueName(s.name, out.id);
  return out;
}

function find(ref) {
  const r = String(ref || '');
  return list.find(s => s.id === r) || list.find(s => slug(s.name) === slug(r)) || null;
}
const playing = () => run ? list.find(s => s.id === run.id) || null : null;

// A sequence's steps as they play: sequence steps replaced by that sequence's own steps, over and over for sequences inside those. top is the step of the
// sequence itself each one comes from; a sequence already on the way in (one inside itself) is skipped.
// path is where each one is: the sequence, its step and which time through it (occ, 0 for the sequence
// itself), from the sequence itself in to the one the step belongs to.
function flatten(sq, chain = [], out = [], top = null, path = [], count = { occ: 0 }) {
  if (!sq || chain.includes(sq.id) || chain.length >= MAX_DEPTH) return out;
  const inner = [...chain, sq.id];
  const occ = count.occ++;
  sq.steps.forEach((st, i) => {
    if (out.length >= MAX_FLAT) return;
    const at = top === null ? i : top;
    const here = [...path, { id: sq.id, i, occ }];
    if (st.kind === 'sequence') {
      const sub = list.find(x => x.id === st.sequence);
      const from = out.length;
      flatten(sub, inner, out, at, here, count);
      for (let k = from; k < out.length; k++) out[k].via = [sub.name, ...(out[k].via || [])];
    } else if (st.kind === 'ads') {
      // One step per ad, filled in with the ad as it comes on (fillAd); until then it waits, as far as anyone can tell.
      for (let n = 0; n < st.count && out.length < MAX_FLAT; n++) out.push({ id: `${st.id}${n}`, kind: 'ad', house: st.house, sources: [], length: { type: 'next' }, top: at, path: here });
    } else out.push({ ...st, sources: [...(st.sources || [])], top: at, path: here });
  });
  return out;
}
// Whether sq plays the sequence id somewhere inside it (so id can't play sq).
function contains(sq, id, seen = new Set()) {
  if (!sq || seen.has(sq.id)) return false;
  seen.add(sq.id);
  return sq.steps.some(st => st.kind === 'sequence' && (st.sequence === id || contains(list.find(x => x.id === st.sequence), id, seen)));
}
// A sequence about to be saved that would play itself: the reason it can't, or null.
function loops(sq) {
  for (const st of sq.steps) {
    if (st.kind !== 'sequence') continue;
    const sub = list.find(x => x.id === st.sequence);
    if (st.sequence === sq.id) return `"${sq.name}" can't play itself.`;
    if (sub && contains(sub, sq.id)) return `"${sub.name}" already plays "${sq.name}", so it can't go inside it.`;
  }
  return null;
}
// What a sequence shows first, kept on when it takes over from another.
const firstOf = sq => flatten(sq)[0]?.sources || [];
const current = () => run && run.steps ? run.steps[run.step] : null;
// How the music on a step ends: as the sequence playing it says (the outermost with music, so the
// sequence itself when it has some), whichever sequence the step belongs to.
const musicEndAt = (step, sq) => (musicOf(step)?.sq || sq).musicEnd;
const quietStep = step => step?.kind === 'scene' && !!api.scene(step.scene)?.quiet;
// Whose music a step plays: the sequence's own, else that of the outermost sequence inside it (on the way
// to the step) that has some, with the step it's at in that one.
function musicOf(step) {
  for (const at of step?.path || []) {
    const sq = list.find(x => x.id === at.id);
    if (sq && sq.music) return { sq, ...at };
  }
  return null;
}

// ─── Saving: one file per competition ────────────────────────────────────
function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    list = [];
    for (const s of Array.isArray(saved.sequences) ? saved.sequences : []) if (s && typeof s === 'object') list.push(clean(s));
  } catch (err) {
    if (err.code !== 'ENOENT') log('warn', 'sequence', `Could not read ${file}, starting with no sequences: ${err.message}`);
    list = [];
  }
}
function save() {
  if (file) {
    try {
      savefile.writeJsonSync(file, { sequences: list });
    } catch (err) { log('error', 'sequence', `Could not save ${file}: ${err.message}`); }
  }
}

// The Automatic sequences switch, kept in the data folder for every competition.
function loadSettings() {
  try { auto = JSON.parse(fs.readFileSync(settingsFile, 'utf8')).auto !== false; }
  catch (err) { if (err.code !== 'ENOENT') log('warn', 'sequence', `Could not read ${settingsFile}: ${err.message}`); }
}
function saveSettings() {
  try { savefile.writeJsonSync(settingsFile, { auto }); }
  catch (err) { log('error', 'sequence', `Could not save ${settingsFile}: ${err.message}`); }
}

// The competition in use may have changed: stop what's playing and load that competition's sequences.
// Saving the same competition's setup leaves a playing sequence running.
function reload() {
  // With no competition yet, they're kept in the data folder.
  const next = fileOf() || datadir.file('sequences.json');
  if (next === file) return false;
  each(() => {
    if (run) interrupt(new Set(), 'the competition changed');
    cancelPending('the competition changed');
  });
  file = next;
  load();
  log('info', 'sequence', `${list.length} sequence${list.length === 1 ? '' : 's'} for this competition`);
  return true;
}

// ─── Playing ─────────────────────────────────────────────────────────────
const now = () => Date.now();
const source = id => api.source(id);

// On and off on the output this runner is for.
const isOn = s => api.isOn ? api.isOn(s, here) : s.visible;
function turnOn(id) {
  const s = source(id);
  if (!s || isOn(s)) return;
  api.setOn(s, true, here);
  run.shown.add(id);
}
function turnOff(id) {
  if (!run.shown.has(id)) return;
  run.shown.delete(id);
  const s = source(id);
  if (s && isOn(s)) api.setOn(s, false, here);
}

// How long Until it finishes waits for a step at most.
function limitFor(step) {
  let ms = 0;
  for (const id of step.sources) {
    const s = source(id);
    if (!s) continue;
    if (s.type === 'video' && !s.loop) {
      const sec = api.duration(s.file);
      ms = Math.max(ms, sec ? sec * 1000 + VIDEO_SPARE_MS : VIDEO_LIMIT_MS);
    } else if (s.type === 'browser') ms = Math.max(ms, PAGE_LIMIT_MS);
  }
  return ms || PAGE_LIMIT_MS;
}
// The sources an Until it finishes step waits for: its videos (that don't loop) and pages that are on.
function finishers(step) {
  return new Set(step.sources.filter(id => {
    const s = source(id);
    return s && isOn(s) && (s.type === 'browser' || (s.type === 'video' && !s.loop));
  }));
}

function schedule() {
  clearTimeout(timer);
  timer = null;
  if (run && !run.paused && run.endsAt !== null) timer = setTimeout(bound(tick), Math.max(0, run.endsAt - now()));
  planFade();
}
// How long the music fades out over as step i ends, when it ends there: the sequence's music on its last
// step (played once), or a sequence inside's music on that one's last step. 0 when it doesn't end or cuts.
function fadeOutSecFor(i) {
  const sq = playing(), st = run.steps[i], nx = run.steps[i + 1];
  if (!nx) { const end = musicEndAt(st, sq); return sq.repeat === 'once' && end.type === 'fade' ? end.sec : 0; }
  const m = musicOf(st);
  return m && m.occ && musicOf(nx)?.occ !== m.occ && m.sq.musicEnd.type === 'fade' ? m.sq.musicEnd.sec : 0;
}
// A fade out starts that long before a step of set time ends, so the music is gone as it ends and never
// carries into what comes next. (A step ended early by Next fades out from then.)
function planFade() {
  clearTimeout(fadeTimer);
  fadeTimer = null;
  if (!run || run.paused || run.endsAt === null || run.fadeEndsAt || current()?.length.type !== 'time') return;
  const sec = fadeOutSecFor(run.step);
  if (!sec) return;
  fadeTimer = setTimeout(bound(() => {
    fadeTimer = null;
    if (!run || run.paused || run.endsAt === null) return;
    run.fadeEndsAt = run.endsAt;
    sound().stopFor(run.id, Math.max(0, run.endsAt - now()) / 1000);
  }), Math.max(0, run.endsAt - sec * 1000 - now()));
}
// What's left of a fade out already under way, or the whole of it.
const fadeLeft = (r, sec) => r.fadeEndsAt ? Math.max(0, r.fadeEndsAt - now()) / 1000 : sec;
function tick() {
  timer = null;
  if (run && !run.paused && run.endsAt !== null && run.endsAt <= now()) { advance(); api.changed(); }
  else schedule();
}

// A Sponsor ads step coming on: the next ad in the rotation, in the scene's Sponsor ad source (scene.js
// sponsorAd), as long as the ad: a video until it finishes, a still for its seconds. With no ad to play
// (and no house ad), it goes straight on.
function fillAd(step) {
  // On another output, in that output's own ad sources (silent there, like everything off the primary).
  const ad = api.sponsorAd ? api.sponsorAd({ house: step.house }, here) : null;
  step.sources = ad ? [ad.source] : [];
  step.length = ad ? ad.length : { type: 'now' };
  step.ad = ad ? ad.name : null;
}

function enter(i) {
  const sq = playing();
  const before = run.steps[run.step];
  const step = run.steps[i];
  if (step.kind === 'ad') fillAd(step);
  const faded = { fadeEndsAt: run.fadeEndsAt };
  const sc = step.kind === 'scene' ? api.scene(step.scene) : null;
  // Sources of the step before that this step doesn't keep go off as these come on.
  const keep = new Set([...step.sources, ...(sc ? Object.keys(sc.states).filter(id => sc.states[id] === 'on') : [])]);
  if (before) for (const id of before.sources) if (!keep.has(id)) turnOff(id);
  for (const id of step.sources) turnOn(id);
  // A scene step goes to the scene (without stopping the sequence): the sources it sets are the scene's
  // now, the base the next steps play over, and they stay as the scene left them when the sequence ends.
  if (sc) { api.goTo(sc, true, here); for (const id of Object.keys(sc.states)) run.shown.delete(id); }
  // A scene step with Quiet the music ducked it: the music comes back up as the sequence moves on.
  if (quietStep(before) && !(sc && sc.quiet)) sound().quiet(sq.quiet);
  Object.assign(run, { step: i, stepAt: now(), paused: false, pausedLeft: null, ready: false, waiting: null, fadeEndsAt: null });
  if (step.length.type === 'now') run.endsAt = now();
  else if (step.length.type === 'time') run.endsAt = now() + step.length.sec * 1000;
  else if (step.length.type === 'next' || step.length.type === 'game') run.endsAt = null;
  else {
    run.waiting = finishers(step);
    run.endsAt = now() + (run.waiting.size ? limitFor(step) : 0);
  }
  const what = step.kind === 'scene' ? `scene "${sc ? sc.name : 'gone'}"` : step.kind === 'ad' ? (step.ad ? `ad: ${step.ad}` : 'no ad to play') : step.sources.map(id => source(id)?.name).filter(Boolean).join(', ');
  log('info', 'sequence', `"${sq.name}" step ${i + 1} of ${run.steps.length}${step.via ? ` (in ${step.via.join(' › ')})` : ''}${what ? `: ${what}` : ''}`);
  // Music: the sequence's own, or with none, that of a sequence inside it while that one plays.
  const m = musicOf(step), was = before ? musicOf(before) : null;
  // Out of a sequence inside whose music was on: it ends as that sequence's music ends (fade or cut).
  if (was && was.occ && (!m || m.occ !== was.occ) && was.sq.musicEnd.type !== 'continue') {
    sound().stopFor(run.id, was.sq.musicEnd.type === 'cut' ? 0 : fadeLeft(faded, was.sq.musicEnd.sec || music.STOP_FADE_SEC));
  }
  // It starts at its step (the first one played from it). The sequence's own starts the first time through
  // only (the track itself loops); one inside starts each time that sequence plays.
  if (m) {
    const musicAt = Math.min(m.sq.music.startStep, m.sq.steps.length) - 1;
    const from = before && before.path.find(at => at.occ === m.occ);
    if (m.i === musicAt && !(from && from.i === musicAt && run.step < i) && !(m.occ === 0 && run.loop)) sound().playFor(run.id, m.sq.music);
  }
  schedule();
}

function advance() {
  const sq = playing();
  if (!sq) return;
  // A repeat until that has had its moment ends with the step that was on.
  if (run.finishing) return finish(run.finishing);
  if (run.step + 1 < run.steps.length) return enter(run.step + 1);
  if ((sq.repeat === 'loop' || sq.repeat === 'until') && run.steps.length) {
    // Steps that all go straight on (scenes, nothing to wait for) would go round as fast as they can.
    if (now() - run.loopAt < 1000) return finish('one time through took no time, so it can\'t repeat');
    run.loop++;
    run.loopAt = now();
    return enter(0);
  }
  finish('it finished');
}

function start(sq, why) {
  if (pending && pending.id === sq.id) cancelPending(null);
  run = { id: sq.id, steps: flatten(sq), step: -1, loop: 0, startedAt: now(), loopAt: now(), shown: new Set(), stepAt: now(), endsAt: null, paused: false, pausedLeft: null, ready: false, waiting: null, finishing: null };
  log('info', 'sequence', `Started "${sq.name}"${why ? `: ${why}` : ''}`);
  sound().quiet(sq.quiet);
  if (run.steps.length) enter(0); else finish('it has no steps');
}

// The end of a sequence, played out or stopped: its Then.
function finish(why) {
  const sq = playing();
  clearTimeout(timer);
  clearTimeout(fadeTimer);
  timer = fadeTimer = null;
  const ended = run;
  const then = sq ? sq.then : { type: 'off' };
  const sc = then.type === 'scene' ? api.scene(then.scene) : null;
  const next = then.type === 'sequence' ? list.find(s => s.id === then.sequence && s.id !== ended.id) : null;
  const end = sq ? musicEndAt(ended.steps[ended.step], sq) : { type: 'fade', sec: music.STOP_FADE_SEC };
  if (next && end.type === 'continue') sound().handOver(ended.id, next.id);
  else sound().stopFor(ended.id, end.type === 'cut' ? 0 : fadeLeft(ended, end.sec || music.STOP_FADE_SEC));
  if (next) {
    // Hands over to the next sequence: its own sources go off as the next one's first step comes on.
    const keep = new Set(firstOf(next));
    for (const id of [...ended.shown]) if (!keep.has(id)) turnOff(id);
  } else if (then.type === 'scene' && sc) {
    // The scene decides about the sources it sets; the sequence turns off its own that the scene leaves alone.
    for (const id of [...ended.shown]) if (!sc.states[id]) turnOff(id);
  } else if (then.type !== 'leave') for (const id of [...ended.shown]) turnOff(id);
  // Ending on a scene step that quieted the music brings it back up, unless a scene or sequence takes over.
  if (quietStep(ended.steps[ended.step]) && !sc && !next) sound().quiet(false);
  run = null;
  log('info', 'sequence', `"${sq ? sq.name : '?'}" ended (${why})${next ? `, then "${next.name}"` : sc ? `, going to scene "${sc.name}"` : then.type === 'scene' ? ', its scene has gone so its sources go off' : then.type === 'sequence' ? ', its next sequence has gone so its sources go off' : then.type === 'leave' ? ', leaving its sources as they are' : ''}`);
  if (sc) api.goTo(sc, false, here);
  // A sequence with no steps would end at once, so a chain of them can't go round for ever.
  if (next && flatten(next).length && !(pending && pending.afterEnd)) start(next, `after "${sq.name}"`);
  // A triggered start that waited for this one to finish goes now.
  if (pending && pending.afterEnd) startPending();
}

// Stopped by something else (a scene, another sequence, every source off): no Then, and its own
// sources go off unless keep says they stay on.
function interrupt(keep, why) {
  if (!run) return;
  const sq = playing();
  clearTimeout(timer);
  clearTimeout(fadeTimer);
  timer = fadeTimer = null;
  for (const id of [...run.shown]) if (!keep.has(id)) turnOff(id);
  // The music fades out over its own Music ends time (or cuts), as when the sequence ends.
  const end = sq ? musicEndAt(current(), sq) : { type: 'fade' };
  sound().stopFor(run.id, end.type === 'cut' ? 0 : fadeLeft(run, end.type === 'fade' ? end.sec : music.STOP_FADE_SEC));
  run = null;
  log('info', 'sequence', `Stopped "${sq ? sq.name : '?'}" because ${why}`);
  // One that was waiting for it to finish its step gives way too: something else was picked.
  if (pending && pending.afterEnd) cancelPending(`"${sq ? sq.name : '?'}" stopped because ${why}`);
}

// ─── Game triggers ───────────────────────────────────────────────────────
// A repeat until sequence that has had its moment finishes the step on screen, then ends. A step that
// only ends with Next or the game ends now.
function finishSoon(why) {
  if (!run || run.finishing) return;
  run.finishing = why;
  const step = current();
  log('info', 'sequence', `"${playing()?.name}" ends after this step: ${why}`);
  if (!step || step.length.type === 'next' || step.length.type === 'game') finish(why);
}

function schedulePending() {
  clearTimeout(pendTimer);
  pendTimer = null;
  if (!pending || pending.afterEnd) return;
  pendTimer = setTimeout(bound(() => {
    pendTimer = null;
    if (pending && pending.at <= now()) { startPending(); api.changed(); } else schedulePending();
  }), Math.max(0, pending.at - now()));
}
function cancelPending(why) {
  if (!pending) return;
  if (why) log('info', 'sequence', `"${find(pending.id)?.name || '?'}" won't start: ${why}`);
  pending = null;
  schedulePending();
}
// Its few seconds are up (or Start now). A repeat until sequence on screen gets to finish its step first.
function startPending() {
  const p = pending;
  const sq = p && find(p.id);
  if (!sq) { cancelPending(null); return; }
  if (run && run.finishing && run.id !== sq.id && !p.now) {
    p.afterEnd = true;
    schedulePending();
    log('info', 'sequence', `"${sq.name}" starts when "${playing()?.name}" finishes its step`);
    return;
  }
  pending = null;
  schedulePending();
  if (run) interrupt(new Set(firstOf(sq)), `"${sq.name}" started`);
  start(sq, p.reason);
}
// A game moment that starts a sequence: it waits afterSec as pending, unless Automatic sequences is off.
function trigger(sq, reason, afterSec) {
  if (!auto) { log('info', 'sequence', `${reason}: "${sq.name}" would start, but Automatic sequences is off`); return; }
  if (run && run.id === sq.id) return;
  // The sequence on screen repeats until the next trigger: this is it.
  if (playing()?.repeat === 'until') finishSoon(`"${sq.name}" is next`);
  pending = { id: sq.id, reason, at: now() + afterSec * 1000, afterEnd: false };
  log('info', 'sequence', `${reason}: "${sq.name}" starts${afterSec ? ` in ${afterSec} s` : ''}`);
  if (afterSec) schedulePending(); else startPending();
}

function breakAfter(period, last) {
  if (last === 2) return period === 1 ? 'ht' : null;
  return BREAKS[period - 1] || null;
}
// The end of a quarter (or half): a break, or full time after the last one. Each counts once a game.
function periodEnded(period) {
  const last = game.last || 4;
  const key = period >= last ? 'fulltime' : `end${period}`;
  if (watch.fired.has(key)) return null;
  watch.fired.add(key);
  if (period >= last) return { kind: 'fulltime' };
  const which = breakAfter(period, last);
  return which ? { kind: 'break', which } : null;
}

// The scoreboard now, each second: { id, label, startAt, period, last, left (seconds), running, onBreak,
// finished, breaks: { qt, ht, '3qt' } (minutes) }. Works out the game's moments and acts on them.
function gameTick(g) {
  const t = now();
  const was = game;
  game = g && g.id ? g : null;
  if (!game) { watch = null; if (was) api.changed(); return; }
  if (!watch || watch.id !== game.id) watch = { id: game.id, fired: new Set(), ranIn: 0, everRan: false, zeroAt: null, running: game.running, period: game.period, onBreak: !!game.onBreak, finished: !!game.finished };
  // Back to an earlier quarter (the scoreboard reset for another game by hand): its breaks count again.
  if (game.period < watch.period) Object.assign(watch, { fired: new Set(), ranIn: 0, everRan: false, zeroAt: null });
  const moments = [];
  let changed = !was || was.id !== game.id || was.label !== game.label || was.startAt !== game.startAt;
  if (game.running && !watch.running) moments.push({ kind: 'resume' });
  if (game.running) { watch.ranIn = game.period; watch.everRan = true; }
  // The siren: the clock at 0:00 for a moment (in a quarter it ran in), PlayHQ's break flag, the scorer
  // moving on to the next quarter, or the game marked finished.
  if (game.period > watch.period && watch.ranIn === watch.period) { const m = periodEnded(watch.period); if (m) moments.push(m); }
  if (game.left === 0 && watch.ranIn === game.period) watch.zeroAt ??= t; else watch.zeroAt = null;
  if ((watch.zeroAt !== null && t - watch.zeroAt >= SETTLE_MS) || (game.onBreak && !watch.onBreak && watch.ranIn === game.period)) { const m = periodEnded(game.period); if (m) moments.push(m); }
  if (game.finished && !watch.finished && watch.everRan && !watch.fired.has('fulltime')) { watch.fired.add('fulltime'); moments.push({ kind: 'fulltime' }); }
  Object.assign(watch, { running: game.running, period: game.period, onBreak: !!game.onBreak, finished: !!game.finished });

  for (const m of moments) {
    log('info', 'sequence', `Game moment: ${m.kind === 'resume' ? 'the clock started' : m.kind === 'break' ? BREAK_NAMES[m.which] : 'full time'} (${game.label || game.id})`);
    changed = true;
    // A step until the game moves on ends; a sequence repeating until play resumes finishes its step.
    each(() => { if (current()?.length.type === 'game') advance(); });
    if (m.kind === 'resume') {
      each(() => {
        if (playing()?.repeat === 'until' && playing().until.moment === 'resume') finishSoon('play resumed');
        if (pending && !pending.afterEnd) cancelPending('play resumed first');
      });
      continue;
    }
    // The first sequence for the moment on each output starts there.
    for (const out of new Set(list.map(outOf))) {
      const next = list.find(s => outOf(s) === out && (m.kind === 'break' ? s.start.type === 'break' && s.start.breaks.includes(m.which) : s.start.type === 'fulltime'));
      if (next) within(out, () => trigger(next, m.kind === 'break' ? `It's ${BREAK_NAMES[m.which]}` : `It's full time`, next.start.afterSec));
    }
  }
  // Before the start: N minutes before the scheduled start, while the game hasn't begun.
  if (game.startAt && !watch.everRan && t < game.startAt) {
    each(() => {
      const on = playing();
      if (on && on.repeat === 'until' && on.until.moment === 'before' && !run.finishing && t >= game.startAt - on.until.min * 60000) {
        finishSoon(`${on.until.min} min before the start`);
        changed = true;
      }
    });
    for (const sq of list) {
      const at = game.startAt - sq.start.min * 60000;
      if (sq.start.type !== 'before' || t < at || watch.fired.has(`before:${sq.id}`)) continue;
      watch.fired.add(`before:${sq.id}`);
      // Its moment came while Studio wasn't running (it was opened inside the window): left to the operator.
      if (at < studioStartedAt) {
        log('info', 'sequence', `"${sq.name}" won't start by itself: Studio wasn't running ${sq.start.min} min before ${game.label || 'the game'}`);
        continue;
      }
      within(outOf(sq), () => trigger(sq, `${sq.start.min} min before ${game.label || 'the game'}`, 0));
      changed = true;
    }
  }
  if (changed) api.changed();
}

// The next start before the game, for the Output page: { id, at }.
function nextAuto() {
  if (!auto || !game || !game.startAt || (watch && watch.everRan)) return null;
  let best = null;
  for (const sq of list) {
    if (sq.start.type !== 'before' || (watch && watch.fired.has(`before:${sq.id}`))) continue;
    const at = game.startAt - sq.start.min * 60000;
    if (at > now() && (!best || at < best.at)) best = { id: sq.id, at };
  }
  return best;
}

// ─── What the scene tells the sequence ───────────────────────────────────
// A source finished by itself (a video ended, a page said it's done) on output out (the primary if left out).
function ended(src, out) { within(out, () => endedHere(src)); }
function endedHere(src) {
  if (!run || !run.waiting || !run.waiting.has(src.id)) return;
  run.waiting.delete(src.id);
  if (run.waiting.size) return;
  run.ready = true;
  if (run.paused) run.pausedLeft = 0;
  else run.endsAt = now();
  schedule();
}
// A source turned off by hand (on output out): if it's one the step is showing, on to the next step.
function turnedOff(src, out) { within(out, () => turnedOffHere(src)); }
function turnedOffHere(src) {
  if (!run) return;
  run.shown.delete(src.id);
  const step = current();
  if (step && step.sources.includes(src.id)) { log('info', 'sequence', `"${src.name}" turned off by hand, next step`); advance(); }
}
// A scene picked on output out stops the sequence playing there.
function beforeScene(sc, out) {
  within(out, () => { if (run) interrupt(new Set(Object.keys(sc.states).filter(id => sc.states[id] === 'on')), `scene "${sc.name}" was picked`); });
}
function allOff(out) { within(out, () => { if (run) interrupt(new Set(), 'every source was turned off'); }); }
// An output was removed: what played there stops (its sequences play on the primary from now on).
function dropOutput(out) {
  if (!out || out === PRIMARY) return;
  within(out, () => {
    if (run) interrupt(new Set(), 'its output was removed');
    cancelPending('its output was removed');
  });
  runners.delete(out);
}
function sourceRemoved(id) {
  let changedAny = false;
  for (const sq of list) {
    const count = () => sq.steps.reduce((n, st) => n + (st.sources || []).length, 0);
    const k = count();
    for (const st of sq.steps) if (st.sources) st.sources = st.sources.filter(x => x !== id);
    if (k !== count()) changedAny = true;
  }
  each(() => { if (run) { run.shown.delete(id); run.waiting?.delete(id); for (const st of run.steps) st.sources = st.sources.filter(x => x !== id); } });
  if (changedAny) save();
}

// ─── Changes from the Output page and the Stream Deck ────────────────────
// Returns an error, null when done, or undefined when the change isn't a sequence change. a.output (an
// output's id, from scene.js; the primary without one) is the output to play on, and the one Next, Stop,
// Pause and the like act on.
function apply(a) {
  const sq = a.sequence ? find(a.sequence) : null;
  return within(a.output || PRIMARY, () => applyHere(a, sq));
}
// The playing sequence (or one playing it inside) keeps going with its new steps, on every output.
function refreshPlaying() {
  each(() => {
    if (!run) return;
    run.steps = flatten(playing());
    if (run.step >= run.steps.length) { if (run.steps.length) enter(run.steps.length - 1); else finish('its steps were removed'); }
  });
}
function applyHere(a, sq) {
  const need = () => sq ? null : `No sequence "${a.sequence || ''}".`;
  switch (a.type) {
    case 'seqAdd': {
      const made = clean({ ...(a.changes || {}), id: undefined }, { id: newId() });
      if (loops(made)) return loops(made);
      list.push(made);
      save();
      log('info', 'sequence', `Made sequence "${made.name}"`);
      return null;
    }
    case 'seqUpdate': {
      if (need()) return need();
      const { id, ...changes } = a.changes || {};
      const i = list.indexOf(sq);
      const updated = clean(changes, sq);
      if (loops(updated)) return loops(updated);
      list[i] = updated;
      refreshPlaying();
      save();
      return null;
    }
    case 'seqCopy': {
      if (need()) return need();
      const copy = clean({ ...JSON.parse(JSON.stringify(sq)), name: `${sq.name} copy` }, { id: newId() });
      copy.steps = copy.steps.map(st => ({ ...st, id: newId() }));
      list.splice(list.indexOf(sq) + 1, 0, copy);
      save();
      return null;
    }
    case 'seqRemove':
      if (need()) return need();
      each(() => { if (run && run.id === sq.id) interrupt(new Set(), 'it was deleted'); });
      list.splice(list.indexOf(sq), 1);
      // Steps that played it play nothing now (the Output page says it's gone).
      refreshPlaying();
      save();
      log('info', 'sequence', `Deleted sequence "${sq.name}"`);
      return null;
    case 'seqMove': {
      if (need()) return need();
      const from = list.indexOf(sq);
      const to = a.to !== undefined ? clamp(a.to, 0, list.length - 1, from) : from + (a.direction === 'up' ? -1 : a.direction === 'down' ? 1 : 0);
      if (to < 0 || to >= list.length || to === from) return null;
      list.splice(from, 1);
      list.splice(to, 0, sq);
      save();
      return null;
    }
    case 'seqPlay': case 'seqToggle': {
      if (need()) return need();
      if (a.type === 'seqToggle' && run && run.id === sq.id) { finish('Stop was pressed'); return null; }
      // Another sequence stops first, keeping what this one shows straight away so it doesn't flicker.
      if (run) interrupt(new Set(firstOf(sq)), `"${sq.name}" started`);
      start(sq);
      return null;
    }
    case 'seqStop':
      if (!run) return null;
      if (a.sequence && (!sq || run.id !== sq.id)) return null;
      finish('Stop was pressed');
      return null;
    case 'seqNext':
      if (!run) return 'No sequence is playing.';
      log('info', 'sequence', 'Next pressed');
      advance();
      return null;
    case 'seqAdvance':
      // Next only for a step waiting on it (Until I press Next), the one on now, so one key fits every
      // sequence: anything else (a timed step, nothing playing) and the press does nothing.
      if (!run || current()?.length.type !== 'next') { log('info', 'sequence', 'Next (when waiting) pressed, nothing waiting for it'); return null; }
      log('info', 'sequence', `Next (when waiting) pressed: "${playing().name}" moves on`);
      advance();
      return null;
    case 'seqPause': case 'seqResume': case 'seqPauseToggle': {
      if (!run) return 'No sequence is playing.';
      const pause = a.type === 'seqPause' || (a.type === 'seqPauseToggle' && !run.paused);
      if (pause && !run.paused) {
        run.paused = true;
        run.pausedLeft = run.endsAt === null ? null : Math.max(0, run.endsAt - now());
        run.endsAt = null;
        log('info', 'sequence', `Paused "${playing().name}"`);
      } else if (!pause && run.paused) {
        run.paused = false;
        run.endsAt = run.pausedLeft === null ? null : now() + run.pausedLeft;
        run.pausedLeft = null;
        log('info', 'sequence', `Carried on with "${playing().name}"`);
      }
      schedule();
      return null;
    }
    case 'seqStartNow':
      if (!pending) return 'No sequence is about to start.';
      pending.now = true;
      startPending();
      return null;
    case 'seqCancel':
      cancelPending('Cancel was pressed');
      return null;
    case 'seqAuto': {
      const v = a.value === 'toggle' ? !auto : a.value === true || a.value === 'on' || a.value === 'true';
      if (v !== auto) {
        auto = v;
        saveSettings();
        log('info', 'sequence', `Automatic sequences ${auto ? 'on' : 'off'}`);
        if (!auto) cancelPending('Automatic sequences was turned off');
      }
      return null;
    }
    default:
      return undefined;
  }
}

// /deck/sequence/<name> (play), /deck/sequence/<name>/play|toggle|stop, for whatever is playing
// /deck/sequence/next|stop|pause|resume, for one about to start by itself /deck/sequence/now|cancel, and the Automatic sequences switch /deck/sequence/auto/on|off|toggle.
// out: the output these act on (/deck/output/<output>/sequence/…), the primary by default.
function deck(parts, out = PRIMARY) {
  const [what, name, verb] = parts;
  if (what !== 'sequence' || !name) return null;
  if (name === 'auto') {
    if (!['on', 'off', 'toggle'].includes(verb || 'toggle')) return null;
    apply({ type: 'seqAuto', value: verb || 'toggle' });
    return { body: { ok: true, auto } };
  }
  const PLAYING = { next: 'seqNext', advance: 'seqAdvance', stop: 'seqStop', pause: 'seqPauseToggle', resume: 'seqResume', now: 'seqStartNow', cancel: 'seqCancel' };
  const ONE = { play: 'seqPlay', start: 'seqPlay', toggle: 'seqToggle', stop: 'seqStop' };
  const action = !verb ? (PLAYING[name] ? { type: PLAYING[name], output: out } : { type: 'seqPlay', sequence: name, output: out }) : ONE[verb] ? { type: ONE[verb], sequence: name, output: out } : null;
  if (!action) return null;
  if (action.sequence && !find(action.sequence)) return { error: `No sequence "${name}".`, status: 404 };
  const error = apply(action);
  if (error) return { error, status: 409 };
  return within(out, () => {
    const sq = playing();
    return { body: { ok: true, playing: sq ? sq.name : null, step: run ? run.step + 1 : null, paused: run ? run.paused : false } };
  });
}

// How long a step still to come will take: its set time or its videos' length. open: it waits (Next, the
// game, a page, a video of unknown length), so it takes at least that.
function lengthOf(step) {
  const t = step.length.type;
  if (t === 'now') return { ms: 0, open: false };
  if (t === 'time') return { ms: step.length.sec * 1000, open: false };
  if (t !== 'done') return { ms: 0, open: true };
  let ms = 0, open = false;
  for (const id of step.sources) {
    const s = source(id);
    if (!s || (s.type === 'video' && s.loop)) continue;
    const sec = s.type === 'video' ? api.duration(s.file) : 0;
    if (sec) ms = Math.max(ms, sec * 1000); else if (s.type === 'video' || s.type === 'browser') open = true;
  }
  return { ms, open };
}
// Time left in the whole sequence: the step on now and every step after it (one time through when it repeats,
// unless it's finishing). open: some of it waits, so it's at least that.
function totalLeft(stepLeftMs) {
  const step = current();
  let ms = 0, open = stepLeftMs === null;
  if (stepLeftMs !== null) {
    ms = stepLeftMs;
    // Until it finishes counts to the video's end, not the few seconds' grace after it.
    if (step.length.type === 'done' && !run.ready && !run.paused) {
      const est = lengthOf(step);
      if (!est.open && est.ms) ms = Math.min(ms, Math.max(0, est.ms - (now() - run.stepAt)));
    }
  }
  if (!run.finishing) for (const st of run.steps.slice(run.step + 1)) { const l = lengthOf(st); ms += l.ms; open = open || l.open; }
  return { ms, open };
}

// What's playing on the output in use, for state().
function playingHere() {
  const sq = playing();
  const stepLeft = run && sq ? (run.paused ? run.pausedLeft : run.endsAt === null ? null : Math.max(0, run.endsAt - now())) : null;
  const total = run && sq ? totalLeft(stepLeft) : null;
  return run && sq ? {
      // step and steps count every step as it plays (sequences inside opened out); top is the sequence's own
      // step it comes from, via the sequences it's inside, and what it shows.
      id: run.id, step: run.step, steps: run.steps.length, loop: run.loop, paused: run.paused,
      top: current()?.top ?? null, via: current()?.via || [], scene: current()?.kind === 'scene' ? current().scene : null, sources: current()?.sources || [],
      ad: current()?.kind === 'ad' ? current().ad || null : undefined,
      // Time left on the step, when it has one: the page counts down from when it hears this.
      leftMs: stepLeft,
      length: current()?.length.type || null, ready: run.ready,
      // Time left in the whole sequence (counting down like leftMs while the step does); totalOpen: part of it
      // waits (Next, the game, a page), so it's at least that; repeats: it goes round again after this time through.
      totalLeftMs: total.ms, totalOpen: total.open, repeats: sq.repeat !== 'once' && !run.finishing,
      waiting: run.waiting ? [...run.waiting] : [], finishing: !!run.finishing,
    } : null;
}
// A triggered start counting down on the output in use: its time left (null while it waits for the one on screen to finish).
const pendingHere = () => pending && find(pending.id) ? { id: pending.id, reason: pending.reason, leftMs: pending.afterEnd ? null : Math.max(0, pending.at - now()) } : null;

function state() {
  // The primary's at the top (playing, pending), as before there could be more than one output; the
  // others' by output id (playingOut, pendingOut), only while there's something to say.
  const playingOut = {}, pendingOut = {};
  each(() => {
    if (here === PRIMARY) return;
    const p = playingHere(), w = pendingHere();
    if (p) playingOut[here] = p;
    if (w) pendingOut[here] = w;
  });
  return {
    sequences: [...list].sort(byColour).map(sq => ({ ...sq, startOn: outOf(sq) })),
    playing: within(PRIMARY, playingHere),
    playingOut,
    auto,
    pending: within(PRIMARY, pendingHere),
    pendingOut,
    nextAuto: nextAuto(),
    game: game ? { label: game.label || '', startAt: game.startAt || null, breaks: game.breaks || null, last: game.last || 4 } : null,
  };
}

function init(logger, hooks, sequencesFile) {
  studioStartedAt = now();
  log = logger || log;
  api = hooks;
  if (sequencesFile) fileOf = sequencesFile;
  settingsFile = datadir.file('sequence-settings.json');
  loadSettings();
  reload();
}

module.exports = { init, reload, file: () => file, apply, deck, state, byColour, game: gameTick, ended, turnedOff, beforeScene, allOff, sourceRemoved, dropOutput, slug, PRIMARY };
