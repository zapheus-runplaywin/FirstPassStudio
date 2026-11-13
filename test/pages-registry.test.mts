// The one list of graphics pages (public/pages.ts): every graphic in public/ is in it, every page with
// link options (pageoptions.js) is in it, graphiclinks.js (the Devices tab's Links) describes every page in it, and the Output page
// and examples.ts read it rather than keeping lists of their own.
import { createRequire } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);

// pages.ts and graphiclinks.ts are page scripts (globals in the browser) that hand Node their lists.
interface StudioGraphic { file: string; name: string; group: string; examples?: [string, string, number][] }
interface LinkGroup { id: string; perDivision?: { name: string; link: string } }
interface GraphicLink { group: string; name: string; link: string }
const { STUDIO_GRAPHICS } = require('../out/public/pages.js') as { STUDIO_GRAPHICS: StudioGraphic[] };

const ROOT = path.join(import.meta.dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const read = (f: string) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');
// Pages that aren't graphics: the Studio pages you work in, and the scene's own pages.
const NOT_GRAPHICS = new Set(['output.html', 'control.html', 'remote.html', 'commentator.html', 'setup.html', 'sponsors.html', 'sponsorreport.html', 'athletes.html', 'planner.html', 'recordings.html', 'socials.html', 'social.html', 'api.html', 'devices.html', 'pair.html', 'scene.html', 'preview.html', 'pvw.html']);
// results.html is served from fixtures.html (ALIASES in server.ts).
const ALIASES: Record<string, string> = { 'results.html': 'fixtures.html' };
const files = new Set(STUDIO_GRAPHICS.map(p => p.file));

test('every page in the list exists, once, with a name and a Links group', () => {
  assert.equal(files.size, STUDIO_GRAPHICS.length, 'no page is listed twice');
  for (const p of STUDIO_GRAPHICS) {
    assert.ok(fs.existsSync(path.join(PUBLIC, ALIASES[p.file] || p.file)), `${p.file} exists`);
    assert.ok(p.name && p.group, `${p.file} has a name and a Links group`);
    for (const [caption, link, ms] of p.examples || []) {
      assert.ok(caption && link.startsWith(`/${p.file}`) && ms > 0, `${p.file} example ${caption} links to the page`);
    }
  }
});

test('every graphic in public/ is in the list', () => {
  const graphics = fs.readdirSync(PUBLIC).filter(n => n.endsWith('.html') && !NOT_GRAPHICS.has(n));
  for (const n of graphics) assert.ok(files.has(n), `${n} is in public/pages.ts`);
  for (const n of NOT_GRAPHICS) assert.ok(!files.has(n), `${n} isn't a graphic`);
});

test('every page with link options is in the list', () => {
  const src = read('pageoptions.ts');
  const keys = [...src.matchAll(/^    '([a-z]+\.html)': \[/gm)].map(m => m[1]);
  assert.ok(keys.length > 20, `found ${keys.length} pages with options`);
  for (const k of keys) assert.ok(files.has(k), `${k} (pageoptions.js) is in public/pages.ts`);
});

test('the Devices tab\'s Links (graphiclinks.js) describe every page in the list, in the group the list names', () => {
  const { GROUPS, LINKS } = require('../out/public/graphiclinks.js') as { GROUPS: LinkGroup[]; LINKS: GraphicLink[] };
  const ids = new Set(GROUPS.map(g => g.id));
  for (const p of STUDIO_GRAPHICS) {
    assert.ok(ids.has(p.group), `graphiclinks.js has a ${p.group} group for ${p.file}`);
    const g = GROUPS.find(x => x.id === p.group)!;
    const here = LINKS.some(l => l.group === p.group && l.link.replace(/^\//, '').split('?')[0] === p.file)
      || (g.perDivision && g.perDivision.link.replace(/^\//, '').split('?')[0] === p.file);
    assert.ok(here, `${p.file} is in the ${p.group} group of graphiclinks.js`);
  }
  for (const l of LINKS) assert.ok(ids.has(l.group), `${l.name} is in a group graphiclinks.js lists`);
});

test('the Output page and examples.ts read the list instead of keeping their own', () => {
  const output = read('output.html');
  assert.match(output, /<script src="pages\.js"><\/script>/);
  // The Output page's script lives in public/output/ (one file per section); the list is read in common.ts.
  const common = read('output/common.ts');
  assert.match(common, /const PAGES = STUDIO_GRAPHICS\.map/);
  assert.doesNotMatch(common, /\['Scoreboard', 'scoreboard\.html'\]/);
  assert.doesNotMatch(output, /\['Scoreboard', 'scoreboard\.html'\]/);
  const examples = fs.readFileSync(path.join(ROOT, 'examples.ts'), 'utf8');
  assert.match(examples, /sharedScript<[^>]*>\('pages\.js'\)/);
  assert.doesNotMatch(examples, /'\/clash\.html', 6000/);
});
