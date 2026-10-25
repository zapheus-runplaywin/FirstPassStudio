"""Joins the per-page PDFs from render.js into out/guide-web.pdf, with a bookmark per page and the document details."""
import json, os
from pypdf import PdfWriter, PdfReader
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, 'out')
pages = json.load(open(os.path.join(OUT, 'pages.json')))
w = PdfWriter()
for p in pages:
    r = PdfReader(os.path.join(OUT, f"p{p['i']:02d}.pdf"))
    assert len(r.pages) == 1, (p, len(r.pages))
    w.add_page(r.pages[0])
assert len(w.pages) == len(pages), (len(w.pages), len(pages))
for p in pages:
    # Chromium rounds the page size up a hair; trim it to the page's own height so no sliver of white shows
    pg = w.pages[p['i']]; top = float(pg.mediabox.top)
    for box in (pg.mediabox, pg.cropbox): box.lower_left = (0, max(0, top - p['h'] * 0.75 + 0.01))
    t = p['title'] if not 2 <= p['i'] <= 12 else f"{p['i'] - 1}. {p['title']}"
    w.add_outline_item(t, p['i'])
w.add_metadata({'/Title': 'FirstPass Studio User Guide', '/Author': 'PIVT', '/Subject': 'User guide for FirstPass Studio'})
w.page_mode = '/UseOutlines'
w.compress_identical_objects(remove_duplicates=True, remove_unreferenced=True)
with open(os.path.join(OUT, 'guide-web.pdf'), 'wb') as f: w.write(f)
print(round(os.path.getsize(os.path.join(OUT, 'guide-web.pdf')) / 1e6, 1), 'MB,', len(w.pages), 'pages')
