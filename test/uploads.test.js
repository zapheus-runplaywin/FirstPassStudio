// Files people add (uploads.js): served as plain files with headers that stop a browser running one as a
// page of Studio's, refused when an image's bytes don't match its name, and browser sources only point
// at http(s) pages.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const uploads = require('../uploads');
const { startStudio } = require('./support/studio');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const SVG = Buffer.from('<?xml version="1.0"?>\n<!-- a logo -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>');
const HTML_AS_SVG = Buffer.from('<html><body><script>fetch("/deck/home/add2")</script></body></html>');

test('looksLikeImage: the first bytes match the name', () => {
  assert.equal(uploads.looksLikeImage('a.png', PNG), true);
  assert.equal(uploads.looksLikeImage('a.PNG', PNG), true);
  assert.equal(uploads.looksLikeImage('a.jpg', PNG), false);
  assert.equal(uploads.looksLikeImage('a.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), true);
  assert.equal(uploads.looksLikeImage('a.gif', Buffer.from('GIF89a......')), true);
  assert.equal(uploads.looksLikeImage('a.gif', Buffer.from('GIF99a......')), false);
  assert.equal(uploads.looksLikeImage('a.webp', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')])), true);
  assert.equal(uploads.looksLikeImage('a.webp', PNG), false);
  assert.equal(uploads.looksLikeImage('a.svg', SVG), true);
  assert.equal(uploads.looksLikeImage('a.svg', Buffer.from('﻿<svg></svg>')), true);
  assert.equal(uploads.looksLikeImage('a.svg', HTML_AS_SVG), false, 'an HTML page named .svg');
  assert.equal(uploads.looksLikeImage('a.svg', PNG), false);
  assert.equal(uploads.looksLikeImage('a.woff2', Buffer.from('anything')), true, 'only images are checked here');
  assert.throws(() => uploads.checkImage('logo.png', Buffer.from('<html>')), /isn't a PNG file inside/);
});

test('cleanUrl: Studio pages and http(s) pages only', () => {
  const { cleanUrl } = require('../scene');
  assert.equal(cleanUrl('scoreboard.html?position=top'), 'scoreboard.html?position=top');
  assert.equal(cleanUrl('/ladder.html'), 'ladder.html');
  assert.equal(cleanUrl('http://localhost:8080/ladder.html'), 'ladder.html');
  assert.equal(cleanUrl('https://example.com/widget'), 'https://example.com/widget');
  assert.equal(cleanUrl('javascript:alert(1)'), '');
  assert.equal(cleanUrl('JavaScript:javascript:alert(1)'), '');
  assert.equal(cleanUrl('data:text/html,<script>1</script>'), '');
  assert.equal(cleanUrl('file:///etc/passwd'), '');
  assert.equal(cleanUrl('//evil.example/x'), '');
  assert.equal(cleanUrl(''), '');
});

test('added files are served as plain files, and a wrong image is refused', async t => {
  const studio = await startStudio(t, { competition: 'Thunder League' });
  const id = studio.competition.id;
  const headers = async p => { const r = await fetch(studio.base + p); return { status: r.status, csp: r.headers.get('content-security-policy'), sniff: r.headers.get('x-content-type-options'), type: r.headers.get('content-type') }; };
  // A competition logo, a sponsor logo and a media file all come back with the guards on.
  let r = await studio.request('POST', `/api/setup/${id}/image?kind=logos&name=Knights.svg`, SVG, { 'content-type': 'application/octet-stream' });
  assert.equal(r.status, 200, r.text);
  let h = await headers('/logos/Knights.svg');
  assert.equal(h.status, 200);
  assert.equal(h.csp, "sandbox; default-src 'none'");
  assert.equal(h.sniff, 'nosniff');
  assert.equal(h.type, 'image/svg+xml');
  fs.mkdirSync(path.join(studio.dataDir, 'media'), { recursive: true });
  fs.writeFileSync(path.join(studio.dataDir, 'media', 'Clip.png'), PNG);
  h = await headers('/media/Clip.png');
  assert.equal(h.status, 200);
  assert.equal(h.csp, "sandbox; default-src 'none'");
  assert.equal(h.sniff, 'nosniff');
  const sponsor = await studio.post('/api/sponsors', { name: 'Corner Cafe', competitions: { [id]: { tier: 'gold' } } });
  const sid = (sponsor.sponsors || []).find(s => s.name === 'Corner Cafe').id;
  r = await studio.request('POST', `/api/sponsors/logo?id=${sid}&which=logo&name=cafe.png`, PNG);
  assert.equal(r.status, 200, r.text);
  h = await headers(`/sponsors/${sid}/cafe.png`);
  assert.equal(h.status, 200);
  assert.equal(h.csp, "sandbox; default-src 'none'");
  // Studio's own pages are not touched.
  h = await headers('/scoreboard.html');
  assert.equal(h.csp, null);
  // An HTML page named .svg is refused wherever images are added.
  r = await studio.request('POST', `/api/setup/${id}/image?kind=logos&name=Evil.svg`, HTML_AS_SVG, { 'content-type': 'application/octet-stream' });
  assert.equal(r.status, 400);
  assert.match(r.text, /isn't a SVG file inside/);
  assert.equal((await headers('/logos/Evil.svg')).status, 404);
  r = await studio.request('POST', `/api/sponsors/logo?id=${sid}&which=logo&name=evil.png`, HTML_AS_SVG);
  assert.equal(r.status, 400);
  r = await studio.request('POST', '/api/scene/media?name=Evil.png', HTML_AS_SVG, { 'content-type': 'application/octet-stream' });
  assert.equal(r.status, 400);
  assert.equal(fs.existsSync(path.join(studio.dataDir, 'media', 'Evil.png')), false, 'nothing left behind');
  r = await studio.request('POST', '/api/scene/media?name=Good.png', PNG, { 'content-type': 'application/octet-stream' });
  assert.equal(r.status, 200, r.text);
  // A browser source can't point at javascript:.
  const sc = await studio.post('/api/scene', { type: 'add', sources: [{ type: 'browser', name: 'Bad', url: 'javascript:alert(1)' }] });
  assert.equal(sc.sources.find(s => s.name === 'Bad').url, 'scoreboard.html');
});

test('two uploads of the same media name at once both finish, and the helper keeps running', async t => {
  const studio = await startStudio(t);
  const http = require('node:http');
  // Each upload sends its bytes in pieces, so both are still writing when the first one finishes.
  const upload = () => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: studio.port, method: 'POST', path: '/api/scene/media?name=Race.png',
      headers: { 'content-type': 'application/octet-stream' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.write(PNG);
    let n = 0;
    const more = () => { if (n++ < 5) { req.write(Buffer.alloc(256 * 1024)); setTimeout(more, 60); } else req.end(); };
    more();
  });
  const codes = await Promise.all([upload(), upload()]);
  assert.deepEqual(codes, [200, 200]);
  assert.equal(studio.exited(), null, 'the helper is still running');
  assert.equal((await studio.request('GET', '/api/health')).status, 200);
  const left = fs.readdirSync(path.join(studio.dataDir, 'media')).filter(f => f.endsWith('.part'));
  assert.deepEqual(left, [], 'no part files left behind');
});
