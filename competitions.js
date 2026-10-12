// PlayHQ Graphics - saved competition setups.
//
// Everything that belongs to one competition and doesn't come from PlayHQ lives in
// competitions/<id>/: settings.json (PlayHQ link, names, rules, colours, font and
// options), logos/ (team logos) and brand/ (the competition's own logo).
// competitions/active.json says which one the helper and every page use.
//
// The competitions folder is tracked in git: the repository holds the starting point,
// the setup page saves changes straight into these files, and you commit and send
// the ones you want to keep (as a pull request) like any other change.

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIR = path.join(ROOT, 'competitions');
const ACTIVE_FILE = path.join(DIR, 'active.json');
const OLD_SETTINGS = path.join(ROOT, 'settings'); // where setups were saved for a while (October 2026)
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
  brandColours: [],                    // [{ hex, name }] pasted from a brand kit, shown as swatches in the colour pickers
  panelOpacity: 0.92,
  font: 'Montserrat',
  competitionLogo: '',                 // a file in brand/: the light mode logo (for a light background)
  competitionLogoDark: '',             // a file in brand/: the dark mode logo (for a dark background); either one alone is used for both
  titleEmoji: '🔥',                    // the emoji either side of the title banner, blank for none
  clashWord: 'CLASH',                  // the big word on The Clash
  logoAliases: {},                     // { "PlayHQ team name": "file.png" }
  teamColours: {},                     // { "PlayHQ team name": "#rrggbb" }, behind the team on the scoreboard and The Clash
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
    } else if (k === 'brandColours') {
      v = (Array.isArray(v) ? v : []).filter(c => c && HEX.test(c.hex)).slice(0, 40)
        .map(c => ({ hex: c.hex.toLowerCase(), name: String(c.name || '').trim().slice(0, 40) }));
    } else if (k === 'logoAliases') {
      v = Object.fromEntries(Object.entries(v && typeof v === 'object' ? v : {}).filter(([t, f]) => t && typeof f === 'string' && f).map(([t, f]) => [String(t), path.basename(f)]));
    } else if (k === 'teamColours') {
      v = Object.fromEntries(Object.entries(v && typeof v === 'object' ? v : {}).filter(([t, c]) => t && HEX.test(c)).map(([t, c]) => [String(t), c.toLowerCase()]));
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
  out.competitionLogoDark = out.competitionLogoDark ? path.basename(out.competitionLogoDark) : '';
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

// On start: bring in setups saved in settings/ by the previous version, make sure there is
// at least one setup, and that active.json names one that exists.
function init(log) {
  moveOldSettings(log);
  fs.mkdirSync(DIR, { recursive: true });
  if (!list().length) create(DEFAULTS.name);
  const active = activeId();
  if (!active || !fs.existsSync(path.join(DIR, active, 'settings.json'))) setActive(list()[0].id);
  return activeId();
}

// For a while setups were saved in settings/competitions/.
// Copy them over competitions/ so your edits show up as changes to commit, then rename
// settings/ to settings.old/ (git ignores it; delete it once you're happy).
function moveOldSettings(log) {
  const old = path.join(OLD_SETTINGS, 'competitions');
  if (!fs.existsSync(OLD_SETTINGS)) return;
  if (fs.existsSync(old)) {
    for (const e of fs.readdirSync(old, { withFileTypes: true })) if (e.isDirectory() && validId(e.name)) copyDir(path.join(old, e.name), path.join(DIR, e.name));
    for (const id of list().map(c => c.id)) writeJson(path.join(DIR, id, 'settings.json'), get(id));
  }
  const active = readJson(path.join(OLD_SETTINGS, 'active.json'), {}).active;
  if (active && fs.existsSync(path.join(DIR, active, 'settings.json'))) setActive(active);
  const control = path.join(OLD_SETTINGS, 'control.json');
  if (fs.existsSync(control)) fs.copyFileSync(control, path.join(ROOT, 'control.json'));
  fs.renameSync(OLD_SETTINGS, path.join(ROOT, 'settings.old'));
  log('info', 'setup', 'Moved the setups saved in settings/ into competitions/ (the old folder is now settings.old)');
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
  writeJson(ACTIVE_FILE, { active: id });
}

// A new setup: a copy of another one's settings (not its logos), or the defaults.
function create(name, fromId, overrides = {}, wantedId) {
  let id = wantedId || slug(name), n = 2;
  while (fs.existsSync(path.join(DIR, id))) id = `${slug(name).slice(0, 36)}-${n++}`;
  const base = fromId ? get(fromId) : DEFAULTS;
  const settings = clean({ ...base, ...overrides, name, competitionLogo: '', competitionLogoDark: '', logoAliases: fromId ? {} : overrides.logoAliases, teamColours: fromId ? {} : overrides.teamColours }, DEFAULTS);
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

module.exports = { DEFAULTS, FONTS, DIR, ACTIVE_FILE, init, list, get, save, activeId, setActive, create, remove, images, saveImage, deleteImage, imageFile, themeCss, clean };
