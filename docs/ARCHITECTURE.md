# How FirstPass Studio is put together

One page on which file owns what, how a request travels from a graphic to PlayHQ, and what runs on a timer. The
README says what Studio does and how to use it; this says how it is built. Keep it current the way the Docs page is
kept current: a new module, timer or data flow gets its line here in the same pull request.

## The three parts

```
 Mac app (desktop/)  ──starts──▶  the helper (server.js + modules)  ──HTTP──▶  PlayHQ
   menu bar, windows,               serves the pages, the API and         api.playhq.com (GraphQL)
   display/NDI/DeckLink outputs     the scene; saves the data folder      spectator.playhq.com (live feed)
         │                                   ▲
         │ shows                             │ fetch + WebSocket
         ▼                                   │
 the pages (public/)  ◀──────────────────────┘
   Studio pages you work in, and the graphics that go on screen
```

- **The Mac app** (`desktop/main.js`) is an Electron menu bar app. It starts `server.js` as a child process when a
  Studio window opens ("on air"), stops it when the last window closes, and owns the outputs that need the Mac:
  full-screen displays (`desktop/outputs.js`), NDI (`desktop/ndi.js`), Blackmagic (`desktop/decklink.js`), both fed
  by an off-screen render of the scene (`desktop/scenewindow.js`). `desktop/windows.js` makes the app's own windows
  and menus from the tab list in `public/studiobar.js`; `desktop/updates.js` and `desktop/whatsnew.js` handle updates.
- **The helper** is plain Node, no framework: `server.js` routes every request by hand and the modules beside it each
  own one subject. Everything it saves goes in the data folder (`datadir.js`), never inside the app.
- **The pages** are static HTML in `public/`. The Studio pages (Output, Scoreboard control, Competitions setup,
  Sponsors, Athletes, Stream Deck, Docs) share `studio.css` and `studiobar.js`. The graphics only talk to the helper
  on this computer and keep the competition's own look.

Two more pieces live in the repository: the Stream Deck plugin (`plugins/studio-deck`, TypeScript, talks to the helper's
`/deck/*` links and the scene WebSocket) and the native addons for NDI and DeckLink (`native/`).

## Module map (helper)

| File | Owns |
| --- | --- |
| `server.js` | Routing, the scoreboard ("the board": scores, clock, period, manual or following), PlayHQ reading (session, fixtures, ladders, rounds, games, live feed, scoring window), game auto-select, athletes, the Graphics page's JSON for each page, start-up and shutdown. Being split by review decision D6: `playhq.js` first, then board, athletes and games. |
| `competitions.js` | Saved competition setups in `competitions/`, `active.json`, templates import, per-club logos and colours. |
| `scene.js` | The scene: sources as layers on one frame, scenes (saved sets of sources), the Output page's state, the WebSocket and SSE feeds that push it to pages and the plugin, game triggers. |
| `sequences.js` | Sequences: steps played in order, waits, repeats, Stream Deck key, time left. |
| `music.js` | The stream's music: one player, playlists, fades and ducking, the super shot song. |
| `sponsors.js`, `exposure.js` | Sponsors, spots on the graphics, ads in sequences; proof of play for the exposure report. |
| `viewers.js` | Live viewer numbers from YouTube and Facebook while a video output is on. |
| `outputs.js` | Which output (display, chroma, fill+key, NDI, Blackmagic) is on and what it shows; the app does the showing. |
| `finals.js`, `fonts.js` | Finals formats per competition and division; the fonts a competition can use. |
| `datadir.js`, `datalocation.js`, `migrations.js`, `savefile.js` | Where settings live, moving them to iCloud Drive, bringing old settings up to date after an update, writing files atomically. |
| `access.js` | Who on the network may change things (the "Let other devices change things" switch). |
| `linkhost.js`, `zip.js`, `examples.js` | The `.local` name in links; just enough zip for export and backup; example PNGs of every graphic. |

Shared browser code in `public/`: `sceneevents.js` (follow the scene over the WebSocket), `pageoptions.js` (the options
each graphic takes in its link), `pages.js` (the registry of graphics, review decision D7), `fit.js` (keep a card in
the zone between title and scoreboard), `done.js` (a one-shot animation switches its source off), `sfx.js` and
`pagesound.js` (animation sound), `sponsorspot.js` (presented-by spots), `chroma.js`, `log.js` (page errors to the
debug log), `autoreload.js`.

## How a request flows

1. A graphic such as `scoreboard.html` asks the helper, for example `GET /api/scoreboard`. Pages never call PlayHQ.
2. `server.js` checks `access.js` (writes from another device may be refused), then routes the path.
3. For PlayHQ data it goes through a cache per query. A reading younger than its max age is answered from memory;
   otherwise one call goes to PlayHQ and every page asking at the same moment shares it. Fixtures, ladders, rounds and
   `discoverGame` use `api.playhq.com/graphql` with a guest cookie; the running score, clock and quarter come from
   `spectator.playhq.com/graphql`.
4. The live feed is read only inside the scoring window: from "electronic scoring starts N minutes before the game"
   (competition setup) until the game is final. Before then "not electronically scored" is logged once per game.
5. Scores, the clock and manual overrides live on the board in memory and are saved to `scoreboard-state.json` so a
   restart picks up where it was.
6. Anything that changes the scene (a source on or off, a scene or sequence starting) goes through `scene.js`, which
   pushes the whole scene to every page holding the WebSocket at `/api/scene/socket` and to the plugin's SSE feed.

Every change to a saved file uses `savefile.js` (write to a temporary file, then rename), so a crash mid-write never
leaves a half-written settings file.

## What runs on a timer

| Where | Every | Does |
| --- | --- | --- |
| `server.js` refreshTick | 1 s | Refreshes the board from PlayHQ when the last reading is older than **Check PlayHQ every** (control page, default 5 s), while a game is followed and scoring has opened. Runs whatever windows are open (review decision D1). |
| `server.js` autoPick | 15 s (first after 3 s) | Game auto-select: picks the next game on the default court when its scoring window opens. |
| `server.js` scene.game | 1 s | Hands the game snapshot to the scene for game triggers (quarter breaks, full time) and the super shot song. |
| `viewers.js` | 30 s per stream | Live viewer counts, only while a video output is on. |
| `outputs.js` listenChanged | 5 s | Notices a preview that stopped checking in. |
| `scene.js` SSE ping | 25 s | Keeps the plugin's event stream open. |
| Pages | 1-30 s | Scoreboard, goals, ticker, countdown, super shot and streak pages poll the helper only (see "Data and bandwidth" on the Docs page). |

Logging: one debug log, `logs/playhq-graphics.log` in the data folder (15 MB cap), written by the helper and by pages
through `/api/log`. The log file keeps its old name on purpose.

## Tests

`npm test` runs the `node:test` suites in `test/`. `test/support/studio.js` starts a real `server.js` on a free port
with its own data folder; `test/support/playhq.js` is a stand-in PlayHQ with a made-up season around today's date. A
Chromium page-load test runs when a browser is available. The Tests workflow runs them on every pull request and
before each Mac app build; `test/packaging.test.js` checks that every root module is in the app's file list.
