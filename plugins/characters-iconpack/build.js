// FirstPass Studio - the Characters icon pack for Stream Deck: one key image per letter, digit and US keyboard
// symbol, for labelling keys. Draws each one in Chromium (Playwright) with the Studio font and packs them as a
// .streamDeckIconPack, which the Stream Deck app installs when it's opened.
//
//   npm run iconpack   ->  dist/iconpack/FirstPass Studio Characters.streamDeckIconPack
//                          dist/iconpack/characters-preview.png (every key on one sheet)

'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const zip = require('../../zip');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'dist', 'iconpack');
const ID = 'com.runplaywin.firstpass-studio-characters';
const NAME = 'FirstPass Studio Characters';
const VERSION = '1.0.0';
const SIZE = 144;

// The key colours match the Studio plugin's keys while they're off: navy body, white title.
const BODY = '#0f172a';
const INK = '#ffffff';
const FONT = path.join(ROOT, 'public', 'vendor', 'montserrat', 'montserrat-latin-800-normal.woff2');

// Every printable character on a US keyboard, each with a file name that's safe on a Mac (which doesn't tell
// a.png from A.png) and the name and tags Stream Deck's icon search finds it by.
const SYMBOLS = [
  ['`', 'backtick', 'Backtick', ['grave']], ['~', 'tilde', 'Tilde', []], ['!', 'exclamation', 'Exclamation mark', ['bang']],
  ['@', 'at', 'At sign', []], ['#', 'hash', 'Hash', ['number', 'pound']], ['$', 'dollar', 'Dollar sign', ['money']],
  ['%', 'percent', 'Percent', []], ['^', 'caret', 'Caret', []], ['&', 'ampersand', 'Ampersand', ['and']],
  ['*', 'asterisk', 'Asterisk', ['star']], ['(', 'paren-open', 'Open parenthesis', ['bracket']],
  [')', 'paren-close', 'Close parenthesis', ['bracket']], ['-', 'minus', 'Minus', ['hyphen', 'dash']],
  ['_', 'underscore', 'Underscore', []], ['=', 'equals', 'Equals', []], ['+', 'plus', 'Plus', ['add']],
  ['[', 'square-open', 'Open square bracket', ['bracket']], [']', 'square-close', 'Close square bracket', ['bracket']],
  ['{', 'brace-open', 'Open curly brace', ['bracket']], ['}', 'brace-close', 'Close curly brace', ['bracket']],
  ['\\', 'backslash', 'Backslash', ['slash']], ['|', 'pipe', 'Pipe', ['bar']], [';', 'semicolon', 'Semicolon', []],
  [':', 'colon', 'Colon', []], ["'", 'apostrophe', 'Apostrophe', ['quote']], ['"', 'quote', 'Double quote', ['quote']],
  [',', 'comma', 'Comma', []], ['.', 'period', 'Full stop', ['period', 'dot']], ['<', 'less-than', 'Less than', ['angle']],
  ['>', 'greater-than', 'Greater than', ['angle']], ['/', 'slash', 'Slash', []], ['?', 'question', 'Question mark', []],
];

function characters() {
  const list = [];
  for (let c = 65; c <= 90; c++) {
    const up = String.fromCharCode(c), low = up.toLowerCase();
    list.push({ char: up, file: `upper-${low}.png`, name: `${up} (capital)`, tags: ['letter', 'uppercase', 'capital'] });
  }
  for (let c = 97; c <= 122; c++) {
    const low = String.fromCharCode(c);
    list.push({ char: low, file: `lower-${low}.png`, name: `${low} (lowercase)`, tags: ['letter', 'lowercase'] });
  }
  for (let d = 0; d <= 9; d++) list.push({ char: String(d), file: `digit-${d}.png`, name: String(d), tags: ['number', 'digit'] });
  for (const [char, file, name, tags] of SYMBOLS) list.push({ char, file: `symbol-${file}.png`, name: `${char} ${name}`, tags: ['symbol', ...tags] });
  return list;
}

// One key. Every character sits on the same baseline, with capitals centred, so - and _ or . and · stay apart
// the way they look on a keyboard instead of all being centred on their own ink.
const KEY_CSS = `
  @font-face { font-family: Studio; font-weight: 800; src: url("data:font/woff2;base64,${fs.readFileSync(FONT).toString('base64')}") format("woff2"); }
  * { margin: 0; box-sizing: border-box; }
  body { background: transparent; }
  .key { position: relative; width: ${SIZE}px; height: ${SIZE}px; background: ${BODY}; overflow: hidden; }
  .key span { position: absolute; left: 0; right: 0; top: 0; text-align: center; color: ${INK};
    font: 800 96px/1 Studio; height: ${SIZE}px; line-height: ${SIZE}px; }
`;

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const keyHtml = char => `<div class="key"><span>${esc(char)}</span></div>`;

