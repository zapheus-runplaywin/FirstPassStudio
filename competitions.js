// PlayHQ Graphics - saved competition setups.
//
// Everything that belongs to one competition and doesn't come from PlayHQ lives in
// competitions/<id>/: settings.json (PlayHQ link, names, rules, colours, font and
// options), logos/ (team logos) and brand/ (the competition's own logo).
// competitions/active.json says which one the helper and every page use.
//
// The competitions folder is never shipped in the zip, so unzipping a new version
// over the old one keeps your setups. Ready-made setups in presets/ are copied in
// the first time the helper starts (and a preset you delete stays deleted).

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIR = path.join(ROOT, 'competitions');
const PRESETS = path.join(ROOT, 'presets');
const ACTIVE_FILE = path.join(DIR, 'active.json');
const IMAGE = /\.(png|jpe?g|webp|svg|gif)$/i;

// Every competition setting, with its default. The setup page shows these.
const DEFAULTS = {
  name: 'New competition',             // what the setup page calls it
  organisationUrl: '',                 // the organisation's playhq.com page
  competitionName: '',                 // the competition as PlayHQ names it (used to find it)
  seasonName: '',                      // blank = the current season
  displayName: '',                     // shown on the graphics; blank = PlayHQ's name
  organisationName: '',                // shown on the ladder; blank = PlayHQ's name
  venueName: '',                       // blank = PlayHQ's venue
  periodType: 'quarters',              // 'quarters' or 'halves'
  quarterMinutes: 10,                  // minutes per quarter (or half)
  superShots: true,                    // 2-point super shots
  finalsPlaces: 4,                     // ladder marker on the top N teams; 0 = none
  defaultCourt: '',
  autoSelectGame: true,
  autoSelectMinutesBefore: 10,
  roundLookaheadDays: 5,
  colours: {
    main: '#7f4092',        // banners, headers, logo circles
    dark: '#4a1f57',        // darker shade of the main colour
    panel: '#260e2e',       // dark panels behind tables and team lists
    panelAlt: '#3a1846',    // every second row
    highlight: '#ffcd00',   // round tab, points, positions, VS
    accent: '#e6007e',      // stripes, tabs, the clock box
    text: '#ffffff',
    textOnHighlight: '#2b0f36',
    muted: '#d9c3e3',       // column headings and small print
  },
  panelOpacity: 0.92,
  font: 'Montserrat',
  competitionLogo: '',                 // a file in brand/
  titleEmoji: '🔥',                    // the emoji either side of the title banner, blank for none
  clashWord: 'CLASH',                  // the big word on The Clash
  logoAliases: {},                     // { "PlayHQ team name": "file.png" }
  apiKey: '',                          // PlayHQ Client ID, only needed for the REST Game Summary
  apiTenant: '',
};
// Google Fonts, with the weights each one has (asking for one it doesn't have fails).
const FULL = 'ital,wght@0,400;0,500;0,600;0,700;0,800;0,900;1,700;1,800;1,900';
const FONT_WEIGHTS = { 'Montserrat': FULL, 'Barlow Condensed': FULL, 'Roboto Condensed': FULL, 'Poppins': FULL, 'Raleway': FULL, 'Exo 2': FULL,
  'Oswald': 'wght@400;500;600;700', 'Teko': 'wght@400;500;600;700', 'Bebas Neue': '', 'Anton': '' };
const FONTS = Object.keys(FONT_WEIGHTS);
const HEX = /^#[0-9a-f]{6}$/i;

const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'competition';
const validId = id => /^[a-z0-9-]{1,40}$/.test(String(id || ''));
const dirOf = id => { if (!validId(id)) throw new Error(`No competition "${id}"`); return path.join(DIR, id); };
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const writeJson = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');

// Setups saved before the emoji could be picked had a flames on/off tick box.
function fromFlames(s) {
  if (!s || s.titleEmoji !== undefined || typeof s.titleFlames !== 'boolean') return s;
  return { ...s, titleEmoji: s.titleFlames ? '🔥' : '' };
}

