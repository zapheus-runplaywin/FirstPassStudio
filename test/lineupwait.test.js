// What the position match ups (positions.html) show before the line ups arrive.
const test = require('node:test');
const assert = require('node:assert/strict');
const { lineupWait } = require('../public/lineupwait.js');

const player = (name, position, extra) => ({ name, position, ...extra });
const team = (name, players = []) => ({ name, players });

test('live scoring not started and no line ups: says live scoring is not active', () => {
  const w = lineupWait({ scoring: 'not-started', home: team('Thunder'), away: team('Warriors') });
  assert.equal(w.title, 'Live scoring is not active for this game');
  assert.match(w.detail, /once live scoring starts/);
});

test('scoring state unknown: also says live scoring is not active', () => {
  assert.equal(lineupWait({ scoring: '', home: team('A'), away: team('B') }).title, 'Live scoring is not active for this game');
  assert.equal(lineupWait({ home: team('A'), away: team('B') }).title, 'Live scoring is not active for this game');
});

test('only season squad players (no line up yet) still waits', () => {
  const squad = [player('Ann', '', { fromSquad: true }), player('Bea', '', { fromSquad: true })];
  const w = lineupWait({ scoring: 'not-started', home: team('A', squad), away: team('B', squad) });
  assert.equal(w.title, 'Live scoring is not active for this game');
});

test('live scoring started but no line ups entered: says so', () => {
  const w = lineupWait({ scoring: 'live', home: team('A'), away: team('B') });
  assert.equal(w.title, 'No line ups yet');
  assert.match(w.detail, /Live scoring has started/);
});

test('finished game without line ups', () => {
  assert.equal(lineupWait({ scoring: 'finished', home: team('A'), away: team('B') }).title, 'No line ups');
});

test('no game picked on the control page', () => {
  const w = lineupWait({ error: 'No PlayHQ game picked on the control page yet.', home: team('Home'), away: team('Away') });
  assert.equal(w.title, 'No game picked');
});

test('nothing from the helper yet', () => {
  assert.equal(lineupWait(null).title, 'Waiting for PlayHQ');
});

test('either team having a line up starts the match ups, whatever the scoring state says', () => {
  const lineup = [player('Ann', 'GS'), player('Bea', 'GA')];
  assert.equal(lineupWait({ scoring: 'live', home: team('A', lineup), away: team('B') }), null);
  assert.equal(lineupWait({ scoring: 'not-started', home: team('A'), away: team('B', lineup) }), null);
  assert.equal(lineupWait({ scoring: 'finished', home: team('A', lineup), away: team('B', lineup) }), null);
});

test('a line up missing positions still counts (those show as Unknown)', () => {
  assert.equal(lineupWait({ scoring: 'live', home: team('A', [player('Ann', '')]), away: team('B') }), null);
});
