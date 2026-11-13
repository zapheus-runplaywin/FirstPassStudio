// FirstPass Studio - saved competition setups.
//
// Everything that belongs to one competition and doesn't come from PlayHQ lives in
// competitions/<id>/ in the data folder (datadir.ts): settings.json (PlayHQ link, names,
// rules, colours, font and options), logos/ (team logos), brand/ (the competition's own
// logo), fonts/ (font files added on the setup page, fonts.ts), photos/ (athlete photos, each named after the athlete, e.g. "Jane Smith.jpg") and
// athletes.json. competitions/active.json says which one the helper and every page use.
//
// The data folder starts with no competitions. imports/ in the app holds import configs,
// ready-made setups (with logos) to start from: Import copies one into the data folder,
// where it can be changed without touching the import config. From a copy of the
// repository, "Save as import config" writes a competition back into imports/ to commit.

import fs from 'node:fs';
import path from 'node:path';
import * as finals from './finals';
import * as fonts from './fonts';
import * as datadir from './datadir';
import * as savefile from './savefile';
import * as uploads from './uploads';
import { arr, obj, str } from './check';
import { errorMessage } from './errors';
import type { Body, Log } from './types';

// The competition's colours (theme.css, colourVars).
interface Colours { main: string; dark: string; panel: string; panelAlt: string; highlight: string; accent: string; text: string; textOnHighlight: string; muted: string }
// A club's logo (a file in logos/) and colour, shared by every team of the club.
interface Club { logo?: string; colour?: string }
// Where the competition streams, for live viewer numbers (viewers.ts).
interface Stream { id: string; platform: 'youtube' | 'facebook'; name: string; where: string }
type Tier = 'naming' | 'elite' | 'major' | 'partner' | 'supporter';
type EmptyRule = 'up' | 'down' | 'skip' | 'vacancy';
type Moment = keyof typeof SPONSOR_MOMENTS;
// A competition's settings (settings.json), as clean() keeps them. DEFAULTS says what each is for.
interface Settings {
  name: string; organisationUrl: string; competitionName: string; seasonName: string; displayName: string; organisationName: string; venueName: string;
  periodType: 'quarters' | 'halves'; quarterMinutes: number; superShots: boolean; divisionSuperShots: Record<string, boolean>;
  quarterBreakMinutes: number; halfTimeMinutes: number; threeQuarterBreakMinutes: number; superShotMinutes: number;
  finalsFormat: string; divisionFinals: Record<string, string>; defaultCourt: string; autoSelectMinutesBefore: number; roundLookaheadDays: number;
  finalsWinners: 'champions' | 'premiers'; runningShooters: '' | 'tournament' | 'season';
  colours: Colours; brandColours: { hex: string; name: string }[]; panelOpacity: number; font: string; fontSize: number;
  competitionLogo: string; competitionLogoDark: string; clubs: Record<string, Club>; teamClubs: Record<string, string>;
  sponsorTierNames: 'names' | 'metals' | 'own'; sponsorOwnNames: Partial<Record<Tier, string>>; sponsorEmpty: Partial<Record<Tier, EmptyRule>>;
  sponsorVacancy: Partial<Record<keyof typeof VACANCY_KEYS, string>>; sponsorMoments: Partial<Record<Moment, string>>;
  streams: Stream[]; viewersMinimum: number; apiKey: string; apiTenant: string;
}
// An image folder of a competition (or its added fonts).
type Kind = typeof KINDS[number];

const DIR = datadir.file('competitions');
const ACTIVE_FILE = path.join(DIR, 'active.json');
const IMPORTS = datadir.IMPORTS_DIR;
const IMAGE = /\.(png|jpe?g|webp|svg|gif)$/i;

