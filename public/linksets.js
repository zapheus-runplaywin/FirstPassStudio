// FirstPass Studio - which Stream Deck link set the links on a page are copied for (devices.js).
//
// Each link set has its own key, so the Website keys on one Stream Deck can be given a new key, or removed, in
// Devices… without touching the others. linkSets(select, onBase) fills select with This Mac's links, every named set
// and "New link set…" (which asks for a name), and calls onBase(base) with the chosen set's link start, such as
// http://studio-mac.local:8080/k/<key>, at the start and whenever the choice changes. The choice is remembered in this browser.
// The sets can only be read on the Mac running Studio: elsewhere it resolves false, and the page keeps the links it
// had (This Mac's key from /api/deck-key). Needs asktext.js.

'use strict';

window.linkSets = async function linkSets(select, onBase) {
  const REMEMBER = 'deckLinkSet';
  const MAC = 'mac-links';
  let chosen = MAC;
  try { chosen = localStorage.getItem(REMEMBER) || MAC; } catch { /* storage off */ }
  const r = await fetch('/api/devices').catch(() => null);
  if (!r || !r.ok) return false;
  const sets = ((await r.json()).devices || []).filter(d => d.kind === 'links');
  if (!sets.some(d => d.id === chosen)) chosen = MAC;
  const remember = id => { chosen = id; try { localStorage.setItem(REMEMBER, id); } catch { /* storage off */ } };
  const fill = () => {
    select.replaceChildren(...sets.map(d => new Option(d.name, d.id)), new Option('New link set…', '+'));
    select.value = chosen;
  };
  async function use(id) {
    const k = await fetch(`/api/devices/${encodeURIComponent(id)}/key`).then(res => res.ok ? res.json() : null).catch(() => null);
    if (!k) { fill(); return; }
    remember(id);
    onBase(k.base);
  }
  select.onchange = async () => {
    if (select.value !== '+') return use(select.value);
    const name = await askText('Name the new link set, after the Stream Deck it is for (such as "Office Stream Deck")');
    if (!name) { fill(); return; }
    const made = await fetch('/api/devices/links', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) })
      .then(res => res.json()).catch(() => ({}));
    if (!made.id) { fill(); return; }
    sets.push(made);
    remember(made.id);
    fill();
    onBase(made.base);
  };
  fill();
  await use(chosen);
  return true;
};
