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
// sequence can play on each at once (the same one on two, even). A sequence plays on its playsOn outputs
// (the primary unless set): started by itself, or played on one of them by hand or from the Stream Deck,
// it starts on all of them together (with "only", on the one picked alone). Played on another output it
// plays there alone. An output in playsOn that has gone is left out; with all of them gone it doesn't
// start by itself. Each output does its own Then when the sequence ends there (thenOn, else then), so one
// sequence played on two outputs can go to a different scene or sequence on each. A sequence's music is Output 1's,
// like all the music (music.js): it plays, quiets, fades and stops with the sequence on Output 1 (sound()), and a
// sequence playing on another output alone plays without it. Its Sponsor ads steps play in each output's own ad
// sources.
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
//
// The run order: Output 1 (the production feed) has a queue of what plays next tonight, sequences and scenes, built
// on the Output page (or loaded from a saved order) and added to on the fly. It is Output 1's alone (Matt, 2 Nov 2026:
// one run to follow): the other outputs have none, and a sequence it starts that plays on them too starts there as
// well and does its own Then there. Next (the panel's, or /deck/runorder/next) plays
// the head; a sequence that ends looks at the queue first and plays its head instead of its own Then, which is
// the fallback when nothing is queued. Whatever is at the head leaves the queue as it starts, however it was
// started. A game trigger puts its sequence at the head (with its few seconds' countdown as usual) rather than
// starting it blind; Cancel takes it out again. Playing a scene or sequence by hand leaves the queue as it is
// (unless it was the head). The queue is saved with the competition's sequences (runOrder), and named orders
// (runOrders) can be loaded for the night, renamed and deleted. The Production Planner can assign a saved order to a
// game (planner.js); it loads, in place of what's queued, as the scoreboard moves to that game (server.js).

'use strict';

const fs = require('fs');
const path = require('path');
const datadir = require('./datadir');
const savefile = require('./savefile');
const music = require('./music');
const switcher = require('./switcher');

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
const MUSIC_ENDS = ['fade', 'cut', 'continue', 'crossfade'];
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
let cut = null;       // the sequence that last ended here (played out or cut short), until it plays again
let queue = [];       // the run order here (Output 1's; always empty on the others): [{ key, kind: 'sequence' | 'scene', id }], the head first
let played = [];      // what the run order has played here tonight, oldest first: [{ key, kind, id, at }] (not saved: a relaunch starts it again)
let orders = [];      // the saved run orders of the competition in use: [{ id, name, items }]
let roNotice = null;  // the Production Planner loaded a game's run order over items queued: { text, at }, until closed (not saved)
const PRIMARY = 'main';
let here = PRIMARY;
const runners = new Map(); // output id -> { run, timer, fadeTimer, pending, pendTimer, cut, queue, played }
const MAX_QUEUE = 100, MAX_ORDERS = 30, MAX_PLAYED = 50;
const ITEM_KINDS = ['sequence', 'scene'];
let auto = true;      // the Automatic sequences switch
let settingsFile = null;
let game = null;      // the latest scoreboard reading, from game()
let watch = null;     // what's been seen of that game: { id, fired, ranIn, everRan, zeroAt, running, period, onBreak }
let studioStartedAt = Date.now(); // when Studio started: a "before the start" moment passed before then is skipped
// When a practice game last started or jumped with Run game-timed sequences again (rearm()), less a minute's
// grace so "Starts in" set to a sequence's minutes still runs it: from then on a "before the start" moment passed before
// it is skipped, in place of one passed before Studio started (a practice game's times are moved to now).
const REARM_GRACE_MS = 60000;
let rearmedAt = 0;

const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const slug = s => String(s || '').toLowerCase().replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const newId = () => Math.random().toString(36).slice(2, 10);
const cleanId = (id, fallback) => String(id || '').replace(/[^a-z0-9]/gi, '').slice(0, 20) || fallback;
const ids = v => [...new Set((Array.isArray(v) ? v : []).map(x => cleanId(x, '')).filter(Boolean))].slice(0, 50);

