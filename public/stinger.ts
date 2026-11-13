// FirstPass Studio - the stinger's script (stinger.html loads it as a module, so its names stay its own).

// When the stinger covers the whole frame, in seconds from its start, for a page or test timing a cut to it.
declare global { interface Window { stingerCover?: number[] } }

(function () {
  const params = new URLSearchParams(location.search);
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const stage = $('stage');
  const LABEL = 'Stinger';
  const num = (k: string) => { const v = parseFloat(params.get(k) ?? ''); return Number.isFinite(v) && v >= 0 ? v : null; };
  const length = Math.min(3, Math.max(.5, num('length') || 1));
  // 0 to 1 second in tenths (100 ms steps).
  const hold = Math.round(Math.min(1, num('hold') ?? .5) * 10) / 10;
  // The hold is in real seconds, so it's set on the slowed or sped up CSS clock as hold / length.
  document.documentElement.style.setProperty('--hold', hold / length + 's');
  const withLogo = params.get('logo') !== '0';
  const dark = (params.get('mode') || 'light').toLowerCase() === 'dark';
  const size = num('size');
  if (size) document.documentElement.style.setProperty('--size', size + 'px');
  // When the whole frame is covered, in seconds from the start, for anyone timing a cut to it.
  const cover = [.22 * length, .72 * length + hold];
  window.stingerCover = cover;

  function play() {
    stage.classList.add('go');
    // Timed in CSS for 1 second plus the hold; another length plays the whole thing faster or slower.
    if (length !== 1) stage.getAnimations({ subtree: true }).forEach(a => { a.playbackRate = 1 / length; });
    const sfx = (num('sfx') ?? 80) / 100;
    if (sfx > 0) studioSound({ sfx, cues: [[0, 'whoosh', 1], [.58 * length + hold, 'out', .7]] });
    console.info(`${LABEL}: ${length + hold} s, frame covered ${cover.map(s => s.toFixed(2)).join(' to ')} s`);
    // In the scene, it tells it when it started and when it covers the frame, so a switcher cut can land underneath.
    if (window.parent !== window) window.parent.postMessage({ studio: 'stinger', cover }, '*');
    studioDone.afterAnimations();
  }

  async function load() {
    if (!withLogo) { $('glow').hidden = true; play(); return; }
    let logo: string | undefined;
    try {
      const res = await fetch('/api/scoreboard', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const rules: LogoRules = (await res.json()).rules || {};
      logo = (dark ? rules.competitionLogoDark : rules.competitionLogoLight) || rules.competitionLogo;
      if (!logo) console.warn(`${LABEL}: the competition setup has no competition logo, so it plays with the colours only`);
    } catch (err) { console.warn(`${LABEL}: competition logo unavailable, so it plays with the colours only:`, err instanceof Error ? err.message : err); }
    if (!logo) { $('glow').hidden = true; play(); return; }
    // Starts once the logo has loaded (or couldn't), so it never sweeps in with an empty box.
    const img = $<HTMLImageElement>('logo');
    img.onerror = () => { console.warn(`${LABEL}: could not load the competition logo`, logo); };
    img.src = logo;
    try { await img.decode(); img.hidden = false; } catch { $('glow').hidden = true; }
    if (document.fonts) await document.fonts.ready;
    play();
  }
  load();
})();

// What makes this file a module (its names its own), as the first line says.
export {};
