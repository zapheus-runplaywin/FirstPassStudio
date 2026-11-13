// FirstPass Studio - the Preview page's script (pvw.html loads it as a module, so its names stay its own).
const box = document.getElementById('box') as HTMLElement;
const q = new URLSearchParams(location.search);
const src = q.get('src') || '';
const name = q.get('name');
if (name) document.title = `${name} · Preview · FirstPass Studio`;
// Only Studio's own pages and media, or an http(s) link (a page source can be any web page).
const ok = /^\/(?!\/)/.test(src) || /^https?:\/\//i.test(src);
if (!ok) {
  box.remove();
  document.body.insertAdjacentHTML('beforeend', '<div id="note">Nothing to preview.</div>');
} else if (/^\/media\//.test(src)) {
  const v = document.createElement('video');
  Object.assign(v, { src, autoplay: true, loop: true, muted: true, controls: true, playsInline: true });
  box.appendChild(v);
} else {
  const f = document.createElement('iframe');
  f.title = name || 'Preview';
  f.src = src;
  box.appendChild(f);
}
console.log(`Preview ${name ? `"${name}" ` : ''}${src}`);

// Scale the 1920 x 1080 page to fit the window, centred, with the window's colour around it.
function fit() {
  const k = Math.min(innerWidth / 1920, innerHeight / 1080);
  Object.assign(box.style, { width: 1920 * k + 'px', height: 1080 * k + 'px', left: (innerWidth - 1920 * k) / 2 + 'px', top: (innerHeight - 1080 * k) / 2 + 'px' });
  const f = box.querySelector('iframe');
  if (f) f.style.transform = `scale(${k})`;
}
addEventListener('resize', fit);
fit();

// What makes this file a module (its names its own), as the first line says.
export {};