// ─── One runner per output ───────────────────────────────────────────────
function stash() { runners.set(here, { run, timer, fadeTimer, pending, pendTimer, cut, queue, played }); }
function unstash() { ({ run = null, timer = null, fadeTimer = null, pending = null, pendTimer = null, cut = null, queue = [], played = [] } = runners.get(here) || {}); }
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
// The outputs a sequence plays on together: its playsOn (the primary unless set) that are still there. With
// all of them removed it's none, and it doesn't start by itself: falling back to Output 1 would put a
// commentary monitor's loop on air.
const has = o => o === PRIMARY || !api?.hasOutput || api.hasOutput(o);
const outsOf = sq => !api?.hasOutput ? [PRIMARY] : (sq?.playsOn?.length ? sq.playsOn : [PRIMARY]).filter(has);
const gone = sq => !!sq && !outsOf(sq).length;
const goneNote = (sq, when) => log('info', 'sequence', `"${sq.name}" won't start by itself ${when}: the outputs it plays on have been removed (pick another in the sequence)`);
// The outputs a play or stop on output out reaches: all the sequence's own when out is one of them, else out alone.
const groupOf = (sq, out, only) => !only && outsOf(sq).includes(out) ? outsOf(sq) : [out];
// What output out does when the sequence ends there: its own Then, else the sequence's.
const thenFor = (sq, out) => (sq.thenOn && sq.thenOn[out]) || sq.then;
// The music is Output 1's: its runner plays, quiets and stops it, and the other outputs' runners play without it.
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
  // Switcher actions (switcher.js) done as the step starts, or a few seconds in.
  const sw = switcher.cleanActions(s.switcher);
  const extra = sw.length ? { switcher: sw } : {};
  if (kind === 'scene') return { id, kind, scene: cleanId(s.scene, ''), sources: [], length, ...extra };
  return { id, sources: ids(s.sources), length, ...extra };
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
    // Starts under the end of a video with its sound on in the step before, its fade in long, while the video's sound
    // fades out (a crossfade from the video).
    ...(m.underVideo ? { underVideo: true } : {}),
  };
}
// How the music ends with the sequence: fade out (sec), cut, carry on into the sequence it hands over to, or
// crossfade (sec): when other music starts straight after it (a sequence inside's, or the next sequence's), it plays
// on to the end and fades out under the new music as that fades in; with none, it fades out as fade does.
function cleanMusicEnd(v) {
  const e = v && typeof v === 'object' ? v : {};
  const type = MUSIC_ENDS.includes(e.type) ? e.type : 'fade';
  return type === 'fade' || type === 'crossfade' ? { type, sec: clamp(e.sec, 0.5, 30, 3) } : { type };
}
function cleanUntil(v) {
  const u = v && typeof v === 'object' ? v : {};
  return u.moment === 'before' ? { moment: 'before', min: Math.round(clamp(u.min, 0, 120, 2)) } : { moment: 'resume' };
}

// Then: go to a scene, play a sequence, turn off what it turned on, or leave it all.
function cleanThen(v) {
  const t = v && typeof v === 'object' ? v : {};
  return THENS.includes(t.type) ? { type: t.type, ...(t.type === 'scene' ? { scene: cleanId(t.scene, '') } : t.type === 'sequence' ? { sequence: cleanId(t.sequence, '') } : {}) } : { type: 'off' };
}

// Fills in and tidies every setting, so a hand-edited or older sequences.json is always usable.
function clean(input, existing = {}) {
  const s = { ...existing, ...input };
  // Older sequences.json (and callers) name one output, startOn; it's the first of playsOn now.
  const on = Array.isArray(input.playsOn) ? input.playsOn : input.startOn ? [input.startOn] : Array.isArray(existing.playsOn) ? existing.playsOn : [existing.startOn || PRIMARY];
  const playsOn = ids(on).slice(0, 4);
  const thenOn = {};
  for (const [o, t] of Object.entries(s.thenOn && typeof s.thenOn === 'object' ? s.thenOn : {})) {
    const k = cleanId(o, '');
    if (k && playsOn.includes(k) && t && THENS.includes(t.type)) thenOn[k] = cleanThen(t);
  }
  const out = {
    id: cleanId(existing.id || s.id, newId()),
    name: '',
    colour: COLOURS.includes(s.colour) ? s.colour : 'blue',
    repeat: REPEATS.includes(s.repeat) ? s.repeat : 'once',
    start: cleanStart(s.start),
    then: cleanThen(s.then),
    music: cleanMusic(s.music),
    musicEnd: cleanMusicEnd(s.musicEnd),
    quiet: !!s.quiet,
    hidden: !!s.hidden,  // left off the Output page's list (a mini sequence used inside others)
    playsOn: playsOn.length ? playsOn : [PRIMARY], // the outputs it plays on together (outputs.js), the primary unless set
    thenOn,  // an output's own Then, by output id, where it differs from then
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
  each(() => { queue = []; played = []; });
  orders = [];
  roNotice = null;
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    list = [];
    for (const s of Array.isArray(saved.sequences) ? saved.sequences : []) if (s && typeof s === 'object') list.push(clean(s));
    // Output 1's run order as it was (a relaunch picks the night up where it was), and the saved orders. One kept for
    // another output from when each had its own is dropped.
    const ro = saved.runOrder && typeof saved.runOrder === 'object' ? saved.runOrder : {};
    if (ro[PRIMARY]) within(PRIMARY, () => { queue = cleanItems(ro[PRIMARY]); });
    for (const o of Array.isArray(saved.runOrders) ? saved.runOrders : []) if (o && typeof o === 'object') orders.push(cleanOrder(o));
    orders = orders.slice(0, MAX_ORDERS);
  } catch (err) {
    if (err.code !== 'ENOENT') log('warn', 'sequence', `Could not read ${file}, starting with no sequences: ${err.message}`);
    list = [];
  }
}
function save() {
  if (file) {
    try {
      const runOrder = {};
      within(PRIMARY, () => { if (queue.length) runOrder[PRIMARY] = queue.map(({ kind, id }) => ({ kind, id })); });
      savefile.writeJsonSync(file, { sequences: list, ...(Object.keys(runOrder).length ? { runOrder } : {}), ...(orders.length ? { runOrders: orders } : {}) });
    } catch (err) { log('error', 'sequence', `Could not save ${file}: ${err.message}`); }
  }
}

