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


// Dark theme (UI level-up, 31 Oct 2026): studio.css carries the brand kit's dark values under prefers-color-scheme, and a page's
// own <style> tints things with the kit's tokens (--fp-warn-bg, --fp-danger-bg, --fp-check-a/b, color-mix on --fp-white), never
// a light-only hex that would glare in the dark.
test('the kit has a dark theme and no Studio page carries a light-only tint of its own', () => {
  const css = fs.readFileSync(path.join(PUBLIC, 'studio.css'), 'utf8');
  assert.match(css, /@media \(prefers-color-scheme: dark\) \{\s*:root \{[^}]*--fp-white: #1E293B;[^}]*--fp-muted: #CBD5E1;/, 'dark tokens from the brand kit');
  for (const tok of ['--fp-bar', '--fp-btn', '--fp-warn-bg', '--fp-warn-ink', '--fp-danger-bg', '--fp-check-a', '--fp-check-b']) assert.ok(css.includes(`${tok}:`), `studio.css defines ${tok}`);
  const lightOnly = /#(FFF4E5|FFF4EC|8A3B00|B23F00|FEF3F2|FECDCA|F8FAFC|f6f6f6|e4e4e4|eeeeee|FCE7F3|FFF7F1|F4F7FD)\b/;
  for (const name of PAGES) {
    const style = (fs.readFileSync(path.join(PUBLIC, `${name}.html`), 'utf8').match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
    assert.doesNotMatch(style, lightOnly, `${name}.html tints with the kit's tokens`);
    assert.doesNotMatch(style, /background: var\(--fp-navy\)/, `${name}.html uses --fp-bar, not the ink, as a dark background`);
  }
});

// Callouts and empty states (UI level-up): information is a blue .fp-callout, something to check an amber .fp-callout.warn,
// and an empty list a .fp-empty box; orange is kept for what is on air, so no page paints a banner, flag or badge orange.
test('the kit has callouts and empty states, and no page paints a banner orange', () => {
  const css = fs.readFileSync(path.join(PUBLIC, 'studio.css'), 'utf8');
  for (const sel of ['.fp-callout', '.fp-callout.warn', '.fp-callout.danger', '.fp-empty', '.fp-seg', '.fp-switch']) assert.ok(css.includes(`:where(body.fp) ${sel} {`), `studio.css has ${sel}`);
  for (const name of PAGES) {
    const html = fs.readFileSync(path.join(PUBLIC, `${name}.html`), 'utf8');
    const style = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
    for (const line of style.split('\n')) {
      if (/^\s*\.(alert|callout|flag|night__badge\.warn|guide \.warn)\b/.test(line)) assert.doesNotMatch(line, /var\(--fp-orange\)/, `${name}.html paints a banner orange: ${line.trim()}`);
    }
    assert.doesNotMatch(html, /class="(alert|callout warn)"/, `${name}.html uses the kit's callouts`);
  }
});
