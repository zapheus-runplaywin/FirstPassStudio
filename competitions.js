// FirstPass Studio - saved competition setups.
//
// Everything that belongs to one competition and doesn't come from PlayHQ lives in
// competitions/<id>/ in the data folder (datadir.js): settings.json (PlayHQ link, names,
// rules, colours, font and options), logos/ (team logos), brand/ (the competition's own
// logo), fonts/ (font files added on the setup page, fonts.js), photos/ (athlete photos, each named after the athlete, e.g. "Jane Smith.jpg") and
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
const fonts = require('./fonts');
const datadir = require('./datadir');
const savefile = require('./savefile');
const uploads = require('./uploads');

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
  quarterBreakMinutes: 3,              // break lengths, for the sequence editor's "plays about N times" hint
  halfTimeMinutes: 5,
  threeQuarterBreakMinutes: 3,
  superShotMinutes: 3,                 // super shots count in the last N minutes of each quarter; the scoreboard shows a tab then (0 = no tab)
  finalsFormat: 'top4-page',           // the finals format (finals.js), blank = no finals
  divisionFinals: {},                  // { "PlayHQ division name": format id or "none" }, for a division with its own format
  defaultCourt: '',
  autoSelectGame: true,
  autoSelectMinutesBefore: 10,
  roundLookaheadDays: 5,
  runningShooters: '',                 // what the Socials tab's running top shooters are called: 'tournament', 'season', or blank = Tournament when the fixture spans under 15 days, else Season
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
  fontSize: 100,                       // %: how tall another font's capitals are next to Montserrat's (fonts.js normalise)
  competitionLogo: '',                 // a file in brand/: the light mode logo (for a light background)
  competitionLogoDark: '',             // a file in brand/: the dark mode logo (for a dark background); either one alone is used for both
  clubs: {},                           // { "Club": { logo: "file.png", colour: "#rrggbb" } }, shared by every team of the club in every division
  teamClubs: {},                       // { "PlayHQ team name": "Club" }, only for a team whose club isn't found from its name
  // Sponsors (sponsors.js and the Sponsors page): what this competition calls each tier, what a tier's
  // spots do when no sponsor is in it, and its own "advertise with us" card for empty spots.
  sponsorTierNames: 'names',           // 'names', 'metals' or 'own' (sponsorOwnNames)
  sponsorOwnNames: {},                 // { tier: "Diamond" }, for 'own'; a blank one uses the Names name
  sponsorEmpty: {},                    // { tier: 'up' | 'down' | 'skip' | 'vacancy' }, missing = SPONSOR_EMPTY_DEFAULTS
  sponsorVacancy: {},                  // { heading, message, contact, link }: the vacancy card, filled in by the competition's admin
  sponsorMoments: {},                  // { moment: sponsor id | 'off' }: who a moment's "brought to you by" tag is for; missing = Elite take turns
  // Where the competition streams, for live viewer numbers (viewers.js): [{ id, platform: 'youtube' | 'facebook',
  // name, where }], filled in by its admin. Their keys and tokens are kept on this Mac only (stream-keys.json).
  streams: [],
  viewersMinimum: 50,                  // the viewers graphic (viewers.html) stays hidden below this many watching
  apiKey: '',                          // PlayHQ Client ID, only needed for the REST Game Summary
  apiTenant: '',
};
const HEX = /^#[0-9a-f]{6}$/i;

// Sponsor tiers, top first. Each competition names them from a set (or its own names) and says
// what an empty tier's spots do: a sponsor from the tier above or below takes them, they're
// hidden, or the competition's vacancy card goes there.
const SPONSOR_TIERS = ['naming', 'elite', 'major', 'partner', 'supporter'];
const SPONSOR_NAME_SETS = {
  names: { naming: 'Naming rights', elite: 'Elite', major: 'Major', partner: 'Partner', supporter: 'Supporter' },
  metals: { naming: 'Naming rights', elite: 'Platinum', major: 'Gold', partner: 'Silver', supporter: 'Bronze' },
};
const SPONSOR_EMPTY = ['up', 'down', 'skip', 'vacancy'];
const SPONSOR_EMPTY_DEFAULTS = { naming: 'vacancy', elite: 'down', major: 'down', partner: 'up', supporter: 'skip' };
const VACANCY_KEYS = { heading: 60, message: 160, contact: 60, link: 300 };
// The moments a sponsor can own: the super shot animation (supershot.html) and the hot streaks and game moments
// (streak.html), each with a "brought to you by" tag (SPONSOR_MOMENTS keys are the pages' own names for them).
const SPONSOR_MOMENTS = { superShot: 'Super shot', heating: 'Heating up', fire: 'On fire', goalForGoal: 'Goal for goal',
  lead: 'Hits the front', level: 'All square', comeback: 'Coming back', siren: 'On the siren', backToBack: 'Back to back super shots' };

