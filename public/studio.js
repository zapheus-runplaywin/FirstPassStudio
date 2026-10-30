// FirstPass Studio - what every Studio page does the same way. Loaded right after studiobar.js on each page.
//
// 1. A change Studio refuses (403: this device isn't paired, or is allowed to score only, or the page is on the
//    wrong Mac) shows one red banner under the tab bar with Studio's reason and, when pairing would fix it, a
//    Pair this device link. window.fetch is wrapped so every page gets it without asking; the banner goes when a
//    later change is accepted, or when it is dismissed.
// 2. studioStatus(text, kind) is the one status line: studioStatus('Saved') shows for 2.5 seconds at the foot of
//    the page; studioStatus(why, 'error') stays until the next status. Pages with a Save bar of their own
//    (Competitions setup, Socials) keep their own line next to the button; everything else uses this.
(function () {
  'use strict';
  const bar = document.querySelector('header.fp-bar');

  let banner = null;
  function refused(message) {
    if (!bar) return;
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'fp-refused';
      banner.setAttribute('role', 'alert');
      // Under the practice/replay strip studiobar.js adds, so the two never swap places.
      const strip = bar.nextElementSibling && bar.nextElementSibling.classList.contains('fp-practice') ? bar.nextElementSibling : bar;
      strip.after(banner);
    }
    banner.replaceChildren();
    const text = document.createElement('span');
    text.textContent = message;
    banner.append(text);
    if (/pair\.html/.test(message)) {
      const a = document.createElement('a');
      a.href = '/pair.html'; a.textContent = 'Pair this device';
      banner.append(a);
    }
    const close = document.createElement('button');
    close.type = 'button'; close.textContent = 'Dismiss'; close.setAttribute('aria-label', 'Dismiss');
    close.onclick = clearRefused;
    banner.append(close);
    banner.hidden = false;
  }
  function clearRefused() { if (banner) banner.hidden = true; }
  window.studioRefused = refused;

  const realFetch = window.fetch.bind(window);
  window.fetch = async function studioFetch(input, init) {
    const res = await realFetch(input, init);
    try {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.origin === location.origin) {
        const method = String((init && init.method) || (typeof input !== 'string' && input.method) || 'GET').toUpperCase();
        if (res.status === 403) {
          res.clone().json().then(b => refused((b && b.error) || 'Studio refused that.'), () => refused('Studio refused that.'));
        } else if (res.ok && method !== 'GET' && method !== 'HEAD') clearRefused();
      }
    } catch { /* not a URL we judge */ }
    return res;
  };

  let status = null, timer = null;
  window.studioStatus = function studioStatus(text, kind) {
    if (!status) {
      status = document.createElement('div');
      status.className = 'fp-status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      document.body.append(status);
    }
    clearTimeout(timer);
    status.textContent = text || '';
    status.classList.toggle('error', kind === 'error');
    status.hidden = !text;
    if (text && kind !== 'error') timer = setTimeout(() => { status.hidden = true; }, 2500);
  };
})();