// Keep only known settings, with the right types, so a bad save can't break the helper.
function clean(input, base = DEFAULTS) {
  input = fromFlames(input); base = fromFlames(base);
  const out = {};
  for (const [k, def] of Object.entries(DEFAULTS)) {
    let v = input && input[k] !== undefined ? input[k] : base[k] !== undefined ? base[k] : def;
    if (k === 'colours') {
      v = Object.fromEntries(Object.entries(def).map(([c, d]) => [c, HEX.test((v || {})[c]) ? v[c].toLowerCase() : ((base.colours || {})[c] || d)]));
    } else if (k === 'logoAliases') {
      v = Object.fromEntries(Object.entries(v && typeof v === 'object' ? v : {}).filter(([t, f]) => t && typeof f === 'string' && f).map(([t, f]) => [String(t), path.basename(f)]));
    } else if (typeof def === 'boolean') v = v === true || v === 'true' || v === 'on';
    else if (typeof def === 'number') { v = Number(v); if (!Number.isFinite(v)) v = def; }
    else v = String(v ?? '').trim();
    out[k] = v;
  }
  out.periodType = out.periodType === 'halves' ? 'halves' : 'quarters';
  out.quarterMinutes = Math.min(60, Math.max(1, out.quarterMinutes));
  out.finalsPlaces = Math.min(32, Math.max(0, Math.round(out.finalsPlaces)));
  out.autoSelectMinutesBefore = Math.min(60, Math.max(0, out.autoSelectMinutesBefore));
  out.roundLookaheadDays = Math.min(14, Math.max(1, Math.round(out.roundLookaheadDays)));
  out.panelOpacity = Math.min(1, Math.max(0.3, out.panelOpacity));
  if (!FONTS.includes(out.font)) out.font = DEFAULTS.font;
  out.competitionLogo = out.competitionLogo ? path.basename(out.competitionLogo) : '';
  out.clashWord = out.clashWord.slice(0, 20) || 'CLASH';
  out.titleEmoji = [...new Intl.Segmenter().segment(out.titleEmoji)].slice(0, 4).map(x => x.segment).join('').trim();
  out.name = out.name.slice(0, 80) || out.competitionName || DEFAULTS.name;
  return out;
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}

// First start (and after an update with a new preset): copy presets in. Settings that
// used to live in config.json are carried over into the Thunder League setup.
const LEGACY_KEYS = ['organisationUrl', 'organisationName', 'competitionName', 'venueName', 'defaultCourt', 'autoSelectGame',
  'autoSelectMinutesBefore', 'roundLookaheadDays', 'seasonName', 'quarterMinutes', 'logoAliases', 'apiKey', 'apiTenant'];
function init(machineConfig, log) {
  fs.mkdirSync(DIR, { recursive: true });
  const state = readJson(ACTIVE_FILE, { active: '', seeded: [] });
  state.seeded = state.seeded || [];
  let presets = [], first = '';
  const fresh = new Set();
  try { presets = fs.readdirSync(PRESETS).filter(p => fs.existsSync(path.join(PRESETS, p, 'settings.json'))).sort(); } catch { /* none */ }
  for (const id of presets) {
    if (state.seeded.includes(id)) continue;
    state.seeded.push(id);
    if (fs.existsSync(path.join(DIR, id))) continue;
    copyDir(path.join(PRESETS, id), path.join(DIR, id));
    fresh.add(id);
    const settings = readJson(path.join(DIR, id, 'settings.json'), {});
    if (settings.legacyConfig) { // the competition config.json used to describe, in use from the start
      delete settings.legacyConfig;
      first = id;
      for (const k of LEGACY_KEYS) if (machineConfig[k] !== undefined && machineConfig[k] !== '') settings[k] = machineConfig[k];
    }
    writeJson(path.join(DIR, id, 'settings.json'), clean(settings));
    log('info', 'setup', `Added the ${settings.name || id} competition setup from presets/${id}`);
  }
  state.presetVersions = state.presetVersions || {};
  for (const id of presets) {
    const preset = readJson(path.join(PRESETS, id, 'settings.json'), {});
    const version = preset.presetVersion || 1;
    if (!fresh.has(id) && version > (state.presetVersions[id] || 1) && fs.existsSync(path.join(DIR, id, 'settings.json'))) updateFromPreset(id, preset, log);
    state.presetVersions[id] = version;
  }
  if (!list().length) { // nothing at all: start one from config.json
    const id = slug(machineConfig.competitionName || 'competition');
    create(machineConfig.competitionName || DEFAULTS.name, null, Object.fromEntries(LEGACY_KEYS.map(k => [k, machineConfig[k]]).filter(([, v]) => v !== undefined)), id);
  }
  if (!state.active || !fs.existsSync(path.join(DIR, state.active, 'settings.json'))) state.active = first || list()[0].id;
  writeJson(ACTIVE_FILE, state);
  return state.active;
}

