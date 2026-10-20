// FirstPass Studio - sequences: the scene's sources played one after another, built on the Output page.
//
// A sequence is a list of steps. Each step turns on one or more sources and stays for a length: a set
// time (a still graphic or a page), until its videos and animations finish, or until Next is pressed.
// Sources kept on for the whole sequence come on at the start. When the last step ends the sequence
// plays again (repeat) or does its Then: go to a scene, turn off what it turned on, or leave it all.
//
// It only ever turns off sources it turned on itself, so a source put on by hand is left alone, and
// manual controls keep working: Next, Pause, Delay (10 s more each press) and Stop, a source turned
// off by hand moves to the next step, and going to a scene stops the sequence. One plays at a time.
//
// Sequences belong to the competition in use (sequences.json in its folder) and refer to the scene's
// shared sources and scenes by id. The runner lives here in Studio, not in a page, so it keeps time
// with the Output page closed. What's playing isn't saved: after a restart nothing is playing.

'use strict';

const fs = require('fs');
const path = require('path');
const datadir = require('./datadir');

const COLOURS = ['blue', 'green', 'grey', 'yellow', 'purple'];
const LENGTHS = ['time', 'done', 'next'];
const REPEATS = ['once', 'loop'];
const THENS = ['scene', 'off', 'leave'];
// Sequence link names that are the playing-sequence links instead (/deck/sequence/next).
const RESERVED = new Set(['next', 'stop', 'pause', 'resume', 'delay']);
const DELAY_MS = 10000;
// Until it finishes stops waiting after this: a page that never says it's done, a video of unknown length.
const PAGE_LIMIT_MS = 60000, VIDEO_LIMIT_MS = 10 * 60000, VIDEO_SPARE_MS = 3000;

let log = () => {};
let api = null;       // the scene, from scene.js
let fileOf = () => null;
let file = null;      // sequences.json of the competition in use
let list = [];
let run = null;       // what's playing
let timer = null;

const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const slug = s => String(s || '').toLowerCase().replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const newId = () => Math.random().toString(36).slice(2, 10);
const cleanId = (id, fallback) => String(id || '').replace(/[^a-z0-9]/gi, '').slice(0, 20) || fallback;
const ids = v => [...new Set((Array.isArray(v) ? v : []).map(x => cleanId(x, '')).filter(Boolean))].slice(0, 50);

function uniqueName(name, id) {
  const base = String(name || '').trim().slice(0, 60) || 'Sequence';
  const taken = new Set([...RESERVED, ...list.filter(s => s.id !== id).map(s => slug(s.name))]);
  if (!taken.has(slug(base)) && slug(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(slug(`${base} ${i}`))) return `${base} ${i}`;
}

function cleanStep(st) {
  const s = st && typeof st === 'object' ? st : {};
  const l = s.length && typeof s.length === 'object' ? s.length : {};
  const type = LENGTHS.includes(l.type) ? l.type : 'time';
  return { id: cleanId(s.id, newId()), sources: ids(s.sources), length: type === 'time' ? { type, sec: Math.round(clamp(l.sec, 1, 3600, 20)) } : { type } };
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
    then: THENS.includes(then.type) ? { type: then.type, ...(then.type === 'scene' ? { scene: cleanId(then.scene, '') } : {}) } : { type: 'off' },
    keepOn: ids(s.keepOn),
    steps: (Array.isArray(s.steps) ? s.steps : []).slice(0, 100).map(cleanStep),
  };
  out.name = uniqueName(s.name, out.id);
  return out;
}

function find(ref) {
  const r = String(ref || '');
  return list.find(s => s.id === r) || list.find(s => slug(s.name) === slug(r)) || null;
}
const playing = () => run ? list.find(s => s.id === run.id) || null : null;

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
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ sequences: list }, null, 2) + '\n');
    } catch (err) { log('error', 'sequence', `Could not save ${file}: ${err.message}`); }
  }
}

// The competition in use may have changed: stop what's playing and load that competition's sequences.
// Saving the same competition's setup leaves a playing sequence running.
function reload() {
  // With no competition yet, they're kept in the data folder.
  const next = fileOf() || datadir.file('sequences.json');
  if (next === file) return false;
  if (run) interrupt(new Set(), 'the competition changed');
  file = next;
  load();
  log('info', 'sequence', `${list.length} sequence${list.length === 1 ? '' : 's'} for this competition`);
  return true;
}

// ─── Playing ─────────────────────────────────────────────────────────────
const now = () => Date.now();
const source = id => api.source(id);