// ─── The run order ───────────────────────────────────────────────────────
// Items are references: a sequence or scene renamed is renamed in the order too, and one deleted shows as gone
// (skipped when its turn comes).
const cleanItem = v => {
  const it = v && typeof v === 'object' ? v : {};
  const kind = ITEM_KINDS.includes(it.kind) ? it.kind : 'sequence';
  const id = cleanId(it.id, '');
  return id ? { key: newId(), kind, id } : null;
};
const cleanItems = v => (Array.isArray(v) ? v : []).map(cleanItem).filter(Boolean).slice(0, MAX_QUEUE);
function cleanOrder(o) {
  const base = String(o.name || '').trim().slice(0, 60) || 'Run order';
  const taken = new Set(orders.filter(x => x.id !== o.id).map(x => slug(x.name)));
  let name = base;
  for (let i = 2; taken.has(slug(name)); i++) name = `${base} ${i}`;
  return { id: cleanId(o.id, newId()), name, items: cleanItems(o.items).map(({ kind, id }) => ({ kind, id })) };
}
// What an item refers to now, or null when it has gone.
const itemOf = it => it.kind === 'scene' ? api.scene(it.id) : list.find(s => s.id === it.id) || null;
const itemName = it => itemOf(it)?.name || (it.kind === 'scene' ? 'a scene that has gone' : 'a sequence that has gone');
// Something in the order changed here: the page and the file.
function queueChanged() { save(); }
// The head of the run order that still exists; gone ones in front of it are dropped with a note.
function nextQueued() {
  while (queue.length && !itemOf(queue[0])) {
    const it = queue.shift();
    log('info', 'sequence', `Run order: skipped ${itemName(it)}`);
  }
  return queue[0] || null;
}
// The head leaves the queue as it plays, and goes on the list of what has played tonight (the page shows the
// last of them above what's on air, so the list reads like a playlist).
function takeHead() {
  const it = queue.shift();
  played.push({ key: it.key, kind: it.kind, id: it.id, at: now() });
  if (played.length > MAX_PLAYED) played.splice(0, played.length - MAX_PLAYED);
  queueChanged();
}
// The head leaves the queue as it starts, however it was started.
function consume(kind, id) {
  if (!queue.length || queue[0].kind !== kind || queue[0].id !== id) return;
  takeHead();
}
// Next in the run order: the head plays (a sequence starts, a scene is gone to). With nothing queued, the
// sequence playing ends and does its Then; with nothing playing either, nothing to do.
function playHead(why) {
  const it = nextQueued();
  if (!it) {
    if (!run) return 'Nothing is in the run order, and no sequence is playing.';
    finish(why);
    return null;
  }
  if (it.kind === 'scene') {
    const sc = api.scene(it.id);
    takeHead();
    if (run) interrupt(new Set(Object.keys(sc.states).filter(id => sc.states[id] === 'on')), `the run order went on to scene "${sc.name}"`);
    log('info', 'sequence', `Run order: going to scene "${sc.name}"`);
    api.goTo(sc, false, here);
    return null;
  }
  const sq = list.find(s => s.id === it.id);
  if (pending && pending.id === sq.id) { pending.now = true; startPending(); return null; }
  if (!flatten(sq).length) { queue.shift(); queueChanged(); log('info', 'sequence', `Run order: "${sq.name}" has no steps, skipped`); return playHead(why); }
  if (run) interrupt(new Set(firstOf(sq)), `the run order went on to "${sq.name}"`);
  start(sq, 'next in the run order');
  // Play next is pressed by hand: like its card, it plays on every output it plays on together.
  joinOthers(sq);
  return null;
}
// Adds an item (a sequence or scene, by id or name) at the end, or at a place.
function enqueue(kind, ref, at) {
  const target = kind === 'scene' ? api.scene(ref) || api.sceneNamed?.(ref) : find(ref);
  if (!target) return `No ${kind} "${ref}".`;
  if (queue.length >= MAX_QUEUE) return `The run order is full (${MAX_QUEUE} items).`;
  const it = { key: newId(), kind, id: target.id };
  const i = at === undefined ? queue.length : Math.round(clamp(at, 0, queue.length, queue.length));
  queue.splice(i, 0, it);
  queueChanged();
  log('info', 'sequence', `Run order: added ${kind} "${target.name}"${i < queue.length - 1 ? ` at ${i + 1}` : ''}`);
  return null;
}
const queueState = () => queue.map(it => ({ key: it.key, kind: it.kind, id: it.id, name: itemName(it), gone: !itemOf(it) }));
const playedState = () => played.map(it => ({ key: it.key, kind: it.kind, id: it.id, name: itemName(it), at: it.at }));

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
  planCross();
}
// How long the music fades out over as step i ends, when it ends there: the sequence's music on its last
// step (played once), or a sequence inside's music on that one's last step. 0 when it doesn't end, cuts, or
// crossfades into music that starts on the step after (it plays on to the end and fades out under the new music).
function fadeOutSecFor(i) {
  const sq = playing(), st = run.steps[i], nx = run.steps[i + 1];
  if (!nx) {
    const end = musicEndAt(st, sq);
    if (sq.repeat !== 'once' || !fades(end)) return 0;
    const next = end.type === 'crossfade' ? nextAfter(sq) : null;
    return next && crossesInto(musicOf(st), musicStartsOn(flatten(next)[0])) ? 0 : end.sec;
  }
  const m = musicOf(st);
  if (!m || !m.occ || musicOf(nx)?.occ === m.occ || !fades(m.sq.musicEnd)) return 0;
  return m.sq.musicEnd.type === 'crossfade' && crossesInto(m, musicStartsOn(nx)) ? 0 : m.sq.musicEnd.sec;
}
const fades = end => !!end && (end.type === 'fade' || end.type === 'crossfade');
// The music a step starts (the first step played from its sequence's music), or null.
function musicStartsOn(step) {
  const m = musicOf(step);
  return m && m.i === Math.min(m.sq.music.startStep, m.sq.steps.length) - 1 ? m : null;
}
// Whether music from crossfades into to: there is new music, and it isn't the same song or playlist.
const crossesInto = (from, to) => !!(from && to) && (to.sq.music.playlist ? to.sq.music.playlist !== from.sq.music.playlist : to.sq.music.track !== from.sq.music.track || !!from.sq.music.playlist);
// The sequence that plays after sq ends here, as finish() picks it: the run order's head, else its Then.
function nextAfter(sq) {
  const q = queue.find(it => itemOf(it));
  if (q) return q.kind === 'sequence' ? list.find(s => s.id === q.id) || null : null;
  const then = thenFor(sq, here);
  return then.type === 'sequence' ? list.find(s => s.id === then.sequence && s.id !== sq.id) || null : null;
}
// How long a step after this one lasts, when it's known ahead: a set time, or a scene step that goes straight on.
const lengthMs = st => st.length.type === 'time' ? st.length.sec * 1000 : st.length.type === 'now' ? 0 : null;
// Whether the music playing on step k ends with it: the last step, or the last of a sequence inside's part.
function partEndsAt(k) {
  const nx = run.steps[k + 1], m = musicOf(run.steps[k]);
  return !nx || !m || (!!m.occ && musicOf(nx)?.occ !== m.occ);
}
// When the music on the step playing now fades out: the end of its part (this step, or a later one when the
// steps between have set times) and the fade's length, { sec, endAt }, or null.
function fadePlan() {
  if (!musicOf(current())) return null;
  let ms = Math.max(0, run.endsAt - now());
  for (let k = run.step; k < run.steps.length; k++) {
    if (k > run.step) {
      const len = lengthMs(run.steps[k]);
      if (len === null) return null;
      ms += len;
    }
    if (partEndsAt(k)) {
      const sec = fadeOutSecFor(k);
      return sec ? { sec, endAt: now() + ms } : null;
    }
  }
  return null;
}
// A fade out starts that long before the music's part ends, so the music is gone as it ends and never carries
// into what comes next, over its whole time even when the last steps are shorter than the fade (it starts in
// an earlier step). A step ended early by Next fades out from then.
function planFade() {
  clearTimeout(fadeTimer);
  fadeTimer = null;
  if (!run || run.paused || run.endsAt === null || run.fadeEndsAt || current()?.length.type !== 'time') return;
  const plan = fadePlan();
  if (!plan) return;
  fadeTimer = setTimeout(bound(() => {
    fadeTimer = null;
    if (!run || run.paused || run.endsAt === null) return;
    run.fadeEndsAt = plan.endAt;
    const sec = Math.max(0, plan.endAt - now()) / 1000;
    sound().stopFor(run.id, sec);
    // The output pages follow the fade from the scene they're sent: send it now, as the fade starts. (Without this
    // they heard of it only at the step's end, by when it had finished, and the music cut.)
    api.changed();
  }), Math.max(0, plan.endAt - plan.sec * 1000 - now()));
}
// A step with a video playing its sound, before a step whose music crossfades from it (its music's underVideo): the
// music starts its fade in time before the video ends, fading in while the video's sound fades out, so the two meet
// as the video ends. With the video's length unknown (or a step that doesn't end with it) the music starts with the
// next step as usual.
function planCross() {
  if (!run) return;
  clearTimeout(run.crossTimer);
  run.crossTimer = null;
  const st = current(), nx = run.steps[run.step + 1];
  if (run.paused || !st || !nx || run.crossed === run.step + 1) return;
  const m = musicStartsOn(nx);
  if (!m || !m.sq.music.underVideo || !(m.sq.music.fadeInSec > 0)) return;
  if (musicOf(st)?.occ === m.occ) return;
  const vids = st.sources.filter(id => { const s = source(id); return s && s.type === 'video' && s.sound && !s.loop && isOn(s); });
  const lens = vids.map(id => api.duration(source(id).file)).filter(Boolean);
  if (!lens.length) return;
  let endAt = run.stepAt + Math.max(...lens) * 1000;
  if (st.length.type === 'time') endAt = Math.min(endAt, run.endsAt);
  else if (st.length.type !== 'done') return;
  const r = run;
  run.crossTimer = setTimeout(bound(() => {
    if (run !== r) return;
    run.crossTimer = null;
    if (run.paused) return;
    const sec = Math.max(0.1, (endAt - now()) / 1000);
    run.crossed = run.step + 1;
    for (const id of vids) api.fadeSound?.(id, here, sec);
    sound().playFor(run.id, m.sq.music, sec);
    log('info', 'sequence', `"${m.sq.name}"'s music starts under the end of the video, crossfading over ${Math.round(sec * 10) / 10} s`);
    api.changed();
  }), Math.max(0, endAt - m.sq.music.fadeInSec * 1000 - now()));
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
  // On another output, in that output's own ad sources.
  const ad = api.sponsorAd ? api.sponsorAd({ house: step.house }, here) : null;
  step.sources = ad ? [ad.source] : [];
  step.length = ad ? ad.length : { type: 'now' };
  step.ad = ad ? ad.name : null;
}

