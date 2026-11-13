// FirstPass Studio Mac app - how hard each output is working, to check a Mac can run the outputs
// wanted before a stream night (desktop/outputs.ts asks for it; outputs.js logs it and the Output page
// shows it on each output's card).
//
// Every few seconds while an output is showing: the CPU and memory of each output's scene pages (the
// processes behind its windows), the frame rate its pages can draw at (requestAnimationFrame for a
// second, against the display's refresh rate or the video format's frame rate), and Studio as a whole,
// with the graphics processor on its own since every output draws through it.

import { app, type WebContents } from 'electron';

const EVERY_MS = 5000;

// Frames drawn in about a second. Chromium only draws when asked, so this asks; a page that can't keep
// up (the Mac too busy) draws fewer.
const PROBE = `new Promise(done => {
  let n = 0, t0 = 0;
  const tick = t => { if (!t0) t0 = t; else n++; if (t - t0 < 1000) requestAnimationFrame(tick); else done(n * 1000 / (t - t0)); };
  requestAnimationFrame(tick);
  setTimeout(() => done(t0 ? n * 1000 / (performance.now() - t0) : 0), 2000);
})`;

// windows(): [{ output, contents, target }] for every scene window showing now (target: the frames a
// second it should draw at). send(perf): { outputs: { id: { cpu, memMB, fps, target } }, total: { cpu, memMB, gpu } }.
// One scene window: its output, its page (null once closed) and the frames a second it should draw at.
interface Watched { output: string, contents: WebContents | null, target?: number }
interface OutputPerf { cpu: number, memMB: number, fps: number, target: number }
interface Perf { outputs: Record<string, OutputPerf>, total: { cpu: number, memMB: number, gpu: number } | null }

function create({ windows, send }: { windows: () => Watched[], send: (perf: Perf) => void }) {
  let timer: NodeJS.Timeout | null = null;
  let busy = false;

  async function sample() {
    if (busy) return;
    const list = windows().flatMap(w => w.contents && !w.contents.isDestroyed() ? [{ ...w, contents: w.contents }] : []);
    if (!list.length) { stop(); send({ outputs: {}, total: null }); return; }
    busy = true;
    try {
      // A page still loading doesn't run the probe until it has loaded, so don't wait on it.
      const late = () => new Promise<number>(done => setTimeout(() => done(0), 3000));
      const fps = await Promise.all(list.map(w => Promise.race([w.contents.executeJavaScript(PROBE).then(Number, () => 0), late()])));
      const byPid = new Map(app.getAppMetrics().map(m => [m.pid, m]));
      const counting: Record<string, OutputPerf & { pids: Set<number> }> = {};
      list.forEach((w, i) => {
        const o = counting[w.output] ||= { cpu: 0, memMB: 0, fps: Infinity, target: 0, pids: new Set() };
        const pid = w.contents.isDestroyed() ? 0 : w.contents.getOSProcessId();
        const m = byPid.get(pid);
        if (m && !o.pids.has(pid)) {
          o.pids.add(pid);
          o.cpu += m.cpu.percentCPUUsage;
          o.memMB += m.memory.workingSetSize / 1024;
        }
        // The slowest window speaks for the output (fill and key are two windows that must both keep up).
        if (fps[i] / (w.target || 60) < o.fps / (o.target || 60)) { o.fps = fps[i]; o.target = w.target || 60; }
      });
      const outputs: Record<string, OutputPerf> = {};
      for (const [id, o] of Object.entries(counting)) {
        outputs[id] = { cpu: Math.round(o.cpu), memMB: Math.round(o.memMB), fps: Math.round(o.fps === Infinity ? 0 : o.fps), target: Math.round(o.target) };
      }
      const all = [...byPid.values()];
      const total = {
        cpu: Math.round(all.reduce((n, m) => n + m.cpu.percentCPUUsage, 0)),
        memMB: Math.round(all.reduce((n, m) => n + m.memory.workingSetSize, 0) / 1024),
        gpu: Math.round(all.filter(m => m.type === 'GPU').reduce((n, m) => n + m.cpu.percentCPUUsage, 0)),
      };
      send({ outputs, total });
    } finally { busy = false; }
  }

  function start() { if (!timer) timer = setInterval(() => sample().catch(() => {}), EVERY_MS); }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }

  return { start, stop };
}

export type { Watched };
export { create };
