// AI captions (captions.ts): the keys, the provider and model picked, a caption written from the picture's facts with
// the rules every provider gets, its cost from captionprices.json and the month's total, the warning for a model whose
// price isn't known, and what each failure says. Against a stand-in for Claude, ChatGPT and Gemini here, so no test
// ever calls (or pays) a real AI.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { startStudio, ROOT, type Json } from './support/studio.mts';
import * as access from '../out/access.js';
import * as datalocation from '../out/datalocation.js';
import type { TestContext } from 'node:test';

const KEYS = { anthropic: 'sk-ant-test-0123456789abcdefWXYZ', openai: 'sk-proj-test-0123456789abcdefOPEN', google: 'AIzaTest0123456789abcdefGOOG' };

// The stand-in: each provider under its own path, as its library calls it. Records every request.
function startAi() {
  const calls: Json[] = [];
  const state = { down: false, status: 0 };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      const url = new URL(req.url || '/', 'http://x');
      const body = raw ? JSON.parse(raw) : null;
      calls.push({ method: req.method, path: url.pathname, headers: req.headers, body });
      const json = (code: Json, v: Json) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
      if (state.down) { req.socket.destroy(); return; }
      if (state.status) return json(state.status, { type: 'error', error: { type: 'error', message: `stand-in ${state.status}` } });
      const p = url.pathname;
      if (p.startsWith('/anthropic/')) {
        if (req.headers['x-api-key'] !== KEYS.anthropic && req.headers.authorization !== `Bearer ${KEYS.anthropic}`) return json(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
        if (p === '/anthropic/v1/models') {
          return json(200, { data: [{ type: 'model', id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5', created_at: '2026-10-01T00:00:00Z' },
            { type: 'model', id: 'claude-mystery-9', display_name: 'Claude Mystery 9', created_at: '2026-10-01T00:00:00Z' }], has_more: false, first_id: 'claude-haiku-5-5', last_id: 'claude-mystery-9' });
        }
        if (p === '/anthropic/v1/messages') {
          return json(200, { id: 'msg_1', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn', stop_sequence: null,
            content: [{ type: 'text', text: '"What a night of netball! 🏐 Well played everyone."' }],
            usage: { input_tokens: 3000, output_tokens: 400, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
        }
      }
      if (p.startsWith('/openai/')) {
        if (req.headers.authorization !== `Bearer ${KEYS.openai}`) return json(401, { error: { message: 'Incorrect API key provided', type: 'invalid_request_error', code: 'invalid_api_key' } });
        if (p === '/openai/v1/models') {
          return json(200, { object: 'list', data: ['gpt-5.4-mini', 'gpt-5.4-nano', 'text-embedding-3-small', 'gpt-image-1', 'gpt-realtime'].map(id => ({ id, object: 'model', created: 0, owned_by: 'openai' })) });
        }
        if (p === '/openai/v1/responses') {
          return json(200, { id: 'resp_1', object: 'response', created_at: 0, status: 'completed', model: body.model,
            output: [{ type: 'message', id: 'msg_1', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: 'Results are in for round 4.', annotations: [] }] }],
            usage: { input_tokens: 2000, output_tokens: 100, total_tokens: 2100, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } });
        }
      }
      if (p.startsWith('/google/')) {
        if (req.headers['x-goog-api-key'] !== KEYS.google) return json(400, { error: { code: 400, message: 'API key not valid.', status: 'INVALID_ARGUMENT' } });
        if (/^\/google\/v1(beta)?\/models$/.test(p) && req.method === 'GET') {
          return json(200, { models: [{ name: 'models/gemini-3.5-flash-lite', displayName: 'Gemini 3.5 Flash-Lite', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] }] });
        }
        if (/^\/google\/v1(beta)?\/models\/[^/]+:generateContent$/.test(p)) {
          return json(200, { candidates: [{ content: { role: 'model', parts: [{ text: 'Game day is here!' }] }, finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 50, thoughtsTokenCount: 50 } });
        }
      }
      json(404, { error: { message: `stand-in has no ${req.method} ${p}` } });
    });
  });
  return new Promise<{ base: string; calls: Json[]; state: typeof state; close: () => Promise<void> }>(resolve => server.listen(0, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    resolve({ base, calls, state, close: () => new Promise<void>(r => { server.closeAllConnections(); server.close(() => r()); }) });
  }));
}

async function setUp(t: TestContext) {
  const ai = await startAi();
  t.after(() => ai.close());
  const studio = await startStudio(t, { competition: 'Thunder League', env: { CAPTIONS_KEYCHAIN: '0',
    CAPTIONS_ANTHROPIC_URL: `${ai.base}/anthropic`, CAPTIONS_OPENAI_URL: `${ai.base}/openai/v1`, CAPTIONS_GOOGLE_URL: `${ai.base}/google` } });
  return { ai, studio };
}