function enter(i) {
  const sq = playing();
  // A scene step before's switcher actions still to come are called off (this step's own are run below).
  if (here === PRIMARY) switcher.cancel('sequenceScene');
  const before = run.steps[run.step];
  const step = run.steps[i];
  if (step.kind === 'ad') fillAd(step);
  const faded = { fadeEndsAt: run.fadeEndsAt };
  // This step's music already started under the end of the video before it (planCross).
  const crossed = run.crossed === i;
  run.crossed = null;
  const sc = step.kind === 'scene' ? api.scene(step.scene) : null;
  // Sources of the step before that this step doesn't keep go off as these come on.
  const keep = new Set([...step.sources, ...(sc ? Object.keys(sc.states).filter(id => sc.states[id] === 'on') : [])]);
  if (before) for (const id of before.sources) if (!keep.has(id)) turnOff(id);
  for (const id of step.sources) turnOn(id);
  // A scene step goes to the scene (without stopping the sequence): the sources it sets are the scene's
  // now, the base the next steps play over, and they stay as the scene left them when the sequence ends.
  if (sc) { api.goTo(sc, true, here); for (const id of Object.keys(sc.states)) run.shown.delete(id); }
  // A scene step that ducks the music ducked it: the music comes back up as the sequence moves on.
  if (quietStep(before) && !(sc && sc.quiet)) sound().quiet(sq.quiet);
  // A fade out under way carries on into the next step of the same music (it started early to last its whole time).
  const going = before && i === run.step + 1 && musicOf(before) && musicOf(step)?.occ === musicOf(before).occ ? run.fadeEndsAt : null;
  Object.assign(run, { step: i, stepAt: now(), paused: false, pausedLeft: null, ready: false, waiting: null, fadeEndsAt: going || null });
  if (step.length.type === 'now') run.endsAt = now();
  else if (step.length.type === 'time') run.endsAt = now() + step.length.sec * 1000;
  else if (step.length.type === 'next' || step.length.type === 'game') run.endsAt = null;
  else {
    run.waiting = finishers(step);
    run.endsAt = now() + (run.waiting.size ? limitFor(step) : 0);
  }
  const what = step.kind === 'scene' ? `scene "${sc ? sc.name : 'gone'}"` : step.kind === 'ad' ? (step.ad ? `ad: ${step.ad}` : 'no ad to play') : step.sources.map(id => source(id)?.name).filter(Boolean).join(', ');
  log('info', 'sequence', `"${sq.name}" step ${i + 1} of ${run.steps.length}${step.via ? ` (in ${step.via.join(' › ')})` : ''}${what ? `: ${what}` : ''}`);
  // The step's switcher actions, on the primary only (the switcher's program is the primary's picture).
  // The step before's still to come are called off.
  if (here === PRIMARY) switcher.run(step.switcher, `Sequence "${sq.name}" step ${i + 1}`, 'sequence');
  // Music: the sequence's own, or with none, that of a sequence inside it while that one plays.
  const m = musicOf(step), was = before ? musicOf(before) : null;
  // Out of a sequence inside whose music was on: it ends as that sequence's music ends (fade or cut).
  if (was && was.occ && (!m || m.occ !== was.occ) && was.sq.musicEnd.type !== 'continue' && !crossed) {
    const sec = was.sq.musicEnd.type === 'cut' ? 0 : fadeLeft(faded, was.sq.musicEnd.sec || music.stopFadeSec());
    sound().stopFor(run.id, sec);
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
  if (cut === sq.id) cut = null;
  consume('sequence', sq.id);
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
  clearTimeout(run.crossTimer);
  timer = fadeTimer = null;
  const ended = run;
  // The card says Stopped for it here until it plays again.
  cut = sq ? sq.id : null;
  if (here === PRIMARY) { switcher.cancel('sequence'); switcher.cancel('sequenceScene'); }
  // The run order first: its head plays instead of the Then. Else this output's own Then (a sequence played on
  // two outputs can go somewhere different on each).
  const queued = nextQueued();
  const then = queued ? (queued.kind === 'scene' ? { type: 'scene', scene: queued.id } : { type: 'sequence', sequence: queued.id }) : sq ? thenFor(sq, here) : { type: 'off' };
  const sc = then.type === 'scene' ? api.scene(then.scene) : null;
  const next = then.type === 'sequence' ? list.find(s => s.id === then.sequence && (queued || s.id !== ended.id)) : null;
  // A queued scene leaves the order now (it plays); a queued sequence as it starts (start() takes it), unless it can't.
  if (queued && sc) takeHead();
  else if (queued && next && !flatten(next).length) { queue.shift(); queueChanged(); }
  const end = sq ? musicEndAt(ended.steps[ended.step], sq) : { type: 'fade', sec: music.stopFadeSec() };
  if (next && end.type === 'continue') sound().handOver(ended.id, next.id);
  else sound().stopFor(ended.id, end.type === 'cut' ? 0 : fadeLeft(ended, end.sec || music.stopFadeSec()));
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
  log('info', 'sequence', `"${sq ? sq.name : '?'}" ended (${why})${next ? `, then "${next.name}"` : sc ? `, going to scene "${sc.name}"` : then.type === 'scene' ? ', its scene has gone so its sources go off' : then.type === 'sequence' ? ', its next sequence has gone so its sources go off' : then.type === 'leave' ? ', leaving its sources as they are' : ''}${queued ? ' (from the run order)' : ''}`);
  if (sc) api.goTo(sc, false, here);
  // A sequence with no steps would end at once, so a chain of them can't go round for ever.
  if (next && flatten(next).length && !(pending && pending.afterEnd)) {
    start(next, `after "${sq.name}"`);
    // The run order moved on by itself: the sequence's other outputs join only where nothing is playing. One that
    // played the sequence that just ended does its own Then there instead (Matt, 1 Nov 2026).
    if (queued) joinOthers(next, ended.id);
  }
  // A triggered start that waited for this one to finish goes now.
  if (pending && pending.afterEnd) startPending();
}

// A sequence the run order started on this output also starts on the other outputs it plays on together (its card
// does the same). With after (the sequence that just ended here, when the run order moved on by itself), an output
// joins only when nothing is playing or waiting there and it wasn't playing that sequence, which does its own Then.
function joinOthers(sq, after) {
  const from = here;
  for (const o of groupOf(sq, from)) {
    if (o === from) continue;
    within(o, () => {
      if (run && run.id === sq.id) return;
      if (after !== undefined && (run || pending || cut === after)) return;
      if (run) interrupt(new Set(firstOf(sq)), `"${sq.name}" started from the run order`);
      start(sq, 'from the run order, with the output it plays on together');
    });
  }
}

// Stopped by something else (a scene, another sequence, every source off): no Then, and its own
// sources go off unless keep says they stay on.
function interrupt(keep, why) {
  if (!run) return;
  const sq = playing();
  clearTimeout(timer);
  clearTimeout(fadeTimer);
  clearTimeout(run.crossTimer);
  timer = fadeTimer = null;
  for (const id of [...run.shown]) if (!keep.has(id)) turnOff(id);
  cut = sq ? sq.id : null;
  if (here === PRIMARY) { switcher.cancel('sequence'); switcher.cancel('sequenceScene'); }
  // The music fades out over its own Music ends time (or cuts), as when the sequence ends.
  const end = sq ? musicEndAt(current(), sq) : { type: 'fade' };
  const sec = end.type === 'cut' ? 0 : fadeLeft(run, fades(end) ? end.sec : music.stopFadeSec());
  sound().stopFor(run.id, sec);
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
  // A trigger put it at the head of the run order: Cancel takes it out again (one queued by hand stays).
  if (pending.queued && queue[0]?.kind === 'sequence' && queue[0].id === pending.id) { queue.shift(); queueChanged(); }
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
  // On Output 1 its place in the run order is the head now: it moves up if it was further down, or joins the order if it
  // wasn't in it (and leaves as it starts). Another output has no run order: it just starts there.
  const main = here === PRIMARY;
  const was = main ? queue.findIndex(it => it.kind === 'sequence' && it.id === sq.id) : 0;
  if (was !== 0) {
    queue.unshift(was > 0 ? queue.splice(was, 1)[0] : { key: newId(), kind: 'sequence', id: sq.id });
    queueChanged();
  }
  // queued: the trigger put it in the order, so Cancel takes it out again (one queued by hand stays, at the head).
  pending = { id: sq.id, reason, at: now() + afterSec * 1000, afterEnd: false, queued: main && was < 0 };
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
    const forMoment = s => m.kind === 'break' ? s.start.type === 'break' && s.start.breaks.includes(m.which) : s.start.type === 'fulltime';
    for (const out of new Set(list.flatMap(outsOf))) {
      const next = list.find(s => outsOf(s).includes(out) && forMoment(s));
      if (next) within(out, () => trigger(next, m.kind === 'break' ? `It's ${BREAK_NAMES[m.which]}` : `It's full time`, next.start.afterSec));
    }
    for (const sq of list) if (gone(sq) && forMoment(sq)) goneNote(sq, m.kind === 'break' ? `at ${BREAK_NAMES[m.which]}` : 'at full time');
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
      // Its moment came while Studio wasn't running (it was opened inside the window), or before a practice game
      // started: left to the operator.
      if (at < (rearmedAt || studioStartedAt)) {
        log('info', 'sequence', `"${sq.name}" won't start by itself: ${rearmedAt ? 'the practice game started after' : 'Studio wasn\'t running'} ${sq.start.min} min before ${game.label || 'the game'}`);
        continue;
      }
      if (gone(sq)) { goneNote(sq, `${sq.start.min} min before ${game.label || 'the game'}`); continue; }
      for (const o of outsOf(sq)) within(o, () => trigger(sq, `${sq.start.min} min before ${game.label || 'the game'}`, 0));
      changed = true;
    }
  }
  if (changed) api.changed();
}

