// FirstPass Studio - the Commentator mic page's script (commentator.html loads it as a module, so its names stay its own).
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
// What the browser may have beyond the DOM's types: Safari's Audio Session API and its old AudioContext name.
interface PhoneNavigator extends Navigator { audioSession?: { type: string } }
declare global {
  // How loud Studio's sound comes back, in dB (the tests read it too).
  interface Window { backLevel: () => number; webkitAudioContext?: typeof AudioContext }
}
const showError = (html: string) => { $('err').innerHTML = html || ''; $('err').hidden = !html; };
const POLL_MS = 500, ANSWER_WAIT_MS = 30000;

let on = false;          // the commentator pressed Start
let stream: MediaStream | null = null, pc: RTCPeerConnection | null = null, session = '', micName = '';
let muted = false, retryTimer: ReturnType<typeof setTimeout> | undefined, wakeLock: WakeLockSentinel | null = null, tries = 0;
let audioCtx: AudioContext | null = null, analyser: AnalyserNode | null = null, meterData = new Float32Array(0);
let studioMic: Mic | null = null;    // this phone's mic as Studio has it (its mute), from the scene
// Hear Studio: on or off, kept on this phone.
const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} } };
let hearOn = store.get('commentator.hear') !== 'off';
let backPlayer: HTMLAudioElement | null = null, backReceiver: RTCRtpReceiver | null = null;

function say(word: string, why: string, dot: string) {
  $('word').textContent = word;
  $('why').textContent = why || '';
  $('dot').className = 'dot ' + (dot || '');
  $('stateCard').classList.toggle('dropped', dot === 'bad');
}
function drawButtons() {
  $<HTMLButtonElement>('start').textContent = on ? 'Stop' : 'Start';
  $<HTMLButtonElement>('start').className = on ? 'alt' : '';
  $<HTMLButtonElement>('mute').hidden = !on;
  $<HTMLButtonElement>('mute').textContent = muted ? 'Muted' : 'Mute';
  $<HTMLButtonElement>('mute').classList.toggle('lit', muted);
}

// Two short beeps in the commentator's ears (and a buzz where the phone can) when Studio stops hearing them.
function alarm() {
  try {
    if (!audioCtx) return;
    for (const at of [0, .25]) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = 880; g.gain.value = .15;
      o.connect(g); g.connect(audioCtx.destination);
      o.start(audioCtx.currentTime + at); o.stop(audioCtx.currentTime + at + .12);
    }
    navigator.vibrate?.([120, 80, 120]);
  } catch { /* nothing to beep with */ }
}

// ─── The mic ────────────────────────────────────────────────────────
async function listInputs() {
  try {
    const list = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default');
    const sel = $<HTMLSelectElement>('input'), want = sel.value;
    sel.replaceChildren(new Option('The phone\'s mic, or what\'s plugged in', ''), ...list.map((d, i) => new Option(d.label || `Mic ${i + 1}`, d.deviceId)));
    if ([...sel.options].some(o => o.value === want)) sel.value = want;
  } catch { /* listed once the phone allows the mic */ }
}
async function openMic() {
  const id = $<HTMLSelectElement>('input').value;
  // Tells iPhone Safari this page plays and records sound, not a call (the Audio Session API, where there is one),
  // and asks for the mic at full rate: call mode squashes what the commentator hears (Hear Studio).
  try { const nav: PhoneNavigator = navigator; if (nav.audioSession) nav.audioSession.type = 'play-and-record'; } catch {}
  const mic = stream = await navigator.mediaDevices.getUserMedia({ audio: {
    ...(id ? { deviceId: { exact: id } } : {}), echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 1 }, sampleRate: { ideal: 48000 } } });
  const track = mic.getAudioTracks()[0];
  track.enabled = !muted;
  // The phone took the mic away (a call, another app, a headset pulled out).
  track.addEventListener('ended', () => { if (on) { alarm(); say('Mic stopped', 'The phone stopped the mic (a call, another app, or the mic was unplugged). Starting again…', 'bad'); restart(1500); } });
  track.addEventListener('mute', () => { if (on) say('Mic paused by the phone', 'Something else has the mic (a call?). It comes back when that ends.', 'warn'); });
  track.addEventListener('unmute', () => { if (on && pc && pc.connectionState === 'connected') onAir(); });
  const ctx = audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
  const meter = analyser = ctx.createAnalyser();
  meter.fftSize = 512;
  meterData = new Float32Array(meter.fftSize);
  ctx.createMediaStreamSource(mic).connect(meter);
  listInputs();
}
function closeMic() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null; analyser = null;
}
// The level as it leaves the phone: green, amber near the top, red at the top.
setInterval(() => {
  const bar = $('meter');
  if (!analyser || muted) { bar.style.width = '0'; return; }
  analyser.getFloatTimeDomainData(meterData);
  let peak = 0;
  for (const v of meterData) peak = Math.max(peak, Math.abs(v));
  const db = peak > 0 ? 20 * Math.log10(peak) : -100;
  bar.style.width = Math.max(0, Math.min(100, (db + 60) / 60 * 100)) + '%';
  bar.className = db >= -3 ? 'hot' : db >= -12 ? 'warm' : '';
}, 60);

