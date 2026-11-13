// A stand-in for Meta's Graph API as posting.ts uses it: a user token that reaches one Page (with its own Page token and
// a linked Instagram account), the Page's photos, posts and Stories, and Instagram's containers, publishing and daily
// limit. Records every request (method, path, query and form fields; a file shows as its size), so no test ever posts
// to a real Page.
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export const TOKENS = {
  user: 'EAAuser0123456789abcdefghijklmnopqrstuvwxyzUSER',
  page: 'EAApage0123456789abcdefghijklmnopqrstuvwxyzPAGE',
  noPosting: 'EAAweak0123456789abcdefghijklmnopqrstuvwxyzWEAK',
  expired: 'EAAold00123456789abcdefghijklmnopqrstuvwxyzOLD0',
};
export const PAGE = { id: '1001', name: 'Thunder League Netball' };
export const IG = { id: '17841400000000001', username: 'thunderleague' };

export interface Call { method: string; path: string; query: Record<string, string>; form: Record<string, string> }

export async function startMeta() {
  const calls: Call[] = [];
  const state = { published: false, quotaUsed: 0, quotaTotal: 100, status: 'FINISHED', n: 0 };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      const url = new URL(req.url || '/', 'http://x');
      const query = Object.fromEntries(url.searchParams);
      const form: Record<string, string> = {};
      if (req.method === 'POST') {
        const fd = await new Response(Buffer.concat(chunks), { headers: { 'content-type': String(req.headers['content-type']) } }).formData();
        for (const [k, v] of fd) form[k] = typeof v === 'string' ? v : `<file ${v.size} bytes>`;
      }
      const p = url.pathname.replace(/^\/graph\//, '');
      const token = query.access_token || form.access_token;
      calls.push({ method: req.method || '', path: p, query, form });
      const json = (code: number, v: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
      const fail = (code: number, message: string, status = 400) => json(status, { error: { message, type: 'OAuthException', code } });
      const id = (prefix: string) => `${prefix}${++state.n}`;
      if (token === TOKENS.expired) return fail(190, 'Error validating access token: Session has expired.');
      if (![TOKENS.user, TOKENS.page, TOKENS.noPosting].includes(token)) return fail(190, 'Invalid OAuth access token.');
      const isUser = token !== TOKENS.page;
      const igField = { instagram_business_account: { id: IG.id, username: IG.username } };
      if (p === 'me/accounts') return isUser ? json(200, { data: [{ ...PAGE, access_token: TOKENS.page, ...igField }] }) : fail(100, 'Tried accessing nonexisting field (accounts) on node type (Page)');
      if (p === 'me/permissions') {
        const granted = token === TOKENS.noPosting ? ['pages_show_list'] : ['pages_show_list', 'pages_manage_posts', 'pages_read_engagement', 'instagram_basic', 'instagram_content_publish'];
        return json(200, { data: granted.map(permission => ({ permission, status: 'granted' })) });
      }
      if (p === 'me') return json(200, { ...PAGE, ...igField });
      if (token !== TOKENS.page) return fail(200, 'Posting needs a Page access token.', 403);
      if (p === `${PAGE.id}/photos` && req.method === 'POST') {
        const photo = id('photo');
        return json(200, form.published === 'true' ? { id: photo, post_id: `${PAGE.id}_${photo}` } : { id: photo });
      }
      if (p === `${PAGE.id}/feed`) return json(200, { id: `${PAGE.id}_${id('feed')}` });
      if (p === `${PAGE.id}/photo_stories`) return json(200, { success: true, post_id: id('story') });
      if (p === `${IG.id}/content_publishing_limit`) return json(200, { data: [{ quota_usage: state.quotaUsed, config: { quota_total: state.quotaTotal, quota_duration: 86400 } }] });
      if (p === `${IG.id}/media`) return json(200, { id: id('container') });
      if (p === `${IG.id}/media_publish`) { state.quotaUsed++; return json(200, { id: id('igmedia') }); }
      if (req.method === 'DELETE') return json(200, { success: true });
      if (/^photo\d+$/.test(p) && query.fields === 'images') return json(200, { images: [{ width: 720, source: `https://cdn.example/${p}-720.jpg` }, { width: 1080, source: `https://cdn.example/${p}.jpg` }] });
      if (/^container\d+$/.test(p)) return json(200, { status_code: state.status });
      if (/^igmedia\d+$/.test(p)) return json(200, { permalink: `https://www.instagram.com/p/${p}/` });
      if (/_feed\d+$/.test(p)) return json(200, state.published ? { is_published: true, permalink_url: `https://www.facebook.com/${p}` } : { is_published: false });
      fail(100, `stand-in has no ${req.method} ${p}`);
    });
  });
  return new Promise<{ base: string; calls: Call[]; state: typeof state; close: () => Promise<void> }>(resolve => server.listen(0, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/graph`;
    resolve({ base, calls, state, close: () => new Promise<void>(r => { server.closeAllConnections(); server.close(() => r()); }) });
  }));
}
