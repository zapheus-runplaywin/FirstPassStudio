// FirstPass Studio - posting the Socials pictures, with their captions, to the competition's Facebook Page and the
// Instagram account linked to it: now, or at a time picked. Nothing is ever posted on its own: only when someone
// presses Post on the Socials tab, and a post held for later goes at its time or not at all.
//
// The connection: a Page access token from the club's own Meta app (the same kind of app as for live viewers,
// viewers.ts, with two more permissions: pages_manage_posts, and instagram_content_publish for Instagram; no review
// needed for the club's own Page). A user token works too: Studio swaps it for the Page's own token. It is kept in the
// Mac's Keychain, one for each competition (in posting.json in the local data folder when Studio runs outside the
// app: npm start, the tests), never with the competition, in a backup or iCloud, and never sent to a page. Only this
// Mac sets it (access.ts MAC_ONLY: /api/posting/account); a device allowed to change things may post with it.
//
// How each kind of post goes (Meta's Graph API, GRAPH):
//   Facebook, now          one picture: POST /{page}/photos; several: each uploaded unpublished, then POST /{page}/feed
//                          with attached_media (one post with them all)
//   Facebook, later        the same /feed post with published=false and scheduled_publish_time: Facebook holds it and
//                          posts it at the time (10 minutes to 30 days ahead), so the Mac needn't be on
//   Facebook Story         uploaded unpublished, then POST /{page}/photo_stories (one Story each)
//   Instagram              Instagram fetches each picture from a public link, so it is uploaded to the Page as an
//                          unpublished photo first and Instagram is given that photo's own link (nothing on the Mac is
//                          opened to the internet); then POST /{ig}/media (a carousel: one for each picture, then one
//                          for the carousel), POST /{ig}/media_publish, and the hidden photo is deleted again
// Meta's API can't schedule Instagram posts or any Story, so Studio holds those and posts them at their time: the Mac
// has to be on with Studio open. One that couldn't go within GRACE_MS of its time is Missed, with Post now; it never
// goes late on its own. The pictures are JPEGs (Instagram takes nothing else), made by the Mac app
// (socials.ts picturesForPost) and kept in posting/<post id>/ in the local folder until the post has gone.
//
// Routes (server.ts hands /api/posting here):
//   GET  /api/posting                 the competition's connection (the Page, the Instagram account, the token's last 4
//                                     characters) and its posts, newest first
//   POST /api/posting/account         { token, page? } checks a token and keeps it (page: which Page, when the token
//                                     reaches several); { remove: true } forgets it
//   POST /api/posting/post            { facebook, instagram, story, carousel, caption, at?, date, set, items: [{ name,
//                                     link, size }] }: one post (one picture, or a carousel of up to 20), or one
//                                     Story per picture; at (ms) for later. Answers the post.
//   POST /api/posting/posts/<id>      { cancel: true } | { at } a new time | { now: true } post it now (a Missed one too)

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import * as datadir from './datadir';
import * as savefile from './savefile';
import { errorMessage } from './errors';
import { obj, arr, str, num } from './check';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Body, Log, Send, ReadBody } from './types';

const GRAPH = process.env.FIRSTPASS_POSTING_API || 'https://graph.facebook.com/v27.0';
const FILE = datadir.local('posting.json');
const DIR = datadir.local('posting');
const KEYCHAIN = process.env.POSTING_KEYCHAIN ? process.env.POSTING_KEYCHAIN === '1' : (process.platform === 'darwin' && !!process.parentPort);
const KEYCHAIN_SERVICE = 'FirstPass Studio social posting';
const TIMEOUT_MS = 60 * 1000;
const MAX_ITEMS = 20;                       // Instagram's carousel, and Studio's own
const MAX_CAPTION = 2200;                   // Instagram's longest caption
const FB_SOONEST_MS = 10 * 60 * 1000;       // Facebook schedules 10 minutes to 30 days ahead
const LATEST_MS = 30 * 24 * 3600 * 1000;
const SOONEST_MS = 60 * 1000;               // a post Studio holds: at least a minute ahead
const GRACE_MS = 15 * 60 * 1000;            // a held post this late (the Mac was asleep, Studio was closed) is Missed
const TICK_MS = 20 * 1000;
const CHECK_EVERY_MS = 5 * 60 * 1000;       // a Facebook post past its time: asked whether it went, at most this often
const READY_TRIES = 15;                     // Instagram making a picture ready: asked once a second, this many times
const KEPT_DAYS = 30;                       // posts that have gone (or were cancelled) stay on the list this long

