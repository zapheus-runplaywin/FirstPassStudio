// Bringing the data folder up to date after an update (migrations.js): each step from an old
// folder, the backup made first, a folder saved by a newer Studio left alone, and Studio
// starting on an old folder. Each case runs migrations.js in a process of its own with its
// own app folder (a copy of migrations.js, datadir.js and imports/) and data folder.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { VERSION } = require('../migrations');
const { startStudio } = require('./support/studio');

const ROOT = path.join(__dirname, '..');
const tmp = name => fs.mkdtempSync(path.join(os.tmpdir(), `studio-migrate-${name}-`));
const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 2)); };
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

// An app folder like an older Studio's, with whatever it kept inside it.
function appFolder(t, files = {}) {
  const app = tmp('app');
  for (const f of ['migrations.js', 'datadir.js']) fs.copyFileSync(path.join(ROOT, f), path.join(app, f));
  fs.cpSync(path.join(ROOT, 'imports'), path.join(app, 'imports'), { recursive: true });
  for (const [f, data] of Object.entries(files)) write(path.join(app, f), data);
  t.after(() => fs.rmSync(app, { recursive: true, force: true }));
  return app;
}
function dataFolder(t, files = {}) {
  const data = tmp('data');
  for (const [f, d] of Object.entries(files)) write(path.join(data, f), d);
  t.after(() => fs.rmSync(data, { recursive: true, force: true }));
  return data;
}
// Runs the migrations; gives what run() returned and the log lines.
function migrate(app, data) {
  const out = execFileSync(process.execPath, ['-e', `
    const lines = [];
    const r = require(${JSON.stringify(path.join(app, 'migrations.js'))}).run((level, source, message) => lines.push(level + ' ' + message));
    process.stdout.write(JSON.stringify({ r, lines }));`], { env: { ...process.env, FIRSTPASS_DATA_DIR: data } });
  return JSON.parse(out);
}

test('a new data folder starts at the newest version, with nothing to back up', t => {
  const data = dataFolder(t);
  const { r } = migrate(appFolder(t), data);
  assert.deepEqual(r, { version: VERSION, readOnly: false, backup: null });
  assert.equal(read(path.join(data, 'data-version.json')).version, VERSION);
  assert.ok(!fs.existsSync(path.join(data, 'backups')));
});

test('an up to date folder is left alone', t => {
  const data = dataFolder(t, { 'data-version.json': { version: VERSION }, 'scene.json': { sources: [{ type: 'browser', url: 'title.html', fadeMs: 300 }] } });
  const { r, lines } = migrate(appFolder(t), data);
  assert.deepEqual(r, { version: VERSION, readOnly: false });
  assert.deepEqual(lines, []);
  assert.equal(read(path.join(data, 'scene.json')).sources[0].fadeMs, 300);
});

test('a folder saved by a newer Studio is not changed and opens read-only', t => {
  const data = dataFolder(t, { 'data-version.json': { version: VERSION + 1 }, 'scene.json': { sources: [{ fadeMs: 300 }] } });
  const { r, lines } = migrate(appFolder(t), data);
  assert.deepEqual(r, { version: VERSION + 1, readOnly: true });
  assert.match(lines.join('\n'), /newer FirstPass Studio/);
  assert.equal(read(path.join(data, 'data-version.json')).version, VERSION + 1);
  assert.equal(read(path.join(data, 'scene.json')).sources[0].fadeMs, 300);
});

test('version 0 to 1: settings kept in the app folder move into the data folder', t => {
  const app = appFolder(t, {
    'competitions/active.json': { active: 'my-league' },
    'competitions/my-league/settings.json': { name: 'My League', venueName: 'Hall' },
    'competitions/my-league/logos/Stars.png': 'png',
    // Its settings.json went with the move to imports/, but its photos stayed: rebuilt from the import config.
    'competitions/thunder-league/photos/Jane Smith.jpg': 'jpg',
    'competitions/no-settings/photos/x.jpg': 'jpg',
    'control.json': { round: '6' },
    'scoreboard-state.json': { 1: { home: { name: 'A', score: 3 } } },
  });
  const data = dataFolder(t);
  const { r } = migrate(app, data);
  assert.equal(r.version, VERSION);
  assert.equal(read(path.join(data, 'competitions', 'active.json')).active, 'my-league');
  assert.equal(read(path.join(data, 'competitions', 'my-league', 'settings.json')).venueName, 'Hall');
  assert.ok(fs.existsSync(path.join(data, 'competitions', 'my-league', 'logos', 'Stars.png')));
  assert.ok(fs.existsSync(path.join(data, 'competitions', 'thunder-league', 'settings.json')), 'rebuilt from imports/');
  assert.ok(fs.existsSync(path.join(data, 'competitions', 'thunder-league', 'photos', 'Jane Smith.jpg')), 'photos kept');
  assert.ok(!fs.existsSync(path.join(data, 'competitions', 'no-settings')), 'nothing to rebuild it from');
  assert.equal(read(path.join(data, 'control.json')).round, '6');
  assert.equal(read(path.join(data, 'scoreboard-state.json'))[1].home.score, 3);
});

test('version 0 to 1 never replaces what the data folder already has', t => {
  const app = appFolder(t, { 'competitions/my-league/settings.json': { name: 'Old copy' }, 'control.json': { round: 'old' } });
  const data = dataFolder(t, { 'competitions/my-league/settings.json': { name: 'Newer' }, 'control.json': { round: 'new' } });
  migrate(app, data);
  assert.equal(read(path.join(data, 'competitions', 'my-league', 'settings.json')).name, 'Newer');
  assert.equal(read(path.join(data, 'control.json')).round, 'new');
});

