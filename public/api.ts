// FirstPass Studio - the Devices page's script (api.html loads it as a module, so its names stay its own).
// The Devices list: what may change things from another device, from /api/devices (this Mac only).
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const rows = $<HTMLTableSectionElement>('rows');
// What Studio answers (devices.ts list() and asking(), securelink.ts status()).
interface Device { id: string; name: string; kind: string; level: string; address?: string; created: string; lastSeen: string | null }
interface Asking { id: string; name: string; address: string; browser: boolean; at: number; expires: string }
interface DevicesAnswer { devices: Device[]; asking: Asking | null; error?: string }
interface SecureLink {
  on: boolean; zoneId: string; keyId: string; hasSecret: boolean; domain: string | null; host: string | null; link: string;
  state: string; step: string; problem: string; expires: string | null;
}
const KINDS: Record<string, string> = { links: 'Stream Deck links (Website keys, and links copied from the Output page or this one)', program: 'A program that asked to be added', browser: 'A phone or browser, paired from its pair page', plugin: 'Studio Stream Deck plugin (signs each press)' };
const LEVELS: Record<string, string> = { full: 'Everything', show: 'Sequences, scenes and sources', scoring: 'Scoring only' };
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Not yet';
// Studio's one status line (studio.js): what just happened, or why it didn't.
const say = (text: string, bad = false) => studioStatus(text, bad ? 'error' : '');

function draw(list: Device[]) {
  rows.replaceChildren(...list.map(d => {
    const tr = document.createElement('tr');
    const name = document.createElement('td');
    const b = document.createElement('b'); b.textContent = d.name;
    const what = document.createElement('div'); what.className = 'what'; what.textContent = (KINDS[d.kind] || d.kind) + (d.address ? `, at ${d.address}` : '');
    name.append(b, what);
    const cells = [LEVELS[d.level] || d.level, when(d.created), when(d.lastSeen)].map(t => { const td = document.createElement('td'); td.textContent = t; return td; });
    // A paired browser's level can be changed here.
    if (d.kind === 'browser') {
      const pick = document.createElement('select');
      pick.append(new Option(LEVELS.scoring, 'scoring'), new Option(LEVELS.full, 'full'));
      pick.value = d.level;
      pick.onchange = async () => {
        const r = await fetch(`/api/devices/${encodeURIComponent(d.id)}/level`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level: pick.value }) });
        say(r.ok ? `${d.name} can now ${pick.value === 'scoring' ? 'only score' : 'change everything'}.` : 'Studio didn\'t answer.', !r.ok);
      };
      cells[0].replaceChildren(pick);
    }
    const act = document.createElement('td'); act.className = 'act';
    const button = (label: string, onclick: () => void) => { const btn = document.createElement('button'); btn.className = 'alt'; btn.textContent = label; btn.onclick = onclick; return btn; };
    if (d.kind === 'links') act.append(button('Make a new key', () => renew(d)));
    // This Mac's links can't be removed, only given a new key.
    if (d.id !== 'mac-links') act.append(' ', button('Remove', () => revoke(d)));
    tr.append(name, ...cells, act);
    return tr;
  }));
}

// A device asking to be added: shown until it is answered here or in the Mac's dialog, or runs out.
let asking: Asking | null = null;
function drawAsking(a: Asking | null) {
  asking = a || null;
  $('asking').hidden = !asking;
  if (!asking) return;
  $('askWho').textContent = `"${asking.name}" at ${asking.address} asks to control Studio`;
  const until = `The request runs out at ${new Date(asking.expires).toLocaleTimeString([], { timeStyle: 'short' })}.`;
  $('askWhat').textContent = asking.browser
    ? `Scoring only: the scores, clock, quarter and game, as on Scoreboard control. Everything: the scene, sequences and settings too. Only allow a device you know is yours. ${until}`
    : `It will be able to change scores, the scene, sequences and settings, like a Stream Deck. Only allow a device you know is yours. ${until}`;
  $<HTMLButtonElement>('allow').textContent = asking.browser ? 'Allow scoring only' : 'Allow';
  $<HTMLButtonElement>('allowFull').hidden = !asking.browser;
}
async function answer(allow: boolean, level?: string) {
  const asked = asking;
  if (!asked) return;
  const r = await fetch(`/api/devices/requests/${encodeURIComponent(asked.id)}/${allow ? 'allow' : 'deny'}`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level }) });
  const j: DevicesAnswer = await r.json().catch(() => ({}));
  if (!r.ok) { say(j.error || 'Studio didn\'t answer.', true); return load(); }
  say(allow ? `${asked.name} can now control Studio.` : `${asked.name} was denied.`);
  draw(j.devices); drawAsking(j.asking);
}
$<HTMLButtonElement>('allow').onclick = () => answer(true, 'scoring');
$<HTMLButtonElement>('allowFull').onclick = () => answer(true, 'full');
$<HTMLButtonElement>('deny').onclick = () => answer(false);

