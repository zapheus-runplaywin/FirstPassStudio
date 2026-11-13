// A stand-in Blackmagic ATEM switcher for the tests: speaks just enough of the ATEM control protocol (UDP,
// the same packets the real switcher sends) for atem-connection to connect, read its state and send it
// cuts, autos, inputs and keyers. One mix effect; it does a cut or an auto at once.
//   const atem = await startAtem({ model: 'MiniPro' });   // atem.port, atem.state, atem.received; videoMode (atem-connection's Enums.VideoMode, 1080p50)
//   atem.drop(); atem.resume();                             // stops answering (as when its cable is pulled)
//   atem.set({ program: 3 });                               // as if someone pressed a button on the switcher
//   atem.state.dskKeys[0], atem.state.uskKeys[1]            // how each key is set up ({ fill, cut, preMultiply } / { type, fill, cut, preMultiplied })
//   atem.state.nextSelection                                // the next transition's selection (bit 0 background, bits 1-4 upstream keys 1-4)
//   startAtem({ autoMs: 400 })                              // an auto that mixes for that long (it's at once otherwise; another auto meanwhile is ignored)
//   atem.state.faders['1301:-65280']                        // a Fairlight audio source's fader, in hundredths of a dB (the mics: Mic 1 1301 and
//                                                           // Mic 2 1302, beside camera 1's embedded sound); startAtem({ split: [1302] }) splits
//                                                           // Mic 2 into two mono channels (-256 left, -255 right); { micOff: [1301] } sets Mic 1 Off
//   atem.setFader('1301:-65280', -1000)                     // as if someone moved that fader on the switcher
//   atem.setLevel('1301:-65280', -2000)                     // the sound coming into that source (hundredths of a dB); sent every
//                                                           // 100 ms to a client that asked for levels (SFLN), as the real one does;
//                                                           // atem.state.sendLevels says whether one asked (SFLN isn't in received)
//   await atem.close();

import dgram from 'node:dgram';

const MODELS: Record<string, [string, number, number, number, number]> = {
  // productIdentifier, model number (atem-connection's Enums.Model), inputs, upstream keys, downstream keys
  Mini: ['ATEM Mini', 13, 4, 1, 1],
  MiniPro: ['ATEM Mini Pro', 14, 4, 1, 1],
  MiniExtreme: ['ATEM Mini Extreme', 16, 8, 4, 2],
};
const VERSION = 131104; // protocol 2.32 (V9_6), as current firmware sends
const FLAG = { ackRequest: 1, newSession: 2, retransmitRequest: 8, ackReply: 16 };

function command(name: string, payload: Buffer<ArrayBufferLike>) {
  const head = Buffer.alloc(8);
  head.writeUInt16BE(payload.length + 8, 0);
  head.write(name, 4, 4, 'ascii');
  return Buffer.concat([head, payload]);
}
const bytes = (n: number, fill: (b: Buffer) => void) => { const b = Buffer.alloc(n); fill(b); return b; };

export interface AtemOptions {
  model?: string; names?: string[]; keys?: Partial<AtemState>; split?: number[]; micOff?: number[];
  autoMs?: number; videoMode?: number; port?: number;
}
export interface AtemState {
  program: number; preview: number; usk: boolean[]; dsk: boolean[]; ftb: boolean;
  dskKeys: { fill: number; cut: number; preMultiply: boolean }[];
  uskKeys: { type: number; fill: number; cut: number; preMultiplied: boolean }[];
  nextSelection: number; selection: number; names: string[];
  faders: Record<string, number>; levels: Record<string, number>; sendLevels: boolean;
}
interface Client { address: string; port: number; session: number; nextId: number; ready: boolean; heard?: number }

