// A stand-in Blackmagic ATEM switcher for the tests: speaks just enough of the ATEM control protocol (UDP,
// the same packets the real switcher sends) for atem-connection to connect, read its state and send it
// cuts, autos, inputs and keyers. One mix effect; it does a cut or an auto at once.
//   const atem = await startAtem({ model: 'MiniPro' });   // atem.port, atem.state, atem.received; videoMode (atem-connection's Enums.VideoMode, 1080p50)
//   atem.drop(); atem.resume();                             // stops answering (as when its cable is pulled)
//   atem.set({ program: 3 });                               // as if someone pressed a button on the switcher
//   await atem.close();

'use strict';

const dgram = require('node:dgram');

const MODELS = {
  // productIdentifier, model number (atem-connection's Enums.Model), inputs, upstream keys, downstream keys
  Mini: ['ATEM Mini', 13, 4, 1, 1],
  MiniPro: ['ATEM Mini Pro', 14, 4, 1, 1],
  MiniExtreme: ['ATEM Mini Extreme', 16, 8, 4, 2],
};
const VERSION = 131104; // protocol 2.32 (V9_6), as current firmware sends
const FLAG = { ackRequest: 1, newSession: 2, retransmitRequest: 8, ackReply: 16 };

function command(name, payload) {
  const head = Buffer.alloc(8);
  head.writeUInt16BE(payload.length + 8, 0);
  head.write(name, 4, 4, 'ascii');
  return Buffer.concat([head, payload]);
}
const bytes = (n, fill) => { const b = Buffer.alloc(n); fill(b); return b; };

