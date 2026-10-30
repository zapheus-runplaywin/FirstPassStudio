// Scoreboard control's keyboard scoring (A / Z home, K / M away, Shift for 2, Space for the clock) only answers a plain
// key press on the page: ⌘A (select all) or any key with ⌘, ⌥ or ⌃ held changes nothing, typing in a field changes
// nothing, and Space on a focused button presses that button instead of the clock.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio } = require('./support/studio');
const { openPage } = require('./support/browser');

test('hotkeys on Scoreboard control ignore modifiers, fields and focused buttons', async t => {
  const studio = await startStudio(t);
  const page = await openPage(t, studio, '/control.html');
  if (!page) return;
  await page.waitForFunction(() => document.querySelector('#homeScore').textContent !== '');
  const score = async () => { const b = await studio.get('/api/scoreboard'); return [b.home.score, b.away.score]; };
  const settled = async (home, away) => page.waitForFunction(([h, a]) => document.querySelector('#homeScore').textContent === String(h) && document.querySelector('#awayScore').textContent === String(a), [home, away]);
  const start = await score();

  // A plain A scores for home, Shift+K scores 2 for away.
  await page.focus('body');
  await page.keyboard.press('a');
  await settled(start[0] + 1, start[1]);
  await page.keyboard.press('Shift+K');
  await settled(start[0] + 1, start[1] + 2);

  // With ⌘, ⌃ or ⌥ held nothing happens.
  for (const combo of ['Meta+a', 'Control+k', 'Alt+z', 'Meta+Shift+a']) await page.keyboard.press(combo);
  await page.waitForTimeout(400);
  assert.deepEqual(await score(), [start[0] + 1, start[1] + 2], 'modifier presses score nothing');

  // Typing a team name is not scoring.
  await page.focus('#homeName');
  await page.keyboard.type('zak');
  await page.waitForTimeout(400);
  assert.deepEqual(await score(), [start[0] + 1, start[1] + 2], 'typing in a field scores nothing');

  // Space on a focused button presses the button, not the clock.
  const running = async () => (await studio.get('/api/scoreboard')).clockRunning;
  const was = await running();
  await page.focus('[data-side="home"][data-delta="1"]');
  await page.keyboard.press('Space');
  await settled(start[0] + 2, start[1] + 2);
  assert.equal(await running(), was, 'the clock did not change');
  // Space on the page runs the clock.
  await page.focus('body');
  await page.keyboard.press('Space');
  await page.waitForFunction(w => fetch('/api/scoreboard').then(r => r.json()).then(b => b.clockRunning !== w), was);
  assert.deepEqual(page.errors, []);
});
