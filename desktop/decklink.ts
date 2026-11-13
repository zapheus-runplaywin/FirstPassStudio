// FirstPass Studio Mac app - the scene out of a Blackmagic UltraStudio or DeckLink (outputs.js decides
// when; the Output page sets it up).
//
// The scene renders in an off-screen window, transparent, at the device's frame rate. Each new picture
// (Chromium only paints when something changes) goes to native/decklink, which keeps the device playing
// the latest one: as fill and key with the device's external keyer, or as fill only. With its sound in the
// SDI (sound 'sdi', or 'both' to hear it on the Mac too), desktop/soundtap.ts hears the window and the sound
// goes out embedded, with the fill; 'mac' leaves it on the Mac's sound output only. Talks to the
// Blackmagic Desktop Video driver; without it, or without the built module, devices() says why. While the sound goes
// into the SDI, onLevel({ peak, dry }) every half second gives its meter (the loudest moment of each side, 0 to 1)
// and how many times the sound ran dry in the last minute, for the status board's Sound out.
//
// It also reads the timecode coming into the device's SDI input, while a 4K replay follows it (the helper's
// sditimecode.ts asks with readInput): the timecode goes to the helper each time it changes, and every half second
// besides, so the helper can tell playing from stopped.

import path from 'node:path';
import * as sceneWindow from './scenewindow';
import * as soundTap from './soundtap';
import { unpacked } from '../unpacked';
import { APP_DIR } from '../appdir';
import { errorMessage } from '../errors';

// What native/decklink gives (native/decklink/src).
interface Mode { mode: string, name: string, supported?: boolean }
interface Device { id: string, name: string, input?: boolean, modes: Mode[] }
type Devices = { ok: true, devices: Device[] } | { ok: false, error: string };
type Started = { ok: true, name: string, width: number, height: number, frameRate: number, audio: boolean } | { ok: false, error: string };
interface AddonStatus { running?: boolean, name?: string, late?: number, dropped?: number, gaps?: number, skipped?: number }
interface InputStatus { running?: boolean, device?: string, name?: string, signal?: boolean, timecode?: string, fps?: number }
interface Addon {
  devices(): Devices,
  status(): AddonStatus,
  start(o: { device: string, mode: string, keying: string, straight: boolean, audio: boolean }): Started,
  stop(): void,
  frame(bitmap: Buffer, width: number, height: number): boolean,
  audio(pcm: Buffer): void,
  inputStart(o: { device: string }): { ok: true, name: string } | { ok: false, error: string },
  inputStatus(): InputStatus,
  inputStop(): void,
}

const MODULE = unpacked(path.join(APP_DIR, 'native', 'decklink', 'build', 'Release', 'decklink.node'));
let addon: Addon | null = null;
let loadError = '';
try { addon = require(MODULE) as Addon; } catch (err) { loadError = errorMessage(err); }

// What the Output page set for the Blackmagic output (outputs.ts).
interface Wanted { device: string, mode: string, keying: string, straight?: boolean, sound?: string, density?: number, output?: string }
interface Status { running: boolean, name: string, mode: string, late: number, dropped: number, sound: string, error: string }
interface Timecode { name: string, signal: boolean, timecode: string, fps: number, at: number, error: string }
interface Options {
  port: number, log: (message: string) => void, onStatus: (status: Status, output: string) => void,
  onLevel?: (level: { peak: [number, number], dry: number }, output: string) => void, onTimecode?: (t: Timecode) => void,
}

