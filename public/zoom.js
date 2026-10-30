// Draws a 1920 x 1080 graphic sharp in a bigger window, such as a browser source set to 3840 x 2160 for a 4K
// recording: the page is zoomed by the whole number of times the frame fits (2 at 3840 x 2160), so its text and
// shapes are laid out again at that size rather than stretched. At 1920 x 1080, or smaller (the Output page's
// Scene View, a half-size preview), nothing changes, and neither does a page the scene fits itself (?fit=1).
//
// The same goes for a 4K output, which draws the scene at twice the density (devicePixelRatio 2). Text and shapes
// follow by themselves; a canvas doesn't, so a page that draws on one gets it from sharpCanvas(canvas): its backing
// is sized for every real pixel (devicePixelRatio times the zoom) and kept so when that changes, and the context
// it gives back draws in the page's own 1920 x 1080 units. Load it in <head>, after log.js.
(function () {
  'use strict';
  window.studioZoom = 1;
  // Called again for the same canvas (an animation played again), it gives back the same context.
  const sharp = new WeakMap();
  window.sharpCanvas = canvas => {
    if (sharp.has(canvas)) return sharp.get(canvas);
    const ctx = canvas.getContext('2d');
    sharp.set(canvas, ctx);
    const w = canvas.width, h = canvas.height;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const size = () => {
      const k = Math.min(4, Math.max(1, Math.round((window.devicePixelRatio || 1) * window.studioZoom)));
      if (canvas.width !== w * k) { canvas.width = w * k; canvas.height = h * k; }
      ctx.setTransform(k, 0, 0, k, 0, 0);
    };
    size();
    addEventListener('studiozoom', size);
    addEventListener('resize', size); // devicePixelRatio changes (the window moved to another screen)
    return ctx;
  };
  if (new URLSearchParams(location.search).get('fit') === '1') return;
  // Only the page itself: a graphic inside the scene is in a 1920 x 1080 frame, which the scene draws as it should.
  if (window.top !== window) return;
  const fit = () => {
    const z = Math.max(1, Math.floor(Math.min(innerWidth / 1920, innerHeight / 1080) + 0.001));
    const was = window.studioZoom;
    window.studioZoom = z;
    document.documentElement.style.zoom = z > 1 ? String(z) : '';
    if (z !== was) {
      if (z > 1 && window.pageLog) window.pageLog('info', `Drawn at ${z}x for a ${innerWidth} x ${innerHeight} window`);
      dispatchEvent(new Event('studiozoom'));
    }
  };
  fit();
  addEventListener('resize', fit);
})();