function turnOn(id) {
  const s = source(id);
  if (!s || s.visible) return;
  api.setVisible(s, true);
  run.shown.add(id);
}
function turnOff(id) {
  if (!run.shown.has(id)) return;
  run.shown.delete(id);
  const s = source(id);
  if (s && s.visible) api.setVisible(s, false);
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
    return s && s.visible && (s.type === 'browser' || (s.type === 'video' && !s.loop));
  }));
}

function schedule() {
  clearTimeout(timer);
  timer = null;
  if (run && !run.paused && run.endsAt !== null) timer = setTimeout(tick, Math.max(0, run.endsAt - now()));
}
function tick() {
  timer = null;
  if (run && !run.paused && run.endsAt !== null && run.endsAt <= now()) { advance(); api.changed(); }
  else schedule();
}

function enter(i) {
  const sq = playing();
  const before = sq.steps[run.step];
  const step = sq.steps[i];
  // Sources of the step before that this step (or the whole sequence) doesn't keep go off as these come on.
  const keep = new Set([...sq.keepOn, ...step.sources]);
  if (before) for (const id of before.sources) if (!keep.has(id)) turnOff(id);
  for (const id of step.sources) turnOn(id);
  Object.assign(run, { step: i, stepAt: now(), paused: false, pausedLeft: null, delayMs: 0, ready: false, waiting: null });
  if (step.length.type === 'time') run.endsAt = now() + step.length.sec * 1000;
  else if (step.length.type === 'next') run.endsAt = null;
  else {
    run.waiting = finishers(step);
    run.endsAt = now() + (run.waiting.size ? limitFor(step) : 0);
  }
  log('info', 'sequence', `"${sq.name}" step ${i + 1} of ${sq.steps.length}${step.sources.length ? `: ${step.sources.map(id => source(id)?.name).filter(Boolean).join(', ')}` : ''}`);
  schedule();
}

function advance() {
  const sq = playing();
  if (!sq) return;
  if (run.step + 1 < sq.steps.length) return enter(run.step + 1);
  if (sq.repeat === 'loop' && sq.steps.length) { run.loop++; return enter(0); }
  finish('it finished');
}

function start(sq) {
  run = { id: sq.id, step: -1, loop: 0, startedAt: now(), shown: new Set(), stepAt: now(), endsAt: null, paused: false, pausedLeft: null, delayMs: 0, ready: false, waiting: null };
  log('info', 'sequence', `Started "${sq.name}"`);
  for (const id of sq.keepOn) turnOn(id);
  if (sq.steps.length) enter(0); else finish('it has no steps');
}

// The end of a sequence, played out or stopped: its Then.
function finish(why) {
  const sq = playing();
  clearTimeout(timer);
  timer = null;
  const ended = run;
  const then = sq ? sq.then : { type: 'off' };
  const sc = then.type === 'scene' ? api.scene(then.scene) : null;
  if (then.type === 'scene' && sc) {
    // The scene decides about the sources it sets; the sequence turns off its own that the scene leaves alone.
    for (const id of [...ended.shown]) if (!sc.states[id]) turnOff(id);
  } else if (then.type !== 'leave') for (const id of [...ended.shown]) turnOff(id);
  run = null;
  log('info', 'sequence', `"${sq ? sq.name : '?'}" ended (${why})${sc ? `, going to scene "${sc.name}"` : then.type === 'scene' ? ', its scene has gone so its sources go off' : then.type === 'leave' ? ', leaving its sources as they are' : ''}`);
  if (sc) api.goTo(sc);
}

// Stopped by something else (a scene, another sequence, every source off): no Then, and its own
// sources go off unless keep says they stay on.
function interrupt(keep, why) {
  if (!run) return;
  const sq = playing();
  clearTimeout(timer);
  timer = null;
  for (const id of [...run.shown]) if (!keep.has(id)) turnOff(id);
  run = null;
  log('info', 'sequence', `Stopped "${sq ? sq.name : '?'}" because ${why}`);
}

// ─── What the scene tells the sequence ───────────────────────────────────
// A source finished by itself (a video ended, a page said it's done).
function ended(src) {
  if (!run || !run.waiting || !run.waiting.has(src.id)) return;
  run.waiting.delete(src.id);
  if (run.waiting.size) return;
  run.ready = true;
  if (run.paused) run.pausedLeft = run.delayMs;
  else run.endsAt = now() + run.delayMs;
  schedule();
}
// A source turned off by hand: if it's one the step is showing, on to the next step.
function turnedOff(src) {
  if (!run) return;
  run.shown.delete(src.id);
  const step = playing()?.steps[run.step];
  if (step && step.sources.includes(src.id)) { log('info', 'sequence', `"${src.name}" turned off by hand, next step`); advance(); }
}
function beforeScene(sc) {
  if (run) interrupt(new Set(Object.keys(sc.states).filter(id => sc.states[id] === 'on')), `scene "${sc.name}" was picked`);
}
function allOff() { if (run) interrupt(new Set(), 'every source was turned off'); }
function sourceRemoved(id) {
  let changedAny = false;
  for (const sq of list) {
    const k = sq.keepOn.length + sq.steps.reduce((n, st) => n + st.sources.length, 0);
    sq.keepOn = sq.keepOn.filter(x => x !== id);
    for (const st of sq.steps) st.sources = st.sources.filter(x => x !== id);
    if (k !== sq.keepOn.length + sq.steps.reduce((n, st) => n + st.sources.length, 0)) changedAny = true;
  }
  if (run) { run.shown.delete(id); run.waiting?.delete(id); }
  if (changedAny) save();
}

