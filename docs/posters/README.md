# FirstPass Studio posters

A0 posters (841 × 1189 mm) pitching FirstPass Studio to premier competitions, Netball WA and AMMNA.
Graphics shown are from the fictional Elite Netball League used in the user guide; every claim comes from the guide.

| Poster | Idea |
| --- | --- |
| `original` | "Your league, live on air." The Clash hero, the numbers, close ups, the three audiences, sponsorship |
| `game-night` | "First centre pass to final siren." Gold hero and a game night in six stages |
| `court` | Laid out on a netball court: the pitch, the numbers round the centre circle, the audiences |
| `automation` | "Set it once. The show runs itself." Sequences and automation, a "Who presses the button?" run sheet |
| `live-on-air` | The original, brought up to date in the FirstPass brand colours: 36 graphics, and new cards for Socials and the commentary desk (Production Planner and commentator stats) |

## Feature poster (A3 landscape)

`feature` is an A3 landscape poster (420 × 297 mm) for clubs and associations: "Your competition, everywhere."
A photorealistic netball centre on stream night shows Studio on every screen, with callouts for the big screen, Socials,
the Production Planner, commentator stats, sequences and Stream Deck. Four close-ups underneath cover Socials, Sponsors,
Commentary and running a night with two people.

- `feature.pdf` is for printing, and `feature.png` (2480 × 1754) is a preview.
- `feature-display.png` (1920 × 1080) is the 16:9 version for a TV or screen, which shows the arena and leaves out the close-ups.
- The photos are AI-generated scenes with plain green screens (`source/feature/photos/`). `source/feature/composite.py` puts real
  Studio pictures from `source/feature/screens/` on the green and writes the `*-comp.jpg` photos the poster uses.
  The screen pictures come from the user guide and the Studio previews, and the LED boards come from `screens/boards.html`
  (`node screens/shoot.js`).
- To rebuild, run `python3 composite.py` (needs `opencv-python-headless`) and then `node render.js` in `source/feature/`.
  It also writes `feature-full.png` (4960 × 3508) and `feature-display-full.png` (3840 × 2160), which aren't committed.

Each has an A0 PDF for printing and a PNG preview at 3179 × 4494. For a full-resolution PNG (6358 × 8988),
run `node render.js <name>` in `source/`; it rewrites the PDF and writes `<name>-full.png` (not committed, about 7 to 9 MB).
Edit the HTML in `source/`, not the PDF. The pictures are in `source/assets/`.
