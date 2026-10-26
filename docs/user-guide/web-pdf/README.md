# Web PDF layout

The web PDF (`../FirstPass Studio User Guide (web).pdf`) is the guide's own text, arranged as a marketing piece:
one tall page per chapter, a hero per chapter, framed screenshots, graphics shown close up with a map of where
they sit on screen, and a pull quote per chapter.

- `build.py` reads the chapters from the guide page and writes `web.html`.
- `layout.js` arranges each chapter in the browser (groups, floats, pairs, tiles, quotes, frames).
- `web.css` is the look, on the FirstPass brand kit.
- `render.js` (`node render.js`) prints one PDF per page; `shrink.py` sizes the pictures down first.
- `merge.py` joins the pages and adds bookmarks.
- `zoom.json` is where each small graphic sits in the 1920 × 1080 frame (for the close ups and their maps).

It expects the full-size JPEG screenshots beside the guide page in `img-web/` (and close ups in `img-web/crop/`),
made from the same screenshot run as `img/`; they are not committed because of their size. Edit the guide page,
not this layout, when the words change.

When the screenshots haven't changed but the words have, `python3 recover.py` rebuilds `img-web/` from the current
web PDF's own pictures (and the WebPs for anything it doesn't hold), so the PDFs can be made again without the
screenshot run. Then: `python3 build.py`, `node render.js`, `python3 merge.py`, and copy `out/guide-web.pdf` over
the web PDF.

`node print.js` makes the print PDF: the guide page on its light grounds, A4, pictures as JPEGs at most 900 wide.
