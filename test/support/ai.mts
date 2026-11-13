// A stand-in for the AI providers AI captions use (captions.ts): Claude, ChatGPT and Gemini, each under its own path
// as its official library calls it, recording every request; and a Studio pointed at it with the keys kept in a file
// (no Keychain), so no test ever calls (or pays) a real AI.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { TestContext } from 'node:test';
import { startStudio, type Json } from './studio.mts';

export const KEYS = { anthropic: 'sk-ant-test-0123456789abcdefWXYZ', openai: 'sk-proj-test-0123456789abcdefOPEN', google: 'AIzaTest0123456789abcdefGOOG' };

// The stand-in: each provider under its own path, as its library calls it. Records every request.
export function startAi() {
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

export async function setUp(t: TestContext) {
  const ai = await startAi();
  t.after(() => ai.close());
  const studio = await startStudio(t, { competition: 'Thunder League', env: { CAPTIONS_KEYCHAIN: '0',
    CAPTIONS_ANTHROPIC_URL: `${ai.base}/anthropic`, CAPTIONS_OPENAI_URL: `${ai.base}/openai/v1`, CAPTIONS_GOOGLE_URL: `${ai.base}/google` } });
  return { ai, studio };
}
