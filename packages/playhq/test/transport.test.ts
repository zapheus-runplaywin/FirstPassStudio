// Talking to PlayHQ: the guest session, headers, retries and how each failure is reported.
import { beforeEach, describe, expect, it } from 'vitest';
import { createTransport, PlayhqError, readCookies, type RequestInfo, type TransportOptions } from '../src/transport';
import { createWorld, fakeFetch, NOW, response, type World } from './world';

let world: World;
let seen: RequestInfo[];
beforeEach(() => {
  world = createWorld();
  seen = [];
});

let ids = 0;
function transport(extra: Partial<TransportOptions> = {}) {
  return createTransport({
    fetch: fakeFetch(world), tenant: 'netball-australia', apiUrl: 'https://api.test/graphql', spectatorUrl: 'https://spectator.test/graphql',
    requestId: () => `req-${++ids}`, now: () => NOW, onRequest: (i) => seen.push(i), ...extra,
  });
}
const Q = 'query discoverGame($gameID: ID!) { discoverGame(gameID: $gameID) { id } }';

describe('guest session', () => {
  it('gets a session cookie first and sends it, with playhq.com headers and the tenant', async () => {
    const t = transport();
    await t.gql('discoverGame', Q, { gameID: 'game-d1-r1-1' });
    expect(world.calls.map((c) => c.operationName)).toEqual(['ProfileSearch', 'discoverGame']);
    const h = world.calls[1]!.headers;
    expect(h.cookie).toBe('phq_session=test');
    expect(h.tenant).toBe('netball-australia');
    expect(h.origin).toBe('https://www.playhq.com');
    expect(h.referer).toBe('https://www.playhq.com/');
    expect(h['request-id']).toMatch(/^req-\d+$/);
    expect(seen.map((s) => s.kind)).toEqual(['session', 'api']);
  });

  it('keeps one session for ten minutes, and shares one handshake between requests at once', async () => {
    let t0 = NOW;
    const t = transport({ now: () => t0 });
    await Promise.all([t.gql('gradeRounds', Q), t.gql('gradeRounds', Q)]);
    t0 += 9 * 60 * 1000;
    await t.gql('gradeRounds', Q);
    expect(world.calls.filter((c) => c.operationName === 'ProfileSearch')).toHaveLength(1);
    t0 += 2 * 60 * 1000;
    await t.gql('gradeRounds', Q);
    expect(world.calls.filter((c) => c.operationName === 'ProfileSearch')).toHaveLength(2);
  });

  it('tries the next session query when the first sets no cookie, and carries on without one', async () => {
    world.setCookie = '';
    const t = transport();
    await t.gql('discoverGame', Q, { gameID: 'game-d1-r1-1' });
    expect(world.calls.map((c) => c.operationName)).toEqual(['ProfileSearch', 'TenantConfig', 'discoverGame']);
    expect(world.calls[2]!.headers.cookie).toBeUndefined();
  });

  it('asks for a fresh session once on 401 or 403', async () => {
    const t = transport();
    let refused = 0;
    world.answers.discoverGame = () => (refused++ === 0 ? { status: 401, body: 'no' } : null);
    await t.gql('discoverGame', Q, { gameID: 'game-d1-r1-1' });
    expect(world.calls.map((c) => c.operationName)).toEqual(['ProfileSearch', 'discoverGame', 'ProfileSearch', 'discoverGame']);
    world.answers.discoverGame = () => ({ status: 403, body: 'no' });
    await expect(t.gql('discoverGame', Q, {})).rejects.toThrow('PlayHQ answered HTTP 403');
  });

  it('needs no session when told so (HQ\'s Edge Function)', async () => {
    const t = transport({ session: false });
    world.answers.discoverGame = () => ({ status: 401, body: 'no' });
    await expect(t.gql('discoverGame', Q, {})).rejects.toMatchObject({ status: 401 });
    expect(world.calls.map((c) => c.operationName)).toEqual(['discoverGame']);
  });

  it('reads PlayHQ cookies from getSetCookie or a joined header, and nothing else', () => {
    const many = { ...response(200, ''), headers: { get: () => null, getSetCookie: () => ['phq_a=1; Path=/', 'other=2', 'phq_b_c=3; HttpOnly'] } };
    expect(readCookies(many)).toBe('phq_a=1; phq_b_c=3');
    expect(readCookies(response(200, '', { 'set-cookie': 'phq_a=1; Path=/, phq_a=2; Path=/' }))).toBe('phq_a=2');
    expect(readCookies(response(200, ''))).toBe('');
  });
});

