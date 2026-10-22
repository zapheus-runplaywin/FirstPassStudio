// Competition setups (competitions.js): settings checked and tidied, clubs, super shots by
// division, setups made, switched and deleted, logos, and template files exported and imported,
// including every template in templates/ and every import config in imports/.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.FIRSTPASS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-competitions-'));
const competitions = require('../competitions');
competitions.init(() => {});

const ROOT = path.join(__dirname, '..');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const { DEFAULTS, clean } = competitions;

function reset() {
  for (const c of competitions.list()) competitions.remove(c.id);
}

test('clean: a setup with nothing in it gets every default', () => {
  const s = clean({});
  assert.deepEqual(Object.keys(s).sort(), Object.keys(DEFAULTS).sort());
  assert.equal(s.name, 'New competition');
  assert.equal(s.quarterMinutes, 10);
  assert.equal(s.finalsFormat, 'top4-page');
  assert.deepEqual(s.colours, DEFAULTS.colours);
});

test('clean: bad values are put right rather than saved', () => {
  const s = clean({
    name: 'x'.repeat(200), periodType: 'thirds', quarterMinutes: 500, superShotMinutes: 99, autoSelectMinutesBefore: -5,
    roundLookaheadDays: 40, panelOpacity: 0.01, font: '";}', finalsFormat: 'made-up',
    colours: { main: 'purple', highlight: '#FFCD00' }, superShots: 'true', autoSelectGame: 'nope',
    competitionLogo: '../../etc/passwd.png', brandColours: [{ hex: '#ABCDEF', name: ' Sky ' }, { hex: 'blue' }],
    clubs: { ' Comets ': { logo: '../x/Comets.png', colour: '#FF0000' }, Empty: {} }, teamClubs: { 'Comets 21U': ' Comets ', Bad: 3 },
    divisionSuperShots: { Open: 'true', '21': false, Men: 'maybe' }, divisionFinals: { 'Division 1': 'none', 'Division 2': 'nope' },
    quarterBreakMinutes: -1, unknownSetting: 'gone',
  });
  assert.equal(s.name.length, 80);
  assert.equal(s.periodType, 'quarters');
  assert.equal(s.quarterMinutes, 60);
  assert.equal(s.superShotMinutes, 60, 'no longer than a quarter');
  assert.equal(s.autoSelectMinutesBefore, 0);
  assert.equal(s.roundLookaheadDays, 14);
  assert.equal(s.panelOpacity, 0.3);
  assert.equal(s.font, 'Montserrat', 'nothing left of the name once the CSS breaking letters are gone');
  assert.equal(s.finalsFormat, 'top4-page');
  assert.equal(s.colours.main, DEFAULTS.colours.main, 'not a colour, so the default');
  assert.equal(s.colours.highlight, '#ffcd00', 'lower case');
  assert.equal(s.superShots, true);
  assert.equal(s.autoSelectGame, false);
  assert.equal(s.competitionLogo, 'passwd.png', 'a file name only, never a path');
  assert.deepEqual(s.brandColours, [{ hex: '#abcdef', name: 'Sky' }]);
  assert.deepEqual(s.clubs, { Comets: { logo: 'Comets.png', colour: '#ff0000' } });
  assert.deepEqual(s.teamClubs, { 'Comets 21U': 'Comets' });
  assert.deepEqual(s.divisionSuperShots, { Open: true, 21: false });
  assert.deepEqual(s.divisionFinals, { 'Division 1': 'none' });
  assert.equal(s.quarterBreakMinutes, 0);
  assert.equal(s.unknownSetting, undefined);
});

test('clean: older setups are brought up to date (finals places, per-team logos and colours)', () => {
  assert.equal(clean({ finalsPlaces: 4 }).finalsFormat, 'top4-page');
  const s = clean({ logoAliases: { 'Comets 21U': 'comets.png', 'Comets Men': 'comets.png', Stars: 'stars.png' }, teamColours: { 'Comets Open': '#112233', 'Comets Men': '#445566' } });
  assert.equal(s.logoAliases, undefined);
  assert.equal(s.clubs.Comets.logo, 'comets.png');
  // Two Comets teams wanted different colours: one keeps its own in a club of its own name.
  const colours = ['Comets Open', 'Comets Men'].map(t => competitions.clubEntry(s, competitions.clubFor(s, t)).colour).sort();
  assert.deepEqual(colours, ['#112233', '#445566']);
  assert.equal(s.clubs.Stars.logo, 'stars.png');
});

