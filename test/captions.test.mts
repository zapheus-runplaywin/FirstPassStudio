// AI captions (captions.ts): the keys, the provider and model picked, a caption written from the picture's facts with
// the rules every provider gets, its cost from captionprices.json and the month's total, the warning for a model whose
// price isn't known, and what each failure says. Against a stand-in for Claude, ChatGPT and Gemini (support/ai.mts), so no test
// ever calls (or pays) a real AI.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, type Json } from './support/studio.mts';
import * as access from '../out/access.js';
import * as datalocation from '../out/datalocation.js';
import { KEYS, setUp } from './support/ai.mts';


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

  // A picture of one division is written from what that picture reads (its kind's part of the night, socials.ts NEEDS),
  // and the AI is told it's only about that division.
  const division = data.games[0].division;
  ai.calls.length = 0;
  await studio.post('/api/socials/caption', { kind: 'preview', query: { kind: 'preview', size: 'square', date, division, colours: '', with: 'everything' }, style: 'neutral' });
  const ask2 = ai.calls.find(x => x.path === '/anthropic/v1/messages').body.messages[0].content;
  assert.match(ask2, /"Round preview" picture/);
  assert.ok(ask2.includes(`The picture is only about division ${JSON.stringify(division)}`), 'what the picture is about');
  const data2 = JSON.parse(ask2.slice(ask2.indexOf('<data>') + 6, ask2.indexOf('</data>')));
  assert.ok('preview' in data2, 'the round preview, as the picture reads it');
  assert.ok(!('everything' in data2) && !('ladders' in data2), 'only what the picture asks for, whatever the link says');
  assert.deepEqual(await studio.get(`/api/socials/night?${new URLSearchParams({ kind: 'preview', date, division })}`).then(n => Object.keys(n).includes('preview')), true, 'social.html reads the same');

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