test('the price list has the default models, and a price for every model in it', () => {
  const prices = JSON.parse(fs.readFileSync(path.join(ROOT, 'captionprices.json'), 'utf8'));
  for (const [provider, model] of [['anthropic', 'claude-haiku-5-5'], ['openai', 'gpt-5.4-mini'], ['google', 'gemini-3.5-flash-lite']]) {
    assert.ok(prices.models[provider][model], `${provider} ${model} has a price`);
  }
  for (const list of Object.values(prices.models as Record<string, Record<string, { in: number; out: number }>>)) for (const p of Object.values(list)) assert.ok(p.in >= 0 && p.out >= 0);
});

test('the Captions settings and keys answer this Mac only; a caption may be asked for by an allowed device', () => {
  const own = new Set(['127.0.0.1']);
  assert.match(access.notThisMac('GET', '/api/captions', '192.168.1.50', own)!, /only be seen and changed on the Mac/);
  assert.match(access.notThisMac('POST', '/api/captions/models', '192.168.1.50', own)!, /only be seen and changed on the Mac/);
  assert.equal(access.notThisMac('POST', '/api/socials/caption', '192.168.1.50', own), null);
});

test('a key is checked, kept out of every answer, and a caption is written from the picture\'s facts with its cost', async t => {
  const { ai, studio } = await setUp(t);

  let s = await studio.get('/api/captions');
  assert.equal(s.provider, 'anthropic');
  assert.deepEqual(s.providers.map((p: Json) => [p.id, p.name, p.model, p.key]), [['anthropic', 'Claude', 'claude-haiku-5-5', ''], ['openai', 'ChatGPT', 'gpt-5.4-mini', ''], ['google', 'Gemini', 'gemini-3.5-flash-lite', '']]);
  assert.deepEqual(s.providers[0].price, { in: 0.1, out: 0.5 });
  assert.equal(s.warning, '');

  // Not set up: asking says so plainly.
  const date = (await studio.get('/api/socials')).next;
  let r = await studio.request('POST', '/api/socials/caption', { kind: 'fixtures', query: { date }, style: 'hype' });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /aren't set up yet.*Claude API key/);

  // A wrong key is caught when it's saved.
  r = await studio.request('POST', '/api/captions', { provider: 'anthropic', key: 'sk-ant-wrong-0123456789abcdefghij' });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /didn't accept the API key/);
  assert.match((await studio.request('POST', '/api/captions', { provider: 'anthropic', key: 'short' })).json.error, /doesn't look like/);

  s = await studio.post('/api/captions', { provider: 'anthropic', key: KEYS.anthropic });
  assert.equal(s.providers[0].key, '••••WXYZ');
  assert.ok(!JSON.stringify(s).includes(KEYS.anthropic), 'the key never comes back');
  // Kept in the local data folder (the Keychain on a Mac), which stays on this Mac: not with the competition, not synced.
  const anywhere: Json[] = [];
  const walk = (d: Json) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (fs.readFileSync(p).includes(KEYS.anthropic)) anywhere.push(path.relative(studio.dataDir, p)); } };
  walk(studio.dataDir);
  assert.deepEqual(anywhere, ['captions.json']);
  assert.ok(datalocation.LOCAL_ONLY.has('captions.json'), 'never synced or backed up');

  // The hashtags typed on the Socials tab go on the end, as typed.
  await studio.post('/api/socials/settings', { hashtags: '  #ThunderLeague   @thunderleague\n#netball ' });
  assert.equal((await studio.get('/api/socials')).settings.hashtags, '#ThunderLeague @thunderleague #netball');

  ai.calls.length = 0;
  const c = await studio.post('/api/socials/caption', { kind: 'fixtures', query: { date }, style: 'hype', short: true });
  assert.equal(c.text, 'What a night of netball! 🏐 Well played everyone.\n\n#ThunderLeague @thunderleague #netball', 'quotes taken off, hashtags added');
  assert.equal(c.provider, 'anthropic');
  assert.equal(c.model, 'claude-haiku-5-5');
  assert.deepEqual(c.cost, { usd: 0.0005, tokensIn: 3000, tokensOut: 400 }); // 3000 x $0.10 + 400 x $0.50 per million
  assert.equal(c.warning, '');

  const sent = ai.calls.find((x: Json) => x.path === '/anthropic/v1/messages').body;
  assert.equal(sent.model, 'claude-haiku-5-5');
  assert.deepEqual(sent.output_config, { effort: 'low' });
  assert.match(sent.system, /Never mention or highlight negative statistics/);
  assert.match(sent.system, /Never invent/);
  assert.match(sent.system, /Australian English/);
  const ask = sent.messages[0].content;
  assert.match(ask, /"Game night fixture" picture, posted before the games/);
  assert.match(ask, /Style: Hype/);
  assert.match(ask, /Length: short/);
  const data = JSON.parse(ask.slice(ask.indexOf('<data>') + 6, ask.indexOf('</data>')));
  assert.equal(data.picture, 'Game night fixture');
  assert.equal(data.competition, 'Thunder League');
  assert.ok(data.games.length > 0 && data.games[0].home.name, 'the night\'s games');
  assert.ok(!/"(logo|photo|look|settings|competitionLogo)"/.test(ask), 'nothing that only draws the picture');

  s = await studio.get('/api/captions');
  assert.deepEqual(s.providers[0].month, { usd: 0.0005, captions: 1, unpriced: 0 });

  // A style that doesn't exist, a kind that doesn't exist.
  assert.match((await studio.request('POST', '/api/socials/caption', { kind: 'fixtures', query: { date }, style: 'angry' })).json.error, /Pick a style/);
  assert.match((await studio.request('POST', '/api/socials/caption', { kind: 'nope', query: { date }, style: 'hype' })).json.error, /no such kind/);
});