// The sheet the pack shows in Stream Deck's store listing and that goes in the repo's docs: every key, by group.
function sheetHtml(list) {
  const group = (title, items) => `<h2>${title}</h2><div class="grid">${items.map(i => `<figure>${keyHtml(i.char)}<figcaption>${esc(i.file.replace(/\.png$/, ''))}</figcaption></figure>`).join('')}</div>`;
  return `<!doctype html><meta charset="utf-8"><style>${KEY_CSS}
    body { background: #f8fafc; font: 600 14px system-ui, sans-serif; color: #0f172a; padding: 32px; width: 1600px; }
    h1 { font: 800 28px Studio; margin-bottom: 4px; } p { color: #475569; margin-bottom: 8px; }
    h2 { font: 800 18px Studio; margin: 24px 0 12px; }
    .grid { display: flex; flex-wrap: wrap; gap: 14px; }
    figure { width: ${SIZE}px; } .key { border-radius: 18px; }
    figcaption { margin-top: 4px; font-size: 11px; color: #475569; text-align: center; }
  </style><h1>${NAME}</h1><p>${list.length} keys: A-Z, a-z, 0-9 and every US keyboard symbol. Search for a name below in Stream Deck's icon library.</p>
  ${group('Capitals', list.filter(i => i.file.startsWith('upper-')))}
  ${group('Lowercase', list.filter(i => i.file.startsWith('lower-')))}
  ${group('Digits', list.filter(i => i.file.startsWith('digit-')))}
  ${group('Symbols', list.filter(i => i.file.startsWith('symbol-')))}`;
}

async function main() {
  const list = characters();
  const pack = `${ID}.sdIconPack`;
  const dir = path.join(OUT, pack);
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'icons'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'previews'), { recursive: true });

  const browser = await chromium.launch(process.env.STUDIO_TEST_CHROMIUM ? { executablePath: process.env.STUDIO_TEST_CHROMIUM } : {});
  try {
    const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>${KEY_CSS}</style><div class="key"><span></span></div>`);
    await page.evaluate(() => document.fonts.load('800 96px Studio'));
    for (const i of list) {
      await page.$eval('.key span', (el, c) => { el.textContent = c; }, i.char);
      await page.locator('.key').screenshot({ path: path.join(dir, 'icons', i.file) });
    }
    // The pack's own icon: Aa1 on the same navy key.
    await page.$eval('.key span', el => { el.textContent = 'Aa1'; el.style.fontSize = '54px'; });
    await page.locator('.key').screenshot({ path: path.join(dir, 'icon.png') });

    const sheet = await browser.newPage({ viewport: { width: 1664, height: 800 } });
    await sheet.setContent(sheetHtml(list));
    await sheet.evaluate(() => document.fonts.ready);
    await sheet.screenshot({ path: path.join(OUT, 'characters-preview.png'), fullPage: true });
    fs.copyFileSync(path.join(OUT, 'characters-preview.png'), path.join(dir, 'previews', 'characters.png'));
  } finally {
    await browser.close();
  }

  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    Author: 'PIVT',
    Description: 'Every letter (capital and lowercase), digit and US keyboard symbol as a key image, in the FirstPass Studio colours.',
    Name: NAME,
    URL: 'https://github.com/zapheus-runplaywin/FirstPassStudio',
    Version: VERSION,
    Icon: 'icon.png',
    Tags: ['letters', 'numbers', 'symbols', 'alphabet', 'keyboard', 'FirstPass Studio'],
  }, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'icons.json'), JSON.stringify(list.map(i => ({ path: i.file, name: i.name, tags: i.tags })), null, 2) + '\n');
  fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(dir, 'license.txt'));

  // The pack is a zip of the .sdIconPack folder, renamed so the Stream Deck app opens it.
  const files = [];
  const walk = rel => {
    for (const e of fs.readdirSync(path.join(OUT, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(r); else files.push({ name: r, file: path.join(OUT, r) });
    }
  };
  walk(pack);
  const target = path.join(OUT, `${NAME}.streamDeckIconPack`);
  const out = fs.createWriteStream(target);
  await zip.write(out, files);
  await new Promise(resolve => out.on('close', resolve));
  console.log(`${list.length} icons -> ${path.relative(ROOT, target)}`);
}

main().catch(err => { console.error(err); process.exit(1); });
