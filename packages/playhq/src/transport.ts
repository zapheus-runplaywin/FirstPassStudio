// Talking to PlayHQ: the guest session, GraphQL requests and the live feed. The product passes in
// fetch and gets told about every request, so nothing here touches a disk, a log or a platform API.
//
// PlayHQ's public API needs no key, but only answers requests that look like they come from
// playhq.com, and (from most places) only with a guest session cookie, which a first harmless
// query sets. A 401 or 403 gets a fresh session and one retry.

import { API_URL, Q_TENANT_LABEL, SESSION_QUERIES, SPECTATOR_URL } from './queries';

/** The parts of a fetch Response this package reads. The global Response fits. */
export interface ResponseLike {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null; getSetCookie?: () => string[] };
  text(): Promise<string>;
}

export type FetchLike = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string },
) => Promise<ResponseLike>;

/** Told once per request, for a traffic counter or a debug log. */
export type RequestInfo = {
  /** session: the guest-session handshake; api: api.playhq.com; live: the live feed. */
  kind: 'session' | 'api' | 'live';
  operationName: string;
  variables: Record<string, unknown>;
  tenant: string;
  ms: number;
  /** The HTTP status; 0 when PlayHQ couldn't be reached. */
  status: number;
  /** Characters in the answer (0 when unreachable). */
  length: number;
  response?: ResponseLike;
  /** The answer's text, for a log of failures. */
  text?: string;
  error?: PlayhqError;
};

export type TransportOptions = {
  fetch: FetchLike;
  /** The sport, such as netball-australia. Change it later with setTenant. */
  tenant?: string;
  apiUrl?: string;
  spectatorUrl?: string;
  /** Ask for a guest session cookie first (default true). HQ's Edge Function doesn't need one. */
  session?: boolean;
  /** How long a guest session is used before asking for a new one (default 10 minutes). */
  sessionMaxAgeMs?: number;
  /** Headers sent with every request; the defaults look like playhq.com in a browser. */
  headers?: Record<string, string>;
  /** A fresh id for PlayHQ's request-id header. Defaults to crypto.randomUUID where there is one. */
  requestId?: () => string;
  /** Accept an answer that has data and errors (default false: any GraphQL error throws). */
  allowPartial?: boolean;
  /** Added to the message when PlayHQ can't be reached, such as "Is this Mac connected to the internet?". */
  unreachableHint?: string;
  now?: () => number;
  onRequest?: (info: RequestInfo) => void;
  /** Every good answer, for a recording of a game. */
  onAnswer?: (answer: { kind: 'api' | 'live'; operationName: string; variables: Record<string, unknown>; tenant: string; data: unknown }) => void;
  /**
   * Answers instead of PlayHQ when it returns anything but undefined, such as Studio's practice mode
   * playing back a recording. Called with the operation name and variables; the live feed with
   * operationName 'live' and { id }.
   */
  answer?: (operationName: string, variables: Record<string, unknown>) => unknown;
};

export class PlayhqError extends Error {
  /** HTTP status, when PlayHQ answered. */
  status?: number;
  /** GraphQL errors PlayHQ sent, such as a field it doesn't know. */
  graphql?: { message: string }[];
  /** PlayHQ was never reached (no internet, name not found, connection cut). */
  unreachable?: boolean;
  /** The live feed says this game isn't being scored electronically (yet). */
  notScored?: boolean;
  constructor(message: string, extra: Partial<Pick<PlayhqError, 'status' | 'graphql' | 'unreachable' | 'notScored'>> & { cause?: unknown } = {}) {
    super(message);
    this.name = 'PlayhqError';
    const { cause, ...rest } = extra;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
    Object.assign(this, rest);
  }
}

export const DEFAULT_HEADERS: Readonly<Record<string, string>> = {
  accept: '*/*',
  'content-type': 'application/json',
  origin: 'https://www.playhq.com',
  referer: 'https://www.playhq.com/',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
};

