// FirstPass Studio - the Output page, part 2 of 16: Scene View: the live scene drawn in the page (always silent) and the pop-out window.
// The page's script is split by section into public/output/, loaded in order by output.html; the files share one
// scope (plain scripts), so a name defined in an earlier part is in reach of a later one.

// The video output state lives here rather than in settings.js because fitting the preview reads it while this
// file loads, before a later file's functions exist.
// Display output (the Mac app opens the windows; outputs.js decides what goes where).
let out = null;
// The Scene View never plays sound (scene.html?mute=1): an output's sound plays where its Sound goes to says, whether
// the output is on or off, so nothing plays twice and nothing plays from a page that happens to be open.
// Clicking the preview brings the pop-out window forward while it's open.
$('preview').addEventListener('click', () => { if (popped) popChannel.postMessage('focus'); });
// For the tests: whether a switch to another output is still standing by.
window.previewSwitching = () => !!standby;

// ─── More than one output ─────────────────────────────────────────────
// The output picked on the page (its card in Video output, its tab over the Scene View): the one being set
// up, and the one the Scene View shows. Remembered in this browser.
let outSel = (() => { try { return localStorage.getItem('outputPicked') || 'main'; } catch { return 'main'; } })();
var previewOutput = 'main'; // the output the Scene View is drawing (var: showPreview can run before the outputs load)
const extraOutputs = () => (out && out.outputs ? out.outputs.filter(o => !o.primary) : []);
const selectedOutput = () => (out && out.outputs ? out.outputs.find(o => o.id === outSel) || out.outputs[0] : null);
function pickOutput(id) {
  outSel = id;
  try { localStorage.setItem('outputPicked', id); } catch {}
  if (out) showOut(out);
  renderTabs();
}
// One tab per output over the Scene View, in its colour, once there's more than one.
function renderTabs() {
  const tabs = $('outTabs');
  const list = out && out.outputs && out.outputs.length > 1 ? out.outputs : [];
  tabs.classList.toggle('hidden', !list.length);
  tabs.innerHTML = '';
  for (const o of list) {
    const b = document.createElement('button');
    b.className = 'outTab' + (o.id === outSel ? ' sel' : '');
    b.style.setProperty('--c', o.colour);
    b.textContent = `${o.slot} · ${o.name}`;
    b.title = `Show ${o.name} in the Scene View, and set it up in Video output`;
    b.onclick = () => pickOutput(o.id);
    tabs.appendChild(b);
  }
  $('previewWhich').textContent = list.length ? `Showing ${(selectedOutput() || {}).name || ''}: pick a tab to see another output.` : '';
}

