// Every page reloads itself when /api/version changes (public/autoreload.js), the output on air included. It
// changes when the pages or the competition's setup change, and never for the other files Studio saves as the
// night goes on: a sequence saved on the Output page, or the athlete register growing as PlayHQ's line-ups
// are read mid-game, must not reload the graphics on air.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startStudio, wait } = require('./support/studio');

const version = async studio => (await studio.get('/api/version')).version;

test('saving a sequence or reading the line-ups leaves the page version alone; the competition\'s settings and logos change it', async t => {
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const id = studio.competition.id || 'thunder-league';
  const dir = path.join(studio.dataDir, 'competitions', id);
  const v0 = await version(studio);
  await wait(50); // file times are to the millisecond: a write now is after v0

  // A sequence, saved beside the competition's settings.
  const { sources } = await studio.post('/api/scene', { type: 'add', sources: [{ type: 'browser', url: 'ladder.html' }] });
  await studio.post('/api/scene', { type: 'seqAdd', changes: { name: 'Quarter break', steps: [{ sources: [sources[0].id], length: { type: 'time', sec: 5 } }] } });
  assert.ok(fs.existsSync(path.join(dir, 'sequences.json')));
  // The game on court 1's line-ups, which go into the athlete register.
  await studio.until(async () => (await studio.get('/api/teams')).home.players.length);
  await studio.until(() => fs.existsSync(path.join(dir, 'athletes.json')));
  assert.equal(await version(studio), v0, 'no reload for a sequence or the athlete register');

  // A team logo: every page picks it up.
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await studio.request('POST', `/api/setup/${id}/image?kind=logos&name=Knights.png`, PNG, { 'content-type': 'application/octet-stream' });
  const v1 = await version(studio);
  assert.notEqual(v1, v0, 'a new logo reloads the pages');
  await wait(50);
  // A setting saved on the setup page.
  await studio.post(`/api/setup/${id}`, { venueName: 'The Hall' });
  assert.notEqual(await version(studio), v1, 'a saved setting reloads the pages');
});