// ─── The connection to Studio ───────────────────────────────────────
function onAir() {
  tries = 0;
  if (studioMic && studioMic.muted) say('Muted in Studio', `Studio hears you as ${micName}, but has you muted on the Mac.`, 'warn');
  else if (muted) say('Muted', 'Studio hears nothing from you until you press Mute again.', 'warn');
  else say('On air', `Studio hears you as ${micName}.`, 'live');
}
function dropPc() {
  if (pc) { pc.onconnectionstatechange = null; pc.ontrack = null; try { pc.close(); } catch {} }
  pc = null; session = '';
  if (backPlayer) backPlayer.srcObject = null;
  backReceiver = null;
}
async function connect() {
  clearTimeout(retryTimer);
  dropPc();
  say('Connecting…', 'Finding Studio on this Wi-Fi.', 'warn');
  const me = pc = new RTCPeerConnection({ iceServers: [] }), mic = stream;
  if (!mic) throw new Error('The mic isn\'t open.');
  // Both ways when Hear Studio is on: the mic out, Studio's sound back.
  mic.getAudioTracks().forEach(t => me.addTransceiver(t, { direction: hearOn ? 'sendrecv' : 'sendonly', streams: [mic] }));
  me.ontrack = e => { if (pc === me) hearBack(e.streams[0] || new MediaStream([e.track]), e.receiver); };
  me.onconnectionstatechange = () => {
    if (pc !== me) return;
    const s = me.connectionState;
    if (s === 'connected') onAir();
    else if (s === 'disconnected' || s === 'failed') { alarm(); say('Dropped', 'Studio stopped hearing you. Trying again…', 'bad'); restart(2000); }
  };
  await me.setLocalDescription(await me.createOffer());
  // Every address in the offer (on one network they're there at once).
  await new Promise<void>(r => { if (me.iceGatheringState === 'complete') return r(); me.addEventListener('icegatheringstatechange', () => me.iceGatheringState === 'complete' && r()); setTimeout(r, 1500); });
  // Studio's sound back as music: stereo, full bandwidth (48 kHz), at a bit rate music sounds right at, never thinned
  // out in the quiet moments.
  const sdp = (me.localDescription?.sdp || '').replace(/a=fmtp:(\d+) ([^\r\n]*useinbandfec=1[^\r\n]*)/g, (all, pt: string, rest: string) => `a=fmtp:${pt} ${rest.replace(/;?(maxaveragebitrate|stereo|maxplaybackrate|usedtx)=\d+/g, '')};stereo=1;maxaveragebitrate=128000;maxplaybackrate=48000;usedtx=0`);
  const res = await fetch('/api/phonemic/offer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sdp }) });
  const made = await res.json().catch(() => ({}));
  if (res.status === 403) { stop(); showError(`This phone isn't paired with the Mac yet. <a href="/pair.html?then=%2Fcommentator.html">Pair it</a> (any level), then press Start again.`); return; }
  if (!res.ok) throw new Error(made.error || res.statusText);
  if (pc !== me) return;
  session = made.session; micName = made.mic;
  const until = Date.now() + ANSWER_WAIT_MS;
  for (;;) {
    if (pc !== me) return;
    const got = await (await fetch(`/api/phonemic/${encodeURIComponent(session)}`, { cache: 'no-store' })).json().catch(() => ({}));
    if (got.answer) { await me.setRemoteDescription({ type: 'answer', sdp: got.answer }); return; }
    if (got.error) throw new Error(got.error);
    say('Waiting for Studio', got.why || 'Studio is picking up…', 'warn');
    if (Date.now() > until) throw new Error('Studio didn\'t pick up. Is Output 1 on?');
    await new Promise(r => setTimeout(r, POLL_MS));
  }
}
// Starts again after ms, a little longer each time it doesn't work (up to 10 s).
function restart(ms: number) {
  clearTimeout(retryTimer);
  if (!on) return;
  retryTimer = setTimeout(async () => {
    if (!on) return;
    try {
      if (!stream || stream.getAudioTracks().every(t => t.readyState === 'ended')) { closeMic(); await openMic(); }
      await connect();
    } catch (err) { tries++; say('Not connected', `${err instanceof Error ? err.message : String(err)} Trying again…`, 'bad'); restart(Math.min(10000, 2000 * tries)); }
  }, ms);
}

// ─── Hear Studio ────────────────────────────────────────────────────
// Studio's sound coming back, played straight to what the phone plays to (the headphones, or the interface plugged
// in), so the phone's own volume buttons set it. Not through a mixer on the page: iPhone Safari passes nothing from a
// network stream through one, and doesn't let a page set a player's volume either. Off mutes it.
function hearBack(st: MediaStream, receiver: RTCRtpReceiver) {
  const player = backPlayer = backPlayer || document.createElement('audio');
  if (!player.isConnected) { player.autoplay = true; player.setAttribute('playsinline', ''); document.body.append(player); }
  player.srcObject = st;
  player.muted = !hearOn;
  backReceiver = receiver || null;
  player.play().catch(() => {});
}
function drawHear() {
  $<HTMLButtonElement>('hearOn').setAttribute('aria-pressed', String(hearOn));
  $<HTMLButtonElement>('hearOff').setAttribute('aria-pressed', String(!hearOn));
  $('hearPct').textContent = hearOn ? 'Set the level with the phone\'s volume buttons' : 'Off';
}
function setHear(v: boolean) {
  if (v === hearOn) return;
  hearOn = v;
  store.set('commentator.hear', v ? 'on' : 'off');
  drawHear();
  if (backPlayer) { backPlayer.muted = !hearOn; if (hearOn) backPlayer.play().catch(() => {}); }
  // Turned on while connected with nothing coming back: connect again both ways.
  if (on && v && !backReceiver) restart(0);
}
$<HTMLButtonElement>('hearOn').onclick = () => setHear(true);
$<HTMLButtonElement>('hearOff').onclick = () => setHear(false);
// How loud Studio's sound comes back (before the phone's volume), in dB: the level the connection reports for what
// arrives, so it needs no mixer on the page either.
window.backLevel = () => {
  const level = backReceiver?.getSynchronizationSources?.()[0]?.audioLevel || 0;
  return level > 0 ? 20 * Math.log10(level) : -100;
};
setInterval(() => {
  const db = hearOn ? window.backLevel() : -100;
  $('backMeter').style.width = Math.max(0, Math.min(100, (db + 60) / 60 * 100)) + '%';
}, 80);
drawHear();

// ─── Start and stop ─────────────────────────────────────────────────
async function keepAwake() {
  try { if (on && !wakeLock && navigator.wakeLock) { const lock = wakeLock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { wakeLock = null; }); } } catch { /* not allowed now */ }
}
async function start() {
  showError('');
  on = true; tries = 0;
  drawButtons();
  keepAwake();
  try {
    await openMic();
    await connect();
  } catch (err) {
    const name = err instanceof Error ? err.name : '', message = err instanceof Error ? err.message : String(err);
    if (name === 'NotAllowedError') { stop(); showError('The phone didn\'t let this page use the mic. Allow the microphone for this site in the browser\'s settings, then press Start again.'); return; }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') { stop(); showError('That mic isn\'t plugged in. Pick another, or plug it in and press Start again.'); return; }
    tries++; say('Not connected', `${message} Trying again…`, 'bad'); restart(2000);
  }
}
function stop() {
  on = false;
  clearTimeout(retryTimer);
  dropPc();
  closeMic();
  if (wakeLock) wakeLock.release().catch(() => {});
  say('Off', 'Press Start to send your mic to Studio.', '');
  drawButtons();
}
$<HTMLButtonElement>('start').onclick = () => (on ? stop() : start());
$<HTMLButtonElement>('mute').onclick = () => {
  muted = !muted;
  if (stream) stream.getAudioTracks().forEach(t => { t.enabled = !muted; });
  drawButtons();
  if (pc && pc.connectionState === 'connected') onAir();
};
$<HTMLSelectElement>('input').onchange = () => { if (on) { closeMic(); restart(0); } };
navigator.mediaDevices?.addEventListener('devicechange', listInputs);