function create({ port, log, onStatus, onLevel = () => {}, onTimecode = () => {} }: Options) {
  let win: sceneWindow.SceneWindow | null = null;
  let running: { key: string, name: string, mode: string, sound: string, frameRate?: number } | null = null; // while sending
  let error = '';
  let counts = { late: 0, dropped: 0 };
  let watch: NodeJS.Timeout | null = null;
  let tap: { stop(): void } | null = null;
  let gaps = { gaps: 0, skipped: 0 };

  if (!addon) log(`DeckLink output unavailable: ${loadError}`);

  function devices(): Devices {
    if (!addon) return { ok: false, error: 'This copy of Studio was built without DeckLink output (cd native/decklink && npm install && npm run build).' };
    try { return addon.devices(); } catch (err) { return { ok: false, error: errorMessage(err) }; }
  }

  function status(): Status {
    const s: AddonStatus = addon ? addon.status() : { running: false };
    return { running: !!s.running, name: s.name || '', mode: running?.mode || '', late: s.late || 0, dropped: s.dropped || 0, sound: running?.sound || '', error };
  }

  const report = () => onStatus(status(), output);
  let output = 'main'; // the output it's sending

  function stop() {
    if (watch) { clearInterval(watch); watch = null; }
    if (tap) { tap.stop(); tap = null; }
    if (win) { win.destroy(); win = null; }
    if (running) log(`DeckLink output stopped (${running.name})`);
    running = null;
    if (addon) addon.stop();
  }

  // w: { device, mode, keying, straight, sound, density, output } from outputs.js, or null to stop. sound: where the
  // window's sound goes (outputs.js Sound goes to): 'sdi' (embedded, on the fill), 'mac' (the Mac's sound output),
  // 'both', or 'none' (the window is muted: the sound goes only to the Mac's other sound outputs, by its copies).
  function show(w: Wanted | null) {
    const key = w && JSON.stringify([w.device, w.mode, w.keying, w.straight, w.sound, w.density || 1, w.output]);
    if (key && running?.key === key) return;
    stop();
    error = '';
    if (!w || !key) return report();
    output = w.output || 'main';
    if (!addon) { error = 'DeckLink output isn\'t in this copy of Studio.'; return report(); }
    const dl = addon;

    const list = devices();
    const device = list.ok ? list.devices.find(d => d.id === w.device) : undefined;
    const mode = device?.modes.find(m => m.mode === w.mode);
    const inSdi = w.sound === 'sdi' || w.sound === 'both';
    const onMac = w.sound === 'mac' || w.sound === 'both';
    const r = dl.start({ device: w.device, mode: w.mode, keying: w.keying, straight: !!w.straight, audio: inSdi });
    if (!r.ok) {
      // A format the device said it can't send: say that rather than guess at another app holding it.
      error = device && mode && mode.supported === false ? `${device.name} says it can't send ${mode.name}. Pick another video format.` : r.error;
      log(`DeckLink output failed on ${device?.name || w.device}: ${error}`);
      return report();
    }
    // The sound: in the SDI when asked and the device took it (else on the Mac, so it isn't lost), on the Mac, or none.
    const sound = inSdi && r.audio ? (onMac ? 'both' : 'sdi') : inSdi || onMac ? 'mac' : 'none';
    running = { key, name: r.name, mode: mode?.name || '', sound, frameRate: r.frameRate };
    counts = { late: 0, dropped: 0 };
    gaps = { gaps: 0, skipped: 0 };
    log(`DeckLink output on ${r.name}: ${running.mode} (${r.width} x ${r.height}, ${r.frameRate} fps), ${w.keying === 'external' ? 'fill and key' : 'fill only'}${w.straight ? ', straight alpha' : ''}, `
      + (sound === 'none' ? 'no sound from its window' : sound === 'mac' ? `sound on the Mac${inSdi ? ` (${r.name} wouldn't take sound)` : ''}` : `sound in the SDI${w.keying === 'external' ? ' fill' : ''}${sound === 'both' ? ' and on the Mac' : ''}`));

    win = sceneWindow.create({
      port, width: r.width, height: r.height, frameRate: r.frameRate, log, label: 'DeckLink output', output, density: w.density || 1, mute: sound === 'none',
      onFrame: (bitmap, width, height) => dl.frame(bitmap, width, height),
    });
    const contents = win.contents();
    if ((sound === 'sdi' || sound === 'both') && contents) {
      // When the sound ran dry (the device had nothing to play), over the last minute, for the meter's line.
      const dry: number[] = [];
      let gapsSeen = 0;
      tap = soundTap.create({
        contents, echo: sound === 'both', log, label: 'DeckLink output', onSound: pcm => dl.audio(pcm),
        onLevel: peak => {
          const now = Date.now(), g = dl.status().gaps || 0;
          if (g > gapsSeen) dry.push(...Array(g - gapsSeen).fill(now));
          gapsSeen = g;
          while (dry.length && now - dry[0] > 60000) dry.shift();
          onLevel({ peak, dry: dry.length }, output);
        },
      });
    }

    // Log when the device has to repeat or drop frames (the Mac falling behind).
    watch = setInterval(() => {
      const s = status();
      if (s.late > counts.late || s.dropped > counts.dropped) log(`DeckLink output: ${s.late - counts.late} late and ${s.dropped - counts.dropped} dropped frames in the last minute`);
      counts = { late: s.late, dropped: s.dropped };
      const a = dl.status(), aGaps = a.gaps || 0, aSkipped = a.skipped || 0;
      if (aGaps > gaps.gaps || aSkipped > gaps.skipped) log(`DeckLink output: the sound ran dry ${aGaps - gaps.gaps} times and ${aSkipped - gaps.skipped} pieces were left out to catch up in the last minute`);
      gaps = { gaps: aGaps, skipped: aSkipped };
      report();
    }, 60000);
    report();
  }

  // The scene window sending now, for desktop/perf.ts.
  const windows = () => win && running ? [{ output, contents: win.contents(), target: running.frameRate }] : [];

  // ─── The SDI input's timecode ─────────────────────────────────────────────
  // want: { device } (an id, or '' for the first device with an input) to read, or null to stop.
  let inputTimer: NodeJS.Timeout | null = null;
  let reading = '';
  function readInput(want: { device: string } | null) {
    const stopReading = () => {
      if (inputTimer) { clearInterval(inputTimer); inputTimer = null; }
      if (reading && addon) { addon.inputStop(); log(`Stopped reading the timecode on ${reading}`); }
      reading = '';
    };
    if (!want) { stopReading(); return; }
    const send = (s: InputStatus, error = '') => onTimecode({ name: s.name || '', signal: !!s.signal, timecode: s.timecode || '', fps: s.fps || 0, at: Date.now(), error });
    if (!addon) { send({}, "This copy of Studio was built without Blackmagic support."); return; }
    const dl = addon;
    const list = devices();
    const device = list.ok ? list.devices.find(d => (want.device ? d.id === want.device : d.input)) : undefined;
    if (!device) { send({}, list.ok ? 'No Blackmagic device with an SDI input is connected.' : list.error); return; }
    if (inputTimer && dl.inputStatus().device === device.id) return;
    stopReading();
    const r = dl.inputStart({ device: device.id });
    if (!r.ok) { log(`Couldn't read the timecode on ${device.name}: ${r.error}`); send({ name: device.name }, r.error); return; }
    reading = r.name;
    log(`Reading the timecode coming into ${r.name}`);
    // Checked every 10 ms, so a change of timecode reaches the helper within a fraction of a frame.
    let last = '', sentAt = 0;
    inputTimer = setInterval(() => {
      const s = dl.inputStatus();
      if (!s.running) return;
      const now = Date.now();
      if (s.timecode !== last || now - sentAt >= 500) { last = s.timecode || ''; sentAt = now; send(s); }
    }, 10);
  }

  return { devices, show, stop, status, windows, readInput };
}

export type { Wanted };
export { create };
