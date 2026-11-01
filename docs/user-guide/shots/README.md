# Guide screenshots

The user guide's Studio screenshots (`../img/s-*.webp`) are taken by `run.js` on the guide's sample competition,
the made-up **Elite Netball League**, so they can be taken again whenever Studio's pages change.

- `league.js` is the league: eight clubs (Panthers, Falcons, Stingrays, Wolves, Rhinos, Cobras, Grizzlies, Hawks) in
  Premier, Men's and Under 21 divisions at the Metro Arena, a season for the tests' stand-in PlayHQ
  (`test/support/playhq.js`) with Round 9 tonight and Panthers v Falcons in the third quarter, and the competition's
  template with its colours and logos.
- `assets/` holds the team logos, the competition logo and the sponsors' logos (SVGs, drawn to PNGs as the run starts).
- `run.js` starts Studio and the stand-in PlayHQ on this computer, in a data folder of their own, and sets the night up
  through Studio's own API: 32 sources, six scenes, the sequences (with Half time's scene step and two mini sequences),
  a run order, two playlists, the six sponsors with two and a half hours of exposure, and the planner's commentators.
- `shots.js` lists every shot: its name and how it's taken (a whole page, one section, or a dialog).

Run it from the repository folder (needs Playwright's Chromium, ffmpeg and python3 with Pillow):

```
node docs/user-guide/shots/run.js            # every shot
node docs/user-guide/shots/run.js output     # only the shots with "output" in their name
KEEP=1 node docs/user-guide/shots/run.js     # set the night up and leave Studio running to look at
```

Each shot is taken at 1440 wide (the 13" MacBook's window, so every page is shown as it fits the smaller Mac) at twice
the pixels, once in the dark theme and once in the light one:

- dark: `../img-web/<name>.jpg` (full size, for the web PDF) and `../img/<name>.webp` (at most 1200 wide, for the page);
- light: `../img-print/<name>.jpg` and `../img/light/<name>.webp`, which `../web-pdf/print.js` uses for the print PDF.

`img-web/` and `img-print/` aren't committed. After a run, rebuild both PDFs (`../web-pdf/README.md`). The
graphics' own pictures (`g-*`) aren't taken here: they change only when a graphic does.
