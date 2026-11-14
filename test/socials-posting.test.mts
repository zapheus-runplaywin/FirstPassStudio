// The Facebook and Instagram card on the Socials tab (this Mac only): a token pasted, checked and kept, the Page and
// the Instagram account it reaches shown with only the token's last four characters, and Disconnect. Against the
// stand-in Meta (support/meta.mts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { startStudio } from './support/studio.mts';
import { openPage } from './support/browser.mts';
import { startMeta, TOKENS, PAGE, IG } from './support/meta.mts';

test('the Facebook and Instagram card connects the competition\'s Page and Instagram, and disconnects them', async t => {
  const meta = await startMeta();
  t.after(() => meta.close());
  const studio = await startStudio(t, { competition: 'Thunder League', env: { FIRSTPASS_POSTING_API: meta.base, POSTING_KEYCHAIN: '0' } });
  const page = await openPage(t, studio, '/socials.html');
  if (!page) return;
  await page.waitForFunction(() => document.getElementById('postSummary')!.textContent === 'not connected');
  await page.click('#postingCard summary');
  await page.fill('#postBody input[type=password]', TOKENS.expired);
  await page.click('#postBody button:text("Connect")');
  await page.waitForSelector('#postBody .error');
  assert.match((await page.textContent('#postBody .error'))!, /token no longer works/);

  await page.fill('#postBody input[type=password]', TOKENS.user);
  await page.click('#postBody button:text("Connect")');
  await page.waitForSelector('#postBody code');
  assert.equal(await page.textContent('#postBody code'), '••••PAGE');
  assert.equal(await page.textContent('#postSummary'), `${PAGE.name}, @${IG.username}`);
  assert.equal(await page.getAttribute(`#postBody a:text("@${IG.username}")`, 'href'), `https://www.instagram.com/${IG.username}/`);
  const html = await page.content();
  assert.ok(!html.includes(TOKENS.user) && !html.includes(TOKENS.page), 'no token on the page');

  await page.click('#postBody button:text("Disconnect")');
  await page.waitForFunction(() => document.getElementById('postSummary')!.textContent === 'not connected');
  assert.equal((await studio.get('/api/posting') as { account: unknown }).account, null);
  assert.deepEqual(page.errors, []);
});

test('Post… shows each post with its caption to check, then posts or schedules it; the Posts list can post a Missed one now', async t => {
  const meta = await startMeta();
  t.after(() => meta.close());
  const studio = await startStudio(t, { competition: 'Thunder League', env: { FIRSTPASS_POSTING_API: meta.base, POSTING_KEYCHAIN: '0' } });
  await studio.post('/api/posting/account', { token: TOKENS.page });
  const page = await openPage(t, studio, '/socials.html');
  if (!page) return;
  // As if the Mac app were there to make the pictures; what's posted is caught here (posting itself: posting.test.mts).
  const sent: Record<string, unknown>[] = [];
  const changed: Record<string, unknown>[] = [];
  const missed = { id: 'm1', made: Date.now() - 7200000, at: Date.now() - 3600000, caption: 'x', story: false, names: ['Results'], instagram: { state: 'missed' } };
  await page.route(url => new URL(url).pathname === '/api/socials', async route => {
    try { const r = await route.fetch(); await route.fulfill({ response: r, json: { ...await r.json(), app: true } }); } catch { await route.abort().catch(() => {}); }
  });
  // (A read still on its way when the test ends finds Studio gone: let it go.)
  await page.route(url => new URL(url).pathname === '/api/posting', async route => {
    try { const r = await route.fetch(); await route.fulfill({ response: r, json: { ...await r.json(), posts: [missed] } }); } catch { await route.abort().catch(() => {}); }
  });
  await page.route(url => new URL(url).pathname === '/api/posting/post', route => {
    const body = JSON.parse(route.request().postData()!);
    sent.push(body);
    route.fulfill({ json: { id: `p${sent.length}`, made: Date.now(), at: body.at, caption: body.caption, story: body.story, names: body.items.map((i: { name: string }) => i.name),
      facebook: { state: body.at ? 'scheduled' : 'posted' }, instagram: { state: body.at ? 'waiting' : 'posted' } } });
  });
  await page.route(url => new URL(url).pathname.startsWith('/api/posting/posts/'), route => { changed.push({ path: new URL(route.request().url()).pathname, ...JSON.parse(route.request().postData()!) }); route.fulfill({ json: {} }); });
  await page.reload();
  await page.waitForSelector('.pic[data-key] .caption');
  await page.waitForSelector('#postBtn:not([hidden])');

  // One picture, with its caption: posted now to both.
  await page.click('#none');
  const card = page.locator('.pic[data-key]').first();
  const name = await card.locator('h3').textContent();
  await card.locator('.pic__ticks input').first().check();
  await card.locator('.caption summary').click();
  await card.locator('.caption textarea').fill('Big night! #ThunderLeague');
  await page.click('#postBtn');
  await page.waitForSelector('#postBox[open]');
  assert.equal(await page.inputValue('#postBox textarea'), 'Big night! #ThunderLeague');
  assert.match((await page.textContent('#postBox .help:not(:empty), #postBox p'))!, /1 post to Facebook and Instagram, now/);
  await page.click('#postBox button:text("Post")');
  await page.waitForSelector('#postBox', { state: 'hidden' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].facebook, true);
  assert.equal(sent[0].instagram, true);
  assert.equal(sent[0].caption, 'Big night! #ThunderLeague');
  assert.equal(sent[0].at, null);
  assert.deepEqual((sent[0].items as { name: string; size: string }[]).map(i => [i.name, i.size]), [[name, 'square']]);

  // Later, with Facebook's 10 minutes checked first.
  await page.click('#postBtn');
  await page.waitForSelector('#postBox[open]');
  const soon = new Date(Date.now() + 5 * 60000);
  const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  await page.fill('#postBox input[type=datetime-local]', local(soon));
  assert.match((await page.textContent('#postBox .warn'))!, /10 minutes ahead/);
  assert.equal(await page.isDisabled('#postBox button:text("Schedule")'), true);
  const later = new Date(Date.now() + 3 * 3600000);
  await page.fill('#postBox input[type=datetime-local]', local(later));
  assert.match((await page.textContent('#postBox p.help'))!, /leave this Mac on with Studio open/);
  await page.click('#postBox button:text("Schedule")');
  await page.waitForSelector('#postBox', { state: 'hidden' });
  assert.ok(Math.abs((sent[1].at as number) - Math.floor(later.getTime() / 60000) * 60000) < 60000);

  // The Posts list (opened once something is posted): a Missed one, posted now.
  assert.equal(await page.getAttribute('#postsCard', 'open'), '');
  await page.waitForSelector('#postsBody .chip.missed');
  assert.equal(await page.textContent('#postsBody .chip.missed'), 'Instagram: Missed');
  await page.click('#postsBody button:text("Post now")');
  await page.waitForFunction(() => document.querySelector('#postsBody button') !== null);
  for (let i = 0; i < 50 && !changed.length; i++) await new Promise(r => setTimeout(r, 100));
  assert.deepEqual(changed[0], { path: '/api/posting/posts/m1', now: true });
  assert.deepEqual(page.errors, []);
});
