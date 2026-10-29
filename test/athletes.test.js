// The athletes page (athletes.js): the register of every athlete PlayHQ's line-ups have named, their photos (on
// the team lists, positions and lower thirds), a gender set by hand for the silhouette, and games and positions
// typed in. Against the stand-in PlayHQ, with the Thunder League's game on court 1 being scored.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startStudio } = require('./support/studio');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const JPG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z', 'base64');

let studio, photosDir;
test.before(async () => {
  studio = await startStudio(null, { competition: 'Thunder League' });
  photosDir = path.join(studio.dataDir, 'competitions', studio.competition.id || 'thunder-league', 'photos');
  await studio.until(async () => (await studio.get('/api/scoreboard')).gameId);
  // The line-ups of the game on the board go into the register.
  await studio.until(async () => (await studio.get('/api/teams')).home.players.length);
});
test.after(() => studio && studio.stop());

const upload = (q, buf = PNG) => studio.request('POST', `/api/athletes/photo?${q}`, buf, { 'content-type': 'application/octet-stream' });
const player = async name => { const t = await studio.get('/api/teams'); return [...t.home.players, ...t.away.players].find(p => p.name === name); };
const inRegister = async name => (await studio.get('/api/athletes?all=1')).athletes.find(a => a.name === name);

test('everyone in the line-ups is in the register, with their team, and no photo yet: a silhouette for their gender', async () => {
  const a = await inRegister('Blizzardz GS');
  assert.ok(a, 'from the game being played');
  assert.deepEqual(a.teams, [{ division: 'Division 1', team: 'Blizzardz' }]);
  assert.equal(a.photo, null);
  const p = await player('Blizzardz GS');
  assert.equal(p.photo, null);
  assert.equal(p.silhouette, '/silhouettes/male.svg', 'PlayHQ says male');
});

test('a photo saved for an athlete shows on the team lists, and a new one replaces the old whatever its type', async () => {
  const r = await upload('athlete=Blizzardz%20GS&ext=png');
  assert.equal(r.status, 200);
  assert.equal(r.json.name, 'Blizzardz GS.png');
  // Not on a graphic until the athlete has approved its use; the athletes page shows it either way.
  assert.equal((await player('Blizzardz GS')).photo, null, 'not approved yet: the silhouette');
  assert.deepEqual([(await inRegister('Blizzardz GS')).photo, (await inRegister('Blizzardz GS')).photoOk], ['/photos/Blizzardz%20GS.png', false]);
  assert.deepEqual((await studio.post('/api/athletes/approval', { athletes: ['Blizzardz GS'], approved: true })).athletes, [{ name: 'Blizzardz GS', photoOk: true }]);
  assert.equal((await inRegister('Blizzardz GS')).photoOk, true);
  assert.equal((await player('Blizzardz GS')).photo, '/photos/Blizzardz%20GS.png');
  const served = await studio.request('GET', '/photos/Blizzardz%20GS.png');
  assert.equal(served.status, 200);
  // A JPEG for the same athlete takes its place.
  assert.equal((await upload('athlete=blizzardz%20gs&ext=jpeg', JPG)).json.name, 'blizzardz gs.jpg');
  assert.deepEqual(fs.readdirSync(photosDir).filter(f => /blizzardz gs/i.test(f)), ['blizzardz gs.jpg'], 'one photo per athlete');
  assert.match((await player('Blizzardz GS')).photo, /blizzardz%20gs\.jpg$/, 'matched by name whatever its case');
  // Taking approval away takes the photo off the graphics again.
  await studio.post('/api/athletes/approval', { athletes: ['Blizzardz GS'], approved: false });
  assert.equal((await player('Blizzardz GS')).photo, null);
  assert.equal((await studio.request('POST', '/api/athletes/approval', { athletes: ['Blizzardz GS'] })).status, 400, 'approved or not must be said');
});

test('photos dropped in by file name are matched to athletes, and a wrong one can be given to the right athlete', async () => {
  assert.equal((await upload('file=Knights%20GA.png')).json.name, 'Knights GA.png');
  // Dropped with a name that's nobody's: given to the right athlete, replacing theirs.
  await upload('file=IMG_0042.png');
  const r = await studio.post('/api/athletes/rename', { file: 'IMG_0042.png', athlete: 'Knights GA' });
  assert.equal(r.name, 'Knights GA.png');
  assert.deepEqual(fs.readdirSync(photosDir).filter(f => /knights ga|img_0042/i.test(f)), ['Knights GA.png']);
  // And removed.
  await studio.del('/api/athletes/photo?file=Knights%20GA.png');
  assert.equal(fs.existsSync(path.join(photosDir, 'Knights GA.png')), false);
});

test('a photo that isn\'t one is refused, and an empty file or no name says what\'s wrong', async () => {
  const notImage = await upload('athlete=Blizzardz%20GA&ext=png', Buffer.from('not a picture'));
  assert.equal(notImage.status >= 400, true);
  assert.match(notImage.json.error, /./);
  const empty = await upload('athlete=Blizzardz%20GA&ext=png', Buffer.alloc(0));
  assert.match(empty.json.error, /That file is empty/);
  const nameless = await upload('athlete=%20%20&ext=png');
  assert.match(nameless.json.error, /A photo needs an athlete name/);
  assert.equal((await studio.request('POST', '/api/athletes/rename', { file: 'x.png', athlete: '' })).json.error, 'Pick an athlete for this photo.');
});

test('a gender set by hand changes the silhouette, and clearing it goes back to PlayHQ\'s', async () => {
  let r = await studio.post('/api/athletes/gender', { athlete: 'Blizzardz WA', gender: 'female' });
  assert.equal(r.silhouette, '/silhouettes/female.svg');
  assert.equal(r.genderSetByHand, true);
  assert.equal((await player('Blizzardz WA')).silhouette, '/silhouettes/female.svg');
  r = await studio.post('/api/athletes/gender', { athlete: 'Blizzardz WA', gender: '' });
  assert.equal(r.genderSetByHand, false);
  assert.equal((await player('Blizzardz WA')).silhouette, '/silhouettes/male.svg');
});

test('games and positions typed in are kept and tidied, and a line without a division is refused', async () => {
  const r = await studio.post('/api/athletes/stats', { athlete: 'Blizzardz C', records: [{ division: 'Division 1', games: '12.4', club: ' Old Club ' }], positions: ['C', 'WA', 'ZZ'] });
  assert.equal(r.name, 'Blizzardz C');
  const a = await inRegister('Blizzardz C');
  assert.deepEqual(a.positionsTyped, ['WA', 'C'], 'netball order, unknown ones left out');
  assert.deepEqual(a.records.map(x => [x.division, x.games, x.club]), [['Division 1', 12, 'Old Club']]);
  const bad = await studio.request('POST', '/api/athletes/stats', { athlete: 'Blizzardz C', records: [{ division: '', games: 3 }] });
  assert.equal(bad.json.error, 'Each games played line needs a division.');
  assert.deepEqual((await inRegister('Blizzardz C')).positionsTyped, ['WA', 'C'], 'nothing changed by the refused save');
  // Saved in the register file, so it's there after a restart.
  const register = path.join(studio.dataDir, 'competitions', studio.competition.id || 'thunder-league', 'athletes.json');
  const saved = JSON.parse(fs.readFileSync(register, 'utf8')).athletes;
  assert.deepEqual(Object.values(saved).find(x => x.name === 'Blizzardz C').positions, ['WA', 'C']);
});
