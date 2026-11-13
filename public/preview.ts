// FirstPass Studio - the Scene View page's script (preview.html loads it as a module, so its names stay its own).
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const frame = $<HTMLIFrameElement>('frame');
const scene = () => { try { return frame.contentWindow; } catch { return null; } };

// Scale the 1920 x 1080 frame to fit the window, centred, with the window's colour around it.
function fit() {
  const k = Math.min(innerWidth / 1920, innerHeight / 1080);
  Object.assign($('box').style, { width: 1920 * k + 'px', height: 1080 * k + 'px', left: (innerWidth - 1920 * k) / 2 + 'px', top: (innerHeight - 1080 * k) / 2 + 'px' });
  frame.style.transform = `scale(${k})`;
}
addEventListener('resize', fit);
fit();

// The window follows the output it shows (its name, and chroma key safe while a chroma output is), checking every few
// seconds, and tells the Output page it's open. It never plays sound, like the Output page's own Scene View.
// Another output than the primary (?output=<id>): its sources.
const outputId = /^[a-z0-9]{1,20}$/i.test(new URLSearchParams(location.search).get('output') || '') ? new URLSearchParams(location.search).get('output') || 'main' : 'main';
async function follow() {
  try {
    const o: OutputsState & Partial<OutputInfo> = await (await fetch('/api/outputs')).json();
    // While a chroma output is chroma key safe, the Scene View shows the scene that way too.
    const mine = (o.outputs || []).find(x => x.id === outputId) || o;
    const src = `/scene.html?mute=1${outputId !== 'main' ? `&output=${outputId}` : ''}${mine.chromaSafeNow ? '&chromaKey=true' : ''}`;
    if (frame.getAttribute('src') !== src) frame.src = src;
    if (outputId !== 'main') document.title = `Scene View · ${mine.name || 'Output'} · FirstPass Studio`;
  } catch {}
  tell();
}
frame.addEventListener('load', () => follow());
setInterval(() => follow(), 5000);

// Sources: show or hide each one from here, following the scene live (the Output page, the Stream Deck).
const act = (action: { type: string; [more: string]: unknown }) => fetch('/api/scene', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(action) })
  .catch((err: unknown) => console.warn('Scene change failed', action.type, err instanceof Error ? err.message : String(err)));
function showSources(scn: SceneState) {
  const ul = $<HTMLUListElement>('sources');
  ul.innerHTML = scn.sources.length ? '' : '<li><span style="color:#94A3B8">No sources yet</span></li>';
  for (const src of scn.sources) {
    const li = document.createElement('li');
    li.innerHTML = '<button class="eye"></button><span></span>';
    const eye = li.querySelector<HTMLButtonElement>('button')!;
    const on = outputId === 'main' ? src.visible : !!(src.out && src.out[outputId]);
    eye.textContent = on ? 'On' : 'Off';
    eye.classList.toggle('on', on);
    eye.title = on ? 'Showing: click to fade it out' : 'Hidden: click to fade it in';
    eye.onclick = () => act({ type: 'toggle', id: src.id, ...(outputId !== 'main' ? { output: outputId } : {}) });
    li.querySelector<HTMLElement>('span')!.textContent = src.name;
    ul.append(li);
  }
}
// Scenes: go to one from here. The current one is orange, with a dot when something's changed since.
const BANDS: Record<string, string> = { blue: '#3b82f6', green: '#22c55e', grey: '#a1a1aa', yellow: '#facc15', purple: '#a855f7' };
function showScenes(scn: SceneState) {
  const box = $('scenes');
  box.innerHTML = '';
  // Every scene (the outputs share them), with this output's current one; a click plays it on this output.
  const main = outputId === 'main';
  const current = main ? scn.current : (scn.currentOut || {})[outputId];
  const changedNow = main ? scn.changed : (scn.changedOut || {})[outputId];
  for (const sc of scn.scenes || []) {
    const b = document.createElement('button');
    b.textContent = sc.name;
    b.style.setProperty('--band', BANDS[sc.colour] || BANDS.blue);
    const cur = sc.id === current, changed = cur && (changedNow || []).length > 0;
    b.className = (cur ? 'cur' : '') + (changed ? ' changed' : '');
    b.title = cur ? (changed ? `Back to ${sc.name} as saved` : `${sc.name} is on now`) : `Go to ${sc.name}`;
    b.onclick = () => act({ type: 'sceneGo', scene: sc.id, ...(main ? {} : { output: outputId }) });
    box.append(b);
  }
}
sceneEvents<SceneState>(scn => { showScenes(scn); showSources(scn); });
$<HTMLButtonElement>('hideAll').onclick = () => act({ type: 'hideAll', ...(outputId !== 'main' ? { output: outputId } : {}) });
const fold = (min: boolean) => {
  $('panel').classList.toggle('min', min);
  $<HTMLButtonElement>('fold').textContent = min ? 'Show' : '–';
  try { localStorage.setItem('previewPanel', min ? 'min' : ''); } catch {}
};
$<HTMLButtonElement>('fold').onclick = () => fold(!$('panel').classList.contains('min'));
try { fold(localStorage.getItem('previewPanel') === 'min'); } catch {}

// The Output page knows this window is open (and turns its own preview off) through this channel.
// It also hears from it every couple of seconds: the Mac app's window can close without the
// goodbye below ever arriving, and then the Output page puts its own preview back by itself.
const channel = new BroadcastChannel('studio-preview');
let closing = false;
const tell = (open = true) => { if (!closing || !open) channel.postMessage({ open }); };
const goodbye = () => {
  if (closing) return;
  tell(false);
  closing = true;
};
channel.onmessage = e => {
  if (e.data === 'ask') follow(); // and says it's open
  if (e.data === 'focus') { focus(); tell(); }
  // Say goodbye before closing, not as the window goes, so the Output page always hears it.
  if (e.data === 'close') { goodbye(); setTimeout(close, 50); }
};
addEventListener('pagehide', goodbye);
setInterval(() => tell(), 2000);
tell();

// What makes this file a module (its names its own), as the first line says.
export {};
