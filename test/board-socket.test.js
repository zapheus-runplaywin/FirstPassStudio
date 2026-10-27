// The scoreboard over the scene socket (review decision D11): a page that asks for it gets the board at once
// and again whenever it changes, so the scoreboard, the control page, the goals and the countdown don't poll.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStudio, wait } = require('./support/studio');

let studio;
test.before(async () => { studio = await startStudio(null, { keepDataDir: true }); });
test.after(() => studio && studio.stop());

// Opens the scene socket, subscribes to the board and collects what arrives.
function follow() {
  const ws = new WebSocket(`ws://127.0.0.1:${studio.port}/api/scene/socket`);
  const got = { scenes: [], boards: [] };
  ws.addEventListener('message', e => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'board') got.boards.push(msg.board); else got.scenes.push(msg);
  });
  const open = new Promise(r => ws.addEventListener('open', r));
  return { ws, got, async subscribe() { await open; ws.send(JSON.stringify({ subscribe: 'board' })); } };
}
const boards = async (f, n) => studio.until(() => f.got.boards.length >= n && f.got.boards, 5000, 50);

test('subscribing sends the board now and on every press', async () => {
  const f = follow();
  await f.subscribe();
  const [first] = await boards(f, 1);
  assert.equal(typeof first.home.score, 'number');
  assert.ok(first.serverNow > 0);
  assert.deepEqual(first.home.name, (await studio.get('/api/scoreboard')).home.name);
  await studio.post('/api/scoreboard', { type: 'manual' });
  const was = (await studio.get('/api/scoreboard')).home.score;
  await studio.request('GET', '/deck/home/add1');
  // The press reaches the page without polling: a board with the new score arrives on the socket.
  const latest = await studio.until(() => f.got.boards.find(b => b.home.score === was + 1), 3000, 50);
  assert.equal(latest.source, 'manual');
  f.ws.close();
});

test('a socket that only wants the scene gets no board messages', async () => {
  const f = follow();
  await new Promise(r => f.ws.addEventListener('open', r));
  await studio.request('GET', '/deck/away/add1');
  await wait(1500);
  assert.ok(f.got.scenes.length >= 1, 'the scene arrived');
  assert.equal(f.got.boards.length, 0);
  f.ws.close();
});

test('a change is pushed once, not every second while nothing moves', async () => {
  const f = follow();
  await f.subscribe();
  await boards(f, 1);
  await studio.post('/api/scoreboard', { type: 'clockStop' }).catch(() => {});
  await wait(300);
  const n = f.got.boards.length;
  await wait(2500);
  assert.ok(f.got.boards.length - n <= 1, `got ${f.got.boards.length - n} unchanged board pushes in 2.5 s`);
  f.ws.close();
});

// Asks for the scene socket on a plain TCP socket and waits for Studio's yes, so what's sent next arrives as frames.
function upgraded(sock) {
  sock.write('GET /api/scene/socket HTTP/1.1\r\nhost: 127.0.0.1\r\nconnection: Upgrade\r\nupgrade: websocket\r\n'
    + 'sec-websocket-version: 13\r\nsec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n');
  return new Promise(resolve => { let got = ''; const on = d => { got += d; if (got.includes('\r\n\r\n')) { sock.off('data', on); resolve(); } }; sock.on('data', on); });
}

test('a socket sending more than a page ever would is closed, and Studio carries on', async () => {
  const net = require('node:net');
  const sock = net.connect(studio.port, '127.0.0.1');
  sock.on('error', () => {});
  const closed = new Promise(r => sock.on('close', r));
  await new Promise(r => sock.on('connect', r));
  await upgraded(sock);
  // A masked text frame that says it's 1 GB long, then 1 MB of it.
  const head = Buffer.alloc(14);
  head[0] = 0x81; head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(1024 ** 3), 2);
  sock.write(head);
  for (let i = 0; i < 16 && !sock.destroyed; i++) { sock.write(Buffer.alloc(64 * 1024, 7)); await wait(10); }
  const shut = await Promise.race([closed.then(() => true), wait(3000).then(() => false)]);
  sock.destroy();
  assert.ok(shut, 'Studio closed the socket');
  assert.equal(studio.exited(), null);
  assert.equal((await studio.request('GET', '/api/health')).status, 200);
});

test('a frame that never finishes but keeps coming is closed too', async () => {
  const net = require('node:net');
  const sock = net.connect(studio.port, '127.0.0.1');
  sock.on('error', () => {});
  const closed = new Promise(r => sock.on('close', r));
  await new Promise(r => sock.on('connect', r));
  await upgraded(sock);
  // Many small whole frames are fine: pings, answered with pongs.
  const ping = Buffer.from([0x89, 0x80, 1, 2, 3, 4]);
  for (let i = 0; i < 50; i++) sock.write(ping);
  await wait(200);
  assert.equal(sock.destroyed, false, 'pings are fine');
  // One frame header with a 2-byte length, never finished... then more than a page would send.
  sock.write(Buffer.from([0x81, 0x80 | 126, 0xff, 0xff]));
  for (let i = 0; i < 4 && !sock.destroyed; i++) { sock.write(Buffer.alloc(32 * 1024, 7)); await wait(10); }
  const shut = await Promise.race([closed.then(() => true), wait(3000).then(() => false)]);
  sock.destroy();
  assert.ok(shut, 'Studio closed the socket');
});