async function startAtem(opts: AtemOptions = {}) {
  const [productName, modelNo, inputCount, uskCount, dskCount] = MODELS[opts.model || 'MiniExtreme']!;
  const state: AtemState = {
    program: 1, preview: 2,
    usk: Array(uskCount).fill(false),
    dsk: Array(dskCount).fill(false),
    ftb: false,
    // How each key is set up (as in ATEM Software Control): its fill and key (cut) inputs, pre multiplied, and an
    // upstream key's type (0 luma, 1 chroma). Fresh from the box: every key on Black, luma, not pre multiplied.
    dskKeys: Array.from({ length: dskCount }, () => ({ fill: 0, cut: 0, preMultiply: false })),
    uskKeys: Array.from({ length: uskCount }, () => ({ type: 0, fill: 0, cut: 0, preMultiplied: false })),
    // The next transition (as the panel's BKGD and KEY buttons): a cut or auto takes these, the background and the
    // upstream keys picked (each key picked goes on if it was off, off if it was on). Background only, from the box.
    nextSelection: 1, selection: 1,
    ...(opts.keys || {}),
    names: Array.from({ length: inputCount }, (_, i) => (opts.names || [])[i] || `Camera ${i + 1}`),
    faders: {},
    levels: {}, sendLevels: false,
  };
  // Fairlight audio: camera 1's embedded sound (not a mic) and the two mic jacks, each one stereo source, or two mono.
  const audioInputs: [number, number, number][] = [[1, 0, 2], [1301, 2, 2048], [1302, 2, 2048]]; // input, type (0 embedded, 2 audio in), port (2 HDMI, 2048 TRS jack)
  const sourcesOf = (id: number) => (opts.split || []).includes(id) ? ['-256', '-255'] : ['-65280'];
  for (const [id] of audioInputs) for (const src of sourcesOf(id)) { state.faders[`${id}:${src}`] = 0; state.levels[`${id}:${src}`] = -10000; }
  const received: { name: string; data: Buffer; at: number }[] = []; // { name, data, at } for every command a client sent, oldest first
  const socket = dgram.createSocket('udp4');
  const clients = new Map<string, Client>(); // "address:port" -> { address, port, session, nextId }
  let answering = true;
  let nextSession = 0x8001;

  const send = (c: Client, flags: number, body: Buffer<ArrayBufferLike> = Buffer.alloc(0), ackId = 0) => {
    const p = Buffer.alloc(12 + body.length);
    p.writeUInt16BE((flags << 11) | (12 + body.length), 0);
    p.writeUInt16BE(c.session, 2);
    p.writeUInt16BE(ackId, 4);
    if (flags & FLAG.ackRequest) { p.writeUInt16BE(c.nextId, 10); c.nextId = (c.nextId + 1) % 32768; }
    body.copy(p, 12);
    socket.send(p, c.port, c.address);
  };
  const toAll = (body: Buffer<ArrayBufferLike>) => { if (answering) for (const c of clients.values()) if (c.ready) send(c, FLAG.ackRequest, body); };

  const input = (id: number, long: string, short: string, internal: number) => command('InPr', bytes(36, b => {
    b.writeUInt16BE(id, 0); b.write(long.slice(0, 19), 2); b.write(short.slice(0, 4), 22);
    b.writeUInt8(1, 26); b.writeUInt8(internal, 32); b.writeUInt8(0x1f, 34); b.writeUInt8(0x1f, 35);
  }));
  const prg = () => command('PrgI', bytes(4, b => b.writeUInt16BE(state.program, 2)));
  const prv = () => command('PrvI', bytes(4, b => b.writeUInt16BE(state.preview, 2)));
  const keOn = (k: number) => command('KeOn', bytes(4, b => { b.writeUInt8(k, 1); b.writeUInt8(state.usk[k] ? 1 : 0, 2); }));
  const dskS = (k: number) => command('DskS', bytes(8, b => { b.writeUInt8(k, 0); b.writeUInt8(state.dsk[k] ? 1 : 0, 1); }));
  const ftbS = () => command('FtbS', bytes(4, b => b.writeUInt8(state.ftb ? 1 : 0, 1)));
  const dskB = (k: number) => command('DskB', bytes(8, b => { b.writeUInt8(k, 0); b.writeUInt16BE(state.dskKeys[k].fill, 2); b.writeUInt16BE(state.dskKeys[k].cut, 4); }));
  const dskP = (k: number) => command('DskP', bytes(20, b => { b.writeUInt8(k, 0); b.writeUInt8(30, 2); b.writeUInt8(state.dskKeys[k].preMultiply ? 1 : 0, 3); }));
  const keBP = (k: number) => command('KeBP', bytes(20, b => {
    b.writeUInt8(k, 1); b.writeUInt8(state.uskKeys[k].type, 2); b.writeUInt8(1, 4);
    b.writeUInt16BE(state.uskKeys[k].fill, 6); b.writeUInt16BE(state.uskKeys[k].cut, 8);
  }));
  const keLm = (k: number) => command('KeLm', bytes(12, b => { b.writeUInt8(k, 1); b.writeUInt8(state.uskKeys[k].preMultiplied ? 1 : 0, 2); }));
  let mixing = false;
  const trPs = () => command('TrPs', bytes(8, b => b.writeUInt8(mixing ? 1 : 0, 1)));
  const trSS = () => command('TrSS', bytes(8, b => { b.writeUInt8(state.selection, 2); b.writeUInt8(state.nextSelection, 4); }));
  const faip = ([id, type, port]: [number, number, number]) => command('FAIP', bytes(16, b => { b.writeUInt16BE(id, 0); b.writeUInt8(type, 2); b.writeUInt16BE(port, 6); b.writeUInt8(3, 9); b.writeUInt8(1, 10); }));
  const fasp = (key: string) => command('FASP', bytes(56, b => {
    const [id, src] = key.split(':');
    b.writeUInt16BE(Number(id), 0); b.writeBigInt64BE(BigInt(src!), 8); b.writeUInt8(1, 16);
    b.writeInt32BE(state.faders[key]!, 44); b.writeUInt8(7, 48); b.writeUInt8((opts.micOff || []).includes(Number(id)) ? 1 : 2, 49);
  }));
  // A source's levels (FMLv): the input's level left and right, the rest of its meters at the same.
  const fmlv = (key: string) => command('FMLv', bytes(40, b => {
    const [id, src] = key.split(':');
    b.writeBigInt64BE(BigInt(src!), 0); b.writeUInt16BE(Number(id), 8);
    for (let at = 10; at < 40; at += 2) b.writeInt16BE(Math.max(-32768, state.levels[key]!), at);
  }));
  const dump = () => Buffer.concat([
    command('_ver', bytes(4, b => b.writeUInt32BE(VERSION, 0))),
    command('_pin', bytes(44, b => { b.write(productName, 0); b.writeUInt8(modelNo, 40); })),
    command('_top', bytes(28, b => { b.writeUInt8(1, 0); b.writeUInt8(inputCount + 3, 1); b.writeUInt8(dskCount, 2); b.writeUInt8(1, 6); b.writeUInt8(1, 9); })),
    command('_MeC', bytes(4, b => b.writeUInt8(uskCount, 1))),
    command('VidM', bytes(4, b => b.writeUInt8(opts.videoMode ?? 12, 0))), // 12: 1080p50
    input(0, 'Black', 'BLK', 1),
    ...state.names.map((n, i) => input(i + 1, n, `CAM${i + 1}`, 0)),
    input(1000, 'Color Bars', 'BARS', 2),
    prg(), prv(), trSS(),
    ...state.usk.map((_, k) => keOn(k)),
    ...state.dsk.map((_, k) => dskS(k)),
    ...state.uskKeys.flatMap((_, k) => [keBP(k), keLm(k)]),
    ...state.dskKeys.flatMap((_, k) => [dskB(k), dskP(k)]),
    ftbS(),
    command('_FAC', bytes(4, b => { b.writeUInt8(audioInputs.length, 0); b.writeUInt8(1, 1); })),
    ...audioInputs.map(faip),
    ...Object.keys(state.faders).map(fasp),
    command('InCm', Buffer.alloc(4)),
  ]);

  // What a client asked for: the switcher does it and tells every client, as the real one does.
  // A cut or auto: the background and the keys in the next transition's selection change together.
  const take = () => {
    const sel = state.nextSelection;
    state.selection = sel;
    const out = [trSS()];
    if (sel & 1) { [state.program, state.preview] = [state.preview, state.program]; out.push(prg(), prv()); }
    state.usk.forEach((on, k) => { if (sel & (2 << k)) { state.usk[k] = !on; out.push(keOn(k)); } });
    return out;
  };
  const handle = (name: string, d: Buffer): Buffer[] => {
    // Asking for the audio levels (SFLN) is listening, not doing: it changes nothing on the switcher, so it isn't in
    // received, which the tests read as what Studio did to the switcher (state.sendLevels says whether it asked).
    if (name === 'SFLN') { state.sendLevels = d[0] === 1; return []; }
    received.push({ name, data: d, at: Date.now() });
    if (name === 'DAut' && opts.autoMs) {
      // A mix: the switcher says it has started (after answering the command), then takes it at the end.
      if (mixing) return [];
      mixing = true;
      setTimeout(() => { if (answering) toAll(trPs()); }, 20);
      setTimeout(() => { mixing = false; toAll(Buffer.concat([...take(), trPs()])); }, opts.autoMs);
      return [];
    }
    if (name === 'DCut' || name === 'DAut') return take();
    if (name === 'CPgI') { state.program = d.readUInt16BE(2); return [prg()]; }
    if (name === 'CPvI') { state.preview = d.readUInt16BE(2); return [prv()]; }
    if (name === 'CKOn') { state.usk[d[1]] = d[2] === 1; return [keOn(d[1])]; }
    if (name === 'CDsL') { state.dsk[d[0]] = d[1] === 1; return [dskS(d[0])]; }
    if (name === 'DDsA') { const k = d[1]; state.dsk[k] = !state.dsk[k]; return [dskS(k)]; }
    if (name === 'FtbA') { state.ftb = !state.ftb; return [ftbS()]; }
    if (name === 'CTTp') { if (d[0] & 2) state.nextSelection = d[3] || 1; return [trSS()]; }
    // Setting a key up: its fill and key inputs, pre multiplied, an upstream key's type.
    if (name === 'CDsF') { state.dskKeys[d[0]].fill = d.readUInt16BE(2); return [dskB(d[0])]; }
    if (name === 'CDsC') { state.dskKeys[d[0]].cut = d.readUInt16BE(2); return [dskB(d[0])]; }
    if (name === 'CDsG') { if (d[0] & 1) state.dskKeys[d[1]].preMultiply = d[2] === 1; return [dskP(d[1])]; }
    if (name === 'CKTp') { if (d[0] & 1) state.uskKeys[d[2]].type = d[3]; return [keBP(d[2])]; }
    if (name === 'CKeF') { state.uskKeys[d[1]].fill = d.readUInt16BE(2); return [keBP(d[1])]; }
    if (name === 'CKeC') { state.uskKeys[d[1]].cut = d.readUInt16BE(2); return [keBP(d[1])]; }
    // A fader moved (CFSP, its fader gain flag 1 << 7).
    if (name === 'CFSP') {
      const key = `${d.readUInt16BE(2)}:${d.readBigInt64BE(8)}`;
      if ((d.readUInt16BE(0) & 128) && key in state.faders) { state.faders[key] = d.readInt32BE(40); return [fasp(key)]; }
      return [];
    }
    if (name === 'CKLm') { if (d[0] & 1) state.uskKeys[d[2]].preMultiplied = d[3] === 1; return [keLm(d[2])]; }
    return [];
  };

  socket.on('message', (p, rinfo) => {
    if (!answering || p.length < 12) return;
    const key = `${rinfo.address}:${rinfo.port}`;
    const flags = p[0] >> 3;
    if (flags & FLAG.newSession) { // hello: a new session, then the whole state
      const c: Client = { address: rinfo.address, port: rinfo.port, session: nextSession++, nextId: 1, ready: false };
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
    if (c) c.heard = Date.now();
    if (!c || !(flags & FLAG.ackRequest)) return;
    send(c, FLAG.ackReply, Buffer.alloc(0), p.readUInt16BE(10));
    const out: Buffer[] = [];
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
  const levelBeat = setInterval(() => { if (state.sendLevels) toAll(Buffer.concat(Object.keys(state.levels).map(fmlv))); }, 100);
  await new Promise<void>(r => socket.bind(opts.port || 0, '127.0.0.1', () => r()));

  return {
    port: socket.address().port, address: '127.0.0.1', productName, state, received,
    drop() { answering = false; },
    // How many clients it has heard from in the last 1.5 s (a connected one replies to its heartbeat every half second).
    talking: () => [...clients.values()].filter(c => Date.now() - (c.heard || 0) < 1500).length,
    resume() { answering = true; clients.clear(); },
    // As if someone pressed buttons on the switcher itself.
    set(change: Partial<AtemState>) {
      Object.assign(state, change);
      toAll(Buffer.concat([prg(), prv(), ...state.usk.map((_, k) => keOn(k)), ...state.dsk.map((_, k) => dskS(k)),
        ...state.uskKeys.flatMap((_, k) => [keBP(k), keLm(k)]), ...state.dskKeys.flatMap((_, k) => [dskB(k), dskP(k)])]));
    },
    setFader(key: string, gain: number) { state.faders[key] = gain; toAll(fasp(key)); },
    setLevel(key: string, level: number) { state.levels[key] = level; },
    close: () => new Promise<void>(r => { clearInterval(beat); clearInterval(levelBeat); socket.close(() => r()); }),
  };
}

export type Atem = Awaited<ReturnType<typeof startAtem>>;

export { startAtem, MODELS };
