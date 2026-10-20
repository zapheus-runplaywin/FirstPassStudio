// FirstPass Studio - tells the Output page's scene that this page has finished animating away, so the scene
// switches its source off (and the Stream Deck key and the Sources list show it off) instead of leaving
// a see-through layer on. Pages call it only when they really leave the frame clear (?out=8, ?end=out and so on),
// never when they stay on screen or wait for something to happen.
//   studioDone(ms)              done in ms, once the page's own exit animation has had time to finish
//   studioDone.afterAnimations() done once every CSS animation that ends has ended (pages timed all in CSS)
// On its own (not in the scene, like an OBS browser source) it does nothing.
(function () {
  let sent = false;
  function send() {
    if (sent || window.parent === window) return;
    sent = true;
    window.pageLog && window.pageLog('info', 'Animated away: telling the scene to switch this source off');
    window.parent.postMessage({ studio: 'done' }, '*');
  }
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const frame = () => new Promise(r => requestAnimationFrame(() => r()));
  window.studioDone = (ms = 0) => { setTimeout(send, Math.max(0, ms)); };
  // Animations that loop for ever (or are paused) are left out; anything still going after a minute is given up on.
  window.studioDone.afterAnimations = async () => {
    const until = Date.now() + 60000;
    await frame(); await frame(); // let classes just added start their animations
    while (Date.now() < until) {
      const left = document.getAnimations().filter(a => a.playState === 'running' && a.effect && a.effect.getComputedTiming().endTime !== Infinity);
      if (!left.length) break;
      await Promise.race([Promise.allSettled(left.map(a => a.finished)), wait(until - Date.now())]);
      await frame();
    }
    send();
  };
})();