// A newer preset (presetVersion went up) passes its changes on to the setup already saved
// from it, but only where that setup still has what an older version of the preset gave it
// (its "was" list, oldest first): anything changed on the setup page is kept. Missing
// logos are copied in too.
function updateFromPreset(id, preset, log) {
  const saved = get(id), after = clean(preset), next = { ...saved }, changed = [];
  const before = [].concat(preset.was || []).map(w => clean(w));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const old = (v, pick) => before.some(b => same(v, pick(b)));
  for (const k of Object.keys(DEFAULTS)) {
    if (k === 'colours') {
      next.colours = { ...saved.colours };
      for (const c of Object.keys(after.colours)) {
        if (saved.colours[c] !== after.colours[c] && old(saved.colours[c], b => b.colours[c])) { next.colours[c] = after.colours[c]; changed.push(`colour ${c}`); }
      }
    } else if (!same(saved[k], after[k]) && old(saved[k], b => b[k])) { next[k] = after[k]; changed.push(k); }
  }
  for (const sub of ['logos', 'brand']) {
    const from = path.join(PRESETS, id, sub), to = path.join(DIR, id, sub);
    if (!fs.existsSync(from)) continue;
    fs.mkdirSync(to, { recursive: true });
    for (const f of fs.readdirSync(from).filter(f => IMAGE.test(f))) if (!fs.existsSync(path.join(to, f))) fs.copyFileSync(path.join(from, f), path.join(to, f));
  }
  if (next.competitionLogo && !fs.existsSync(path.join(DIR, id, 'brand', next.competitionLogo))) next.competitionLogo = saved.competitionLogo;
  writeJson(path.join(DIR, id, 'settings.json'), clean(next));
  log('info', 'setup', `Updated the ${next.name} setup from presets/${id}: ${changed.join(', ') || 'nothing left at the old preset values'}`);
}

