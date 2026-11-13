// FirstPass Studio - the title banner's script (title.html loads it as a module, so its names stay its own).

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
let emoji = '';
if (params.get('position') === 'bottom') document.body.classList.add('bottom');
const wide = params.get('layout') === 'wide';
if (wide) document.body.classList.add('wide');
if (wide && params.get('ends') === 'yellow') document.body.classList.add('yellow-ends');
let last = '';

// branding.html's logos sit 100px in from the frame's edges: the left pair's inside edge is about 660px from the centre, and the
// competition logo's about 750px (500px for the widest it allows). At most 600px wide keeps the banner well clear of both;
// the wide shape may take 1200px, 60px clear of the left pair and of a square competition logo.
const SCALE = 0.8, MAX_WIDTH = wide ? 1200 : 600;
function fitBetweenLogos() {
  const title = $('title');
  const s = Math.min(SCALE, MAX_WIDTH / title.offsetWidth);
  title.style.scale = String(Math.floor(s * 1000) / 1000);
  if (s < SCALE && window.pageLog) window.pageLog('info', `Title scaled to ${title.style.scale} to fit between the branding logos (${title.offsetWidth}px wide)`);
}

function setComp(name: string) {
  const comp = $('comp');
  comp.replaceChildren();
  const side = () => { const s = document.createElement('span'); s.className = 'fire'; s.textContent = emoji; return s; };
  if (emoji) comp.append(side(), ' ');
  comp.append(name);
  if (emoji) comp.append(' ', side());
}

async function load() {
  try {
    const s: ScoreboardView = await (await fetch('/api/scoreboard', { cache: 'no-store' })).json();
    const rules = s.rules || {};
    const compLogo = (params.get('mode') === 'dark' ? rules.competitionLogoDark : rules.competitionLogoLight) || rules.competitionLogo;
    const view = JSON.stringify([s.round, s.competition, s.venueName, compLogo]);
    if (view === last) return;
    last = view;
    emoji = (params.get('emoji') || '').trim();
    const logo = $<HTMLImageElement>('logo');
    // Off unless asked for: branding.html usually shows the competition logo beside the title.
    const showLogo = ['show', '1', 'on', 'true'].includes((params.get('logo') || '').toLowerCase());
    logo.hidden = !compLogo || !showLogo;
    if (compLogo && !logo.hidden) logo.src = compLogo;
    $('round').textContent = s.round || '';
    setComp(s.competition || '');
    $('venue').textContent = s.venueName || '';
    $('title').hidden = false;
    fitBetweenLogos();
    if (document.fonts) document.fonts.ready.then(fitBetweenLogos);
  } catch (err) { console.warn('Title unavailable:', err instanceof Error ? err.message : err); }
}
load();
sponsorSpot.naming('title').then(s => {
  if (!s) return;
  const box = $('sponsor');
  box.replaceChildren(sponsorSpot.badge(s));
  box.hidden = false;
  fitBetweenLogos();
});

// What makes this file a module (its names its own), as the first line says.
export {};