/** PlayHQ's session cookies (phq_*) from a response, as one Cookie header. */
export function readCookies(res: ResponseLike): string {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const raw = list.length ? list.join('\n') : (res.headers.get('set-cookie') ?? '');
  const jar: Record<string, string> = {};
  for (const m of raw.matchAll(/(phq_[a-z_]+)=([^;,\s]*)/gi)) if (m[1]) jar[m[1]] = m[2] ?? '';
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

function defaultRequestId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Hermes has no crypto.randomUUID: a v4-shaped id is enough for a request id.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function whyUnreachable(err: unknown): string {
  const e = err as { cause?: { code?: string; message?: string }; message?: string };
  return e?.cause ? e.cause.code || e.cause.message || '' : e?.message || '';
}

export type Transport = ReturnType<typeof createTransport>;

export function createTransport(options: TransportOptions) {
  const apiUrl = options.apiUrl ?? API_URL;
  const spectatorUrl = options.spectatorUrl ?? SPECTATOR_URL;
  const useSession = options.session ?? true;
  const sessionMaxAgeMs = options.sessionMaxAgeMs ?? 10 * 60 * 1000;
  const headersBase = { ...DEFAULT_HEADERS, ...options.headers };
  const requestId = options.requestId ?? defaultRequestId;
  const now = options.now ?? Date.now;
  const tell = options.onRequest ?? (() => {});

  let tenant = options.tenant ?? 'netball-australia';
  let cookie: string | null = null;
  let cookieAt = 0;
  let cookiePromise: Promise<string> | null = null;
  let tenantLabel = '';

  const unreachable = (err: unknown, what: string) => {
    const why = whyUnreachable(err);
    const hint = options.unreachableHint ? ` ${options.unreachableHint}` : '';
    return new PlayhqError(`Can't reach ${what}${why ? ` (${why})` : ''}.${hint}`, { unreachable: true, cause: err });
  };

  async function post(kind: RequestInfo['kind'], url: string, headers: Record<string, string>, operationName: string, variables: Record<string, unknown>, body: string, forTenant: string) {
    const started = now();
    let res: ResponseLike;
    try {
      res = await options.fetch(url, { method: 'POST', headers, body });
    } catch (err) {
      const error = unreachable(err, kind === 'live' ? "PlayHQ's live scoring" : 'PlayHQ');
      tell({ kind, operationName, variables, tenant: forTenant, ms: now() - started, status: 0, length: 0, error });
      throw error;
    }
    const text = await res.text();
    tell({ kind, operationName, variables, tenant: forTenant, ms: now() - started, status: res.status, length: text.length, response: res, text });
    return { res, text };
  }

  /** The guest session cookie ('' when PlayHQ gave none), asked for again after sessionMaxAgeMs or when forced. */
  async function getSession(force = false): Promise<string> {
    if (!useSession) return '';
    if (!force && cookie !== null && now() - cookieAt < sessionMaxAgeMs) return cookie;
    if (cookiePromise) return cookiePromise;
    cookiePromise = (async () => {
      try {
        for (const q of SESSION_QUERIES) {
          const { res } = await post('session', apiUrl, { ...headersBase, tenant, 'request-id': requestId() }, q.operationName, q.variables, JSON.stringify(q), tenant);
          const c = readCookies(res);
          if (c) {
            cookie = c;
            cookieAt = now();
            return cookie;
          }
        }
        // Some sessions answer without a cookie: carry on without one.
        cookie = '';
        cookieAt = now();
        return cookie;
      } finally {
        cookiePromise = null;
      }
    })();
    return cookiePromise;
  }

  /** One GraphQL query to api.playhq.com. Gives the answer's data; throws PlayhqError. */
  async function gql<T = unknown>(operationName: string, query: string, variables: Record<string, unknown> = {}, opts: { tenant?: string } = {}): Promise<T> {
    const forTenant = opts.tenant ?? tenant;
    if (options.answer) {
      const own = options.answer(operationName, variables);
      if (own !== undefined) return own as T;
    }
    const send = async (retried: boolean): Promise<T> => {
      const c = await getSession(retried);
      const headers: Record<string, string> = { ...headersBase, tenant: forTenant, 'request-id': requestId() };
      if (c) headers.cookie = c;
      const { res, text } = await post('api', apiUrl, headers, operationName, variables, JSON.stringify({ operationName, query, variables }), forTenant);
      if ((res.status === 401 || res.status === 403) && !retried && useSession) return send(true);
      if (!res.ok) {
        // A query PlayHQ doesn't accept (a field it doesn't have) comes back as HTTP 400 with GraphQL errors.
        let bad: { message: string }[] | null = null;
        try { bad = (JSON.parse(text) as { errors?: { message: string }[] }).errors ?? null; } catch { /* not JSON */ }
        if (bad && bad.length) {
          throw new PlayhqError(`PlayHQ answered HTTP ${res.status}: ${bad.map((e) => e.message).join('; ')}`, { status: res.status, graphql: bad });
        }
        throw new PlayhqError(`PlayHQ answered HTTP ${res.status}${/Request blocked/i.test(text) ? ' (temporarily blocked, will retry)' : ''}`, { status: res.status });
      }
      let json: { data?: T | null; errors?: { message: string }[] };
      try { json = JSON.parse(text); } catch { throw new PlayhqError('PlayHQ sent something that was not JSON', { status: res.status }); }
      const errors = json.errors ?? [];
      if (errors.length && !(options.allowPartial && json.data)) {
        throw new PlayhqError(errors.map((e) => e.message).join('; '), { status: res.status, graphql: errors });
      }
      if (json.data === undefined || json.data === null) throw new PlayhqError('PlayHQ sent nothing back', { status: res.status });
      options.onAnswer?.({ kind: 'api', operationName, variables, tenant: forTenant, data: json.data });
      return json.data;
    };
    return send(false);
  }

  /** The sport's short label for the live feed's tenant header ("na" for netball-australia). */
  async function getTenantLabel(): Promise<string> {
    if (tenantLabel) return tenantLabel;
    try {
      const data = await gql<{ tenantConfiguration?: { label?: string } | null }>('tenantLabel', Q_TENANT_LABEL, {});
      tenantLabel = data.tenantConfiguration?.label ?? '';
    } catch {
      // Fall back below.
    }
    if (!tenantLabel) tenantLabel = tenant === 'netball-australia' ? 'na' : tenant;
    return tenantLabel;
  }

  /**
   * The live feed's whole answer for one game ({ data } or { errors }), as spectator.playhq.com sends
   * it. parse it with api.live, which also turns "not electronically scored" into an error.
   */
  async function live(gameId: string, query: string): Promise<{ data?: { game?: unknown } | null; errors?: { message: string }[] }> {
    if (options.answer) {
      const own = options.answer('live', { id: gameId });
      if (own !== undefined) return own as { data?: { game?: unknown } };
    }
    const label = await getTenantLabel();
    const headers: Record<string, string> = { ...headersBase, 'x-phq-tenant': label };
    const c = await getSession();
    if (c) headers.cookie = c;
    const variables = { id: gameId };
    const { res, text } = await post('live', spectatorUrl, headers, 'game', variables, JSON.stringify({ operationName: 'game', query, variables }), label);
    if (!res.ok) throw new PlayhqError(`PlayHQ live feed answered HTTP ${res.status}`, { status: res.status });
    let json: { data?: { game?: unknown } | null; errors?: { message: string }[] };
    try { json = JSON.parse(text); } catch { throw new PlayhqError('PlayHQ live feed sent something that was not JSON', { status: res.status }); }
    options.onAnswer?.({ kind: 'live', operationName: 'game', variables, tenant: label, data: json });
    return json;
  }

  return {
    gql,
    live,
    getSession,
    getTenantLabel,
    tenant: () => tenant,
    /** Points at another sport; forgets the session and tenant label. */
    setTenant(next: string) {
      if (next !== tenant) {
        tenant = next;
        cookie = null;
        tenantLabel = '';
      }
    },
    /** Forgets the session and tenant label. */
    reset() {
      cookie = null;
      tenantLabel = '';
    },
  };
}