function list() {
  let ids = [];
  try { ids = fs.readdirSync(DIR, { withFileTypes: true }).filter(e => e.isDirectory() && validId(e.name)).map(e => e.name); } catch { /* none */ }
  const active = readJson(ACTIVE_FILE, {}).active;
  return ids.filter(id => fs.existsSync(path.join(DIR, id, 'settings.json')))
    .map(id => { const s = get(id); return { id, name: s.name, competitionName: s.competitionName, organisationUrl: s.organisationUrl, active: id === active }; })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function get(id) { return clean(readJson(path.join(dirOf(id), 'settings.json'), {})); }
function save(id, input) {
  const s = clean(input, get(id));
  writeJson(path.join(dirOf(id), 'settings.json'), s);
  return s;
}
function activeId() { return readJson(ACTIVE_FILE, {}).active; }
function setActive(id) {
  dirOf(id);
  if (!fs.existsSync(path.join(DIR, id, 'settings.json'))) throw new Error(`No competition "${id}"`);
  writeJson(ACTIVE_FILE, { ...readJson(ACTIVE_FILE, { seeded: [] }), active: id });
}

// A new setup: a copy of another one's settings (not its logos), or the defaults.
function create(name, fromId, overrides = {}, wantedId) {
  let id = wantedId || slug(name), n = 2;
  while (fs.existsSync(path.join(DIR, id))) id = `${slug(name).slice(0, 36)}-${n++}`;
  const base = fromId ? get(fromId) : DEFAULTS;
  const settings = clean({ ...base, ...overrides, name, competitionLogo: '', logoAliases: fromId ? {} : overrides.logoAliases }, DEFAULTS);
  for (const sub of ['logos', 'brand']) fs.mkdirSync(path.join(DIR, id, sub), { recursive: true });
  writeJson(path.join(DIR, id, 'settings.json'), settings);
  return id;
}
function remove(id) {
  if (id === activeId()) throw new Error('Switch to another competition before deleting this one.');
  fs.rmSync(dirOf(id), { recursive: true, force: true });
}

// ─── Images ─────────────────────────────────────────────────────────────────
function imageDir(id, kind) { return path.join(dirOf(id), kind === 'brand' ? 'brand' : 'logos'); }
function images(id, kind) {
  try { return fs.readdirSync(imageDir(id, kind)).filter(f => IMAGE.test(f)).sort((a, b) => a.localeCompare(b)); } catch { return []; }
}
function saveImage(id, kind, fileName, buf) {
  const name = path.basename(String(fileName || '')).replace(/[^\w .'()&+-]/g, '').trim();
  if (!IMAGE.test(name)) throw new Error('Logos must be PNG, JPG, WebP, SVG or GIF files.');
  if (!buf.length) throw new Error('That file is empty.');
  fs.mkdirSync(imageDir(id, kind), { recursive: true });
  fs.writeFileSync(path.join(imageDir(id, kind), name), buf);
  return name;
}
function deleteImage(id, kind, fileName) {
  const file = path.join(imageDir(id, kind), path.basename(String(fileName || '')));
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
// The file behind a /logos/ or /brand/ link, for the competition in use.
function imageFile(id, kind, fileName) {
  const name = path.basename(decodeURIComponent(fileName));
  return IMAGE.test(name) ? path.join(imageDir(id, kind), name) : null;
}

// ─── Colours (theme.css) ────────────────────────────────────────────────────
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const toHex = a => '#' + a.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
const mix = (hex, other, t) => { const a = rgb(hex), b = rgb(other); return toHex(a.map((v, i) => v + (b[i] - v) * t)); };

// Every overlay links theme.css; the helper writes it from the competition's colours.
// The variable names are the original Thunder League ones, so every page keeps working.
function themeCss(s) {
  const c = s.colours, o = s.panelOpacity;
  const w = FONT_WEIGHTS[s.font];
  const font = s.font.replace(/ /g, '+') + (w ? ':' + w : '');
  const vars = {
    '--font': `"${s.font}", "Montserrat", "Segoe UI", "Helvetica Neue", Arial, sans-serif`,
    '--purple': c.main, '--purple-rgb': rgb(c.main).join(', '),
    '--purple-light': mix(c.main, '#ffffff', 0.25), '--purple-shade': mix(c.main, '#000000', 0.15),
    '--purple-dark': c.dark, '--purple-dark-light': mix(c.dark, '#ffffff', 0.15),
    '--purple-deep': `rgba(${rgb(c.panel).join(', ')}, ${o})`, '--purple-deep-alt': `rgba(${rgb(c.panelAlt).join(', ')}, ${o})`,
    '--deep-rgb': rgb(c.panel).join(', '), '--deep-alt-rgb': rgb(c.panelAlt).join(', '),
    '--yellow': c.highlight, '--yellow-rgb': rgb(c.highlight).join(', '), '--yellow-light': mix(c.highlight, '#ffffff', 0.4),
    '--pink': c.accent, '--pink-rgb': rgb(c.accent).join(', '),
    '--text': c.text, '--text-on-yellow': c.textOnHighlight, '--muted': c.muted,
  };
  return `/* ${s.name}: colours and font from the competition setup page (setup.html). */\n` +
    `@import url("https://fonts.googleapis.com/css2?family=${font}&display=swap");\n` +
    `:root {\n${Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}\n`;
}

module.exports = { DEFAULTS, FONTS, DIR, init, list, get, save, activeId, setActive, create, remove, images, saveImage, deleteImage, imageFile, themeCss, clean };