test('clubs: a team\'s club is its name without the division words', () => {
  const cases = { 'Comets 21U': 'Comets', 'Comets Men': 'Comets', "Comets Men's": 'Comets', 'Comets Open': 'Comets', 'Stormz Div 2': 'Stormz',
    'Stormz Division 1': 'Stormz', 'Perth Coastals': 'Perth Coastals', 'Titans (Mixed)': 'Titans', "Travis' Disciples": "Travis' Disciples",
    'Knights - Reserves': 'Knights', 'Open': 'Open', 'Saddle Up U17': 'Saddle Up', 'Game of Throws B': 'Game of Throws' };
  for (const [team, club] of Object.entries(cases)) assert.equal(competitions.clubOf(team), club, team);
  assert.equal(competitions.clubFor({ teamClubs: { 'Mavs Blue': 'Mavericks' } }, 'Mavs Blue'), 'Mavericks');
});

test('super shots by division: an exact name wins, then the longest word that matches, else the competition\'s', () => {
  const s = { superShots: false, divisionSuperShots: { Open: true, '21': false, "Men": false, 'Division 1 Open': false } };
  assert.equal(competitions.superShotsFor(s, 'Open'), true);
  assert.equal(competitions.superShotsFor(s, 'Division 1 Open'), false, 'exact name');
  assert.equal(competitions.superShotsFor(s, 'Division 2 Open'), true, 'the word Open');
  assert.equal(competitions.superShotsFor(s, '21&Under'), false);
  assert.equal(competitions.superShotsFor(s, "Men's"), false);
  assert.equal(competitions.superShotsFor({ ...s, superShots: true }, "Women's"), true, '"Men" is not in "Women\'s"');
  assert.equal(competitions.superShotsFor(s, 'Masters'), false, 'the competition\'s own setting');
  assert.equal(competitions.superShotsFor({}, 'Anything'), true, 'on by default');
});

test('setups: make, copy, save, switch, and delete the one in use', () => {
  reset();
  const a = competitions.create('Thunder League');
  assert.equal(a, 'thunder-league');
  assert.equal(competitions.activeId(), null, 'making one doesn\'t put it to use');
  competitions.setActive(a);
  const saved = competitions.save(a, { venueName: ' Gold Netball Centre ', quarterMinutes: '12', colours: { main: '#123456' } });
  assert.equal(saved.venueName, 'Gold Netball Centre');
  assert.equal(saved.quarterMinutes, 12);
  assert.equal(saved.colours.main, '#123456');
  assert.equal(saved.colours.highlight, DEFAULTS.colours.highlight, 'colours not sent keep theirs');
  assert.equal(competitions.save(a, { name: 'Thunder' }).quarterMinutes, 12, 'a save keeps what it doesn\'t change');

  competitions.saveImage(a, 'logos', 'Blizzardz.png', PNG);
  const b = competitions.create('Thunder League', a);
  assert.equal(b, 'thunder-league-2', 'a free id');
  assert.equal(competitions.get(b).quarterMinutes, 12, 'settings copied');
  assert.deepEqual(competitions.images(b, 'logos'), [], 'logos not copied');
  assert.deepEqual(competitions.list().map(c => [c.id, c.active]), [['thunder-league', true], ['thunder-league-2', false]]);

  assert.equal(competitions.remove(a), b, 'deleting the one in use moves to the next');
  assert.equal(competitions.remove(b), null);
  assert.equal(competitions.activeId(), null);
  assert.throws(() => competitions.setActive('nope'), /No competition "nope"/);
  assert.throws(() => competitions.get('../x'), /No competition/);
});

