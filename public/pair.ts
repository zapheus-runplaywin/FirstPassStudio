// FirstPass Studio - the Pair this device page's script (pair.html loads it as a module, so its names stay its own).
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
// ?then=/socials.html (from a QR code on the Mac): the Studio page to go on to once this device is paired.
const then = (() => { const t = new URLSearchParams(location.search).get('then') || ''; return /^\/[a-z]+\.html$/.test(t) ? t : ''; })();
const show = (which: string) => { for (const id of ['mac', 'ask', 'waiting', 'paired']) $(id).hidden = id !== which; };

function paired(name: string, level: string) {
  if (then) return location.replace(then);
  $('pairedAs').textContent = level === 'scoring'
    ? `Paired as ${name}: this device can change the scores, clock, quarter and game.`
    : `Paired as ${name}: this device can change everything, like the Mac.`;
  // Everything: the phone pages (Socials, the Remote, the Commentator mic). Scoring only: Scoreboard control and the
  // Commentator mic, which any paired device can send.
  for (const id of ['remoteLink', 'socialsLink']) $(id).hidden = level === 'scoring';
  $<HTMLAnchorElement>('controlLink').hidden = level !== 'scoring';
  show('paired');
}

async function start() {
  if ((await fetch('/api/devices').catch(() => null))?.ok) return show('mac');
  const me = await fetch('/api/pair/me').then(r => r.json()).catch(() => ({}));
  if (me.paired) return paired(me.name, me.level);
  show('ask');
  $<HTMLInputElement>('name').focus();
}

$<HTMLButtonElement>('go').onclick = async () => {
  const name = $<HTMLInputElement>('name').value.trim();
  $('askErr').hidden = true;
  if (!name) { $('askErr').textContent = 'Type a name, so whoever is at the Mac knows what is asking.'; $('askErr').hidden = false; return; }
  const r = await fetch('/api/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, browser: true }) }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  if (!r || r.status !== 202) { $('askErr').textContent = j.error || 'Studio didn\'t answer. Is it on air?'; $('askErr').hidden = false; return; }
  $('until').textContent = `The request runs out at ${new Date(j.expires).toLocaleTimeString([], { timeStyle: 'short' })}.`;
  show('waiting');
  for (;;) {
    await new Promise(res => setTimeout(res, 2000));
    const got = await fetch(`/api/pair/${encodeURIComponent(j.id)}`, { headers: { 'x-studio-pair': j.token } }).catch(() => null);
    if (!got) continue;
    const a = got.ok ? await got.json().catch(() => ({})) : { status: 'gone' };
    if (a.status === 'waiting') continue;
    if (a.status === 'allowed') return paired(name, a.level);
    show('ask');
    $('askErr').textContent = a.status === 'denied' ? 'The Mac said no.' : 'Nobody answered in five minutes. Ask again when someone is at the Mac.';
    $('askErr').hidden = false;
    return;
  }
};
$<HTMLInputElement>('name').addEventListener('keydown', e => { if (e.key === 'Enter') $<HTMLButtonElement>('go').click(); });

start();

// What makes this file a module (its names its own), as the first line says.
export {};