// ─── Preview ───────────────────────────────────────────────────────────
function fitPreview() {
  const w = $('preview').clientWidth;
  $('previewFrame').style.transform = `scale(${w / 1920})`;
  drawBox();
}
// Folded, the Scene View has no width: fit it again as it opens.
$('viewSection').addEventListener('fold', e => { if (e.detail.open) fitPreview(); });
function setPreview(on) {
  try { localStorage.setItem('outputPreview', on ? '1' : '0'); } catch {}
  $('previewOn').checked = on;
  if (!on && popped) { popChannel.postMessage('close'); popped = null; }
  showPreview();
}
var chromaWas = false; // whether the chroma output is chroma key safe (var: showPreview can run before the outputs load)
// The preview here runs only while it's on and not popped out into its own window (preview.html).
// Switching the Scene View to another output: the new output's page loads beside the one showing, standing by, and
// takes over once it has drawn, or after STANDBY_MS. So the picture carries straight on instead of going blank for a
// moment while the page loads. Anything else (turning Live View on or off, popping out) just loads the page.
const STANDBY_MS = 3000;
let standby = null; // { frame, timer } while the next output's page stands by
function frameTo(src) {
  const cur = $('previewFrame');
  if (standby) {
    if (standby.frame.getAttribute('src') === src) return;
    clearInterval(standby.timer);
    standby.frame.remove();
    standby = null;
  }
  const was = cur.getAttribute('src') || '';
  if (was === src) return;
  if (!was.startsWith('/scene.html') || !src.startsWith('/scene.html')) { cur.src = src; return; }
  const next = cur.cloneNode(false);
  next.removeAttribute('id');
  next.style.visibility = 'hidden';
  next.src = src;
  cur.after(next);
  const started = Date.now();
  let loaded = false;
  next.addEventListener('load', () => { loaded = true; }, { once: true });
  standby = { frame: next, timer: setInterval(() => {
    let ready = false;
    // Ready once it has drawn the scene.
    try { ready = loaded && !!next.contentWindow.standbyReady?.(); } catch {}
    if (!ready && Date.now() - started < STANDBY_MS) return;
    clearInterval(standby.timer);
    standby = null;
    cur.remove();
    next.id = 'previewFrame';
    next.style.visibility = '';
    fitPreview();
  }, 50) };
}
function showPreview() {
  const on = $('previewOn').checked, here = on && !popped;
  // While a chroma output is chroma key safe, the Live View shows the scene that way too.
  const which = previewOutput && previewOutput !== 'main' ? `&output=${encodeURIComponent(previewOutput)}` : '';
  const src = here ? `/scene.html?mute=1${which}${chromaWas ? '&chromaKey=true' : ''}` : 'about:blank';
  frameTo(src);
  $('previewOff').classList.toggle('hidden', here);
  $('preview').classList.toggle('picked', !!(out && out.outputs && out.outputs.length > 1));
  $('previewOffText').textContent = popped ? 'The Scene View is in its own window' : 'Live View is off';
  $('popIn').classList.toggle('hidden', !popped);
  $('popOut').textContent = popped ? 'Show window' : 'Pop out';
}
// Pop out: the popped-out window says it's open on this channel, and says so again when this page asks, so a
// reopened Output page knows too.
// The window also says it's open every couple of seconds; if it goes quiet it has gone (the Mac
// app's windows can close without saying so), and the preview comes back here.
let popped = null; // { heard } while the preview window is open
let poppedHeard = 0;
const popChannel = new BroadcastChannel('studio-preview');
const setPopped = p => {
  const was = !!popped;
  popped = p;
  if (was !== !!popped) { console.log(popped ? 'Scene View popped out into its own window' : 'Scene View back on the Output page'); showPreview(); }
};
popChannel.onmessage = e => {
  if (!e.data || typeof e.data !== 'object') return;
  poppedHeard = Date.now();
  setPopped(e.data.open ? { heard: true } : null);
};
setInterval(() => { if (popped && popped.heard && Date.now() - poppedHeard > 6000) setPopped(null); }, 1000);
popChannel.postMessage('ask');
const openPopOut = () => {
  window.open(`/preview.html${previewOutput && previewOutput !== 'main' ? `?output=${encodeURIComponent(previewOutput)}` : ''}`, 'studio-preview', 'popup,width=1280,height=720');
  popped = {};
  // A blocked pop-up never says it's open: put the preview back here.
  setTimeout(() => { if (popped && !popped.heard) { popped = null; showPreview(); $('err').textContent = 'The Scene View window didn\'t open: allow pop-ups for Studio in this browser.'; } }, 4000);
  $('previewOn').checked = true;
  try { localStorage.setItem('outputPreview', '1'); } catch {}
  showPreview();
};
// Show window: the window answers when asked to come forward; if it doesn't, it has gone, so open
// a new one.
$('popOut').onclick = () => {
  if (!popped) return openPopOut();
  const asked = Date.now();
  popChannel.postMessage('focus');
  setTimeout(() => { if (popped && poppedHeard < asked) { popped = null; openPopOut(); } }, 1000);
};
// Bring it back: the preview comes back here straight away, whether or not the window says goodbye.
$('popIn').onclick = e => {
  e.stopPropagation();
  popChannel.postMessage('close');
  setPopped(null);
};
function drawBox() {
  const s = current(), box = $('selBox');
  if (!s) { box.style.display = 'none'; return; }
  const k = $('preview').clientWidth / 1920 * s.scale / 100;
  let [w, h] = s.type === 'browser' ? [s.width, s.height] : (naturalSize.get(s.file) || [0, 0]);
  if (s.type === 'image' && !naturalSize.has(s.file)) {
    const img = new Image();
    img.onload = () => { naturalSize.set(s.file, [img.naturalWidth, img.naturalHeight]); drawBox(); };
    img.src = '/media/' + encodeURIComponent(s.file);
  }
  if (s.type === 'video' && !naturalSize.has(s.file)) {
    naturalSize.set(s.file, [1920, 1080]); // until its size is known
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => { naturalSize.set(s.file, [v.videoWidth, v.videoHeight]); v.removeAttribute('src'); v.load(); drawBox(); };
    v.src = '/media/' + encodeURIComponent(s.file);
  }
  const p = $('preview').clientWidth / 1920;
  Object.assign(box.style, { display: 'block', left: s.x * p + 'px', top: s.y * p + 'px', width: w * k + 'px', height: h * k + 'px' });
}