const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'competition';
const validId = id => /^[a-z0-9-]{1,40}$/.test(String(id || ''));
const dirOf = id => { if (!validId(id)) throw new Error(`No competition "${id}"`); return path.join(DIR, id); };
const readJson = (file, fallback) => savefile.readJson(file, fallback, (err, movedTo) => console.warn(`Could not read ${file}: ${err.message}${movedTo ? `; moved it to ${path.basename(movedTo)}` : ''}`));
const writeJson = (file, data) => savefile.writeJsonSync(file, data);

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
  input = fromPlaces(fromTeamSettings(input)); base = fromPlaces(fromTeamSettings(base));
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
    } else if (k === 'sponsorOwnNames') {
      v = Object.fromEntries(SPONSOR_TIERS.map(t => [t, String((v || {})[t] ?? '').trim().slice(0, 30)]).filter(([, n]) => n));
    } else if (k === 'sponsorEmpty') {
      v = Object.fromEntries(SPONSOR_TIERS.map(t => [t, (v || {})[t]]).filter(([, e]) => SPONSOR_EMPTY.includes(e)));
    } else if (k === 'streams') {
      const ids = new Set();
      v = (Array.isArray(v) ? v : []).map(x => x && typeof x === 'object' ? x : {}).filter(x => ['youtube', 'facebook'].includes(x.platform)).slice(0, 8).map(x => {
        let id = /^[a-z0-9-]{1,40}$/.test(x.id) && !ids.has(x.id) ? x.id : '';
        for (let n = 1; !id; n++) if (!ids.has(`${x.platform}-${n}`)) id = `${x.platform}-${n}`;
        ids.add(id);
        return { id, platform: x.platform, name: String(x.name ?? '').trim().slice(0, 40), where: String(x.where ?? '').trim().slice(0, 300) };
      });
    } else if (k === 'sponsorMoments') {
      v = Object.fromEntries(Object.keys(SPONSOR_MOMENTS).map(m => [m, String((v || {})[m] ?? '').trim()]).filter(([, o]) => /^[a-z0-9-]{1,60}$/.test(o)));
    } else if (k === 'sponsorVacancy') {
      v = Object.fromEntries(Object.entries(VACANCY_KEYS).map(([f, max]) => [f, String((v || {})[f] ?? '').trim().slice(0, max)]).filter(([, t]) => t));
    } else if (typeof def === 'boolean') v = v === true || v === 'true' || v === 'on';
    else if (typeof def === 'number') { v = Number(v); if (!Number.isFinite(v)) v = def; }
    else v = String(v ?? '').trim();
    out[k] = v;
  }
  if (!['names', 'metals', 'own'].includes(out.sponsorTierNames)) out.sponsorTierNames = 'names';
  if (!['tournament', 'season'].includes(out.runningShooters)) out.runningShooters = '';
  out.periodType = out.periodType === 'halves' ? 'halves' : 'quarters';
  out.quarterMinutes = Math.min(60, Math.max(1, out.quarterMinutes));
  for (const k of ['quarterBreakMinutes', 'halfTimeMinutes', 'threeQuarterBreakMinutes']) out[k] = Math.min(60, Math.max(0, out[k]));
  out.superShotMinutes = Math.min(out.quarterMinutes, Math.max(0, out.superShotMinutes));
  if (out.finalsFormat && !finals.byId(out.finalsFormat)) out.finalsFormat = DEFAULTS.finalsFormat;
  out.autoSelectMinutesBefore = Math.min(120, Math.max(0, out.autoSelectMinutesBefore));
  out.roundLookaheadDays = Math.min(14, Math.max(1, Math.round(out.roundLookaheadDays)));
  out.panelOpacity = Math.min(1, Math.max(0.3, out.panelOpacity));
  // Any font name: a bundled one, one on the Mac or an added one (fonts.js). One that isn't there
  // falls back to Montserrat on the graphics.
  out.font = fonts.cleanName(out.font) || DEFAULTS.font;
  out.fontSize = Math.round(Math.min(130, Math.max(80, Number(out.fontSize) || DEFAULTS.fontSize)));
  out.competitionLogo = out.competitionLogo ? path.basename(out.competitionLogo) : '';
  out.competitionLogoDark = out.competitionLogoDark ? path.basename(out.competitionLogoDark) : '';
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
    // A folder saved by a newer Studio can't be written to, so it's left with none in use.
    if (first && !readOnly) setActive(first.id);
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
  for (const sub of ['logos', 'brand', 'fonts']) {
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
  for (const sub of ['logos', 'brand', 'fonts']) {
    for (const [f, b64] of Object.entries(tpl[sub] || {})) {
      try { saveImage(id, sub, f, Buffer.from(String(b64), 'base64')); } catch { /* skip a file that isn't an image or font */ }
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
  for (const sub of ['logos', 'brand', 'fonts']) {
    const files = images(id, sub);
    fs.mkdirSync(path.join(to, sub), { recursive: true });
    for (const f of files) fs.copyFileSync(path.join(dirOf(id), sub, f), path.join(to, sub, f));
    if (!files.length) fs.writeFileSync(path.join(to, sub, '.keep'), '');
  }
  writeJson(path.join(to, 'settings.json'), get(id));
  return importId;
}

// ─── Images (and font files) ────────────────────────────────────────────────
const KINDS = ['logos', 'brand', 'photos', 'fonts', 'headshots']; // headshots: the Production Planner's commentators'
function imageDir(id, kind) { return path.join(dirOf(id), KINDS.includes(kind) ? kind : 'logos'); }
const typeOf = kind => kind === 'fonts' ? fonts.FILE : IMAGE;
function images(id, kind) {
  try { return fs.readdirSync(imageDir(id, kind)).filter(f => typeOf(kind).test(f)).sort((a, b) => a.localeCompare(b)); } catch { return []; }
}
function saveImage(id, kind, fileName, buf) {
  writable();
  const name = path.basename(String(fileName || '')).replace(/[^\w .'()&+-]/g, '').trim();
  if (!typeOf(kind).test(name)) throw new Error(kind === 'fonts' ? 'Fonts must be TTF, OTF, WOFF or WOFF2 files.'
    : `${kind === 'photos' || kind === 'headshots' ? 'Photos' : 'Logos'} must be PNG, JPG, WebP, SVG or GIF files.`);
  if (!buf.length) throw new Error('That file is empty.');
  if (kind !== 'fonts') uploads.checkImage(name, buf);
  fs.mkdirSync(imageDir(id, kind), { recursive: true });
  savefile.writeFileSync(path.join(imageDir(id, kind), name), buf);
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
// The file behind a /logos/, /brand/, /photos/, /headshots/ or /fonts/ link, for the competition in use.
function imageFile(id, kind, fileName) {
  const name = path.basename(decodeURIComponent(fileName));
  return typeOf(kind).test(name) ? path.join(imageDir(id, kind), name) : null;
}

// ─── Colours (theme.css) ────────────────────────────────────────────────────
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const toHex = a => '#' + a.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
const mix = (hex, other, t) => { const a = rgb(hex), b = rgb(other); return toHex(a.map((v, i) => v + (b[i] - v) * t)); };

// Every overlay links theme.css; the helper writes it from the competition's colours and font
// (with fontFiles, the paths of the competition's added font files, and macFaces when the font is a
// Mac font, from fonts.macFaces). The variable names are the original
// Thunder League ones, so every page keeps working.
function themeCss(s, fontFiles = [], macFaces = null) {
  const vars = { '--font': fonts.stack(s.font, macFaces), ...colourVars(s.colours, s.panelOpacity) };
  return `/* ${s.name}: colours and font from the competition setup page (setup.html). */\n` +
    fonts.css(s.font, fontFiles, undefined, { mac: macFaces, size: s.fontSize / 100 }) + '\n' +
    `:root {\n${Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}\n`;
}

// theme.css's colour variables from a competition's colours (c: main, dark, panel, panelAlt, highlight, accent, text,
// textOnHighlight, muted) and panel opacity (o). The Socials tab's colour sets use it too (socials.js).
function colourVars(c, o) {
  return {
    '--purple': c.main, '--purple-rgb': rgb(c.main).join(', '),
    '--purple-light': mix(c.main, '#ffffff', 0.25), '--purple-shade': mix(c.main, '#000000', 0.15),
    '--purple-dark': c.dark, '--purple-dark-light': mix(c.dark, '#ffffff', 0.15),
    '--purple-deep': `rgba(${rgb(c.panel).join(', ')}, ${o})`, '--purple-deep-alt': `rgba(${rgb(c.panelAlt).join(', ')}, ${o})`,
    '--deep-rgb': rgb(c.panel).join(', '), '--deep-alt-rgb': rgb(c.panelAlt).join(', '),
    '--yellow': c.highlight, '--yellow-rgb': rgb(c.highlight).join(', '), '--yellow-light': mix(c.highlight, '#ffffff', 0.4),
    '--pink': c.accent, '--pink-rgb': rgb(c.accent).join(', '),
    '--text': c.text, '--text-on-yellow': c.textOnHighlight, '--muted': c.muted,
  };
}

// What a competition calls each sponsor tier, and what each empty tier does.
function sponsorTiers(s) {
  const set = SPONSOR_NAME_SETS[s && s.sponsorTierNames] || SPONSOR_NAME_SETS.names;
  const own = (s && s.sponsorTierNames === 'own' && s.sponsorOwnNames) || {};
  return SPONSOR_TIERS.map(key => ({ key, name: own[key] || set[key], empty: ((s && s.sponsorEmpty) || {})[key] || SPONSOR_EMPTY_DEFAULTS[key] }));
}

module.exports = { KINDS, SPONSOR_TIERS, SPONSOR_NAME_SETS, SPONSOR_EMPTY, SPONSOR_EMPTY_DEFAULTS, SPONSOR_MOMENTS, sponsorTiers, DEFAULTS, DIR, ACTIVE_FILE, init, list, imports, importConfig, saveAsImport, exportTemplate, importTemplate, isReadOnly: () => readOnly, get, save, activeId, setActive, create, remove, images, saveImage, deleteImage, renameImage, imageFile, themeCss, colourVars, mix, clean, clubOf, clubFor, clubEntry, superShotsFor };
