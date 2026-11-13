// FirstPass Studio - the branding page's script (branding.html loads it as a module, so its names stay its own).

(function () {
  const params = new URLSearchParams(location.search);
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const root = document.documentElement.style;
  const num = (k: string) => { const v = parseFloat(params.get(k) ?? ''); return Number.isFinite(v) ? v : null; };
  const edge = num('edge'), gap = num('gap'), top = num('top'), size = num('size');
  if (edge !== null) root.setProperty('--edge', edge + 'px');
  if (gap !== null) { root.setProperty('--gap', gap + 'px'); document.body.classList.add('from-centre'); }
  if (top !== null) root.setProperty('--mid', top + 'px');
  if (size !== null && size > 0) {
    const css = getComputedStyle(document.documentElement);
    ['--pivt', '--studio', '--comp'].forEach(v => root.setProperty(v, parseFloat(css.getPropertyValue(v)) * size + 'px'));
  }
  // The brand kit's two FirstPass Studio logos: dark for a dark picture behind it, light for a light one.
  const dark = (params.get('mode') || params.get('theme') || 'light').toLowerCase() === 'dark';
  if (dark) $<HTMLImageElement>('studio').src = 'studio/firstpass-studio.svg';
  $('pivt').hidden = params.get('pivt') === '0';
  $('studio').hidden = params.get('studio') === '0';
  $('left').hidden = $('pivt').hidden && $('studio').hidden;

  async function load() {
    if (params.get('comp') === '0') return;
    try {
      const res = await fetch('/api/scoreboard', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const rules: LogoRules = (await res.json()).rules || {};
      const logo = (dark ? rules.competitionLogoDark : rules.competitionLogoLight) || rules.competitionLogo;
      if (!logo) { console.warn('Branding: the competition setup has no competition logo'); return; }
      $<HTMLImageElement>('comp').src = logo;
      $('right').hidden = false;
    } catch (err) { console.warn('Branding: competition logo unavailable:', err instanceof Error ? err.message : err); }
  }
  load();
})();

// What makes this file a module (its names its own), as the first line says.
export {};