type Network = 'facebook' | 'instagram';
type State = 'scheduled' | 'waiting' | 'posting' | 'posted' | 'failed' | 'missed' | 'cancelled';
// Where a post is up to on one network: scheduled (Facebook holds it), waiting (Studio holds it), posting, posted
// (url: the post), failed (error), missed (its time passed with Studio closed) or cancelled. id: Meta's id for it.
interface Target { state: State; id?: string; url?: string; error?: string; at?: number; checked?: number }
interface Post {
  id: string; comp: string; made: number; at: number | null; caption: string; story: boolean;
  names: string[]; files: string[]; facebook?: Target; instagram?: Target;
}
interface Account { pageId: string; pageName: string; igId: string; igUsername: string; warning: string }
// posting.json. tokens only when the Keychain isn't used (npm start, the tests).
interface Saved { v: number; accounts: Record<string, Account>; tokens: Record<string, string>; posts: Post[] }

// A failure the person can act on, with the HTTP status the page gets.
class PostError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

// Meta's answer to a failed request, in words a club volunteer can act on.
function metaError(e: Body): PostError {
  const code = num(e.code), message = str(e.message) || 'something went wrong';
  if (code === 190) return new PostError('Facebook says the token no longer works (it expired or was changed). Make a new one and paste it on the Facebook and Instagram card, on this Mac.', 401);
  if (code === 10 || (code >= 200 && code < 300)) return new PostError(`Facebook says the token isn't allowed to do that. It needs pages_manage_posts (and instagram_content_publish for Instagram). Facebook said: ${message}`, 403);
  if ([4, 9, 17, 32, 613].includes(code)) return new PostError('Facebook says that\'s too many requests for now. Wait a few minutes and try again.', 429);
  return new PostError(`Facebook said: ${message}`, 502);
}
const masked = (key: string) => (key ? `••••${key.slice(-4)}` : '');