test('a model whose price isn\'t known is warned about, and its captions show tokens instead of a cost', async t => {
  const { studio } = await setUp(t);
  await studio.post('/api/captions', { provider: 'anthropic', key: KEYS.anthropic });
  const list = await studio.get('/api/captions/models?provider=anthropic');
  assert.deepEqual(list.models.map((m: Json) => [m.id, m.price]), [['claude-haiku-5-5', { in: 0.1, out: 0.5 }], ['claude-mystery-9', null]]);

  const s = await studio.post('/api/captions', { provider: 'anthropic', model: 'claude-mystery-9' });
  assert.equal(s.providers[0].price, null);
  assert.match(s.warning, /don't know what Claude's claude-mystery-9 costs/);

  const date = (await studio.get('/api/socials')).next;
  const c = await studio.post('/api/socials/caption', { kind: 'fixtures', query: { date }, style: 'neutral' });
  assert.deepEqual(c.cost, { usd: null, tokensIn: 3000, tokensOut: 400 });
  assert.match(c.warning, /tokens used instead of a price/);
  assert.deepEqual((await studio.get('/api/captions')).providers[0].month, { usd: 0, captions: 1, unpriced: 1 });
});

test('ChatGPT and Gemini write captions too, each with its own key and its chat models only', async t => {
  const { ai, studio } = await setUp(t);
  const date = (await studio.get('/api/socials')).next;

  let s = await studio.post('/api/captions', { provider: 'openai', key: KEYS.openai });
  assert.equal(s.provider, 'openai');
  assert.equal(s.providers[1].key, '••••OPEN');
  assert.deepEqual((await studio.get('/api/captions/models?provider=openai')).models.map((m: Json) => m.id), ['gpt-5.4-mini', 'gpt-5.4-nano']);
  let c = await studio.post('/api/socials/caption', { kind: 'results', query: { date }, style: 'professional' });
  assert.equal(c.text, 'Results are in for round 4.');
  assert.equal(c.model, 'gpt-5.4-mini');
  assert.equal(c.cost.tokensIn, 2000);
  assert.equal(typeof c.cost.usd, 'number');
  const sent = ai.calls.find((x: Json) => x.path === '/openai/v1/responses').body;
  assert.match(sent.instructions, /negative statistics/);
  assert.equal(sent.store, false, 'OpenAI doesn\'t keep it');
  assert.match(sent.input, /Style: Professional/);

  s = await studio.post('/api/captions', { provider: 'google', key: KEYS.google });
  assert.equal(s.provider, 'google');
  assert.deepEqual((await studio.get('/api/captions/models?provider=google')).models.map((m: Json) => m.id), ['gemini-3.5-flash-lite']);
  c = await studio.post('/api/socials/caption', { kind: 'fixtures', query: { date }, style: 'emotional' });
  assert.equal(c.text, 'Game day is here!');
  assert.deepEqual([c.cost.tokensIn, c.cost.tokensOut], [1000, 100], 'Gemini\'s thinking counts as output');
  const g = ai.calls.find((x: Json) => x.path.endsWith(':generateContent'));
  assert.match(g.path, /^\/google\/v1(beta)?\/models\/gemini-3\.5-flash-lite:generateContent$/);
  assert.match(JSON.stringify(g.body.systemInstruction), /negative statistics/);

  // Each provider's key stays; removing one leaves the others.
  s = await studio.post('/api/captions', { removeKey: 'openai' });
  assert.deepEqual(s.providers.map((p: Json) => p.key), ['', '', '••••GOOG']);
});

test('without the internet, or when the provider fails, the answer says so in plain words', async t => {
  const { ai, studio } = await setUp(t);
  await studio.post('/api/captions', { provider: 'anthropic', key: KEYS.anthropic });
  const date = (await studio.get('/api/socials')).next;
  const ask = () => studio.request('POST', '/api/socials/caption', { kind: 'fixtures', query: { date }, style: 'fun' });

  ai.state.down = true;
  let r = await ask();
  assert.equal(r.status, 503);
  assert.match(r.json.error, /Needs the internet.*write the caption by hand/);
  ai.state.down = false;

  ai.state.status = 429;
  r = await ask();
  assert.equal(r.status, 429);
  assert.match(r.json.error, /out of credit/);

  ai.state.status = 401;
  r = await ask();
  assert.match(r.json.error, /didn't accept the API key/);
  ai.state.status = 0;

  assert.equal((await ask()).status, 200, 'and works again once it can');
});