// A practice game started or jumped with Run game-timed sequences again (practice.js): the game's moments
// that have fired are forgotten, so its pre-game, break and full time sequences fire again, even for the same game id.
// Like Studio starting, a pre-game moment that passed before now (give or take a minute) is skipped.
function rearm() {
  watch = null;
  rearmedAt = now() - REARM_GRACE_MS;
  log('info', 'sequence', 'Game-timed sequences run again from now (practice game)');
}

// The next start before the game, for the Output page: { id, at }.
function nextAuto() {
  if (!auto || !game || !game.startAt || (watch && watch.everRan)) return null;
  let best = null;
  for (const sq of list) {
    if (sq.start.type !== 'before' || gone(sq) || (watch && watch.fired.has(`before:${sq.id}`))) continue;
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
  within(out, () => {
    if (run) interrupt(new Set(Object.keys(sc.states).filter(id => sc.states[id] === 'on')), `scene "${sc.name}" was picked`);
    consume('scene', sc.id);
  });
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
// Pause and the like act on. Run order changes (ro…) always act on Output 1's.
function apply(a) {
  const sq = a.sequence ? find(a.sequence) : null;
  // The run order is Output 1's, whatever output a change names.
  return within(/^ro[A-Z]/.test(a.type) ? PRIMARY : a.output || PRIMARY, () => applyHere(a, sq));
}
// The playing sequence (or one playing it inside) keeps going with its new steps, on every output.
function refreshPlaying() {
  each(() => {
    if (!run) return;
    run.steps = flatten(playing());
    if (run.step >= run.steps.length) { if (run.steps.length) enter(run.steps.length - 1); else finish('its steps were removed'); }
  });
}
// Stops sq where it's playing on outs, each output doing its own Then.
function stopOn(outs, sq) {
  for (const o of outs) within(o, () => { if (run && run.id === sq.id) finish('Stop was pressed'); });
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
      // On every output it plays on together (when this is one of them), unless a.only.
      const outs = groupOf(sq, here, a.only);
      if (a.type === 'seqToggle' && run && run.id === sq.id) { stopOn(outs, sq); return null; }
      for (const o of outs) within(o, () => {
        // Another sequence stops first, keeping what this one shows straight away so it doesn't flicker.
        if (run) interrupt(new Set(firstOf(sq)), `"${sq.name}" started`);
        start(sq, outs.length > 1 ? `on ${outs.length} outputs together` : undefined);
      });
      return null;
    }
    case 'seqStop':
      // Stop naming the sequence stops it on every output it plays on together; plain Stop, this output's.
      if (a.sequence) { if (sq) stopOn(groupOf(sq, here, a.only), sq); return null; }
      if (run) finish('Stop was pressed');
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
    // ─── The run order on this output ───
    case 'roNext':
      log('info', 'sequence', 'Run order: Next pressed');
      return playHead('Next in the run order was pressed');
    case 'roSkip': {
      const it = nextQueued();
      if (!it) return 'Nothing is in the run order.';
      queue.shift();
      queueChanged();
      log('info', 'sequence', `Run order: skipped ${itemName(it)}`);
      return null;
    }
    case 'roAdd':
      return enqueue(a.kind === 'scene' ? 'scene' : 'sequence', a.sequence || a.scene || a.id || a.name, a.at);
    case 'roRemove': {
      const i = queue.findIndex(it => it.key === a.key);
      if (i < 0) return 'That item isn\'t in the run order any more.';
      const [it] = queue.splice(i, 1);
      queueChanged();
      log('info', 'sequence', `Run order: took out ${itemName(it)}`);
      return null;
    }
    case 'roMove': {
      const from = queue.findIndex(it => it.key === a.key);
      if (from < 0) return 'That item isn\'t in the run order any more.';
      const to = a.to !== undefined ? Math.round(clamp(a.to, 0, queue.length - 1, from)) : from + (a.direction === 'up' ? -1 : a.direction === 'down' ? 1 : 0);
      if (to < 0 || to >= queue.length || to === from) return null;
      queue.splice(to, 0, queue.splice(from, 1)[0]);
      queueChanged();
      return null;
    }
    case 'roClear':
      // Empties what's queued and what has played: a fresh list (what's on air carries on).
      roNotice = null;
      if (!queue.length && !played.length) return null;
      queue = [];
      played = [];
      queueChanged();
      log('info', 'sequence', 'Run order: cleared');
      return null;
    case 'roSave': {
      // Tonight's order kept under a name (over one of that name), for another night.
      if (!queue.length) return 'The run order is empty, so there\'s nothing to save.';
      const name = String(a.name || '').trim().slice(0, 60);
      if (!name) return 'Give the run order a name, such as "Thursday night".';
      const items = queue.map(({ kind, id }) => ({ kind, id }));
      const existing = orders.find(o => slug(o.name) === slug(name));
      if (existing) existing.items = items;
      else {
        if (orders.length >= MAX_ORDERS) return `There are already ${MAX_ORDERS} saved run orders; delete one first.`;
        orders.push({ id: newId(), name, items });
      }
      save();
      log('info', 'sequence', `Run order: saved as "${name}" (${items.length} item${items.length === 1 ? '' : 's'})`);
      return null;
    }
    case 'roLoad': {
      const o = orders.find(x => x.id === String(a.order || '')) || orders.find(x => slug(x.name) === slug(a.order));
      if (!o) return `No saved run order "${a.order || ''}".`;
      // Loaded in place of what's queued (the Output page asks first when the queue isn't empty). a.planner: the
      // game the Production Planner loaded it for, as the scoreboard moved to it (server.js plannerRunOrder); nobody
      // was asked then, so when that dropped anything queued, the run order panel says so until it's closed.
      const had = queue.length;
      queue = cleanItems(o.items);
      queueChanged();
      const planner = typeof a.planner === 'string' ? a.planner.slice(0, 120) : '';
      roNotice = planner && had ? { text: `Cleared the ${had} item${had === 1 ? '' : 's'} queued: the Production Planner loaded "${o.name}" for ${planner}.`, at: now() } : null;
      log('info', 'sequence', `Run order: loaded "${o.name}" (${queue.length} item${queue.length === 1 ? '' : 's'})${planner ? ` from the Production Planner for ${planner}` : ''}${had ? `, in place of ${had} queued` : ''}`);
      return null;
    }
    case 'roNoticeClose':
      roNotice = null;
      return null;
    case 'roRename': {
      // A saved order under a new name. It keeps its id, so a game in the Production Planner it's assigned to keeps it.
      const o = orders.find(x => x.id === String(a.order || '')) || orders.find(x => slug(x.name) === slug(a.order));
      if (!o) return `No saved run order "${a.order || ''}".`;
      const name = String(a.name || '').trim().slice(0, 60);
      if (!name) return 'Give the run order a name, such as "Thursday night".';
      if (orders.some(x => x !== o && slug(x.name) === slug(name))) return `There's already a saved run order called "${name}".`;
      if (name === o.name) return null;
      const was = o.name;
      o.name = name;
      save();
      log('info', 'sequence', `Run order: renamed the saved order "${was}" to "${name}"`);
      return null;
    }
    case 'roDeleteOrder': {
      const i = orders.findIndex(x => x.id === String(a.order || '') || slug(x.name) === slug(a.order));
      if (i < 0) return `No saved run order "${a.order || ''}".`;
      const [o] = orders.splice(i, 1);
      save();
      log('info', 'sequence', `Run order: deleted the saved order "${o.name}"`);
      return null;
    }
    default:
      return undefined;
  }
}