function create({ log, competition, render }: {
  log: Log;
  // The competition in use: its id (each has its own Page) and name.
  competition: () => { id: string; name: string } | null;
  // The pictures as JPEGs (socials.ts picturesForPost): their paths on this Mac, and any that couldn't be made.
  render: (body: Body, port: number) => Promise<{ files: string[]; skipped: { name: string; reason: string }[] }>;
}) {
  let saved = load();
  const tokenCache: Record<string, string> = {};
  let busy = false;

  function load(): Saved {
    const d = obj(savefile.readJson<unknown>(FILE, {}));
    const accounts: Saved['accounts'] = {};
    for (const [k, v] of Object.entries(obj(d.accounts))) {
      const a = obj(v);
      if (str(a.pageId)) accounts[k] = { pageId: str(a.pageId), pageName: str(a.pageName), igId: str(a.igId), igUsername: str(a.igUsername), warning: str(a.warning) };
    }
    const tokens: Saved['tokens'] = {};
    for (const [k, v] of Object.entries(obj(d.tokens))) if (str(v)) tokens[k] = str(v);
    const posts = arr(d.posts).map(obj).filter(p => str(p.id) && str(p.comp)).map((p): Post => ({
      id: str(p.id), comp: str(p.comp), made: num(p.made), at: typeof p.at === 'number' ? p.at : null, caption: str(p.caption), story: p.story === true,
      names: arr(p.names).map(str), files: arr(p.files).map(str), facebook: targetOf(p.facebook), instagram: targetOf(p.instagram),
    }));
    return { v: 1, accounts, tokens, posts };
  }
  function targetOf(v: unknown): Target | undefined {
    const t = obj(v);
    if (!str(t.state)) return undefined;
    // A post caught part way when Studio stopped can't be known to have gone: it says so rather than going again.
    const state = (str(t.state) === 'posting' ? 'failed' : str(t.state)) as State;
    return { state, id: str(t.id) || undefined, url: str(t.url) || undefined, at: num(t.at) || undefined,
      error: str(t.state) === 'posting' ? 'Studio stopped while this was posting: check the Page or Instagram before posting it again.' : str(t.error) || undefined };
  }
  const save = () => { try { savefile.writeJsonSync(FILE, saved); } catch (err) { log('error', 'posting', `Couldn't save posting.json: ${errorMessage(err)}`); } };

  // ─── The token ────────────────────────────────────────────────────────────
  const security = (args: string[]) => new Promise<string | null>(resolve => execFile('/usr/bin/security', args, { timeout: 10000 }, (err, out) => resolve(err ? null : String(out).trim())));
  async function readToken(comp: string): Promise<string> {
    if (!KEYCHAIN) return saved.tokens[comp] || '';
    if (tokenCache[comp] === undefined) tokenCache[comp] = (await security(['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', comp, '-w'])) || '';
    return tokenCache[comp] || '';
  }
  async function writeToken(comp: string, token: string): Promise<void> {
    if (!KEYCHAIN) { if (token) saved.tokens[comp] = token; else delete saved.tokens[comp]; save(); return; }
    if (!token) { await security(['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', comp]); tokenCache[comp] = ''; return; }
    if ((await security(['add-generic-password', '-U', '-s', KEYCHAIN_SERVICE, '-a', comp, '-w', token])) === null) {
      throw new PostError('The Mac\'s Keychain didn\'t take the token. Try again, and allow FirstPass Studio if the Mac asks.', 500);
    }
    tokenCache[comp] = token;
  }

  // ─── Meta's Graph API ─────────────────────────────────────────────────────
  // One request: GET with the fields in the path, POST and DELETE with a form (a file goes as a JPEG).
  async function graph(method: 'GET' | 'POST' | 'DELETE', where: string, token: string, form: Record<string, string | Buffer> = {}): Promise<Body> {
    const url = new URL(`${GRAPH}/${where}`);
    let body: FormData | undefined;
    if (method === 'GET' || method === 'DELETE') url.searchParams.set('access_token', token);
    else {
      body = new FormData();
      body.set('access_token', token);
      for (const [k, v] of Object.entries(form)) {
        if (typeof v === 'string') body.set(k, v);
        else body.set(k, new Blob([new Uint8Array(v)], { type: 'image/jpeg' }), 'picture.jpg');
      }
    }
    let res: Response;
    try { res = await fetch(url, { method, body, signal: AbortSignal.timeout(TIMEOUT_MS) }); }
    catch (err) { throw new PostError(`Couldn't reach Facebook: check this Mac's internet. (${errorMessage(err)})`, 502); }
    let d: Body;
    try { d = obj(await res.json()); } catch { d = {}; }
    if (!res.ok || d.error) throw metaError(obj(d.error));
    return d;
  }

  // ─── The connection ───────────────────────────────────────────────────────
  // A Page token answers for the Page itself; a user token lists the Pages it can post to, each with its own token.
  async function connect(comp: string, token: string, pageId: string) {
    if (!/^[\w-]{20,600}$/.test(token)) throw new PostError('That doesn\'t look like a Facebook access token. Copy it again from the Graph API Explorer.');
    const igField = 'instagram_business_account{id,username}';
    let page: Body, pageToken = token, warning = '';
    let pages: Body[] | null = null;
    try { pages = arr((await graph('GET', `me/accounts?fields=id,name,access_token,${igField}&limit=100`, token)).data).map(obj); }
    catch (err) { if (!(err instanceof PostError) || err.status === 401 || err.status === 429 || /couldn't reach/i.test(err.message)) throw err; }
    if (pages) {
      // A user token: its permissions, then the Page.
      const granted = new Set(arr((await graph('GET', 'me/permissions', token)).data).map(obj).filter(p => p.status === 'granted').map(p => str(p.permission)));
      if (!granted.has('pages_manage_posts')) throw new PostError('That token can\'t post to a Page: make it again with the pages_manage_posts permission ticked.');
      if (!pages.length) throw new PostError('That token doesn\'t reach any Facebook Page. Make it as an admin of the competition\'s Page.');
      const picked = pages.find(p => str(p.id) === pageId) || (pages.length === 1 ? pages[0] : null);
      if (!picked) return { pages: pages.map(p => ({ id: str(p.id), name: str(p.name) })) };
      page = picked; pageToken = str(picked.access_token) || token;
      if (obj(page.instagram_business_account).id && !granted.has('instagram_content_publish')) {
        warning = 'The token can post to Facebook only: make it again with instagram_content_publish ticked to post to Instagram too.';
      }
    } else {
      page = await graph('GET', `me?fields=id,name,${igField}`, token);
    }
    const ig = obj(page.instagram_business_account);
    const account: Account = { pageId: str(page.id), pageName: str(page.name), igId: warning ? '' : str(ig.id), igUsername: warning ? '' : str(ig.username), warning };
    if (!account.pageId) throw new PostError('Facebook didn\'t say which Page that token is for. Make a Page access token for the competition\'s Page.');
    if (!str(ig.id)) account.warning = 'No Instagram account is linked to this Page. Link the club\'s Instagram professional account to the Page (Page settings, Linked accounts) to post there too.';
    await writeToken(comp, pageToken);
    saved.accounts[comp] = account;
    save();
    log('info', 'posting', `Connected to ${account.pageName}${account.igUsername ? ` and @${account.igUsername}` : ''} (${masked(pageToken)})`);
    return status();
  }

  async function account(body: Body) {
    const c = competition();
    if (!c) throw new PostError('Pick a competition first.');
    if (body.remove === true) {
      await writeToken(c.id, '');
      delete saved.accounts[c.id];
      save();
      log('info', 'posting', `Facebook and Instagram disconnected for ${c.name}`);
      return status();
    }
    return connect(c.id, str(body.token).trim(), str(body.page));
  }

  // ─── Status ───────────────────────────────────────────────────────────────
  async function status() {
    const c = competition();
    if (!c) return { competition: null, account: null, posts: [] };
    const a = saved.accounts[c.id];
    const token = a ? await readToken(c.id) : '';
    return {
      competition: c.name,
      account: a && token ? { page: { id: a.pageId, name: a.pageName }, instagram: a.igId ? { id: a.igId, username: a.igUsername } : null, token: masked(token), warning: a.warning } : null,
      posts: saved.posts.filter(p => p.comp === c.id).sort((x, y) => (y.at || y.made) - (x.at || x.made)).map(view),
    };
  }
  const view = (p: Post) => ({ id: p.id, made: p.made, at: p.at, caption: p.caption, story: p.story, names: p.names, facebook: p.facebook, instagram: p.instagram });

  // ─── Posting ──────────────────────────────────────────────────────────────
  const fileBytes = (p: Post) => p.files.map(f => fs.readFileSync(path.join(DIR, p.id, f)));
  // A picture as a public link for Instagram: uploaded to the Page unpublished, then the photo's own biggest image.
  async function hosted(page: string, token: string, jpeg: Buffer): Promise<{ photo: string; url: string }> {
    const photo = str((await graph('POST', `${page}/photos`, token, { source: jpeg, published: 'false', temporary: 'true' })).id);
    const images = arr((await graph('GET', `${photo}?fields=images`, token)).images).map(obj).sort((a, b) => num(b.width) - num(a.width));
    const url = str(images[0]?.source);
    if (!url) throw new PostError('Facebook didn\'t give a link to the picture for Instagram. Try again.', 502);
    return { photo, url };
  }
  async function ready(container: string, token: string) {
    for (let i = 0; i < READY_TRIES; i++) {
      const s = str((await graph('GET', `${container}?fields=status_code`, token)).status_code);
      if (s === 'FINISHED' || s === '') return;
      if (s === 'ERROR' || s === 'EXPIRED') throw new PostError('Instagram couldn\'t take the picture. Check it is Square or Portrait (Story size goes as a Story), then try again.', 502);
      await new Promise(r => setTimeout(r, 1000));
    }
    throw new PostError('Instagram took too long to get the picture ready. Try again in a minute.', 504);
  }
  async function toInstagram(p: Post, a: Account, token: string): Promise<Target> {
    const limit = obj(arr((await graph('GET', `${a.igId}/content_publishing_limit?fields=quota_usage,config`, token)).data)[0]);
    const total = num(obj(limit.config).quota_total);
    if (total && num(limit.quota_usage) >= total) throw new PostError(`Instagram's limit of ${total} posts a day through apps is used up. Try again later, or post this one in the Instagram app.`, 429);
    const photos: string[] = [];
    try {
      const urls: string[] = [];
      for (const jpeg of fileBytes(p)) { const h = await hosted(a.pageId, token, jpeg); photos.push(h.photo); urls.push(h.url); }
      const published: string[] = [];
      if (p.story) {
        for (const url of urls) {
          const c = str((await graph('POST', `${a.igId}/media`, token, { image_url: url, media_type: 'STORIES' })).id);
          await ready(c, token);
          published.push(str((await graph('POST', `${a.igId}/media_publish`, token, { creation_id: c })).id));
        }
      } else {
        let container: string;
        if (urls.length === 1) container = str((await graph('POST', `${a.igId}/media`, token, { image_url: urls[0], caption: p.caption })).id);
        else {
          const children: string[] = [];
          for (const url of urls) children.push(str((await graph('POST', `${a.igId}/media`, token, { image_url: url, is_carousel_item: 'true' })).id));
          for (const c of children) await ready(c, token);
          container = str((await graph('POST', `${a.igId}/media`, token, { media_type: 'CAROUSEL', children: children.join(','), caption: p.caption })).id);
        }
        await ready(container, token);
        published.push(str((await graph('POST', `${a.igId}/media_publish`, token, { creation_id: container })).id));
      }
      let url = '';
      try { url = str((await graph('GET', `${published[0]}?fields=permalink`, token)).permalink); } catch { /* the post went; no link */ }
      return { state: 'posted', id: published.join(','), url: url || undefined, at: Date.now() };
    } finally {
      // Instagram has its own copy once it's published (or never will): the hidden photos on the Page go again.
      await Promise.allSettled(photos.map(photo => graph('DELETE', photo, token)));
    }
  }
  async function toFacebook(p: Post, a: Account, token: string, later: number | null): Promise<Target> {
    const bytes = fileBytes(p);
    if (p.story) {
      const ids: string[] = [];
      for (const jpeg of bytes) {
        const photo = str((await graph('POST', `${a.pageId}/photos`, token, { source: jpeg, published: 'false' })).id);
        ids.push(str((await graph('POST', `${a.pageId}/photo_stories`, token, { photo_id: photo })).post_id));
      }
      return { state: 'posted', id: ids.join(','), url: `https://www.facebook.com/${a.pageId}`, at: Date.now() };
    }
    if (bytes.length === 1 && !later) {
      const d = await graph('POST', `${a.pageId}/photos`, token, { source: bytes[0], message: p.caption, published: 'true' });
      const id = str(d.post_id) || str(d.id);
      return { state: 'posted', id, url: `https://www.facebook.com/${id}`, at: Date.now() };
    }
    const form: Record<string, string> = { message: p.caption };
    for (const [i, jpeg] of bytes.entries()) {
      const photo = str((await graph('POST', `${a.pageId}/photos`, token, { source: jpeg, published: 'false', ...(later ? { temporary: 'true' } : {}) })).id);
      form[`attached_media[${i}]`] = JSON.stringify({ media_fbid: photo });
    }
    if (later) { form.published = 'false'; form.scheduled_publish_time = String(Math.floor(later / 1000)); }
    const id = str((await graph('POST', `${a.pageId}/feed`, token, form)).id);
    return later ? { state: 'scheduled', id, at: later } : { state: 'posted', id, url: `https://www.facebook.com/${id}`, at: Date.now() };
  }
  // Posts (or, for Facebook with a time, hands to Facebook to hold) one network's part of a post now.
  async function send(p: Post, network: Network, later: number | null = null) {
    const a = saved.accounts[p.comp], token = await readToken(p.comp);
    const t = p[network];
    if (!t) return;
    if (!a || !token) { p[network] = { ...t, state: 'failed', error: 'Facebook and Instagram aren\'t connected any more: paste a token on the card, on this Mac.' }; return; }
    p[network] = { ...t, state: 'posting', error: undefined };
    save();
    try {
      p[network] = network === 'instagram' ? await toInstagram(p, a, token) : await toFacebook(p, a, token, later);
      log('info', 'posting', `${network === 'instagram' ? `Instagram @${a.igUsername}` : `Facebook ${a.pageName}`}: ${p[network]!.state} ${p.story ? 'Story' : 'post'} of ${p.names.join(', ')}`);
    } catch (err) {
      p[network] = { ...t, state: 'failed', error: errorMessage(err) };
      log('warn', 'posting', `${network}: couldn't post ${p.names.join(', ')}: ${errorMessage(err)}`);
    }
    tidy(p);
    save();
  }
  // The post's pictures go once nothing is left to post.
  function tidy(p: Post) {
    const open = (['facebook', 'instagram'] as Network[]).some(n => p[n] && ['scheduled', 'waiting', 'posting', 'missed', 'failed'].includes(p[n]!.state));
    if (!open) { try { fs.rmSync(path.join(DIR, p.id), { recursive: true, force: true }); } catch { /* gone already */ } p.files = []; }
  }

  async function post(body: Body, port: number) {
    const c = competition();
    if (!c) throw new PostError('Pick a competition first.');
    const a = saved.accounts[c.id];
    if (!a || !await readToken(c.id)) throw new PostError('Facebook and Instagram aren\'t connected yet: paste a Page access token on the Facebook and Instagram card, on this Mac.');
    const fb = body.facebook === true, ig = body.instagram === true, story = body.story === true;
    if (!fb && !ig) throw new PostError('Tick Facebook, Instagram or both.');
    if (ig && !a.igId) throw new PostError(a.warning || 'No Instagram account is connected.');
    const items = arr(body.items).map(obj);
    if (!items.length) throw new PostError('Tick a picture to post.');
    if (items.length > MAX_ITEMS) throw new PostError(`A post takes ${MAX_ITEMS} pictures at most: untick ${items.length - MAX_ITEMS}.`);
    const sizes = new Set(items.map(i => str(i.size)));
    if (story && [...sizes].some(s => s !== 'story')) throw new PostError('A Story is Story size: tick Story, and untick Square and Portrait.');
    if (!story && sizes.has('story')) throw new PostError('Story size goes as a Story: Instagram posts are Square or Portrait.');
    if (!story && items.length > 1 && body.carousel !== true) throw new PostError('Tick As a carousel to post several pictures together.');
    if (!story && sizes.size > 1) throw new PostError('A carousel is all one size: tick just one of Square or Portrait.');
    const caption = str(body.caption).trim().slice(0, MAX_CAPTION);
    const now = Date.now();
    const at = body.at === undefined || body.at === null ? null : num(body.at);
    if (at !== null) {
      const soonest = fb && !story ? FB_SOONEST_MS : SOONEST_MS;
      if (!(at >= now + soonest - 30000)) throw new PostError(`Pick a time at least ${soonest / 60000} minute${soonest === 60000 ? '' : 's'} from now${fb && !story ? ' (Facebook\'s soonest)' : ''}.`);
      if (at > now + LATEST_MS) throw new PostError('Pick a time within 30 days (Facebook\'s furthest).');
    }
    if (busy) throw new PostError('Already posting: wait for it to finish.', 429);
    busy = true;
    try {
      const made = await render({ date: body.date, set: body.set, carousel: !story && items.length > 1, items }, port);
      if (made.skipped.length) throw new PostError(`Couldn't make ${made.skipped.map(x => `${x.name}: ${x.reason}`).join(' · ')}. Nothing was posted.`);
      const id = crypto.randomUUID();
      fs.mkdirSync(path.join(DIR, id), { recursive: true });
      const files = made.files.map((f, i) => { const name = `${String(i + 1).padStart(2, '0')}.jpg`; fs.copyFileSync(f, path.join(DIR, id, name)); return name; });
      const p: Post = { id, comp: c.id, made: now, at, caption, story, names: items.map(i => str(i.name)), files };
      if (fb) p.facebook = { state: 'waiting', at: at || undefined };
      if (ig) p.instagram = { state: 'waiting', at: at || undefined };
      saved.posts.push(p);
      save();
      if (fb && (at === null || !story)) await send(p, 'facebook', at);
      if (ig && at === null) await send(p, 'instagram');
      return view(p);
    } finally { busy = false; }
  }

  async function change(id: string, body: Body) {
    const p = saved.posts.find(x => x.id === id && x.comp === competition()?.id);
    if (!p) throw new PostError('There is no such post.', 404);
    const nets = (['facebook', 'instagram'] as Network[]).filter(n => p[n]);
    const token = await readToken(p.comp);
    // A post Facebook holds is taken back first (it's put up again for a new time, or posted now).
    const takeBack = async (n: Network) => {
      const t = p[n]!;
      if (t.state === 'scheduled' && t.id) { try { await graph('DELETE', t.id, token); } catch (err) { throw new PostError(`Couldn't take the post back from Facebook: ${errorMessage(err)}`, 502); } }
    };
    if (body.cancel === true) {
      for (const n of nets) if (['scheduled', 'waiting', 'missed', 'failed'].includes(p[n]!.state)) { await takeBack(n); p[n] = { ...p[n]!, state: 'cancelled', id: undefined }; }
      tidy(p); save();
      log('info', 'posting', `Cancelled the post of ${p.names.join(', ')}`);
      return view(p);
    }
    if (busy) throw new PostError('Already posting: wait for it to finish.', 429);
    busy = true;
    try {
      if (body.now === true) {
        for (const n of nets) if (['scheduled', 'waiting', 'missed', 'failed'].includes(p[n]!.state)) { await takeBack(n); p[n] = { state: 'waiting' }; await send(p, n); }
        return view(p);
      }
      if (body.at !== undefined) {
        const at = num(body.at), now = Date.now();
        const fbHeld = p.facebook && !p.story && ['scheduled', 'waiting', 'missed', 'failed'].includes(p.facebook.state);
        const soonest = fbHeld ? FB_SOONEST_MS : SOONEST_MS;
        if (!(at >= now + soonest - 30000)) throw new PostError(`Pick a time at least ${soonest / 60000} minute${soonest === 60000 ? '' : 's'} from now.`);
        if (at > now + LATEST_MS) throw new PostError('Pick a time within 30 days.');
        p.at = at;
        for (const n of nets) {
          if (!['scheduled', 'waiting', 'missed', 'failed'].includes(p[n]!.state)) continue;
          await takeBack(n);
          p[n] = { state: 'waiting', at };
          if (n === 'facebook' && !p.story) await send(p, 'facebook', at);
        }
        save();
        return view(p);
      }
    } finally { busy = false; }
    throw new PostError('Cancel it, give it a new time, or post it now.');
  }

  // ─── The clock ────────────────────────────────────────────────────────────
  // Posts Studio holds go at their time (Missed when it's long past); posts Facebook holds are checked once past it.
  async function tick(now = Date.now()) {
    if (busy) return;
    for (const p of saved.posts) {
      for (const n of ['facebook', 'instagram'] as Network[]) {
        const t = p[n];
        if (!t || !p.at) continue;
        if (t.state === 'waiting' && p.at <= now) {
          if (now - p.at > GRACE_MS) { p[n] = { ...t, state: 'missed' }; save(); log('warn', 'posting', `Missed the ${n} post of ${p.names.join(', ')}: Studio wasn't open at its time`); continue; }
          busy = true;
          try { await send(p, n); } finally { busy = false; }
        } else if (t.state === 'scheduled' && t.id && p.at + 60000 <= now && (!t.checked || now - t.checked > CHECK_EVERY_MS)) {
          t.checked = now;
          try {
            const d = await graph('GET', `${t.id}?fields=is_published,permalink_url`, await readToken(p.comp));
            if (d.is_published === true) { p[n] = { state: 'posted', id: t.id, url: str(d.permalink_url) || `https://www.facebook.com/${t.id}`, at: p.at }; tidy(p); }
          } catch { /* asked again later */ }
          save();
        }
      }
    }
    // Gone (or cancelled) a while ago: off the list.
    const before = saved.posts.length;
    saved.posts = saved.posts.filter(p => p.files.length || now - (p.at || p.made) < KEPT_DAYS * 24 * 3600 * 1000);
    if (saved.posts.length !== before) save();
  }
  const timer = setInterval(() => { tick().catch(err => log('error', 'posting', errorMessage(err))); }, TICK_MS);
  timer.unref();

  async function route(req: IncomingMessage, res: ServerResponse, url: URL, { send: answer, readBody, port }: { send: Send; readBody: ReadBody; port: number }): Promise<boolean> {
    const p = url.pathname;
    try {
      if (p === '/api/posting' && req.method === 'GET') return answer(res, 200, await status()), true;
      if (p === '/api/posting/account' && req.method === 'POST') return answer(res, 200, await account(await readBody(req))), true;
      if (p === '/api/posting/post' && req.method === 'POST') return answer(res, 200, await post(await readBody(req), port)), true;
      const m = p.match(/^\/api\/posting\/posts\/([\w-]{1,60})$/);
      if (m && req.method === 'POST') return answer(res, 200, await change(m[1], await readBody(req))), true;
    } catch (err) {
      if (!(err instanceof PostError)) log('error', 'posting', errorMessage(err));
      return answer(res, err instanceof PostError ? err.status : 500, { error: errorMessage(err) }), true;
    }
    return false;
  }

  return { route, status, account, post, change, tick, stop: () => clearInterval(timer) };
}

export { create, GRAPH, GRACE_MS };
