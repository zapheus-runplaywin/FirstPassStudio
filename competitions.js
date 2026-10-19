// FirstPass Studio - saved competition setups.
//
// Everything that belongs to one competition and doesn't come from PlayHQ lives in
// competitions/<id>/ in the data folder (datadir.js): settings.json (PlayHQ link, names,
// rules, colours, font and options), logos/ (team logos), brand/ (the competition's own
// logo), photos/ (athlete photos, each named after the athlete, e.g. "Jane Smith.jpg") and
// athletes.json. competitions/active.json says which one the helper and every page use.
//
// The data folder starts with no competitions. imports/ in the app holds import configs,
// ready-made setups (with logos) to start from: Import copies one into the data folder,
// where it can be changed without touching the import config. From a copy of the
// repository, "Save as import config" writes a competition back into imports/ to commit.

'use strict';

const fs = require('fs');
const path = require('path');
const finals = require('./finals');
const datadir = require('./datadir');

const DIR = datadir.file('competitions');
const ACTIVE_FILE = path.join(DIR, 'active.json');
const IMPORTS = datadir.IMPORTS_DIR;
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
  divisionSuperShots: {},              // { "division name or word": true/false }, for divisions that differ (superShotsFor)
  finalsFormat: 'top4-page',           // the finals format (finals.js), blank = no finals
  divisionFinals: {},                  // { "PlayHQ division name": format id or "none" }, for a division with its own format
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
  clubs: {},                           // { "Club": { logo: "file.png", colour: "#rrggbb" } }, shared by every team of the club in every division
  teamClubs: {},                       // { "PlayHQ team name": "Club" }, only for a team whose club isn't found from its name
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

// Setups saved before finals formats had only a number of finals places for the ladder marker.
function fromPlaces(s) {
  if (!s || s.finalsFormat !== undefined || s.finalsPlaces === undefined) return s;
  const { finalsPlaces, ...rest } = s;
  return { ...rest, finalsFormat: finals.fromPlaces(finalsPlaces) };
}

// ─── Clubs ──────────────────────────────────────────────────────────────────
// A club's teams share its logo and colour in every division. A team's club is its name
// without the division words on the end ("Comets 21U", "Comets Men" and "Comets Open" are
// all Comets; "Stormz Div 2" is Stormz), unless the setup page links it to another club.
const DIVISION_WORD = /^(\d+u|u\d+|\d+|men'?s?|women'?s?|ladies|mixed|open|reserves?|res|colts|juniors?|seniors?|masters|ii|iii|iv|[a-f]|(div|division|grade)\d+)$/i;
// Whether a division plays super shots. divisionSuperShots can name a division exactly (as PlayHQ
// names it), or a word in its name: "Open" covers "Open" and "Division 1 Open", "21" covers
// "21&Under", "Men" covers "Men's" (but not "Women's"). An exact name wins, then the longest word
// that matches; a division none of them match follows the competition's superShots.
function superShotsFor(s, division) {
  const own = (s && s.divisionSuperShots) || {};
  const name = String(division || '').trim().toLowerCase();
  if (name) {
    const exact = Object.keys(own).find(k => k.toLowerCase() === name);
    if (exact) return own[exact];
    const esc = k => k.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const word = Object.keys(own).filter(k => new RegExp(`(^|[^a-z0-9])${esc(k)}([^a-z0-9]|$)`).test(name)).sort((a, b) => b.length - a.length)[0];
    if (word) return own[word];
  }
  return !s || s.superShots !== false;
}

function clubOf(team) {
  const words = String(team || '').replace(/\([^)]*\)/g, ' ').replace(/\s[-–—]\s/g, ' ').trim().split(/\s+/).filter(Boolean);
  while (words.length > 1) {
    const last = words[words.length - 1];
    if (/^(div|division|grade)\.?$/i.test(last)) { words.pop(); continue; }
    if (!DIVISION_WORD.test(last)) break;
    words.pop();
    if (words.length > 1 && /^(div|division|grade|under)\.?$/i.test(words[words.length - 1])) words.pop();
  }
  return words.join(' ') || String(team || '').trim();
}
const clubKey = (s, club) => Object.keys((s && s.clubs) || {}).find(k => k.toLowerCase() === String(club || '').toLowerCase());
function clubFor(s, team) { return ((s && s.teamClubs) || {})[team] || clubOf(team); }
function clubEntry(s, club) { const k = clubKey(s, club); return k ? s.clubs[k] : {}; }

