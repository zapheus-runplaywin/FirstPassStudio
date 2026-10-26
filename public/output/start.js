// FirstPass Studio - the Output page, part 12 of 12: Start up: live viewer numbers, the link base, Scene View on or off, the first load.
// The page's script is split by section into public/output/, loaded in order by output.html; the files share one
// scope (plain scripts), so a name defined in an earlier part is in reach of a later one.

async function viewersNow() {
  try {
    const v = await (await fetch('/api/viewers', { cache: 'no-store' })).json();
    const box = $('viewersNow');
    box.hidden = !v.streams || !v.streams.length;
    if (box.hidden) return;
    const read = v.streams.filter(x => x.at);
    const parts = read.map(x => `${x.name || (x.platform === 'facebook' ? 'Facebook' : 'YouTube')} ${x.error ? 'error' : x.live ? x.count.toLocaleString() : 'not live'}`);
    box.textContent = !read.length ? 'Live viewers: read every 30 seconds while a video output is on.'
      : `👁 ${v.total.toLocaleString()} watching · ${parts.join(' · ')}`;
    box.title = read.filter(x => x.error).map(x => `${x.name || x.platform}: ${x.error}`).join('\n');
  } catch { /* Studio restarting: try again next time */ }
}
viewersNow();
setInterval(viewersNow, 15000);

fetch('/api/version').then(r => r.json()).then(v => { if (v.base) base = v.base; renderForm(); }).catch(() => {});
let pref = '1'; try { pref = localStorage.getItem('outputPreview') ?? '1'; } catch {}
$('previewOn').onchange = () => setPreview($('previewOn').checked);
setPreview(pref !== '0');
addEventListener('resize', fitPreview);
fitPreview();
loadMedia();
