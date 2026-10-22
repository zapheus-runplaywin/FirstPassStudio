// FirstPass Studio - sound for animations: effects made on the spot with Web Audio (no sound files to ship), and a
// theme (a song from the media folder), played to a plan a page sends with pagesound.js:
//   { theme: { file, volume 0..1, at }, sfx: 0..1, cues: [[sec, effect, gain], ...] }
// Times are seconds from when the plan arrives; a theme at a negative time starts that far into the song.
// In the Output page's scene, scene.html plays the plan (so it's heard only where Studio's sound goes); on its own
// (an OBS browser source) the page plays it.
//   StudioSfx.run(ctx, destination, plan)  starts it; returns { stop(fadeSec) }
//   StudioSfx.EFFECTS                      the effects' names
/* exported StudioSfx */
const StudioSfx = (() => {
  // White noise and a hall's echo, made once for each audio context.
  const kits = new WeakMap();
  function kit(ctx) {
    let k = kits.get(ctx);
    if (k) return k;
    const sr = ctx.sampleRate, noise = ctx.createBuffer(1, sr * 2, sr), d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const ir = ctx.createBuffer(2, Math.round(sr * 1.8), sr);
    for (let c = 0; c < 2; c++) { const x = ir.getChannelData(c); for (let i = 0; i < x.length; i++) x[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / x.length, 3); }
    k = { noise, ir };
    kits.set(ctx, k);
    return k;
  }

  // ─── Building blocks: each sound is sources through a filter into a level that rises and falls ───
  // A level: up to peak over a, then away over d (exponential, as loudness is heard).
  function level(ctx, to, t, a, peak, d) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    g.connect(to);
    return g;
  }
  function tone(ctx, to, type, f0, f1, t, dur) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    o.connect(to);
    o.start(t);
    o.stop(t + dur + .05);
    return o;
  }
  function hiss(ctx, to, t, dur) {
    const s = ctx.createBufferSource();
    s.buffer = kit(ctx).noise;
    s.loop = true;
    s.connect(to);
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + .05);
    return s;
  }
  function filter(ctx, to, type, f0, f1, t, dur, q = 1) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    f.connect(to);
    return f;
  }
  function pan(ctx, to, from, end, t, dur) {
    if (!ctx.createStereoPanner) return to;
    const p = ctx.createStereoPanner();
    p.pan.setValueAtTime(from, t);
    if (end !== from) p.pan.linearRampToValueAtTime(end, t + dur);
    p.connect(to);
    return p;
  }
  // Sends some of a sound to the echo as well as straight out.
  function out(ctx, bus, wet) {
    const g = ctx.createGain();
    g.connect(bus.dry);
    if (wet) { const w = ctx.createGain(); w.gain.value = wet; g.connect(w); w.connect(bus.wet); }
    return g;
  }
  // Rushing air, low to high (or high to low), across the stereo.
  function whoosh(ctx, bus, t, g, { dur = .7, f0 = 250, f1 = 2200, p0 = 0, p1 = 0, peak = .5, wet = .3 } = {}) {
    const lv = ctx.createGain();
    lv.gain.setValueAtTime(0.0001, t);
    lv.gain.linearRampToValueAtTime(peak * g, t + dur * .62);
    lv.gain.linearRampToValueAtTime(0.0001, t + dur);
    lv.connect(pan(ctx, out(ctx, bus, wet), p0, p1, t, dur));
    hiss(ctx, filter(ctx, lv, 'bandpass', f0, f1, t, dur, 1.1), t, dur);
  }
  // A low knock, like a body landing or a ball caught.
  function knock(ctx, bus, t, g, { f0 = 150, f1 = 55, dur = .22, peak = .7, slap = .35, slapF = 1100, wet = .15 } = {}) {
    const o = out(ctx, bus, wet);
    tone(ctx, level(ctx, o, t, .004, peak * g, dur), 'sine', f0, f1, t, dur);
    if (slap) hiss(ctx, filter(ctx, level(ctx, o, t, .002, slap * g, .06), 'bandpass', slapF, slapF, t, .08, .9), t, .08);
  }
  function chord(ctx, bus, t, g, notes, { a = .01, d = 1.2, peak = .12, step = .05, type = 'sine', wet = .6 } = {}) {
    const o = out(ctx, bus, wet);
    notes.forEach((f, i) => {
      const at = t + i * step;
      tone(ctx, level(ctx, o, at, a, peak * g, d), type, f, f, at, a + d);
      tone(ctx, level(ctx, o, at, a, peak * g * .3, d * .6), 'triangle', f * 2, f * 2, at, a + d);
    });
  }

  // ─── The effects: (ctx, bus, time, gain) ───
  const FX = {
    // Comes in, from one side to the other.
    whoosh: (c, b, t, g) => whoosh(c, b, t, g, { p0: -.6, p1: .6 }),
    // A long rush that swings round the stereo (logos spiralling in).
    swirl: (c, b, t, g) => whoosh(c, b, t, g, { dur: 1.5, f0: 180, f1: 3000, p0: -.9, p1: .9, peak: .45 }),
    // Goes away: high to low.
    out: (c, b, t, g) => whoosh(c, b, t, g, { dur: .8, f0: 2600, f1: 200, p0: .3, p1: -.3, peak: .4 }),
    // The ball thrown: a short rush.
    pass: (c, b, t, g) => whoosh(c, b, t, g, { dur: .26, f0: 600, f1: 2400, peak: .22, wet: .1 }),
    // The ball caught: a slap and a thump.
    catch: (c, b, t, g) => knock(c, b, t, g, { f0: 190, f1: 70, dur: .16, peak: .55, slap: .55, slapF: 1500 }),
    // Feet landing.
    stomp: (c, b, t, g) => knock(c, b, t, g, { f0: 120, f1: 48, dur: .22, peak: .5, slap: .15, slapF: 500 }),
    // A light popping on.
    pop(c, b, t, g) {
      const o = out(c, b, .2);
      tone(c, level(c, o, t, .003, .45 * g, .12), 'sine', 900, 260, t, .12);
      hiss(c, filter(c, level(c, o, t, .001, .2 * g, .02), 'highpass', 2500, 2500, t, .03), t, .03);
    },
    // A tile turning up: a dry click.
    tick(c, b, t, g) {
      const o = out(c, b, .05);
      hiss(c, filter(c, level(c, o, t, .001, .22 * g, .025), 'highpass', 3200, 3200, t, .04), t, .04);
      tone(c, level(c, o, t, .001, .08 * g, .03), 'sine', 1900, 1700, t, .04);
    },
    // A tile flipping over: a woody clack.
    clack(c, b, t, g) {
      const o = out(c, b, .12);
      hiss(c, filter(c, level(c, o, t, .002, .35 * g, .06), 'bandpass', 950, 950, t, .08, 3), t, .08);
      tone(c, level(c, o, t, .002, .18 * g, .07), 'sine', 320, 190, t, .08);
    },
    // A big theatre light switching on: a deep clunk in a hall.
    clunk(c, b, t, g) {
      knock(c, b, t, g, { f0: 75, f1: 42, dur: .35, peak: .75, slap: .45, slapF: 260, wet: .55 });
      const o = out(c, b, .3);
      hiss(c, filter(c, level(c, o, t, .001, .18 * g, .015), 'highpass', 4000, 4000, t, .03), t, .03);
    },
    // The lights all coming up: a rush and a warm chord.
    swell(c, b, t, g) {
      whoosh(c, b, t, g, { dur: 1, f0: 300, f1: 3500, peak: .3, wet: .5 });
      chord(c, b, t + .55, g, [261.6, 329.6, 392, 523.3], { a: .35, d: 1.6, peak: .07, step: 0, wet: .7 });
    },
    // The big moment: an impact with a hall's echo.
    boom(c, b, t, g) {
      const o = out(c, b, .5);
      tone(c, level(c, o, t, .004, .9 * g, 1.3), 'sine', 115, 36, t, 1.3);
      hiss(c, filter(c, level(c, o, t, .004, .55 * g, .8), 'lowpass', 900, 180, t, .9), t, .9);
      hiss(c, filter(c, level(c, o, t, .001, .3 * g, .08), 'highpass', 2500, 2500, t, .1), t, .1);
    },
    // A bright sparkle of bells.
    shimmer: (c, b, t, g) => chord(c, b, t, g, [1046.5, 1318.5, 1568, 2093]),
    // The words rising in: a soft airy lift.
    rise: (c, b, t, g) => whoosh(c, b, t, g, { dur: .55, f0: 900, f1: 6000, peak: .12, wet: .4 }),
    // The ball through the ring: a net's swish.
    swish(c, b, t, g) {
      const o = out(c, b, .2);
      hiss(c, filter(c, level(c, o, t, .03, .35 * g, .28), 'bandpass', 3200, 5200, t, .32, 1.2), t, .32);
    },
    // The umpire's whistle: a pea whistle's trill.
    whistle(c, b, t, g) {
      const o = out(c, b, .35), dur = .55;
      const lv = c.createGain();
      lv.gain.setValueAtTime(0.0001, t);
      lv.gain.exponentialRampToValueAtTime(.16 * g, t + .02);
      lv.gain.setValueAtTime(.16 * g, t + dur - .06);
      lv.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      lv.connect(o);
      const trill = c.createOscillator(), depth = c.createGain();
      trill.frequency.value = 32;
      depth.gain.value = 90;
      trill.connect(depth);
      trill.start(t); trill.stop(t + dur + .05);
      [2850, 2905].forEach(f => { const w = tone(c, lv, 'sine', f, f, t, dur); depth.connect(w.frequency); });
      hiss(c, filter(c, level(c, o, t, .02, .05 * g, dur), 'bandpass', 2880, 2880, t, dur, 6), t, dur);
    },
    // The blueprint grid powering on: a low electric hum.
    hum(c, b, t, g) {
      const o = out(c, b, .25), lp = filter(c, o, 'lowpass', 250, 1400, t, .8);
      const lv = c.createGain();
      lv.gain.setValueAtTime(0.0001, t);
      lv.gain.exponentialRampToValueAtTime(.12 * g, t + .25);
      lv.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      lv.connect(lp);
      tone(c, lv, 'sawtooth', 55, 55, t, 1.6);
      tone(c, lv, 'sawtooth', 110.5, 110.5, t, 1.6);
    },
    // A laser sketching: a buzzing sweep down.
    laser(c, b, t, g) {
      const dur = .7, o = pan(c, out(c, b, .3), Math.random() - .5, Math.random() - .5, t, dur);
      const bp = filter(c, level(c, o, t, .02, .06 * g, dur), 'bandpass', 1600, 1600, t, dur, 2);
      const w = tone(c, bp, 'sawtooth', 2400, 650, t, dur);
      const lfo = c.createOscillator(), depth = c.createGain();
      lfo.frequency.value = 19; depth.gain.value = 70;
      lfo.connect(depth); depth.connect(w.frequency);
      lfo.start(t); lfo.stop(t + dur + .05);
    },
    // A blueprint turning solid: a quick bright zap and pop.
    zap(c, b, t, g) {
      const o = out(c, b, .25);
      tone(c, level(c, o, t, .003, .06 * g, .12), 'square', 700, 2100, t, .12);
      FX.pop(c, b, t + .02, g * .7);
    },
    // Tiny glints flying out.
    sparkle(c, b, t, g) {
      for (let i = 0; i < 14; i++) {
        const at = t + Math.random() * 1.1, f = 2200 + Math.random() * 3200;
        tone(c, level(c, pan(c, out(c, b, .5), Math.random() * 1.6 - .8, 0, at, 0), at, .002, .045 * g, .09), 'sine', f, f, at, .1);
      }
    },
  };

  function run(ctx, dest, plan) {
    const now = ctx.currentTime + .03;
    // A limiter at the end, so effects landing together (and on a loud theme) don't distort.
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -8; limit.knee.value = 6; limit.ratio.value = 12; limit.attack.value = .003; limit.release.value = .2;
    limit.connect(dest);
    const all = ctx.createGain();
    all.connect(limit);
    // Effects: straight out, and through the echo.
    const sfx = ctx.createGain();
    sfx.gain.value = Math.max(0, Math.min(1.5, plan.sfx ?? 1));
    sfx.connect(all);
    const verb = ctx.createConvolver();
    verb.buffer = kit(ctx).ir;
    verb.connect(sfx);
    const bus = { dry: sfx, wet: ctx.createGain() };
    bus.wet.gain.value = .5;
    bus.wet.connect(verb);
    if (sfx.gain.value > 0) for (const [sec, name, gain] of plan.cues || []) {
      if (sec < -.05 || !FX[name]) continue;
      try { FX[name](ctx, bus, now + Math.max(0, sec), gain ?? 1); } catch (err) { console.warn(`Sound effect ${name} failed:`, err.message); }
    }
    // The theme: a song played as it is, from its start at its time (or part way in, if it starts before now).
    let el = null, src = null, timer = null;
    const th = plan.theme;
    if (th && (th.file || th.buffer)) {
      const tg = ctx.createGain();
      tg.gain.value = Math.max(0, Math.min(1.5, th.volume ?? 1));
      tg.connect(all);
      const at = th.at || 0;
      if (th.buffer) {
        src = ctx.createBufferSource();
        src.buffer = th.buffer;
        src.connect(tg);
        src.start(now + Math.max(0, at), Math.max(0, -at));
      } else {
        el = new Audio('/media/' + encodeURIComponent(th.file));
        el.preload = 'auto';
        ctx.createMediaElementSource(el).connect(tg);
        const go = () => {
          if (at < 0) { try { el.currentTime = -at; } catch { /* starts from the top */ } }
          el.play().catch(err => { console.warn(`Theme "${th.file}" would not play: ${err.message}`); if (plan.onBlocked && err.name === 'NotAllowedError') plan.onBlocked(); });
        };
        if (at > 0) timer = setTimeout(go, at * 1000); else go();
      }
    }
    return {
      stop(fade = .4) {
        clearTimeout(timer);
        const t = ctx.currentTime;
        all.gain.cancelScheduledValues(t);
        all.gain.setValueAtTime(all.gain.value, t);
        all.gain.linearRampToValueAtTime(0, t + Math.max(.02, fade));
        setTimeout(() => {
          if (el) { el.pause(); el.removeAttribute('src'); el.load(); }
          if (src) try { src.stop(); } catch { /* already stopped */ }
          all.disconnect();
          limit.disconnect();
        }, Math.max(.02, fade) * 1000 + 100);
      },
    };
  }

  return { run, EFFECTS: Object.keys(FX) };
})();