describe('answers and failures', () => {
  it('gives the data and tells onAnswer', async () => {
    const answers: unknown[] = [];
    const t = transport({ onAnswer: (a) => answers.push(a) });
    const data = await t.gql<{ discoverGame: { id: string } }>('discoverGame', Q, { gameID: 'game-d1-r1-1' });
    expect(data.discoverGame.id).toBe('game-d1-r1-1');
    expect(answers).toEqual([{ kind: 'api', operationName: 'discoverGame', variables: { gameID: 'game-d1-r1-1' }, tenant: 'netball-australia', data }]);
  });

  it('says why PlayHQ could not be reached, with the product\'s hint', async () => {
    world.unreachable = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    const t = transport({ unreachableHint: 'Is this Mac connected to the internet?' });
    const err = await t.gql('discoverGame', Q).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PlayhqError);
    expect(err).toMatchObject({ unreachable: true, message: "Can't reach PlayHQ (ENOTFOUND). Is this Mac connected to the internet?" });
    expect(seen[0]).toMatchObject({ kind: 'session', status: 0, length: 0 });
    expect(seen[0]!.error?.unreachable).toBe(true);
  });

  it('reports a refused query\'s GraphQL errors, a block and a non-JSON answer', async () => {
    const t = transport();
    world.answers.discoverGame = () => ({ status: 400, body: { errors: [{ message: 'Cannot query field "gender" on type "Profile".' }] } });
    await expect(t.gql('discoverGame', Q)).rejects.toMatchObject({
      status: 400, message: 'PlayHQ answered HTTP 400: Cannot query field "gender" on type "Profile".', graphql: [{ message: 'Cannot query field "gender" on type "Profile".' }],
    });
    world.answers.discoverGame = () => null;
    world.fail.discoverGame = 403;
    await expect(t.gql('discoverGame', Q)).rejects.toThrow('PlayHQ answered HTTP 403 (temporarily blocked, will retry)');
    world.fail = {};
    world.answers.discoverGame = () => ({ body: '<html>' });
    await expect(t.gql('discoverGame', Q)).rejects.toThrow('PlayHQ sent something that was not JSON');
    world.answers.discoverGame = () => ({ body: { data: null } });
    await expect(t.gql('discoverGame', Q)).rejects.toThrow('PlayHQ sent nothing back');
  });

  it('throws on GraphQL errors, unless partial answers are allowed and there is data', async () => {
    world.answers.discoverGame = () => ({ body: { data: { discoverGame: { id: 'x' } }, errors: [{ message: 'one field failed' }] } });
    await expect(transport().gql('discoverGame', Q)).rejects.toMatchObject({ message: 'one field failed', graphql: [{ message: 'one field failed' }] });
    expect(await transport({ allowPartial: true }).gql('discoverGame', Q)).toEqual({ discoverGame: { id: 'x' } });
    world.answers.discoverGame = () => ({ body: { errors: [{ message: 'all failed' }] } });
    await expect(transport({ allowPartial: true }).gql('discoverGame', Q)).rejects.toThrow('all failed');
  });

  it('lets the product answer instead (Studio\'s practice mode), without asking PlayHQ', async () => {
    const t = transport({ answer: (op, v) => (op === 'discoverGame' ? { discoverGame: { id: `practice-${v.gameID}` } } : op === 'live' ? { data: { game: { id: v.id } } } : undefined) });
    expect(await t.gql('discoverGame', Q, { gameID: 'g1' })).toEqual({ discoverGame: { id: 'practice-g1' } });
    expect(await t.live('g1', 'query')).toEqual({ data: { game: { id: 'g1' } } });
    expect(world.calls).toHaveLength(0);
    await t.gql('gradeRounds', Q, {});
    expect(world.calls.map((c) => c.operationName)).toContain('gradeRounds');
  });

  it('can ask for another tenant on one request', async () => {
    await transport().gql('discoverGame', Q, {}, { tenant: 'basketball-victoria' });
    expect(world.calls.at(-1)!.headers.tenant).toBe('basketball-victoria');
  });
});

