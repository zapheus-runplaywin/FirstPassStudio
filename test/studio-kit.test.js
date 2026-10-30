// Every Studio page (the ones with the tab bar) is built from the page kit in studio.css: a page's own <style> carries
// what is really its own, never another copy of the kit's button, section, heading or help text rules. Review finding 1
// (30 Oct 2026): the copies had drifted, so a button looked different on each page.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
const PAGES = ['output', 'planner', 'control', 'recordings', 'socials', 'setup', 'sponsors', 'athletes', 'api', 'devices', 'graphics', 'sponsorreport'];
// Selectors the kit owns. A page may still style a more specific thing (.plus, .eye, .guide h3, dialog.editor).
const KIT = new Set(['*', 'main', 'h1', '.sub', 'section', 'h2', 'button', 'button:hover', 'button.alt', 'button.alt:hover', 'button.danger',
  'button.small', 'button:disabled', '.help', '.note', '.error', 'dialog', 'dialog::backdrop', 'dialog h2', '.hidden', 'details.info']);

function topLevelSelectors(css) {
  const heads = []; let depth = 0;
  for (const line of css.split('\n')) {
    const m = line.match(/^\s*([^{@]+?)\s*\{/);
    if (m && depth === 0) for (const sel of m[1].split(',')) heads.push(sel.replace(/\s+/g, ' ').trim());
    depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
  }
  return heads;
}

test('every Studio page loads studio.css and the tab bar, and redeclares none of the page kit', () => {
  for (const name of PAGES) {
    const html = fs.readFileSync(path.join(PUBLIC, `${name}.html`), 'utf8');
    assert.match(html, /<link rel="stylesheet" href="studio.css">/, `${name}.html loads studio.css`);
    assert.match(html, /<body class="fp">/, `${name}.html is a Studio page (body.fp)`);
    assert.match(html, /<header class="fp-bar"><\/header><script src="studiobar.js"><\/script><script src="studio.js"><\/script>/, `${name}.html has the tab bar and studio.js`);
    const style = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
    const copies = topLevelSelectors(style).filter(s => KIT.has(s) || KIT.has(s.replace(/^\.guide /, '')));
    assert.deepEqual(copies, [], `${name}.html styles the kit's own selectors itself: ${copies.join(', ')}`);
  }
});

test('the kit itself is in studio.css, scoped so a page\'s own classes still win', () => {
  const css = fs.readFileSync(path.join(PUBLIC, 'studio.css'), 'utf8');
  for (const sel of ['main', 'section', 'h2', 'button', 'button.alt', 'button.danger', '.help', '.note', '.error', 'dialog']) {
    assert.ok(css.includes(`:where(body.fp) ${sel}`), `studio.css has :where(body.fp) ${sel}`);
  }
});

// Help text follows one pattern (review finding 7): a line under the control says what it does, and anything longer waits
// behind Expand for info, on the Output page, the Production Planner, Socials and Recordings alike.
test('help text on the Output page, Production Planner, Socials and Recordings folds behind Expand for info', () => {
  for (const name of ['output', 'planner', 'socials', 'recordings']) {
    const html = fs.readFileSync(path.join(PUBLIC, `${name}.html`), 'utf8');
    assert.match(html, /<details class="info"><summary>Expand for info<\/summary><p class="note">/, `${name}.html folds its longer help`);
    for (const m of html.matchAll(/<p class="help">([\s\S]*?)<\/p>/g)) {
      const text = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      assert.ok(text.length <= 260, `${name}.html: help text over a line or two belongs behind Expand for info: "${text.slice(0, 60)}…" (${text.length} chars)`);
    }
  }
});

