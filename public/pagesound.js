// FirstPass Studio - a page's side of animation sound (sfx.js has the effects and the plan's shape).
//   studioSound(plan)         plays the plan: in the Output page's scene, scene.html plays it (only in the scene
//                             windows that make sound, and stops it when the source goes off); on its own, like an
//                             OBS browser source, the page plays it (?sound=0 keeps it quiet). Elsewhere (the
//                             Graphics page's previews) it's silent.
//   studioSound.lengthOf(file) a song in the media folder's length in seconds, or null if it can't be read in time
(function () {
  const params = new URLSearchParams(location.search);
  let here = null;
  window.studioSound = plan => {
    const clean = JSON.parse(JSON.stringify(plan)); // only what a message can carry
    if (window.parent !== window) { window.parent.postMessage({ studio: 'sound', plan: clean }, '*'); return; }
    if (params.get('sound') === '0' || typeof StudioSfx === 'undefined') return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    if (ctx.state === 'suspended') { ctx.resume().catch(() => {}); console.warn('Sound: this browser may block it until the page is clicked'); }
    if (here) here.stop(.1);
    here = StudioSfx.run(ctx, ctx.destination, clean);
  };
  window.studioSound.lengthOf = (file, waitMs = 4000) => new Promise(resolve => {
    const a = new Audio();
    const done = v => { clearTimeout(t); a.removeAttribute('src'); resolve(v); };
    const t = setTimeout(() => done(null), waitMs);
    a.preload = 'metadata';
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) && a.duration > 0 ? a.duration : null);
    a.onerror = () => done(null);
    a.src = '/media/' + encodeURIComponent(file);
  });
})();
