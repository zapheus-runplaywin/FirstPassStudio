// One name for each Studio page ("Game Day" with a capital D is a Socials template, and stays): the tab bar's label (studiobar.js), the page's <title> and its h1 agree, and the Mac
// app's Go menu uses the tab's label as it is (no title-casing). Review finding 6 (30 Oct 2026).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { STUDIO_PAGES } = require('../public/studiobar.js');

test('each tab\'s label is its page\'s title and heading', () => {
  for (const p of STUDIO_PAGES) {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', p.href.slice(1)), 'utf8');
    assert.equal((html.match(/<title>([^<·]+?)\s*·\s*FirstPass Studio<\/title>/) || [])[1], p.label, `${p.href} title`);
    assert.equal((html.match(/<h1[^>]*>([^<]+)<\/h1>/) || [])[1], p.label, `${p.href} h1`);
  }
});

test('the Go menu and the menu bar icon use the tabs\' own names', () => {
  const windows = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'windows.js'), 'utf8');
  assert.match(windows, /submenu: TABS\.map\(\(p, i\) => \(\{ label: p\.label,/, 'the Go menu takes the label as it is');
  const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.js'), 'utf8');
  for (const m of main.matchAll(/label: '([^']+)', click: \(\) => openPage\('(\/[a-z]+\.html)'\)/g)) {
    const tab = STUDIO_PAGES.find(p => p.href === m[2] || (p.also || []).includes(m[2]));
    if (tab && tab.href === m[2]) assert.equal(m[1], tab.label, `menu bar item for ${m[2]}`);
  }
});

test('Studio\'s pages say "Scoreboard control" and "game night", not "the control page" or "game day"', () => {
  for (const f of ['output.html', 'planner.html', 'control.html', 'recordings.html', 'socials.html', 'setup.html', 'sponsors.html', 'athletes.html', 'api.html', 'devices.html', 'graphics.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(html, /control page/i, `${f} says "control page"`);
    assert.doesNotMatch(html, /[Gg]ame day/, `${f} says "game day"`);
  }
});
