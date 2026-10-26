// The Stream Deck page (api.html) documents every control link in public/openapi.yaml. Each one,
// with every value it lists, must be a link the helper knows: a renamed or removed link would
// leave a Stream Deck button doing nothing on stream night. Links that name a source, scene,
// sequence or song may answer that there's none by that name, but never "Unknown Stream Deck link".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startStudio, ROOT } = require('./support/studio');

// The links and their path parameters' listed values, read from openapi.yaml.
function documentedLinks() {
  const lines = fs.readFileSync(path.join(ROOT, 'public', 'openapi.yaml'), 'utf8').split('\n');
  const paths = [];
  let current = null, param = null;
  for (const line of lines) {
    const p = line.match(/^ {2}(\/\S+):\s*$/);
    if (p) { current = { path: p[1], params: {} }; paths.push(current); param = null; continue; }
    if (/^\S/.test(line)) { current = null; continue; }
    if (!current) continue;
    const n = line.match(/^\s+- name: (\w+)/);
    if (n) { param = { name: n[1], in: '', values: null }; current.params[param.name] = param; continue; }
    if (!param) continue;
    const where = line.match(/^\s+in: (\w+)/);
    if (where) param.in = where[1];
    const e = line.match(/enum: \[([^\]]+)\]/);
    if (e && /schema:/.test(line)) param.values = e[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
  }
  return paths;
}

// Values for path parameters that are free text.
const SAMPLES = { time: ['5:00', '12:34'], amount: ['10', '-10', '1m', '-1m'], minutes: ['10'], court: ['1', 'Court%202'], pixels: ['150'],
  quarter: ['1', '4', '5', 'next', 'prev'], name: ['scoreboard', 'pre-game', 'next', 'again'],
  input: ['2', 'Camera%202'], key: ['1', '2'], macro: ['1'] };

function expand(link) {
  let urls = [link.path];
  for (const [name, p] of Object.entries(link.params)) {
    if (p.in !== 'path') continue;
    const values = p.values || SAMPLES[name];
    assert.ok(values, `${link.path}: no values to try for {${name}}; add some to SAMPLES`);
    urls = urls.flatMap(u => values.map(v => u.replace(`{${name}}`, v)));
  }
  // A link that only takes query settings (e.g. /deck/clock/adjust?minutes=1&seconds=-30).
  const query = Object.values(link.params).filter(p => p.in === 'query').map(p => `${p.name}=1`);
  if (query.length && !Object.values(link.params).some(p => p.in === 'path')) urls = urls.map(u => `${u}?${query.join('&')}`);
  // Mute and duck take on, off or toggle in place of a name (as their description says).
  urls = urls.map(u => u.replace(/\/music\/(mute|duck)\/[^/?]+/, '/music/$1/toggle'));
  return [...new Set(urls)];
}

test('every documented Stream Deck link, with every value it lists, is one the helper knows', async t => {
  const links = documentedLinks();
  assert.ok(links.length >= 25, `found ${links.length} links in openapi.yaml`);
  const studio = await startStudio(t);
  const unknown = [], failed = [];
  let tried = 0;
  for (const link of links) {
    for (const url of expand(link)) {
      tried++;
      const r = await studio.request('GET', url);
      if (r.json && /Unknown Stream Deck link/.test(r.json.error || '')) unknown.push(url);
      else if (r.status >= 500) failed.push(`${url} answered ${r.status}: ${r.text.slice(0, 200)}`);
    }
  }
  assert.deepEqual(unknown, [], 'documented but unknown to the helper');
  assert.deepEqual(failed, []);
  assert.ok(tried > 80, `${tried} links tried`);
});

test('the scoreboard and goals reads are documented and answer', async t => {
  const links = documentedLinks().map(l => l.path);
  assert.ok(links.includes('/api/scoreboard'));
  assert.ok(links.includes('/api/goals'));
  const studio = await startStudio(t);
  assert.equal((await studio.request('GET', '/api/scoreboard')).status, 200);
  assert.equal((await studio.request('GET', '/api/goals')).status, 200);
});