async function startAtem(opts = {}) {
  const [productName, modelNo, inputCount, uskCount, dskCount] = MODELS[opts.model || 'MiniExtreme'];
  const state = {
    program: 1, preview: 2,
    usk: Array(uskCount).fill(false),
    dsk: Array(dskCount).fill(false),
    ftb: false,
    names: Array.from({ length: inputCount }, (_, i) => (opts.names || [])[i] || `Camera ${i + 1}`),
  };
  const received = []; // { name, data, at } for every command a client sent, oldest first
  const socket = dgram.createSocket('udp4');
  const clients = new Map(); // "address:port" -> { address, port, session, nextId }
  let answering = true;
  let nextSession = 0x8001;

  const send = (c, flags, body = Buffer.alloc(0), ackId = 0) => {
    const p = Buffer.alloc(12 + body.length);
    p.writeUInt16BE((flags << 11) | (12 + body.length), 0);
    p.writeUInt16BE(c.session, 2);
    p.writeUInt16BE(ackId, 4);
    if (flags & FLAG.ackRequest) { p.writeUInt16BE(c.nextId, 10); c.nextId = (c.nextId + 1) % 32768; }
    body.copy(p, 12);
    socket.send(p, c.port, c.address);
  };
  const toAll = body => { if (answering) for (const c of clients.values()) if (c.ready) send(c, FLAG.ackRequest, body); };

  const input = (id, long, short, internal) => command('InPr', bytes(36, b => {
    b.writeUInt16BE(id, 0); b.write(long.slice(0, 19), 2); b.write(short.slice(0, 4), 22);
    b.writeUInt8(1, 26); b.writeUInt8(internal, 32); b.writeUInt8(0x1f, 34); b.writeUInt8(0x1f, 35);
  }));
  const prg = () => command('PrgI', bytes(4, b => b.writeUInt16BE(state.program, 2)));
  const prv = () => command('PrvI', bytes(4, b => b.writeUInt16BE(state.preview, 2)));
  const keOn = k => command('KeOn', bytes(4, b => { b.writeUInt8(k, 1); b.writeUInt8(state.usk[k] ? 1 : 0, 2); }));
  const dskS = k => command('DskS', bytes(8, b => { b.writeUInt8(k, 0); b.writeUInt8(state.dsk[k] ? 1 : 0, 1); }));
  const ftbS = () => command('FtbS', bytes(4, b => b.writeUInt8(state.ftb ? 1 : 0, 1)));
  const dump = () => Buffer.concat([
    command('_ver', bytes(4, b => b.writeUInt32BE(VERSION, 0))),
    command('_pin', bytes(44, b => { b.write(productName, 0); b.writeUInt8(modelNo, 40); })),
    command('_top', bytes(28, b => { b.writeUInt8(1, 0); b.writeUInt8(inputCount + 3, 1); b.writeUInt8(dskCount, 2); b.writeUInt8(1, 6); b.writeUInt8(1, 9); })),
    command('_MeC', bytes(4, b => b.writeUInt8(uskCount, 1))),
    command('VidM', bytes(4, b => b.writeUInt8(opts.videoMode ?? 12, 0))), // 12: 1080p50
    input(0, 'Black', 'BLK', 1),
    ...state.names.map((n, i) => input(i + 1, n, `CAM${i + 1}`, 0)),
    input(1000, 'Color Bars', 'BARS', 2),
    prg(), prv(),
    ...state.usk.map((_, k) => keOn(k)),
    ...state.dsk.map((_, k) => dskS(k)),
    ftbS(),
    command('InCm', Buffer.alloc(4)),
  ]);

  // What a client asked for: the switcher does it and tells every client, as the real one does.
  const take = () => { [state.program, state.preview] = [state.preview, state.program]; return [prg(), prv()]; };
  const handle = (name, d) => {
    received.push({ name, data: d, at: Date.now() });
    if (name === 'DCut' || name === 'DAut') return take();
    if (name === 'CPgI') { state.program = d.readUInt16BE(2); return [prg()]; }
    if (name === 'CPvI') { state.preview = d.readUInt16BE(2); return [prv()]; }
    if (name === 'CKOn') { state.usk[d[1]] = d[2] === 1; return [keOn(d[1])]; }
    if (name === 'CDsL') { state.dsk[d[0]] = d[1] === 1; return [dskS(d[0])]; }
    if (name === 'DDsA') { const k = d[1]; state.dsk[k] = !state.dsk[k]; return [dskS(k)]; }
    if (name === 'FtbA') { state.ftb = !state.ftb; return [ftbS()]; }
    return [];
  };

  socket.on('message', (p, rinfo) => {
    if (!answering || p.length < 12) return;
    const key = `${rinfo.address}:${rinfo.port}`;
    const flags = p[0] >> 3;
    if (flags & FLAG.newSession) { // hello: a new session, then the whole state
      const c = { address: rinfo.address, port: rinfo.port, session: nextSession++, nextId: 1, ready: false };
      clients.set(key, c);
      const hello = Buffer.alloc(20);
      hello.writeUInt16BE((FLAG.newSession << 11) | 20, 0);
      hello.writeUInt16BE(c.session, 2);
      hello.writeUInt8(2, 12);
      socket.send(hello, c.port, c.address);
      setTimeout(() => { c.ready = true; if (answering) send(c, FLAG.ackRequest, dump()); }, 5);
      return;
    }
    const c = clients.get(key);
    if (!c || !(flags & FLAG.ackRequest)) return;
    send(c, FLAG.ackReply, Buffer.alloc(0), p.readUInt16BE(10));
    const out = [];
    for (let at = 12; at + 8 <= p.length;) {
      const len = p.readUInt16BE(at);
      if (len < 8) break;
      out.push(...handle(p.toString('ascii', at + 4, at + 8), p.subarray(at + 8, at + len)));
      at += len;
    }
    if (out.length) toAll(Buffer.concat(out));
  });
  // The real switcher keeps talking while nothing changes; a client gives up after a few seconds of silence.
  const beat = setInterval(() => toAll(Buffer.alloc(0)), 500);
  await new Promise(r => socket.bind(opts.port || 0, '127.0.0.1', r));

  return {
    port: socket.address().port, address: '127.0.0.1', productName, state, received,
    drop() { answering = false; },
    resume() { answering = true; clients.clear(); },
    // As if someone pressed buttons on the switcher itself.
    set(change) {
      Object.assign(state, change);
      toAll(Buffer.concat([prg(), prv(), ...state.usk.map((_, k) => keOn(k)), ...state.dsk.map((_, k) => dskS(k))]));
    },
    close: () => new Promise(r => { clearInterval(beat); socket.close(r); }),
  };
}

module.exports = { startAtem, MODELS };
