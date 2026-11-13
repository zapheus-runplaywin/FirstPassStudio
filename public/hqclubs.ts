// FirstPass Studio - the FirstPass HQ card on the Devices tab (api.html): signing in to each club's FirstPass HQ.
//
// /api/firstpass/clubs (hqauth.ts) answers on the Mac running Studio only; elsewhere the card stays hidden. Each club
// shows whether this Mac is signed in, as whom and since when, with Sign in or Sign out. Sign in opens the club's
// Google sign-in page in the browser on the Mac (Studio opens it; the link shows too, in case it didn't), and the card
// looks again every couple of seconds until the sign-in is done. Needs studio.js (studioStatus) and asktext.js (askConfirm).

'use strict';

(function hqClubs() {
  interface HqClub { code: string; name: string; state: 'signed-out' | 'signing-in' | 'signed-in' | 'offline'; email: string; since: string; problem: string }
  const section = document.getElementById('hqSection');
  const list = document.getElementById('hqClubs');
  if (!section || !list) return;
  const say = (text: string, bad = false) => studioStatus(text, bad ? 'error' : '');
  let clubs: HqClub[] = [];
  let link: { code: string; url: string } | null = null;
  let timer: number | undefined;

  const isClub = (v: unknown): v is HqClub => !!v && typeof v === 'object' && typeof (v as HqClub).code === 'string';
  const clubsOf = (body: unknown): HqClub[] => {
    const got = body && typeof body === 'object' ? (body as { clubs?: unknown }).clubs : null;
    return Array.isArray(got) ? got.filter(isClub) : [];
  };
  const when = (iso: string) => (iso ? new Date(iso).toLocaleDateString([], { dateStyle: 'medium' }) : '');

  function draw() {
    section!.hidden = false;
    if (!clubs.length) {
      const p = document.createElement('p');
      p.className = 'help';
      p.textContent = 'No clubs are listed yet. A club that records FirstPass stats is added to Studio in an update.';
      list!.replaceChildren(p);
      return;
    }
    list!.replaceChildren(...clubs.map(c => {
      const row = document.createElement('div');
      row.className = 'club';
      row.dataset.club = c.code;
      const state = document.createElement('div');
      state.className = 'state';
      const dot = document.createElement('span');
      dot.className = 'dot ' + (c.state === 'signed-in' ? 'ok' : c.state === 'offline' || c.state === 'signing-in' ? 'warn' : c.problem ? 'bad' : '');
      const says = document.createElement('span');
      const name = document.createElement('b');
      name.textContent = c.name;
      says.append(name, ': ', c.state === 'signed-in' ? `signed in${c.email ? ` as ${c.email}` : ''}${c.since ? ` since ${when(c.since)}` : ''}`
        : c.state === 'signing-in' ? 'waiting for the sign-in in your browser…'
          : c.state === 'offline' ? `signed in${c.email ? ` as ${c.email}` : ''}, but FirstPass HQ can't be reached`
            : 'not signed in');
      state.append(dot, says);
      const btn = document.createElement('button');
      const signedIn = c.state === 'signed-in' || c.state === 'offline';
      btn.className = signedIn ? 'alt' : '';
      btn.textContent = signedIn ? 'Sign out' : c.state === 'signing-in' ? 'Start again' : 'Sign in';
      btn.onclick = () => (signedIn ? signOut(c) : signIn(c));
      row.append(state, btn);
      if (link && link.code === c.code && c.state === 'signing-in') {
        const a = document.createElement('a');
        a.href = link.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        a.textContent = 'Open the sign-in page';
        row.append(a);
      }
      if (c.problem) {
        const p = document.createElement('p');
        p.className = 'problem';
        p.textContent = c.problem;
        row.append(p);
      }
      return row;
    }));
  }

  async function load(): Promise<boolean> {
    const r = await fetch('/api/firstpass/clubs');
    if (r.status === 403) return false;
    if (!r.ok) return true;
    clubs = clubsOf(await r.json());
    draw();
    watch();
    return true;
  }
  // While a club is signing in, look every 2 seconds; otherwise every minute.
  function watch() {
    window.clearTimeout(timer);
    const busy = clubs.some(c => c.state === 'signing-in');
    timer = window.setTimeout(() => { (document.hidden && !busy ? Promise.resolve(true) : load()).catch(() => true).then(ok => { if (ok) watch(); }); }, busy ? 2000 : 60000);
  }

  async function post(c: HqClub, what: 'signin' | 'signout'): Promise<{ url?: string } | null> {
    const r = await fetch(`/api/firstpass/clubs/${encodeURIComponent(c.code)}/${what}`, { method: 'POST' });
    const j: unknown = await r.json().catch(() => ({}));
    const error = j && typeof j === 'object' ? (j as { error?: unknown }).error : null;
    if (!r.ok) { say(typeof error === 'string' ? error : 'Studio didn\'t answer.', true); return null; }
    clubs = clubsOf(j);
    const url = j && typeof j === 'object' ? (j as { url?: unknown }).url : undefined;
    return { url: typeof url === 'string' ? url : undefined };
  }

  async function signIn(c: HqClub) {
    const got = await post(c, 'signin');
    if (!got) return;
    link = got.url ? { code: c.code, url: got.url } : null;
    say(`Sign in to ${c.name} in the browser that just opened.`);
    draw();
    watch();
  }

  async function signOut(c: HqClub) {
    if (!await askConfirm(`Sign out of ${c.name}?`, `Studio deletes the sign-in and every FirstPass stat it kept for ${c.name}, and its graphics use PlayHQ's data.`, { ok: 'Sign out', danger: true })) return;
    if (!await post(c, 'signout')) return;
    say(`Signed out of ${c.name}; its FirstPass stats on this Mac are deleted.`);
    draw();
  }

  load().catch(() => {});
})();