describe('live feed', () => {
  it('sends the tenant label and the session cookie to the spectator feed', async () => {
    const t = transport();
    const json = await t.live('game-d1-r3-1', 'query game');
    expect((json.data?.game as { id: string }).id).toBe('game-d1-r3-1');
    const call = world.calls.find((c) => c.spectator)!;
    expect(call.url).toBe('https://spectator.test/graphql');
    expect(call.headers['x-phq-tenant']).toBe('na');
    expect(call.headers.cookie).toBe('phq_session=test');
    expect(call.variables).toEqual({ id: 'game-d1-r3-1' });
    await t.live('game-d1-r3-1', 'query game');
    expect(world.calls.filter((c) => c.operationName === 'tenantLabel')).toHaveLength(1);
  });

  it('falls back to "na" for netball, or the tenant itself, when the label can\'t be read', async () => {
    world.fail.tenantLabel = 500;
    await transport().live('game-d1-r3-1', 'q');
    expect(world.calls.find((c) => c.spectator)!.headers['x-phq-tenant']).toBe('na');
    world.calls.length = 0;
    await transport({ tenant: 'basketball-victoria' }).live('game-d1-r3-1', 'q');
    expect(world.calls.find((c) => c.spectator)!.headers['x-phq-tenant']).toBe('basketball-victoria');
  });

  it('reports an HTTP failure, a non-JSON answer and an unreachable feed', async () => {
    const t = transport();
    world.fail.live = 502;
    await expect(t.live('g', 'q')).rejects.toMatchObject({ status: 502, message: 'PlayHQ live feed answered HTTP 502' });
    world.fail = {};
    world.answers.live = () => ({ body: 'oops' });
    await expect(t.live('g', 'q')).rejects.toThrow('PlayHQ live feed sent something that was not JSON');
    world.unreachable = new Error('socket hang up');
    await expect(t.live('g', 'q')).rejects.toThrow("Can't reach PlayHQ's live scoring (socket hang up).");
  });

  it('forgets the session and label when the tenant changes or on reset', async () => {
    const t = transport();
    await t.live('game-d1-r3-1', 'q');
    t.setTenant('netball-australia'); // the same: nothing forgotten
    await t.live('game-d1-r3-1', 'q');
    expect(world.calls.filter((c) => c.operationName === 'ProfileSearch')).toHaveLength(1);
    t.setTenant('basketball-victoria');
    expect(t.tenant()).toBe('basketball-victoria');
    await t.live('game-d1-r3-1', 'q');
    expect(world.calls.filter((c) => c.operationName === 'ProfileSearch')).toHaveLength(2);
    t.reset();
    await t.live('game-d1-r3-1', 'q');
    expect(world.calls.filter((c) => c.operationName === 'tenantLabel')).toHaveLength(3);
  });
});

it('makes request ids without crypto.randomUUID (Hermes)', async () => {
  const saved = (globalThis as { crypto?: unknown }).crypto;
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
  try {
    await createTransport({ fetch: fakeFetch(world), session: false }).gql('discoverGame', Q);
  } finally {
    Object.defineProperty(globalThis, 'crypto', { value: saved, configurable: true });
  }
  expect(world.calls[0]!.headers['request-id']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(world.calls[0]!.url).toBe('https://api.playhq.com/graphql');
});
