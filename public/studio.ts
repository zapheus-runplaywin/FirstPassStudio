// FirstPass Studio - what every Studio page does the same way. Loaded right after studiobar.js on each page.
//
// 1. A change Studio refuses (403: this device isn't paired, or is allowed to score only, or the page is on the
//    wrong Mac) shows one red banner under the tab bar with Studio's reason and, when pairing would fix it, a
//    Pair this device link. window.fetch is wrapped so every page gets it without asking; the banner goes when a
//    later change is accepted, or when it is dismissed. A read only the Mac may make (macOnly: the Devices list, the
//    link sets, the secure link's settings) refused on another device shows nothing: the page asked to find out, and
//    leaves those parts out.
// 2. studioStatus(text, kind) is the one status line: studioStatus('Saved') shows for 2.5 seconds at the foot of
//    the page; studioStatus(why, 'error') stays until the next status. Pages with a Save bar of their own
//    (Competitions setup, Socials) keep their own line next to the button; everything else uses this.
// studioRefused(message): the red banner, for a page that was refused some other way; studioStatus: see 2 above.
var studioRefused: (message: string) => void;
var studioStatus: (text: string, kind?: string) => void;

(function () {
  'use strict';
  const bar = document.querySelector('header.fp-bar');

  let banner: HTMLDivElement | null = null;
  function refused(message: string) {
    if (!bar) return;
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'fp-refused';
      banner.setAttribute('role', 'alert');
      // Under the practice/replay strip studiobar.js adds, so the two never swap places.
      const strip = bar.nextElementSibling && bar.nextElementSibling.classList.contains('fp-practice') ? bar.nextElementSibling : bar;
      strip.after(banner);
    }
    const b = banner;
    b.replaceChildren();
    const text = document.createElement('span');
    text.textContent = message;
    b.append(text);
    if (/pair\.html/.test(message)) {
      const a = document.createElement('a');
      a.href = '/pair.html'; a.textContent = 'Pair this device';
      b.append(a);
    }
    const close = document.createElement('button');
    close.type = 'button'; close.textContent = 'Dismiss'; close.setAttribute('aria-label', 'Dismiss');
    close.onclick = clearRefused;
    b.append(close);
    b.hidden = false;
  }
  function clearRefused() { if (banner) banner.hidden = true; }
  studioRefused = refused;

  const realFetch = window.fetch.bind(window);
  window.fetch = async function studioFetch(input: RequestInfo | URL, init?: RequestInit) {
    const res = await realFetch(input, init);
    try {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
      if (url.origin === location.origin) {
        const method = String((init && init.method) || (input instanceof Request && input.method) || 'GET').toUpperCase();
        if (res.status === 403) {
          const read = method === 'GET' || method === 'HEAD';
          res.clone().json().then(b => { if (!(read && b && b.macOnly)) refused((b && b.error) || 'Studio refused that.'); }, () => refused('Studio refused that.'));
        } else if (res.ok && method !== 'GET' && method !== 'HEAD') clearRefused();
      }
    } catch { /* not a URL we judge */ }
    return res;
  };

  let line: HTMLDivElement | null = null, timer: ReturnType<typeof setTimeout> | undefined;
  studioStatus = function show(text, kind) {
    let status = line;
    if (!status) {
      status = line = document.createElement('div');
      status.className = 'fp-status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      document.body.append(status);
    }
    const shown = status;
    clearTimeout(timer);
    shown.textContent = text || '';
    shown.classList.toggle('error', kind === 'error');
    shown.hidden = !text;
    if (text && kind !== 'error') timer = setTimeout(() => { shown.hidden = true; }, 2500);
  };
})();
