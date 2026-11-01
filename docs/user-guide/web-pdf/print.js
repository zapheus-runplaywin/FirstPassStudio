// Prints the print PDF (../FirstPass Studio User Guide (print).pdf): the guide page on its light grounds (.light),
// A4 from the page's own @page rule, with the pictures as JPEGs at most 900 wide to keep the file small. A Studio
// screenshot with a light version in ../img/light/ (taken by ../shots/run.js) prints that one, to match the page.
// Run: node print.js (needs Playwright's Chromium and python3 with Pillow and pypdf).
const { chromium } = require('playwright');
const path = require('path'); const fs = require('fs'); const { execFileSync } = require('child_process');
const GUIDE = path.join(__dirname, '..'); const OUT = path.join(__dirname, 'out'); const IMG = path.join(OUT, 'print-img');
fs.mkdirSync(IMG, { recursive: true });
execFileSync('python3', ['-c', `
import glob, os, sys
from PIL import Image
for f in glob.glob(os.path.join(sys.argv[1], 'img', '*.webp')):
    light = os.path.join(sys.argv[1], 'img', 'light', os.path.basename(f))
    im = Image.open(light if os.path.exists(light) else f).convert('RGB')
    if im.width > 900: im = im.resize((900, round(im.height * 900 / im.width)), Image.LANCZOS)
    im.save(os.path.join(sys.argv[2], os.path.basename(f)[:-5] + '.jpg'), quality=82, optimize=True)
`, GUIDE, IMG], { stdio: 'inherit' });
(async () => {
  const b = await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined });
  const p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
  await p.goto('file://' + path.join(GUIDE, 'index.html'), { waitUntil: 'networkidle' });
  await p.evaluate(() => document.documentElement.classList.add('light'));
  await p.evaluate(dir => Promise.all([...document.querySelectorAll('img[src$=".webp"]')].map(i => {
    i.src = 'file://' + dir + '/' + i.getAttribute('src').split('/').pop().replace('.webp', '.jpg');
    return i.decode().catch(() => {});
  })), IMG);
  await p.evaluate(() => document.fonts.ready);
  await p.pdf({ path: path.join(OUT, 'guide-print.pdf'), printBackground: true, preferCSSPageSize: true });
  await b.close();
  execFileSync('python3', ['-c', `
import sys
from pypdf import PdfReader, PdfWriter
w = PdfWriter(clone_from=PdfReader(sys.argv[1])); w.add_metadata({'/Title': 'FirstPass Studio User Guide', '/Author': 'PIVT'})
w.write(sys.argv[2]); print(len(w.pages), 'pages')
`, path.join(OUT, 'guide-print.pdf'), path.join(GUIDE, 'FirstPass Studio User Guide (print).pdf')], { stdio: 'inherit' });
})();
