// Posting the Socials pictures to Facebook and Instagram (posting.ts), against a stand-in for Meta's Graph API
// (support/meta.mts): the token checked and kept on this Mac, a post now to both, a carousel for later (Facebook holds
// it, Studio posts Instagram's part at its time), Stories, a Missed post and Post now, cancelling, the rules a post
// must meet, Instagram's daily limit, and a post caught part way when Studio stopped.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startMeta, TOKENS, PAGE, IG } from './support/meta.mts';

const require = createRequire(import.meta.url);
const meta = await startMeta();
const local = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-posting-'));
process.env.FIRSTPASS_LOCAL_DIR = local;
process.env.FIRSTPASS_DATA_DIR = local;
process.env.FIRSTPASS_POSTING_API = meta.base;
process.env.POSTING_KEYCHAIN = '0';
const posting: typeof import('../out/posting.js') = require('../out/posting.js');
const datalocation: typeof import('../out/datalocation.js') = require('../out/datalocation.js');
const access: typeof import('../out/access.js') = require('../out/access.js');
test.after(() => meta.close());

const HOUR = 3600 * 1000;
type Studio = ReturnType<typeof posting.create>;
// A Studio's posting, with pictures "made" as small files (the Mac app makes real JPEGs: test/app.test.mts).
function setUp(t: import('node:test').TestContext, comp = 'thunder') {
  const rendered: Record<string, unknown>[] = [];
  const logs: string[] = [];
  const studio: Studio = posting.create({
    log: (level, source, message) => { logs.push(`${level} ${message}`); },
    competition: () => ({ id: comp, name: 'Thunder League' }),
    render: async body => {
      rendered.push(body);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-pictures-'));
      const items = body.items as { name: string }[];
      return { files: items.map((it, i) => { const f = path.join(dir, `${i + 1} ${it.name}.jpg`); fs.writeFileSync(f, Buffer.alloc(100 + i, 0xff)); return f; }), skipped: [] };
    },
  });
  t.after(() => studio.stop());
  meta.calls.length = 0;
  return { studio, rendered, logs };
}
const item = (name: string, size = 'square') => ({ name, link: `/social.html?kind=results&size=${size}`, size });
const fails = async (p: Promise<unknown>, re: RegExp) => { await assert.rejects(p, (err: Error) => { assert.match(err.message, re); return true; }); };
const called = (method: string, p: string) => meta.calls.filter(c => c.method === method && c.path === p);