// /deck/sequence/<name> (play), /deck/sequence/<name>/play|toggle|stop|only (play on this output alone), for whatever is playing
// /deck/sequence/next|stop|pause|resume, for one about to start by itself /deck/sequence/now|cancel, and the Automatic sequences switch /deck/sequence/auto/on|off|toggle.
// out: the output these act on (/deck/output/<output>/sequence/…), the primary by default.
function deck(parts, out = PRIMARY) {
  const [what, name, verb] = parts;
  // The run order: /deck/runorder/next (play the head), skip, clear, add/<sequence or scene name>, load/<saved order>.
  if (what === 'runorder') {
    if (!name) return null;
    if (out !== PRIMARY) return { error: 'The run order is Output 1\'s: use /deck/runorder/… instead.', status: 404 };
    const simple = { next: 'roNext', skip: 'roSkip', clear: 'roClear' };
    let action = null;
    if (simple[name] && !verb) action = { type: simple[name], output: out };
    else if (name === 'add' && verb) action = { type: 'roAdd', output: out, kind: find(verb) ? 'sequence' : 'scene', name: verb };
    else if (name === 'load' && verb) action = { type: 'roLoad', output: out, order: verb };
    if (!action) return null;
    const error = apply(action);
    if (error) return { error, status: /^No /.test(error) ? 404 : 409 };
    return within(out, () => {
      const head = nextQueued();
      return { body: { ok: true, next: head ? itemName(head) : null, queued: queue.length, playing: playing()?.name || null } };
    });
  }
  if (what !== 'sequence' || !name) return null;
  if (name === 'auto') {
    if (!['on', 'off', 'toggle'].includes(verb || 'toggle')) return null;
    apply({ type: 'seqAuto', value: verb || 'toggle' });
    return { body: { ok: true, auto } };
  }
  const PLAYING = { next: 'seqNext', advance: 'seqAdvance', stop: 'seqStop', pause: 'seqPauseToggle', resume: 'seqResume', now: 'seqStartNow', cancel: 'seqCancel' };
  // only: on this output alone, not every output the sequence plays on together.
  const ONE = { play: 'seqPlay', start: 'seqPlay', toggle: 'seqToggle', stop: 'seqStop', only: 'seqPlay' };
  const action = !verb ? (PLAYING[name] ? { type: PLAYING[name], output: out } : { type: 'seqPlay', sequence: name, output: out }) : ONE[verb] ? { type: ONE[verb], sequence: name, output: out, ...(verb === 'only' ? { only: true } : {}) } : null;
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
  // stoppedOn: the sequence that last ended on each output (played out or cut short), until it plays again.
  const playingOut = {}, pendingOut = {}, stoppedOn = {};
  each(() => {
    if (cut && (!run || run.id !== cut)) stoppedOn[here] = cut;
    if (here === PRIMARY) return;
    const p = playingHere(), w = pendingHere();
    if (p) playingOut[here] = p;
    if (w) pendingOut[here] = w;
  });
  return {
    // goneOn: outputs in its playsOn that have been removed (kept for the editor to show); startGone: all of them.
    sequences: [...list].sort(byColour).map(sq => {
      const goneOn = sq.playsOn.filter(o => !has(o));
      return { ...sq, ...(goneOn.length ? { goneOn } : {}), ...(gone(sq) ? { startGone: true } : {}) };
    }),
    playing: within(PRIMARY, playingHere),
    playingOut,
    auto,
    pending: within(PRIMARY, pendingHere),
    pendingOut,
    stoppedOn,
    // The run order (Output 1's, the only one): its items, each with its name now and gone when its sequence or scene
    // was deleted, and the saved orders.
    runOrder: within(PRIMARY, queueState),
    // What the run order has played tonight, oldest first.
    runOrderPlayed: within(PRIMARY, playedState),
    runOrders: orders.map(o => ({ id: o.id, name: o.name, count: o.items.length })),
    // The Production Planner cleared what was queued to load a game's run order: what to tell the operator, or null.
    runOrderNotice: roNotice,
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

module.exports = { init, reload, file: () => file, apply, deck, state, byColour, game: gameTick, rearm, ended, turnedOff, beforeScene, allOff, sourceRemoved, dropOutput, slug, PRIMARY };