test('version 1 to 2: the title emoji and The Clash word move from the setup onto the scene\'s sources', t => {
  const data = dataFolder(t, {
    'data-version.json': { version: 1 },
    'competitions/active.json': { active: 'tl' },
    'competitions/tl/settings.json': { name: 'TL', titleEmoji: '⚡', clashWord: 'Battle' },
    'scene.json': { sources: [
      { type: 'browser', url: 'title.html' },
      { type: 'browser', url: '/title.html?emoji=%F0%9F%8F%86' }, // already has its own
      { type: 'browser', url: 'title.html?fire=0' },              // flames were turned off
      { type: 'browser', url: 'clash.html?out=5' },
      { type: 'video', url: 'title.html' },
      { type: 'browser', url: 'ladder.html' },
    ] },
  });
  const { lines } = migrate(appFolder(t), data);
  const urls = read(path.join(data, 'scene.json')).sources.map(s => s.url);
  assert.equal(new URLSearchParams(urls[0].split('?')[1]).get('emoji'), '⚡');
  assert.equal(new URLSearchParams(urls[1].split('?')[1]).get('emoji'), '🏆');
  assert.equal(urls[2], 'title.html');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(urls[3].split('?')[1])), { out: '5', word: 'Battle' });
  assert.equal(urls[4], 'title.html', 'only browser sources');
  assert.equal(urls[5], 'ladder.html');
  assert.match(lines.join('\n'), /on 3 scene source/);
});

test('version 1 to 2: the old default flames, and the default CLASH word, need nothing on the source', t => {
  const data = dataFolder(t, {
    'data-version.json': { version: 1 },
    'competitions/active.json': { active: 'tl' },
    'competitions/tl/settings.json': { name: 'TL', clashWord: 'clash' },
    'scene.json': { sources: [{ type: 'browser', url: 'title.html' }, { type: 'browser', url: 'clash.html' }] },
  });
  migrate(appFolder(t), data);
  const urls = read(path.join(data, 'scene.json')).sources.map(s => s.url);
  assert.equal(urls[0], `title.html?emoji=${encodeURIComponent('🔥')}`);
  assert.equal(urls[1], 'clash.html');
});

test('version 2 to 3: sources on the old 300 ms fade move to 500, others keep theirs', t => {
  const data = dataFolder(t, { 'data-version.json': { version: 2 },
    'scene.json': { sources: [{ fadeMs: 300 }, { fadeMs: 0 }, { fadeMs: 800 }, {}] } });
  migrate(appFolder(t), data);
  assert.deepEqual(read(path.join(data, 'scene.json')).sources.map(s => s.fadeMs), [500, 0, 800, undefined]);
});

test('the saved settings are backed up before any step, and only the newest 5 backups are kept', t => {
  const data = dataFolder(t, { 'data-version.json': { version: 2 }, 'scene.json': { sources: [{ fadeMs: 300 }] }, 'control.json': { round: '' },
    'logs/playhq-graphics.log': 'not backed up' });
  for (let i = 0; i < 6; i++) fs.mkdirSync(path.join(data, 'backups', `2026-01-0${i + 1}T00-00-00-v1`), { recursive: true });
  const { r } = migrate(appFolder(t), data);
  assert.ok(r.backup && fs.existsSync(r.backup));
  assert.equal(read(path.join(r.backup, 'scene.json')).sources[0].fadeMs, 300, 'the backup is from before the step');
  assert.ok(fs.existsSync(path.join(r.backup, 'control.json')));
  assert.ok(!fs.existsSync(path.join(r.backup, 'logs')));
  assert.match(path.basename(r.backup), /-v2$/);
  const kept = fs.readdirSync(path.join(data, 'backups')).sort();
  assert.equal(kept.length, 5);
  assert.equal(kept[kept.length - 1], path.basename(r.backup));
});

test('Studio starts on an old data folder: it is brought up to date and the competition still works', async t => {
  const data = dataFolder(t, {
    'data-version.json': { version: 1 },
    'competitions/active.json': { active: 'tl' },
    'competitions/tl/settings.json': { name: 'Old Thunder', organisationUrl: 'https://www.playhq.com/netball-australia/org/west-coast-mens-and-mixed-netball-association/a9434809',
      competitionName: 'Thunder League', finalsPlaces: 4, logoAliases: { Blizzardz: 'Blizzardz.png' }, titleEmoji: '⚡' },
    'scene.json': { sources: [{ id: 's1', type: 'browser', name: 'Title', url: 'title.html', fadeMs: 300 }] },
  });
  const studio = await startStudio(t, { dataDir: data });
  assert.equal(read(path.join(data, 'data-version.json')).version, VERSION);
  const setup = await studio.get('/api/setup/tl');
  assert.equal(setup.settings.finalsFormat, 'top4-page');
  assert.deepEqual(setup.settings.clubs, { Blizzardz: { logo: 'Blizzardz.png' } });
  const s = (await studio.get('/api/structure'));
  assert.equal(s.competition, 'Thunder League');
  const scene = await studio.get('/api/scene');
  const title = scene.sources.find(x => x.name === 'Title');
  assert.equal(title.fadeMs, 500);
  assert.match(decodeURIComponent(title.url), /emoji=⚡/);
});