test('a token is checked, swapped for the Page\'s own, kept on this Mac only, and never shown again', async t => {
  const { studio } = setUp(t);
  assert.equal((await studio.status()).account, null);
  await fails(studio.account({ token: 'nope' }), /doesn't look like a Facebook access token/);
  await fails(studio.account({ token: TOKENS.expired }), /token no longer works/);
  await fails(studio.account({ token: TOKENS.noPosting }), /pages_manage_posts/);

  const s = await studio.account({ token: TOKENS.user }) as Awaited<ReturnType<Studio['status']>>;
  assert.deepEqual(s.account, { page: PAGE, instagram: IG, token: '••••PAGE', warning: '' });
  assert.ok(!JSON.stringify(s).includes(TOKENS.page) && !JSON.stringify(s).includes(TOKENS.user), 'no token comes back');
  // Kept in the local folder (the Keychain on a Mac), which stays on this Mac.
  const kept = fs.readFileSync(path.join(local, 'posting.json'), 'utf8');
  assert.ok(kept.includes(TOKENS.page) && !kept.includes(TOKENS.user), 'the Page\'s own token is kept, not the person\'s');
  assert.ok(datalocation.LOCAL_ONLY.has('posting.json') && datalocation.LOCAL_ONLY.has('posting'), 'never synced or backed up');
  assert.match(access.notThisMac('POST', '/api/posting/account', '192.168.1.50', new Set(['127.0.0.1']))!, /only be seen and changed on the Mac/);
  assert.equal(access.notThisMac('POST', '/api/posting/post', '192.168.1.50', new Set(['127.0.0.1'])), null, 'an allowed phone may post');

  // A Page token works as it is.
  const again = await studio.account({ token: TOKENS.page }) as Awaited<ReturnType<Studio['status']>>;
  assert.equal(again.account!.page.name, PAGE.name);
  await studio.account({ remove: true });
  assert.equal((await studio.status()).account, null);
});

test('a picture posts now to Facebook and Instagram, through a hidden Page photo for Instagram', async t => {
  const { studio, rendered } = setUp(t);
  await studio.account({ token: TOKENS.user });
  meta.calls.length = 0;
  const p = await studio.post({ facebook: true, instagram: true, caption: 'What a night! #ThunderLeague', date: '2026-11-13', set: 'results', items: [item('Results')] }, 8080);
  assert.equal(rendered[0].carousel, false);
  assert.equal(p.facebook!.state, 'posted');
  assert.match(p.facebook!.url!, /^https:\/\/www\.facebook\.com\/1001_photo\d+$/);
  assert.equal(p.instagram!.state, 'posted');
  assert.match(p.instagram!.url!, /^https:\/\/www\.instagram\.com\/p\/igmedia\d+\/$/);

  const fb = called('POST', `${PAGE.id}/photos`);
  assert.deepEqual(fb[0].form, { access_token: TOKENS.page, source: '<file 100 bytes>', message: 'What a night! #ThunderLeague', published: 'true' });
  assert.deepEqual(fb[1].form, { access_token: TOKENS.page, source: '<file 100 bytes>', published: 'false', temporary: 'true' }, 'the hidden photo for Instagram');
  const media = called('POST', `${IG.id}/media`);
  assert.equal(media.length, 1);
  assert.match(media[0].form.image_url, /^https:\/\/cdn\.example\/photo\d+\.jpg$/, 'the biggest image');
  assert.equal(media[0].form.caption, 'What a night! #ThunderLeague');
  assert.equal(called('POST', `${IG.id}/media_publish`).length, 1);
  assert.equal(meta.calls.filter(c => c.method === 'DELETE').length, 1, 'the hidden photo goes again');
  assert.equal(called('GET', `${IG.id}/content_publishing_limit`).length, 1, 'the daily limit checked first');
  assert.ok(!fs.existsSync(path.join(local, 'posting', p.id)), 'its pictures go once it has gone');
});

test('a carousel for later: Facebook holds it, Studio posts Instagram\'s part at its time; and it can be cancelled', async t => {
  const { studio, rendered } = setUp(t);
  await studio.account({ token: TOKENS.page });
  meta.calls.length = 0;
  meta.state.published = false;
  const at = Date.now() + 2 * HOUR;
  const p = await studio.post({ facebook: true, instagram: true, carousel: true, caption: 'Round 4', at, items: [item('Results', 'portrait'), item('Ladder', 'portrait')] }, 8080);
  assert.equal(rendered[0].carousel, true);
  assert.equal(p.facebook!.state, 'scheduled');
  assert.equal(p.instagram!.state, 'waiting');
  const feed = called('POST', `${PAGE.id}/feed`)[0].form;
  assert.equal(feed.published, 'false');
  assert.equal(feed.scheduled_publish_time, String(Math.floor(at / 1000)));
  assert.equal(JSON.parse(feed['attached_media[0]']).media_fbid.startsWith('photo'), true);
  assert.ok(feed['attached_media[1]']);
  assert.equal(called('POST', `${PAGE.id}/photos`).every(c => c.form.temporary === 'true'), true);
  assert.equal(called('POST', `${IG.id}/media`).length, 0, 'nothing on Instagram yet');

  // At its time: Instagram's carousel goes; once Facebook says it went, Facebook's part is posted too.
  await studio.tick(at + 1000);
  const media = called('POST', `${IG.id}/media`);
  assert.deepEqual(media.slice(0, 2).map(c => c.form.is_carousel_item), ['true', 'true']);
  assert.equal(media[2].form.media_type, 'CAROUSEL');
  assert.equal(media[2].form.children.split(',').length, 2);
  assert.equal(media[2].form.caption, 'Round 4');
  meta.state.published = true;
  await studio.tick(at + 2 * 60000);
  const after = (await studio.status()).posts.find(x => x.id === p.id)!;
  assert.equal(after.instagram!.state, 'posted');
  assert.equal(after.facebook!.state, 'posted');

  // Another for later, cancelled: Facebook's is taken back.
  const q = await studio.post({ facebook: true, instagram: true, caption: 'Next week', at, items: [item('Fixture')] }, 8080);
  meta.calls.length = 0;
  const c = await studio.change(q.id, { cancel: true });
  assert.equal(c.facebook!.state, 'cancelled');
  assert.equal(c.instagram!.state, 'cancelled');
  assert.equal(meta.calls.filter(x => x.method === 'DELETE').length, 1);
  await studio.tick(at + 1000);
  assert.equal(called('POST', `${IG.id}/media`).length, 0, 'a cancelled post never goes');
});

test('a held post whose time passed with Studio closed is Missed, never posted late on its own; Post now sends it', async t => {
  const { studio } = setUp(t);
  await studio.account({ token: TOKENS.page });
  const at = Date.now() + HOUR;
  const p = await studio.post({ instagram: true, caption: 'Late', at, items: [item('Results')] }, 8080);
  meta.calls.length = 0;
  await studio.tick(at + posting.GRACE_MS + 1000);
  assert.equal((await studio.status()).posts.find(x => x.id === p.id)!.instagram!.state, 'missed');
  assert.equal(called('POST', `${IG.id}/media`).length, 0);
  const now = await studio.change(p.id, { now: true });
  assert.equal(now.instagram!.state, 'posted');

  // A new time for one held: it goes then.
  const q = await studio.post({ instagram: true, caption: 'Moved', at, items: [item('Ladder')] }, 8080);
  const moved = await studio.change(q.id, { at: at + HOUR });
  assert.equal(moved.at, at + HOUR);
  meta.calls.length = 0;
  await studio.tick(at + 1000);
  assert.equal(called('POST', `${IG.id}/media`).length, 0, 'not at the old time');
  await studio.tick(at + HOUR + 1000);
  assert.equal(called('POST', `${IG.id}/media`).length, 1);
});

test('Story size posts as Stories, one each, without a caption', async t => {
  const { studio } = setUp(t);
  await studio.account({ token: TOKENS.page });
  meta.calls.length = 0;
  const p = await studio.post({ facebook: true, instagram: true, story: true, caption: 'not shown', items: [item('Results', 'story'), item('Ladder', 'story')] }, 8080);
  assert.equal(p.facebook!.state, 'posted');
  assert.equal(p.instagram!.state, 'posted');
  assert.equal(called('POST', `${PAGE.id}/photo_stories`).length, 2);
  const media = called('POST', `${IG.id}/media`);
  assert.deepEqual(media.map(c => c.form.media_type), ['STORIES', 'STORIES']);
  assert.ok(media.every(c => !c.form.caption));
  assert.equal(called('POST', `${IG.id}/media_publish`).length, 2);
});

test('a post must fit what Facebook and Instagram take', async t => {
  const { studio } = setUp(t, 'other');
  const one = [item('Results')];
  await fails(studio.post({ facebook: true, items: one }, 8080), /aren't connected yet/);
  await studio.account({ token: TOKENS.page });
  const now = Date.now();
  await fails(studio.post({ items: one }, 8080), /Tick Facebook, Instagram or both/);
  await fails(studio.post({ facebook: true, items: [] }, 8080), /Tick a picture/);
  await fails(studio.post({ instagram: true, items: [item('Results', 'story')] }, 8080), /Story size goes as a Story/);
  await fails(studio.post({ instagram: true, story: true, items: one }, 8080), /A Story is Story size/);
  await fails(studio.post({ facebook: true, items: [item('A'), item('B')] }, 8080), /Tick As a carousel/);
  await fails(studio.post({ facebook: true, carousel: true, items: [item('A'), item('B', 'portrait')] }, 8080), /all one size/);
  await fails(studio.post({ facebook: true, carousel: true, items: Array.from({ length: 21 }, (_, i) => item(`P${i}`)) }, 8080), /20 pictures at most/);
  await fails(studio.post({ facebook: true, at: now + 5 * 60000, items: one }, 8080), /at least 10 minutes.*Facebook's soonest/);
  await fails(studio.post({ instagram: true, at: now + 31 * 24 * HOUR, items: one }, 8080), /within 30 days/);
  const ok = await studio.post({ instagram: true, at: now + 5 * 60000, items: one }, 8080);
  assert.equal(ok.instagram!.state, 'waiting', 'Instagram alone can go sooner: Studio holds it');
});

test('Instagram\'s daily limit and Meta\'s refusals say what to do; a post caught part way is never posted twice', async t => {
  const { studio } = setUp(t);
  await studio.account({ token: TOKENS.page });
  meta.state.quotaUsed = 100;
  const p = await studio.post({ instagram: true, caption: 'x', items: [item('Results')] }, 8080);
  assert.equal(p.instagram!.state, 'failed');
  assert.match(p.instagram!.error!, /limit of 100 posts a day/);
  meta.state.quotaUsed = 0;
  meta.state.status = 'ERROR';
  const q = await studio.post({ instagram: true, caption: 'x', items: [item('Results')] }, 8080);
  assert.match(q.instagram!.error!, /couldn't take the picture/);
  meta.state.status = 'FINISHED';
  // Failed ones keep their pictures, to try again with Post now.
  assert.ok(fs.existsSync(path.join(local, 'posting', q.id)));
  assert.equal((await studio.change(q.id, { now: true })).instagram!.state, 'posted');

  // Studio stopped while posting: the post says so rather than going again.
  const file = path.join(local, 'posting.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  saved.posts.push({ id: 'stuck', comp: 'thunder', made: Date.now(), at: null, caption: 'x', story: false, names: ['Results'], files: ['01.jpg'], instagram: { state: 'posting' } });
  fs.writeFileSync(file, JSON.stringify(saved));
  const { studio: next } = setUp(t);
  const stuck = (await next.status()).posts.find(x => x.id === 'stuck')!;
  assert.equal(stuck.instagram!.state, 'failed');
  assert.match(stuck.instagram!.error!, /stopped while this was posting/);
});