// ─── Changes from the Output page and the Stream Deck ────────────────────
// Returns an error, null when done, or undefined when the change isn't a sequence change.
function apply(a) {
  const sq = a.sequence ? find(a.sequence) : null;
  const need = () => sq ? null : `No sequence "${a.sequence || ''}".`;
  switch (a.type) {
    case 'seqAdd': {
      const made = clean({ ...(a.changes || {}), id: undefined }, { id: newId() });
      list.push(made);
      save();
      log('info', 'sequence', `Made sequence "${made.name}"`);
      return null;
    }
    case 'seqUpdate': {
      if (need()) return need();
      const { id, ...changes } = a.changes || {};
      const i = list.indexOf(sq);
      list[i] = clean(changes, sq);
      // The playing sequence keeps going with its new steps.
      if (run && run.id === sq.id && run.step >= list[i].steps.length) { if (list[i].steps.length) enter(list[i].steps.length - 1); else finish('its steps were removed'); }
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
      if (run && run.id === sq.id) interrupt(new Set(), 'it was deleted');
      list.splice(list.indexOf(sq), 1);
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
      if (run) interrupt(new Set([...sq.keepOn, ...(sq.steps[0]?.sources || [])]), `"${sq.name}" started`);
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
    case 'seqDelay': {
      // 10 s more on the step showing now, for each press (a shot after the siren).
      if (!run) return 'No sequence is playing.';
      const step = playing().steps[run.step];
      run.delayMs += DELAY_MS;
      if (step.length.type !== 'next') {
        if (run.paused) { if (run.pausedLeft !== null) run.pausedLeft += DELAY_MS; }
        else if (run.endsAt !== null) run.endsAt += DELAY_MS;
      }
      log('info', 'sequence', `Delay: "${playing().name}" step ${run.step + 1} held ${run.delayMs / 1000} s longer`);
      schedule();
      return null;
    }
    default:
      return undefined;
  }
}

// /deck/sequence/<name> (play), /deck/sequence/<name>/play|toggle|stop, and for whatever is playing
// /deck/sequence/next|stop|pause|resume|delay.
function deck(parts) {
  const [what, name, verb] = parts;
  if (what !== 'sequence' || !name) return null;
  const PLAYING = { next: 'seqNext', stop: 'seqStop', pause: 'seqPauseToggle', resume: 'seqResume', delay: 'seqDelay' };
  const ONE = { play: 'seqPlay', start: 'seqPlay', toggle: 'seqToggle', stop: 'seqStop' };
  const action = !verb ? (PLAYING[name] ? { type: PLAYING[name] } : { type: 'seqPlay', sequence: name }) : ONE[verb] ? { type: ONE[verb], sequence: name } : null;
  if (!action) return null;
  if (action.sequence && !find(action.sequence)) return { error: `No sequence "${name}".`, status: 404 };
  const error = apply(action);
  if (error) return { error, status: 409 };
  const sq = playing();
  return { body: { ok: true, playing: sq ? sq.name : null, step: run ? run.step + 1 : null, paused: run ? run.paused : false } };
}

function state() {
  const sq = playing();
  return {
    sequences: list,
    playing: run && sq ? {
      id: run.id, step: run.step, steps: sq.steps.length, loop: run.loop, paused: run.paused,
      // Time left on the step, when it has one: the page counts down from when it hears this.
      leftMs: run.paused ? run.pausedLeft : run.endsAt === null ? null : Math.max(0, run.endsAt - now()),
      length: sq.steps[run.step]?.length.type || null, ready: run.ready, delayMs: run.delayMs,
      waiting: run.waiting ? [...run.waiting] : [],
    } : null,
  };
}

function init(logger, hooks, sequencesFile) {
  log = logger || log;
  api = hooks;
  if (sequencesFile) fileOf = sequencesFile;
  reload();
}

module.exports = { init, reload, apply, deck, state, ended, turnedOff, beforeScene, allOff, sourceRemoved, slug, DELAY_MS };
