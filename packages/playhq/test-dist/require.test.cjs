// Studio loads this package with require(). These tests load the built CommonJS output the way
// Studio does, in plain Node, so a change that would break Studio fails here first. Run after
// `npm run build`.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const pkg = require('../package.json');
const playhq = require('../dist/index.js');

// The files package.json points a consumer at.
test('the exports point at files that exist', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dot = pkg.exports['.'];
  for (const file of [dot.default, dot.types, pkg.main, pkg.types]) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', file)), `${file} is built`);
  }
});

test('require() gives the whole API', () => {
  for (const name of ['createTransport', 'createPlayhqApi', 'createKeeper', 'parsePlayhqLink', 'parseOrganisationLink', 'parseSeasonLink',
    'parseGame', 'parseLive', 'parseRoundGames', 'parseLadder', 'collectFixtures', 'isFinished', 'startOf', 'localDate', 'positionOf', 'PlayhqError']) {
    assert.equal(typeof playhq[name], 'function', name);
  }
  assert.deepEqual(playhq.POSITION_RANK, ['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK']);
  assert.equal(playhq.API_URL, 'https://api.playhq.com/graphql');
});

test('reads Studio\'s organisation link', () => {
  assert.deepEqual(playhq.parseOrganisationLink('https://www.playhq.com/netball-australia/org/wcmmna/a9434809'), { tenant: 'netball-australia', orgId: 'a9434809' });
});

test('asks PlayHQ through Node\'s own fetch Response, with a guest session', async () => {
  const calls = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, op: body.operationName, cookie: init.headers.cookie });
    if (body.operationName === 'ProfileSearch') return new Response('{"data":{}}', { headers: { 'set-cookie': 'phq_session=abc; Path=/' } });
    return Response.json({ data: { discoverGrade: { id: 'g', rounds: [{ id: 'r1', name: 'Round 1', current: true, number: 1 }] } } });
  };
  const api = playhq.createPlayhqApi(playhq.createTransport({ fetch, tenant: 'netball-australia' }));
  assert.deepEqual(await api.rounds('g'), [{ id: 'r1', name: 'Round 1', current: true, number: 1 }]);
  assert.deepEqual(calls.map(c => c.op), ['ProfileSearch', 'gradeRounds']);
  assert.equal(calls[1].cookie, 'phq_session=abc');
});

test('errors are PlayhqErrors Studio can test for', async () => {
  const fetch = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); };
  const t = playhq.createTransport({ fetch, unreachableHint: 'Is this Mac connected to the internet?' });
  await assert.rejects(t.gql('x', 'query x { a }'), err => err instanceof playhq.PlayhqError && err.unreachable === true
    && err.message === "Can't reach PlayHQ (ECONNREFUSED). Is this Mac connected to the internet?");
});