let macOnly = false;
async function load() {
  if (macOnly) return;
  const r = await fetch('/api/devices');
  const j: DevicesAnswer = await r.json().catch(() => ({}));
  if (r.status === 403) { macOnly = true; $('devicesSection').hidden = true; $('devicesElsewhere').hidden = false; return; }
  if (!r.ok) { say(j.error || 'Studio didn\'t answer.', true); return; }
  // Not while a level is being picked: drawing again would close the list.
  if (!rows.contains(document.activeElement)) draw(j.devices);
  drawAsking(j.asking);
}
// Checks for a new request every few seconds while the page is showing.
setInterval(() => { if (!document.hidden) load().catch(() => {}); }, 3000);

async function act(path: string, question: string, detail: string, label: string, done: string) {
  const ok = await askChoice(question, detail, [{ label: 'Cancel', value: 'cancel', alt: true }, { label, value: 'go' }]);
  if (ok !== 'go') return;
  const r = await fetch(path, { method: 'POST' });
  const j: DevicesAnswer = await r.json().catch(() => ({}));
  if (!r.ok) { say(j.error || 'Studio didn\'t answer.', true); return; }
  say(done);
  draw(j.devices);
}
const renew = (d: Device) => act(`/api/devices/${encodeURIComponent(d.id)}/renew`, `Make a new key for ${d.name}?`,
  `Every Website key and copied link made for ${d.name} stops working straight away. Copy them again from the Output page or the Stream Deck links below (with ${d.name} picked) and paste them into the Stream Deck. Other link sets and the Studio plugin keep working.`,
  'Make a new key', `New key made for ${d.name}. Links copied before no longer work: copy them again (reload the Output page first if it was already open).`);
const revoke = (d: Device) => act(`/api/devices/${encodeURIComponent(d.id)}/revoke`, `Remove ${d.name}?`,
  d.kind === 'links' ? `Every link made for ${d.name} stops working, and the set goes from the list.` : `${d.name} can no longer change anything until it is allowed again.`,
  'Remove', `${d.name} removed.`);