// Setups saved before clubs had a logo (logoAliases) and colour (teamColours) per team.
// Each team's goes to its club; a team whose club already has a different one keeps it
// in a club of its own name, so nothing changes on screen.
function fromTeamSettings(s) {
  if (!s || s.clubs !== undefined || (!s.logoAliases && !s.teamColours)) return s;
  const logos = s.logoAliases || {}, colours = s.teamColours || {};
  const clubs = {}, teamClubs = {};
  const teams = [...new Set([...Object.keys(logos), ...Object.keys(colours)])]
    .sort((a, b) => (clubOf(b) === b) - (clubOf(a) === a));
  for (const team of teams) {
    const want = { ...(logos[team] ? { logo: logos[team] } : {}), ...(colours[team] ? { colour: colours[team] } : {}) };
    let club = clubOf(team);
    const have = clubs[club] || {};
    if (Object.keys(want).some(k => have[k] && have[k] !== want[k])) {
      club = team; let n = 2;
      while (clubs[club]) club = `${team} (${n++})`;
      teamClubs[team] = club;
    }
    clubs[club] = { ...(clubs[club] || {}), ...want };
  }
  const { logoAliases, teamColours, ...rest } = s;
  return { ...rest, clubs, teamClubs };
}

// Keep only known settings, with the right types, so a bad save can't break the helper.
function clean(input, base = DEFAULTS) {
  input = fromPlaces(fromTeamSettings(fromFlames(input))); base = fromPlaces(fromTeamSettings(fromFlames(base)));
  const out = {};
  for (const [k, def] of Object.entries(DEFAULTS)) {
    let v = input && input[k] !== undefined ? input[k] : base[k] !== undefined ? base[k] : def;
    if (k === 'colours') {
      v = Object.fromEntries(Object.entries(def).map(([c, d]) => [c, HEX.test((v || {})[c]) ? v[c].toLowerCase() : ((base.colours || {})[c] || d)]));
    } else if (k === 'brandColours') {
      v = (Array.isArray(v) ? v : []).filter(c => c && HEX.test(c.hex)).slice(0, 40)
        .map(c => ({ hex: c.hex.toLowerCase(), name: String(c.name || '').trim().slice(0, 40) }));
    } else if (k === 'clubs') {
      v = Object.fromEntries(Object.entries(v && typeof v === 'object' ? v : {}).map(([club, c]) => [String(club).trim(), {
        ...(c && typeof c.logo === 'string' && c.logo ? { logo: path.basename(c.logo) } : {}),
        ...(c && HEX.test(c.colour) ? { colour: c.colour.toLowerCase() } : {}),
      }]).filter(([club, c]) => club && Object.keys(c).length));
    } else if (k === 'teamClubs') {
      v = Object.fromEntries(Object.entries(v && typeof v === 'object' ? v : {}).filter(([t, c]) => t && typeof c === 'string' && c.trim()).map(([t, c]) => [String(t), c.trim()]));
    } else if (k === 'divisionFinals') {
      v = Object.fromEntries(Object.entries(v && typeof v === 'object' ? v : {}).map(([d, f]) => [String(d).trim(), String(f || '')])
        .filter(([d, f]) => d && (f === 'none' || finals.byId(f))));
    } else if (k === 'divisionSuperShots') {
      v = Object.fromEntries(Object.entries(v && typeof v === 'object' ? v : {}).map(([d, on]) => [String(d).trim(), on])
        .filter(([d, on]) => d && [true, false, 'true', 'false'].includes(on)).map(([d, on]) => [d, on === true || on === 'true']));
    } else if (typeof def === 'boolean') v = v === true || v === 'true' || v === 'on';
    else if (typeof def === 'number') { v = Number(v); if (!Number.isFinite(v)) v = def; }
    else v = String(v ?? '').trim();
    out[k] = v;
  }
  out.periodType = out.periodType === 'halves' ? 'halves' : 'quarters';
  out.quarterMinutes = Math.min(60, Math.max(1, out.quarterMinutes));
  if (out.finalsFormat && !finals.byId(out.finalsFormat)) out.finalsFormat = DEFAULTS.finalsFormat;
  out.autoSelectMinutesBefore = Math.min(120, Math.max(0, out.autoSelectMinutesBefore));
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

// On start: make sure active.json names a competition that exists (or none, when there
// are none yet). readOnly is set when the data folder was saved by a newer Studio.
let readOnly = false;
function init(log, opts = {}) {
  readOnly = !!opts.readOnly;
  fs.mkdirSync(DIR, { recursive: true });
  const active = activeId();
  if (!active || !fs.existsSync(path.join(DIR, active, 'settings.json'))) {
    const first = list()[0];
    if (first) setActive(first.id);
    else if (active && !readOnly) fs.rmSync(ACTIVE_FILE, { force: true });
  }
  if (!list().length) log('info', 'setup', 'No competitions yet: import one or make a new one on the setup page');
  return activeId();
}
function writable() {
  if (readOnly) throw new Error('These settings were saved by a newer version of FirstPass Studio. Update Studio to change them.');
}

function list(dir = DIR) {
  let ids = [];
  try { ids = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory() && validId(e.name)).map(e => e.name); } catch { /* none */ }
  const active = dir === DIR ? activeId() : null;
  return ids.filter(id => fs.existsSync(path.join(dir, id, 'settings.json')))
    .map(id => { const s = clean(readJson(path.join(dir, id, 'settings.json'), {})); return { id, name: s.name, competitionName: s.competitionName, organisationUrl: s.organisationUrl, active: id === active }; })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// The settings of a competition; with no id (no competitions yet) the defaults.
function get(id) { return id ? clean(readJson(path.join(dirOf(id), 'settings.json'), {})) : clean({}); }
function save(id, input) {
  writable();
  const s = clean(input, get(id));
  writeJson(path.join(dirOf(id), 'settings.json'), s);
  return s;
}
function activeId() { return readJson(ACTIVE_FILE, {}).active || null; }
function setActive(id) {
  writable();
  dirOf(id);
  if (!fs.existsSync(path.join(DIR, id, 'settings.json'))) throw new Error(`No competition "${id}"`);
  writeJson(ACTIVE_FILE, { active: id });
}

// A new setup: a copy of another one's settings (not its logos), or the defaults.
function create(name, fromId, overrides = {}, wantedId) {
  writable();
  let id = wantedId || slug(name), n = 2;
  id = freeId(id, name);
  const base = fromId ? get(fromId) : DEFAULTS;
  const settings = clean({ ...base, ...overrides, name, competitionLogo: '', competitionLogoDark: '', clubs: fromId ? {} : overrides.clubs, teamClubs: fromId ? {} : overrides.teamClubs }, DEFAULTS);
  for (const sub of ['logos', 'brand']) fs.mkdirSync(path.join(DIR, id, sub), { recursive: true });
  writeJson(path.join(DIR, id, 'settings.json'), settings);
  return id;
}
// Delete a competition. Deleting the one in use switches to the first one left, or to none.
// Returns the competition in use afterwards.
function remove(id) {
  writable();
  fs.rmSync(dirOf(id), { recursive: true, force: true });
  if (id === activeId()) {
    const next = list()[0];
    if (next) setActive(next.id); else fs.rmSync(ACTIVE_FILE, { force: true });
  }
  return activeId();
}

function freeId(id, name) {
  let out = id, n = 2;
  while (fs.existsSync(path.join(DIR, out))) out = `${slug(name).slice(0, 36)}-${n++}`;
  return out;
}

// ─── Template files ─────────────────────────────────────────────────────────
// A competition as one JSON file: its settings, team logos and competition logo (not athlete
// photos). Exported from the setup page and imported from it on any Studio.
const TEMPLATE_FORMAT = 'firstpass-studio-competition';

function exportTemplate(id) {
  const out = { format: TEMPLATE_FORMAT, version: 1, settings: get(id) };
  for (const sub of ['logos', 'brand']) {
    out[sub] = {};
    for (const f of images(id, sub)) out[sub][f] = fs.readFileSync(path.join(dirOf(id), sub, f)).toString('base64');
  }
  return out;
}

function importTemplate(tpl, name) {
  writable();
  if (!tpl || tpl.format !== TEMPLATE_FORMAT || !tpl.settings) throw new Error("That isn't a FirstPass Studio competition template.");
  const from = clean(tpl.settings);
  name = String(name || '').trim() || from.name;
  const id = freeId(slug(name), name);
  for (const sub of ['logos', 'brand']) fs.mkdirSync(path.join(DIR, id, sub), { recursive: true });
  writeJson(path.join(DIR, id, 'settings.json'), clean({ ...from, name }));
  for (const sub of ['logos', 'brand']) {
    for (const [f, b64] of Object.entries(tpl[sub] || {})) {
      try { saveImage(id, sub, f, Buffer.from(String(b64), 'base64')); } catch { /* skip a file that isn't an image */ }
    }
  }
  if (!activeId()) setActive(id);
  return id;
}

// ─── Import configs (imports/) ──────────────────────────────────────────────
function imports() { return list(IMPORTS).map(({ id, name, competitionName, organisationUrl }) => ({ id, name, competitionName, organisationUrl })); }

// Copy an import config (settings, logos and competition logo) into the data folder as a
// new competition. The first competition imported is put to use.
function importConfig(importId, name) {
  writable();
  if (!validId(importId) || !fs.existsSync(path.join(IMPORTS, importId, 'settings.json'))) throw new Error(`No import config "${importId}"`);
  const from = clean(readJson(path.join(IMPORTS, importId, 'settings.json'), {}));
  name = String(name || '').trim() || from.name;
  const id = freeId(importId, name);
  copyDir(path.join(IMPORTS, importId), path.join(DIR, id));
  for (const sub of ['logos', 'brand']) fs.mkdirSync(path.join(DIR, id, sub), { recursive: true });
  for (const keep of fs.readdirSync(path.join(DIR, id), { recursive: true })) if (path.basename(keep) === '.keep') fs.rmSync(path.join(DIR, id, keep));
  writeJson(path.join(DIR, id, 'settings.json'), clean({ ...from, name }));
  if (!activeId()) setActive(id);
  return id;
}

// Save a competition as an import config in imports/<importId> (settings, logos and
// competition logo; not athlete photos or the athlete register). Only from a copy of the
// repository: the installed app can't change its own folder.
function saveAsImport(id, importId, replace) {
  if (!datadir.canSaveImports()) throw new Error('Import configs can only be saved when Studio runs from a copy of the repository.');
  importId = slug(importId || get(id).name);
  const to = path.join(IMPORTS, importId);
  if (fs.existsSync(to) && !replace) { const e = new Error(`There is already an import config called "${importId}".`); e.exists = importId; throw e; }
  fs.rmSync(to, { recursive: true, force: true });
  for (const sub of ['logos', 'brand']) {
    const files = images(id, sub);
    fs.mkdirSync(path.join(to, sub), { recursive: true });
    for (const f of files) fs.copyFileSync(path.join(dirOf(id), sub, f), path.join(to, sub, f));
    if (!files.length) fs.writeFileSync(path.join(to, sub, '.keep'), '');
  }
  writeJson(path.join(to, 'settings.json'), get(id));
  return importId;
}

// ─── Images ─────────────────────────────────────────────────────────────────
const KINDS = ['logos', 'brand', 'photos'];
function imageDir(id, kind) { return path.join(dirOf(id), KINDS.includes(kind) ? kind : 'logos'); }
function images(id, kind) {
  try { return fs.readdirSync(imageDir(id, kind)).filter(f => IMAGE.test(f)).sort((a, b) => a.localeCompare(b)); } catch { return []; }
}
function saveImage(id, kind, fileName, buf) {
  writable();
  const name = path.basename(String(fileName || '')).replace(/[^\w .'()&+-]/g, '').trim();
  if (!IMAGE.test(name)) throw new Error(`${kind === 'photos' ? 'Photos' : 'Logos'} must be PNG, JPG, WebP, SVG or GIF files.`);
  if (!buf.length) throw new Error('That file is empty.');
  fs.mkdirSync(imageDir(id, kind), { recursive: true });
  fs.writeFileSync(path.join(imageDir(id, kind), name), buf);
  return name;
}
function deleteImage(id, kind, fileName) {
  writable();
  const file = path.join(imageDir(id, kind), path.basename(String(fileName || '')));
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
function renameImage(id, kind, from, to) {
  writable();
  const src = path.join(imageDir(id, kind), path.basename(String(from || '')));
  const name = path.basename(String(to || '')).replace(/[^\w .'()&+-]/g, '').trim();
  if (!IMAGE.test(name)) throw new Error('The new name needs to end in .png, .jpg, .webp, .svg or .gif.');
  if (!fs.existsSync(src)) throw new Error(`There is no ${from} to rename.`);
  fs.renameSync(src, path.join(imageDir(id, kind), name));
  return name;
}
// The file behind a /logos/, /brand/ or /photos/ link, for the competition in use.
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

module.exports = { DEFAULTS, FONTS, DIR, ACTIVE_FILE, init, list, imports, importConfig, saveAsImport, exportTemplate, importTemplate, isReadOnly: () => readOnly, get, save, activeId, setActive, create, remove, images, saveImage, deleteImage, renameImage, imageFile, themeCss, clean, clubOf, clubFor, clubEntry, superShotsFor };