test('logos: only images, saved by file name alone, removed, renamed', () => {
  reset();
  const id = competitions.create('Logos');
  assert.equal(competitions.saveImage(id, 'logos', '../../evil/Knights.png', PNG), 'Knights.png');
  assert.ok(fs.existsSync(path.join(competitions.DIR, id, 'logos', 'Knights.png')));
  assert.throws(() => competitions.saveImage(id, 'logos', 'notes.txt', PNG), /must be PNG, JPG/);
  assert.throws(() => competitions.saveImage(id, 'logos', 'empty.png', Buffer.alloc(0)), /empty/);
  assert.equal(competitions.renameImage(id, 'logos', 'Knights.png', 'Knights FC.png'), 'Knights FC.png');
  assert.deepEqual(competitions.images(id, 'logos'), ['Knights FC.png']);
  assert.equal(competitions.imageFile(id, 'logos', '..%2F..%2Fsettings.json'), null, 'not an image');
  assert.equal(path.dirname(competitions.imageFile(id, 'logos', '..%2F..%2FKnights%20FC.png')), path.join(competitions.DIR, id, 'logos'));
  competitions.deleteImage(id, 'logos', 'Knights FC.png');
  assert.deepEqual(competitions.images(id, 'logos'), []);
});

test('template files: exported and imported again give the same settings and logos', () => {
  reset();
  const id = competitions.create('Round Trip', null, { venueName: 'Court House', colours: { main: '#010203' }, clubs: { Comets: { logo: 'Comets.png' } } });
  competitions.saveImage(id, 'logos', 'Comets.png', PNG);
  competitions.saveImage(id, 'brand', 'Brand.png', PNG);
  const tpl = competitions.exportTemplate(id);
  assert.equal(tpl.format, 'firstpass-studio-competition');
  assert.equal(tpl.logos['Comets.png'], PNG.toString('base64'));
  // Through JSON, as the file is.
  const back = competitions.importTemplate(JSON.parse(JSON.stringify(tpl)));
  assert.equal(back, 'round-trip-2');
  assert.deepEqual({ ...competitions.get(back), name: '' }, { ...competitions.get(id), name: '' });
  assert.deepEqual(fs.readFileSync(path.join(competitions.DIR, back, 'logos', 'Comets.png')), PNG);
  assert.deepEqual(competitions.images(back, 'brand'), ['Brand.png']);
  const named = competitions.importTemplate(tpl, 'My Copy');
  assert.equal(competitions.get(named).name, 'My Copy');
});