$<HTMLButtonElement>('newSet').onclick = async () => {
  const name = await askText('Name the new link set, after the Stream Deck it is for (such as "Office Stream Deck")');
  if (!name) return;
  const r = await fetch('/api/devices/links', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
  const j: { name?: string; error?: string } = await r.json().catch(() => ({}));
  if (!r.ok) { say(j.error || 'Studio didn\'t answer.', true); return; }
  say(`${j.name} made. Pick it on the Output page or under Stream Deck below to copy its links.`);
  load();
};

load().catch((err: unknown) => say(`Couldn't load the devices: ${err instanceof Error ? err.message : String(err)}`, true));

// The secure phone link card (securelink.ts): on this Mac only, like the Devices list.
let secure: SecureLink | null = null;
function drawSecure(s: SecureLink) {
  secure = s;
  $('secureSection').hidden = false;
  $('secureHost').textContent = s.host || (s.domain ? `…${s.domain}` : '…studio.firstpass.pivt.au');
  const dot = $('secureState').querySelector('.dot');
  if (dot) dot.className = 'dot ' + (s.state === 'ready' ? (s.problem ? 'warn' : 'ok') : s.state === 'problem' ? 'bad' : s.state === 'starting' ? 'warn' : '');
  const says = $('secureSays');
  says.replaceChildren();
  if (s.state === 'ready') {
    const code = document.createElement('code'); code.textContent = s.link;
    says.append('Ready: ', code, s.expires ? `. Certificate good until ${new Date(s.expires).toLocaleDateString([], { dateStyle: 'medium' })}, renewed by itself.` : '');
    if (s.problem) says.append(` ${s.problem}`);
  } else if (s.state === 'starting') says.textContent = `${s.step || 'Starting'}…`;
  else if (s.state === 'problem') says.textContent = s.problem;
  else says.textContent = 'Off. The phone QR codes use the http link.';
  for (const [id, key] of [['secureZone', 'zoneId'], ['secureKeyId', 'keyId']] as const) if (document.activeElement !== $(id)) $<HTMLInputElement>(id).value = s[key] || '';
  $<HTMLInputElement>('secureSecret').placeholder = s.hasSecret ? 'Kept in the Keychain (paste a new one to change it)' : 'Paste the secret';
  $<HTMLButtonElement>('secureOn').textContent = s.on ? 'Turn off' : 'Turn on';
  $<HTMLButtonElement>('secureTry').hidden = !s.on || s.state === 'starting';
}
async function loadSecure() {
  const r = await fetch('/api/securelink');
  if (r.status === 403) return false;
  if (r.ok) drawSecure(await r.json());
  return true;
}
async function setSecure(body: { zoneId?: string; keyId?: string; secret?: string; on?: boolean }) {
  const r = await fetch('/api/securelink', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { say(j.error || 'Studio didn\'t answer.', true); return; }
  $<HTMLInputElement>('secureSecret').value = '';
  drawSecure(j);
}
const secureFields = () => ({ zoneId: $<HTMLInputElement>('secureZone').value, keyId: $<HTMLInputElement>('secureKeyId').value, secret: $<HTMLInputElement>('secureSecret').value });
$<HTMLButtonElement>('secureOn').onclick = () => setSecure(secure && secure.on ? { on: false } : { ...secureFields(), on: true });
$<HTMLButtonElement>('secureTry').onclick = () => setSecure(secureFields());
for (const id of ['secureZone', 'secureKeyId', 'secureSecret']) $(id).addEventListener('change', () => { if (secure && secure.on) setSecure(secureFields()); });
loadSecure().then(onMac => {
  // Every couple of seconds while it's starting (a certificate takes about a minute), every half minute otherwise.
  if (onMac) (function again() { setTimeout(() => { (document.hidden ? Promise.resolve() : loadSecure()).catch(() => {}).finally(again); }, secure && secure.state === 'starting' ? 2000 : 30000); })();
}).catch(() => {});
// Devices in the menu bar icon and /devices.html land here.

// Stream Deck links: with the chosen link set's key in front on the Mac (linksets.js); elsewhere with this Mac's Stream Deck
// key when Studio gives it (access.ts deckPress()), plain otherwise.
linkSets($<HTMLSelectElement>('linkSet'), base => studioLinks.setDeckBase(base)).then(onMac => {
  $('linkSetRow').hidden = !onMac;
  if (onMac) return;
  fetch('/api/deck-key').then(r => r.ok ? r.json() : Promise.reject()).then(k => studioLinks.setDeckBase(k.base)).catch(() => {});
});
// The plugin comes with the Mac app; opening it hands it to the Stream Deck app to install.
fetch('/api/scene/streamdeck').then(r => r.json()).then(b => { $('deckRow').hidden = !b.available; }).catch(() => {});
$<HTMLButtonElement>('deckInstall').onclick = async () => {
  const note = $('deckNote');
  try {
    const r = await fetch('/api/scene/streamdeck', { method: 'POST' });
    const b = await r.json();
    if (r.ok) console.log('Opened the Stream Deck plugin to install it');
    note.textContent = r.ok ? 'The Stream Deck app should open to install it.' : (b.error || 'Could not open the plugin.');
  } catch (err) { note.textContent = `Could not open the plugin: ${err instanceof Error ? err.message : String(err)}`; }
};

// What makes this file a module (its names its own), as the first line says.
export {};