// Every competition setting, with its default. The setup page shows these.
const DEFAULTS: Settings = {
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
  quarterBreakMinutes: 3,              // break lengths, for the sequence editor's "plays about N times" hint and Commentator stats' Back in countdown
  halfTimeMinutes: 5,
  threeQuarterBreakMinutes: 3,
  superShotMinutes: 3,                 // super shots count in the last N minutes of each quarter; the scoreboard shows a tab then (0 = no tab)
  finalsFormat: 'top4-page',           // the finals format (finals.ts), blank = no finals
  divisionFinals: {},                  // { "PlayHQ division name": format id or "none" }, for a division with its own format
  defaultCourt: '',                    // the fallback court to follow on a night the Production Planner has no plan for
  autoSelectMinutesBefore: 10,
  roundLookaheadDays: 5,
  finalsWinners: 'champions',         // what the Socials tab's Champions picture calls the grand final winners: 'champions' or 'premiers'
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
  fontSize: 100,                       // %: how tall another font's capitals are next to Montserrat's (fonts.ts normalise)
  competitionLogo: '',                 // a file in brand/: the light mode logo (for a light background)
  competitionLogoDark: '',             // a file in brand/: the dark mode logo (for a dark background); either one alone is used for both
  clubs: {},                           // { "Club": { logo: "file.png", colour: "#rrggbb" } }, shared by every team of the club in every division
  teamClubs: {},                       // { "PlayHQ team name": "Club" }, only for a team whose club isn't found from its name
  // Sponsors (sponsors.ts and the Sponsors page): what this competition calls each tier, what a tier's
  // spots do when no sponsor is in it, and its own "advertise with us" card for empty spots.
  sponsorTierNames: 'names',           // 'names', 'metals' or 'own' (sponsorOwnNames)
  sponsorOwnNames: {},                 // { tier: "Diamond" }, for 'own'; a blank one uses the Names name
  sponsorEmpty: {},                    // { tier: 'up' | 'down' | 'skip' | 'vacancy' }, missing = SPONSOR_EMPTY_DEFAULTS
  sponsorVacancy: {},                  // { heading, message, contact, link }: the vacancy card, filled in by the competition's admin
  sponsorMoments: {},                  // { moment: sponsor id | 'off' }: who a moment's "brought to you by" tag is for; missing = Elite take turns
  // Where the competition streams, for live viewer numbers (viewers.ts): [{ id, platform: 'youtube' | 'facebook',
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
const SPONSOR_TIERS: readonly Tier[] = ['naming', 'elite', 'major', 'partner', 'supporter'];
const SPONSOR_NAME_SETS: Record<'names' | 'metals', Record<Tier, string>> = {
  names: { naming: 'Naming rights', elite: 'Elite', major: 'Major', partner: 'Partner', supporter: 'Supporter' },
  metals: { naming: 'Naming rights', elite: 'Platinum', major: 'Gold', partner: 'Silver', supporter: 'Bronze' },
};
const SPONSOR_EMPTY: readonly EmptyRule[] = ['up', 'down', 'skip', 'vacancy'];
const SPONSOR_EMPTY_DEFAULTS: Record<Tier, EmptyRule> = { naming: 'vacancy', elite: 'down', major: 'down', partner: 'up', supporter: 'skip' };
const VACANCY_KEYS = { heading: 60, message: 160, contact: 60, link: 300 };
// The moments a sponsor can own: the super shot animation (supershot.html) and the hot streaks and game moments
// (streak.html), each with a "brought to you by" tag (SPONSOR_MOMENTS keys are the pages' own names for them).
const SPONSOR_MOMENTS = { superShot: 'Super shot', heating: 'Heating up', fire: 'On fire', goalForGoal: 'Goal for goal',
  lead: 'Hits the front', level: 'All square', comeback: 'Coming back', siren: 'On the siren', backToBack: 'Back to back super shots' };

const slug = (s: unknown) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'competition';
const validId = (id: unknown) => /^[a-z0-9-]{1,40}$/.test(String(id || ''));
const dirOf = (id: string | null | undefined): string => { if (!id || !validId(id)) throw new Error(`No competition "${id}"`); return path.join(DIR, id); };
// A settings or active.json file, unchecked: clean() checks a competition's settings.
const readJson = (file: string): Body => obj(savefile.readJson<unknown>(file, {}, (err, movedTo) => console.warn(`Could not read ${file}: ${errorMessage(err)}${movedTo ? `; moved it to ${path.basename(movedTo)}` : ''}`)));
const writeJson = (file: string, data: unknown) => savefile.writeJsonSync(file, data);

// Setups saved before finals formats had only a number of finals places for the ladder marker.
function fromPlaces(s: Body): Body {
  if (s.finalsFormat !== undefined || s.finalsPlaces === undefined) return s;
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
function superShotsFor(s: Partial<Pick<Settings, 'divisionSuperShots' | 'superShots'>> | null | undefined, division: unknown): boolean {
  const own = (s && s.divisionSuperShots) || {};
  const name = String(division || '').trim().toLowerCase();
  if (name) {
    const exact = Object.keys(own).find(k => k.toLowerCase() === name);
    if (exact) return own[exact];
    const esc = (k: string) => k.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const word = Object.keys(own).filter(k => new RegExp(`(^|[^a-z0-9])${esc(k)}([^a-z0-9]|$)`).test(name)).sort((a, b) => b.length - a.length)[0];
    if (word) return own[word];
  }
  return !s || s.superShots !== false;
}

function clubOf(team: unknown): string {
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
type ClubSettings = Partial<Pick<Settings, 'clubs' | 'teamClubs'>> | null | undefined;
const clubKey = (s: ClubSettings, club: unknown) => Object.keys((s && s.clubs) || {}).find(k => k.toLowerCase() === String(club || '').toLowerCase());
function clubFor(s: ClubSettings, team: string): string { return ((s && s.teamClubs) || {})[team] || clubOf(team); }
function clubEntry(s: ClubSettings, club: unknown): Club { const k = clubKey(s, club); return (s && k && s.clubs && s.clubs[k]) || {}; }

// Setups saved before clubs had a logo (logoAliases) and colour (teamColours) per team.
// Each team's goes to its club; a team whose club already has a different one keeps it
// in a club of its own name, so nothing changes on screen.
function fromTeamSettings(s: Body): Body {
  if (s.clubs !== undefined || (!s.logoAliases && !s.teamColours)) return s;
  const logos = obj(s.logoAliases), colours = obj(s.teamColours);
  const clubs: Record<string, Club> = {}, teamClubs: Record<string, string> = {};
  const teams = [...new Set([...Object.keys(logos), ...Object.keys(colours)])]
    .sort((a, b) => Number(clubOf(b) === b) - Number(clubOf(a) === a));
  for (const team of teams) {
    const want: Club = { ...(logos[team] ? { logo: str(logos[team]) } : {}), ...(colours[team] ? { colour: str(colours[team]) } : {}) };
    let club = clubOf(team);
    const have = clubs[club] || {};
    if ((Object.keys(want) as (keyof Club)[]).some(k => have[k] && have[k] !== want[k])) {
      club = team; let n = 2;
      while (clubs[club]) club = `${team} (${n++})`;
      teamClubs[team] = club;
    }
    clubs[club] = { ...(clubs[club] || {}), ...want };
  }
  const { logoAliases, teamColours, ...rest } = s;
  return { ...rest, clubs, teamClubs };
}

// Keep only known settings, with the right types, so a bad save can't break the helper. Each setting comes from input,
// else base, else its default.
function clean(input: unknown, base: unknown = DEFAULTS): Settings {
  const i = fromPlaces(fromTeamSettings(obj(input))), b = fromPlaces(fromTeamSettings(obj(base)));
  const pick = (k: keyof Settings): unknown => i[k] !== undefined ? i[k] : b[k] !== undefined ? b[k] : DEFAULTS[k];
  const text = (k: keyof Settings) => String(pick(k) ?? '').trim();
  const number = (k: keyof Settings, def: number) => { const v = Number(pick(k)); return Number.isFinite(v) ? v : def; };
  const bool = (k: keyof Settings) => { const v = pick(k); return v === true || v === 'true' || v === 'on'; };
  const entries = (k: keyof Settings) => Object.entries(obj(pick(k)));
  const hex = (v: unknown): v is string => typeof v === 'string' && HEX.test(v);
  const one = <T extends string>(v: unknown, allowed: readonly T[], def: T): T => allowed.includes(v as T) ? v as T : def;

  const given = obj(pick('colours')), baseColours = obj(b.colours);
  const colours = Object.fromEntries(Object.entries(DEFAULTS.colours).map(([c, d]) => [c, hex(given[c]) ? given[c].toLowerCase() : str(baseColours[c]) || d])) as Colours;
  const brandColours = arr(pick('brandColours')).map(obj).filter(c => hex(c.hex)).slice(0, 40)
    .map(c => ({ hex: str(c.hex).toLowerCase(), name: String(c.name || '').trim().slice(0, 40) }));
  const clubs: Record<string, Club> = Object.fromEntries(entries('clubs').map(([club, v]): [string, Club] => {
    const c = obj(v);
    return [String(club).trim(), {
      ...(typeof c.logo === 'string' && c.logo ? { logo: path.basename(c.logo) } : {}),
      ...(hex(c.colour) ? { colour: c.colour.toLowerCase() } : {}),
    }];
  }).filter(([club, c]) => club && Object.keys(c).length));
  const teamClubs = Object.fromEntries(entries('teamClubs').filter((e): e is [string, string] => !!e[0] && typeof e[1] === 'string' && !!e[1].trim())
    .map(([t, c]) => [t, c.trim()]));
  const divisionFinals = Object.fromEntries(entries('divisionFinals').map(([d, f]) => [String(d).trim(), String(f || '')])
    .filter(([d, f]) => d && (f === 'none' || finals.byId(f))));
  const divisionSuperShots = Object.fromEntries(entries('divisionSuperShots').map(([d, on]): [string, unknown] => [String(d).trim(), on])
    .filter(([d, on]) => d && [true, false, 'true', 'false'].includes(on as string)).map(([d, on]) => [d, on === true || on === 'true']));
  const ownNames = obj(pick('sponsorOwnNames')), empty = obj(pick('sponsorEmpty'));
  const sponsorOwnNames = Object.fromEntries(SPONSOR_TIERS.map(t => [t, String(ownNames[t] ?? '').trim().slice(0, 30)]).filter(([, n]) => n));
  const sponsorEmpty = Object.fromEntries(SPONSOR_TIERS.map(t => [t, empty[t]]).filter(([, e]) => SPONSOR_EMPTY.includes(e as EmptyRule)));
  const ids = new Set<string>();
  const streams = arr(pick('streams')).map(obj).filter(x => x.platform === 'youtube' || x.platform === 'facebook').slice(0, 8).map((x): Stream => {
    const platform = x.platform as Stream['platform'];
    let id = typeof x.id === 'string' && /^[a-z0-9-]{1,40}$/.test(x.id) && !ids.has(x.id) ? x.id : '';
    for (let n = 1; !id; n++) if (!ids.has(`${platform}-${n}`)) id = `${platform}-${n}`;
    ids.add(id);
    return { id, platform, name: String(x.name ?? '').trim().slice(0, 40), where: String(x.where ?? '').trim().slice(0, 300) };
  });
  const moments = obj(pick('sponsorMoments')), vacancy = obj(pick('sponsorVacancy'));
  const sponsorMoments = Object.fromEntries(Object.keys(SPONSOR_MOMENTS).map(m => [m, String(moments[m] ?? '').trim()]).filter(([, o]) => /^[a-z0-9-]{1,60}$/.test(o)));
  const sponsorVacancy = Object.fromEntries(Object.entries(VACANCY_KEYS).map(([f, max]) => [f, String(vacancy[f] ?? '').trim().slice(0, max)]).filter(([, t]) => t));

  const quarterMinutes = Math.min(60, Math.max(1, number('quarterMinutes', DEFAULTS.quarterMinutes)));
  const breakMinutes = (k: 'quarterBreakMinutes' | 'halfTimeMinutes' | 'threeQuarterBreakMinutes') => Math.min(60, Math.max(0, number(k, DEFAULTS[k])));
  const finalsFormat = text('finalsFormat');
  const competitionName = text('competitionName');
  const competitionLogo = text('competitionLogo'), competitionLogoDark = text('competitionLogoDark');
  // In the order of DEFAULTS, which is the order settings.json keeps them in.
  return {
    name: text('name').slice(0, 80) || competitionName || DEFAULTS.name,
    organisationUrl: text('organisationUrl'),
    competitionName,
    seasonName: text('seasonName'),
    displayName: text('displayName'),
    organisationName: text('organisationName'),
    venueName: text('venueName'),
    periodType: text('periodType') === 'halves' ? 'halves' : 'quarters',
    quarterMinutes,
    superShots: bool('superShots'),
    divisionSuperShots,
    quarterBreakMinutes: breakMinutes('quarterBreakMinutes'),
    halfTimeMinutes: breakMinutes('halfTimeMinutes'),
    threeQuarterBreakMinutes: breakMinutes('threeQuarterBreakMinutes'),
    superShotMinutes: Math.min(quarterMinutes, Math.max(0, number('superShotMinutes', DEFAULTS.superShotMinutes))),
    finalsFormat: finalsFormat && !finals.byId(finalsFormat) ? DEFAULTS.finalsFormat : finalsFormat,
    divisionFinals,
    defaultCourt: text('defaultCourt'),
    autoSelectMinutesBefore: Math.min(120, Math.max(0, number('autoSelectMinutesBefore', DEFAULTS.autoSelectMinutesBefore))),
    roundLookaheadDays: Math.min(14, Math.max(1, Math.round(number('roundLookaheadDays', DEFAULTS.roundLookaheadDays)))),
    finalsWinners: one(text('finalsWinners'), ['champions', 'premiers'], 'champions'),
    runningShooters: one(text('runningShooters'), ['tournament', 'season'], ''),
    colours,
    brandColours,
    panelOpacity: Math.min(1, Math.max(0.3, number('panelOpacity', DEFAULTS.panelOpacity))),
    // Any font name: a bundled one, one on the Mac or an added one (fonts.ts). One that isn't there falls back to
    // Montserrat on the graphics.
    font: fonts.cleanName(text('font')) || DEFAULTS.font,
    fontSize: Math.round(Math.min(130, Math.max(80, number('fontSize', DEFAULTS.fontSize) || DEFAULTS.fontSize))),
    competitionLogo: competitionLogo ? path.basename(competitionLogo) : '',
    competitionLogoDark: competitionLogoDark ? path.basename(competitionLogoDark) : '',
    clubs,
    teamClubs,
    sponsorTierNames: one(text('sponsorTierNames'), ['names', 'metals', 'own'], 'names'),
    sponsorOwnNames,
    sponsorEmpty,
    sponsorVacancy,
    sponsorMoments,
    streams,
    viewersMinimum: number('viewersMinimum', DEFAULTS.viewersMinimum),
    apiKey: text('apiKey'),
    apiTenant: text('apiTenant'),
  };
}

function copyDir(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}

// On start: make sure active.json names a competition that exists (or none, when there
// are none yet). readOnly is set when the data folder was saved by a newer Studio.
let readOnly = false;
function init(log: Log, opts: { readOnly?: boolean } = {}): string | null {
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

function list(dir = DIR): { id: string; name: string; competitionName: string; organisationUrl: string; active: boolean }[] {
  let ids: string[] = [];
  try { ids = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory() && validId(e.name)).map(e => e.name); } catch { /* none */ }
  const active = dir === DIR ? activeId() : null;
  return ids.filter(id => fs.existsSync(path.join(dir, id, 'settings.json')))
    .map(id => { const s = clean(readJson(path.join(dir, id, 'settings.json'))); return { id, name: s.name, competitionName: s.competitionName, organisationUrl: s.organisationUrl, active: id === active }; })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// The settings of a competition; with no id (no competitions yet) the defaults.
function get(id?: string | null): Settings { return id ? clean(readJson(path.join(dirOf(id), 'settings.json'))) : clean({}); }
function save(id: string, input: unknown): Settings {
  writable();
  const s = clean(input, get(id));
  writeJson(path.join(dirOf(id), 'settings.json'), s);
  return s;
}
function activeId(): string | null { const a = readJson(ACTIVE_FILE).active; return typeof a === 'string' && a ? a : null; }
function setActive(id: string): void {
  writable();
  dirOf(id);
  if (!fs.existsSync(path.join(DIR, id, 'settings.json'))) throw new Error(`No competition "${id}"`);
  writeJson(ACTIVE_FILE, { active: id });
}

// A new setup: a copy of another one's settings (not its logos), or the defaults.
function create(name: string, fromId?: string | null, overrides: Partial<Settings> = {}, wantedId?: string): string {
  writable();
  const id = freeId(wantedId || slug(name), name);
  const base = fromId ? get(fromId) : DEFAULTS;
  const settings = clean({ ...base, ...overrides, name, competitionLogo: '', competitionLogoDark: '', clubs: fromId ? {} : overrides.clubs, teamClubs: fromId ? {} : overrides.teamClubs }, DEFAULTS);
  for (const sub of ['logos', 'brand']) fs.mkdirSync(path.join(DIR, id, sub), { recursive: true });
  writeJson(path.join(DIR, id, 'settings.json'), settings);
  return id;
}
// Delete a competition. Deleting the one in use switches to the first one left, or to none.
// Returns the competition in use afterwards.
function remove(id: string): string | null {
  writable();
  fs.rmSync(dirOf(id), { recursive: true, force: true });
  if (id === activeId()) {
    const next = list()[0];
    if (next) setActive(next.id); else fs.rmSync(ACTIVE_FILE, { force: true });
  }
  return activeId();
}

function freeId(id: string, name: string): string {
  let out = id, n = 2;
  while (fs.existsSync(path.join(DIR, out))) out = `${slug(name).slice(0, 36)}-${n++}`;
  return out;
}

// ─── Template files ─────────────────────────────────────────────────────────
// A competition as one JSON file: its settings, team logos and competition logo (not athlete
// photos). Exported from the setup page and imported from it on any Studio.
const TEMPLATE_FORMAT = 'firstpass-studio-competition';

// The files of a template, by folder: file name -> base64.
type TemplateFiles = Record<'logos' | 'brand' | 'fonts', Record<string, string>>;
function exportTemplate(id: string): { format: string; version: number; settings: Settings } & TemplateFiles {
  const files = { logos: {}, brand: {}, fonts: {} } as TemplateFiles;
  for (const sub of ['logos', 'brand', 'fonts'] as const) {
    for (const f of images(id, sub)) files[sub][f] = fs.readFileSync(path.join(dirOf(id), sub, f)).toString('base64');
  }
  return { format: TEMPLATE_FORMAT, version: 1, settings: get(id), ...files };
}

function importTemplate(input: unknown, name?: string): string {
  writable();
  const tpl = obj(input);
  if (tpl.format !== TEMPLATE_FORMAT || !tpl.settings) throw new Error("That isn't a FirstPass Studio competition template.");
  const from = clean(tpl.settings);
  name = String(name || '').trim() || from.name;
  const id = freeId(slug(name), name);
  for (const sub of ['logos', 'brand']) fs.mkdirSync(path.join(DIR, id, sub), { recursive: true });
  writeJson(path.join(DIR, id, 'settings.json'), clean({ ...from, name }));
  for (const sub of ['logos', 'brand', 'fonts'] as const) {
    for (const [f, b64] of Object.entries(obj(tpl[sub]))) {
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
function importConfig(importId: string, name?: string): string {
  writable();
  if (!validId(importId) || !fs.existsSync(path.join(IMPORTS, importId, 'settings.json'))) throw new Error(`No import config "${importId}"`);
  const from = clean(readJson(path.join(IMPORTS, importId, 'settings.json')));
  name = String(name || '').trim() || from.name;
  const id = freeId(importId, name);
  copyDir(path.join(IMPORTS, importId), path.join(DIR, id));
  for (const sub of ['logos', 'brand']) fs.mkdirSync(path.join(DIR, id, sub), { recursive: true });
  for (const keep of fs.readdirSync(path.join(DIR, id), { recursive: true, encoding: 'utf8' })) if (path.basename(keep) === '.keep') fs.rmSync(path.join(DIR, id, keep));
  writeJson(path.join(DIR, id, 'settings.json'), clean({ ...from, name }));
  if (!activeId()) setActive(id);
  return id;
}

// Save a competition as an import config in imports/<importId> (settings, logos and
// competition logo; not athlete photos or the athlete register). Only from a copy of the
// repository: the installed app can't change its own folder.
function saveAsImport(id: string, importId: string | undefined, replace?: boolean): string {
  if (!datadir.canSaveImports()) throw new Error('Import configs can only be saved when Studio runs from a copy of the repository.');
  importId = slug(importId || get(id).name);
  const to = path.join(IMPORTS, importId);
  if (fs.existsSync(to) && !replace) throw Object.assign(new Error(`There is already an import config called "${importId}".`), { exists: importId });
  fs.rmSync(to, { recursive: true, force: true });
  for (const sub of ['logos', 'brand', 'fonts'] as const) {
    const files = images(id, sub);
    fs.mkdirSync(path.join(to, sub), { recursive: true });
    for (const f of files) fs.copyFileSync(path.join(dirOf(id), sub, f), path.join(to, sub, f));
    if (!files.length) fs.writeFileSync(path.join(to, sub, '.keep'), '');
  }
  writeJson(path.join(to, 'settings.json'), get(id));
  return importId;
}

// ─── Images (and font files) ────────────────────────────────────────────────
const KINDS = ['logos', 'brand', 'photos', 'fonts', 'headshots'] as const; // headshots: the Production Planner's commentators'
const isKind = (kind: unknown): kind is Kind => KINDS.includes(kind as Kind);
function imageDir(id: string, kind: unknown) { return path.join(dirOf(id), isKind(kind) ? kind : 'logos'); }
const typeOf = (kind: unknown) => kind === 'fonts' ? fonts.FILE : IMAGE;
function images(id: string | null | undefined, kind: unknown): string[] {
  if (!id) return [];
  try { return fs.readdirSync(imageDir(id, kind)).filter(f => typeOf(kind).test(f)).sort((a, b) => a.localeCompare(b)); } catch { return []; }
}
function saveImage(id: string, kind: unknown, fileName: unknown, buf: Buffer): string {
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
function deleteImage(id: string, kind: unknown, fileName: unknown): void {
  writable();
  const file = path.join(imageDir(id, kind), path.basename(String(fileName || '')));
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
function renameImage(id: string, kind: unknown, from: unknown, to: unknown): string {
  writable();
  const src = path.join(imageDir(id, kind), path.basename(String(from || '')));
  const name = path.basename(String(to || '')).replace(/[^\w .'()&+-]/g, '').trim();
  if (!IMAGE.test(name)) throw new Error('The new name needs to end in .png, .jpg, .webp, .svg or .gif.');
  if (!fs.existsSync(src)) throw new Error(`There is no ${from} to rename.`);
  fs.renameSync(src, path.join(imageDir(id, kind), name));
  return name;
}
// The file behind a /logos/, /brand/, /photos/, /headshots/ or /fonts/ link, for the competition in use.
function imageFile(id: string, kind: unknown, fileName: string): string | null {
  const name = path.basename(decodeURIComponent(fileName));
  return typeOf(kind).test(name) ? path.join(imageDir(id, kind), name) : null;
}

// ─── Colours (theme.css) ────────────────────────────────────────────────────
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const toHex = (a: number[]) => '#' + a.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
const mix = (hex: string, other: string, t: number) => { const a = rgb(hex), b = rgb(other); return toHex(a.map((v, i) => v + (b[i] - v) * t)); };

// Every overlay links theme.css; the helper writes it from the competition's colours and font
// (with fontFiles, the paths of the competition's added font files, and macFaces when the font is a
// Mac font, from fonts.macFaces). The variable names are the original
// Thunder League ones, so every page keeps working.
function themeCss(s: Settings, fontFiles: string[] = [], macFaces: Parameters<typeof fonts.stack>[1] = null): string {
  const vars = { '--font': fonts.stack(s.font, macFaces), ...colourVars(s.colours, s.panelOpacity) };
  return `/* ${s.name}: colours and font from the competition setup page (setup.html). */\n` +
    fonts.css(s.font, fontFiles, undefined, { mac: macFaces, size: s.fontSize / 100 }) + '\n' +
    `:root {\n${Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}\n`;
}

// theme.css's colour variables from a competition's colours (c: main, dark, panel, panelAlt, highlight, accent, text,
// textOnHighlight, muted) and panel opacity (o). The Socials tab's colour sets use it too (socials.ts).
function colourVars(c: Colours, o: number): Record<string, string> {
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
function sponsorTiers(s: Pick<Settings, 'sponsorTierNames' | 'sponsorOwnNames' | 'sponsorEmpty'> | null | undefined): { key: Tier; name: string; empty: EmptyRule }[] {
  const set = (s && s.sponsorTierNames !== 'own' && SPONSOR_NAME_SETS[s.sponsorTierNames]) || SPONSOR_NAME_SETS.names;
  const own: Partial<Record<Tier, string>> = (s && s.sponsorTierNames === 'own' && s.sponsorOwnNames) || {};
  return SPONSOR_TIERS.map(key => ({ key, name: own[key] || set[key], empty: ((s && s.sponsorEmpty) || {})[key] || SPONSOR_EMPTY_DEFAULTS[key] }));
}

const isReadOnly = () => readOnly;
export type { Settings, Colours, Club, Stream, Tier, EmptyRule, Moment, Kind };
export { KINDS, SPONSOR_TIERS, SPONSOR_NAME_SETS, SPONSOR_EMPTY, SPONSOR_EMPTY_DEFAULTS, SPONSOR_MOMENTS, sponsorTiers, DEFAULTS, DIR, ACTIVE_FILE, init, list, imports, importConfig, saveAsImport, exportTemplate, importTemplate, isReadOnly, get, save, activeId, setActive, create, remove, images, saveImage, deleteImage, renameImage, imageFile, themeCss, colourVars, mix, clean, clubOf, clubFor, clubEntry, superShotsFor };