// Back on the page after the phone was locked or another app was in front: the phone may have stopped the mic.
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !on) return;
  keepAwake();
  if (!stream || stream.getAudioTracks().some(t => t.readyState === 'ended') || !pc || pc.connectionState !== 'connected') {
    say('Starting again', 'The phone stopped the mic while this page was away.', 'bad');
    restart(0);
  }
});

// Studio's side of this phone's mic (its mute on the Mac), from the scene as it changes.
const events = new EventSource('/api/scene/events');
events.onmessage = e => {
  try {
    const sc: SceneState = JSON.parse(e.data);
    studioMic = ((sc.mics && sc.mics.mics) || []).find(m => m.on === 'phone' && m.name === micName) || null;
    if (on && pc && pc.connectionState === 'connected') onAir();
  } catch { /* the next one */ }
};

if (!window.isSecureContext || !navigator.mediaDevices || !window.RTCPeerConnection) {
  $<HTMLButtonElement>('start').disabled = true;
  showError(`A phone lets a page use its mic only over the secure link. On the Mac, turn on <b>Secure phone link</b> on the Devices tab, then open this page from the QR code under <b>+ Phone mic</b> in Mics on the Output page${location.protocol === 'http:' ? '' : ' (this browser has no WebRTC: use Safari or Chrome)'}.`);
}
drawButtons();

// What makes this file a module (its names its own), as the first line says.
export {};