test('template files: anything else is refused, and a bad logo inside is skipped', () => {
  reset();
  for (const bad of [null, {}, { format: 'something-else', settings: {} }, { format: 'firstpass-studio-competition' }]) {
    assert.throws(() => competitions.importTemplate(bad), /isn't a FirstPass Studio competition template/);
  }
  const id = competitions.importTemplate({ format: 'firstpass-studio-competition', version: 1, settings: { name: 'Odd' },
    logos: { 'ok.png': PNG.toString('base64'), 'script.js': 'YWxlcnQoMSk=', '../up.png': PNG.toString('base64') } });
  assert.deepEqual(competitions.images(id, 'logos'), ['ok.png', 'up.png']);
  assert.ok(!fs.existsSync(path.join(competitions.DIR, id, 'logos', 'script.js')));
  assert.equal(competitions.activeId(), id, 'the first competition imported is put to use');
});

test('every template in templates/ imports, with its logos, and exports back the same', () => {
  reset();
  const dir = path.join(ROOT, 'templates');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  assert.ok(files.length >= 4);
  for (const f of files) {
    const tpl = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const id = competitions.importTemplate(tpl);
    const s = competitions.get(id);
    assert.equal(s.name, tpl.settings.name, f);
    assert.ok(s.organisationUrl.startsWith('https://www.playhq.com/'), `${f} has a PlayHQ link`);
    assert.ok(s.competitionName, `${f} names its PlayHQ competition`);
    assert.deepEqual(competitions.images(id, 'logos'), Object.keys(tpl.logos || {}).sort((a, b) => a.localeCompare(b)), `${f} logos`);
    for (const k of ['competitionLogo', 'competitionLogoDark']) {
      if (s[k]) assert.ok(competitions.images(id, 'brand').includes(s[k]), `${f}: ${k} ${s[k]} is in the template`);
    }
    for (const [club, c] of Object.entries(s.clubs)) {
      if (c.logo) assert.ok(competitions.images(id, 'logos').includes(c.logo), `${f}: ${club}'s logo ${c.logo} is in the template`);
    }
    const again = competitions.exportTemplate(id);
    assert.deepEqual(again.settings, clean(tpl.settings), `${f} is saved as it is in the file (nothing tidied away)`);
  }
});

test('every import config in imports/ imports', () => {
  reset();
  const list = competitions.imports();
  assert.ok(list.length >= 1);
  for (const { id: importId, name } of list) {
    const id = competitions.importConfig(importId);
    assert.equal(competitions.get(id).name, name);
    assert.ok(!fs.readdirSync(path.join(competitions.DIR, id), { recursive: true }).some(f => path.basename(String(f)) === '.keep'));
  }
  assert.throws(() => competitions.importConfig('../templates'), /No import config/);
});

test('theme.css: the setup\'s colours, font and panel opacity', () => {
  const css = competitions.themeCss(clean({ name: 'Look', font: 'Raleway', colours: { main: '#2c8e3e', panel: '#000000' }, panelOpacity: 0.5 }));
  assert.match(css, /--purple: #2c8e3e;/);
  assert.match(css, /--purple-rgb: 44, 142, 62;/);
  assert.match(css, /--purple-deep: rgba\(0, 0, 0, 0\.5\);/);
  assert.match(css, /^@import url\("\/vendor\/fonts\/montserrat\/montserrat\.css"\);$/m, 'Montserrat, the fallback, from Studio itself');
  assert.match(css, /^@import url\("\/vendor\/fonts\/raleway\/raleway\.css"\);$/m);
  assert.match(css, /--font: "Raleway", "Montserrat"/);
  assert.doesNotMatch(css, /googleapis/, 'no font comes from the internet');
});

test('fonts: every bundled font is in public/vendor/fonts, with its licence and files', () => {
  const fonts = require('../fonts');
  for (const [name, id] of Object.entries(fonts.BUNDLED)) {
    const dir = path.join(fonts.VENDOR, id);
    assert.ok(fs.existsSync(path.join(dir, 'LICENSE')), `${name} has no licence; run npm run fonts`);
    const css = fs.readFileSync(path.join(dir, `${id}.css`), 'utf8');
    assert.match(css, new RegExp(`font-family: '${name}';`));
    for (const [, file] of css.matchAll(/url\(([^)]+)\)/g)) assert.ok(fs.existsSync(path.join(dir, file)), `${name}: ${file} is missing`);
  }
});

test('fonts: a Mac font is used by name, and an added font file by its family, weight and style', () => {
  const fonts = require('../fonts');
  let css = competitions.themeCss(clean({ font: 'Helvetica Neue' }));
  assert.match(css, /--font: "Helvetica Neue", "Montserrat"/);
  assert.doesNotMatch(css, /@font-face/, 'nothing to load: it is on the Mac');
  assert.deepEqual(fonts.fontFile('Gotham-BoldItalic.otf'), { file: 'Gotham-BoldItalic.otf', family: 'Gotham', weight: 700, italic: true });
  assert.deepEqual(fonts.fontFile('BebasNeue-Regular.ttf'), { file: 'BebasNeue-Regular.ttf', family: 'Bebas Neue', weight: 400, italic: false });
  assert.deepEqual(fonts.fontFile('Club Sans Extra Bold.woff2'), { file: 'Club Sans Extra Bold.woff2', family: 'Club Sans', weight: 800, italic: false });
  assert.equal(fonts.fontFile('Inter-VariableFont_opsz,wght.ttf').weight, '100 900');
  assert.equal(fonts.fontFile('Kanit-SemiBold.ttf').weight, 600);
  const files = ['Gotham-Bold.otf', 'Gotham-Black.otf', 'Other-Regular.ttf'];
  assert.deepEqual(fonts.families(files), ['Gotham', 'Other']);
  css = competitions.themeCss(clean({ font: 'Gotham' }), files);
  assert.match(css, /@font-face { font-family: "Gotham"; font-style: normal; font-weight: 700; font-display: block; src: url\("\/fonts\/Gotham-Bold\.otf"\) format\("opentype"\); }/);
  assert.match(css, /font-weight: 900;.*Gotham-Black\.otf/);
  assert.doesNotMatch(css, /Other-Regular/, 'only the family in use');
});
