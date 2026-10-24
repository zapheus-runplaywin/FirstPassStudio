// FirstPass Studio - the Output page, part 2 of 11: Scene View: the live scene drawn in the page, its sound, and the pop-out window.
// The page's script is split by section into public/output/, loaded in order by output.html; the files share one
// scope (plain scripts), so a name defined in an earlier part is in reach of a later one.

// ─── Preview ───────────────────────────────────────────────────────────
function fitPreview() {
  const w = $('preview').clientWidth;
  $('previewFrame').style.transform = `scale(${w / 1920})`;
  drawBox();
}
function setPreview(on) {
  try { localStorage.setItem('outputPreview', on ? '1' : '0'); } catch {}
  $('previewOn').checked = on;
  if (!on && popped) { popChannel.postMessage('close'); popped = null; }
  showPreview();
}
var chromaWas = false; // whether the chroma output is chroma key safe (var: showPreview can run before the outputs load)
// The preview here runs only while it's on and not popped out into its own window (preview.html).
function showPreview() {
  const on = $('previewOn').checked, here = on && !popped;
  // While a chroma output is chroma key safe, the Live View shows the scene that way too.
  const src = here ? `/scene.html?mute=1${chromaWas ? '&chromaKey=true' : ''}` : 'about:blank';
  if ($('previewFrame').getAttribute('src') !== src) $('previewFrame').src = src;
  $('previewOff').classList.toggle('hidden', here);
  $('previewOffText').textContent = popped ? 'The Scene View is in its own window' : 'Live View is off';
  $('popIn').classList.toggle('hidden', !popped);
  $('popOut').textContent = popped ? 'Show window' : 'Pop out';
  listen();
}
// Pop out: the popped-out window says it's open (and why it's silent, if it is) on this channel,
// and says so again when this page asks, so a reopened Output page knows too.
// The window also says it's open every couple of seconds; if it goes quiet it has gone (the Mac
// app's windows can close without saying so), and the preview comes back here.
let popped = null; // { note } while the preview window is open
let poppedHeard = 0;
const popChannel = new BroadcastChannel('studio-preview');
const setPopped = p => {
  const was = !!popped;
  popped = p;
  if (was !== !!popped) { console.log(popped ? 'Scene View popped out into its own window' : 'Scene View back on the Output page'); showPreview(); }
  else soundNote();
};
popChannel.onmessage = e => {
  if (!e.data || typeof e.data !== 'object') return;
  poppedHeard = Date.now();
  setPopped(e.data.open ? { note: e.data.note || '', heard: true } : null);
};
setInterval(() => { if (popped && popped.heard && Date.now() - poppedHeard > 6000) setPopped(null); }, 1000);
popChannel.postMessage('ask');
const openPopOut = () => {
  window.open('/preview.html', 'studio-preview', 'popup,width=1280,height=720');
  popped = { note: '' };
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
