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
  by an off-screen render of the scene (`desktop/scenewindow.js`). `desktop/perf.js` measures each output's CPU, memory and frame
  rate every 5 s while one is showing; `outputs.js` shows it on the Output page and logs it once a minute. `desktop/windows.js` makes the app's own windows
  and menus from the tab list in `public/studiobar.js`; `desktop/updates.js` and `desktop/whatsnew.js` handle updates.
- **The helper** is plain Node, no framework: `server.js` routes every request by hand and the modules beside it each
  own one subject. Everything it saves goes in the data folder (`datadir.js`), never inside the app.
- **The pages** are static HTML in `public/`. The Studio pages (Output, Scoreboard control, Competitions setup,
  Sponsors, Athletes, Stream Deck, Docs) share `studio.css` and `studiobar.js`. The graphics only talk to the helper
  on this computer and keep the competition's own look.

Two more pieces live in the repository: the Stream Deck plugin (`plugins/studio-deck`, TypeScript, talks to the helper's
`/deck/*` links and follows the scene's and the switcher's SSE feeds, `/api/scene/events` and `/api/switcher/events`) and the native addons for NDI and DeckLink (`native/`).

## Module map (helper)

| File | Owns |
| --- | --- |
| `server.js` | Routing, the competition in use and `control.json`, team sheets and shooting stats, the person lower third, health and page version, start-up and shutdown. |
| `playhq.js` | Everything that talks to PlayHQ: the guest session, the organisation's competitions and seasons, ladders, rounds and games, one game in detail, the live feed, the scoring window, the game cache. |
| `athletes.js` | Team logos, athlete photos, the athlete register (`athletes.json`), what the athletes page shows and edits, a team's season squad for short line ups. |
| `games.js` | The games: which round is "this round", the fixture, up next and the end of night card, intro and outro, the countdown, automatic game selection, the season graphics (ladder bar, head to head, form, ticker, top shooters) and the finals. |
| `board.js` | The board: scores, clock and period by hand or following PlayHQ's live feed, the goal order, super shots, hot streaks and moments, the game stats card and the score worm; `scoreboard-state.json` and the lasting settings in `control.json`. |
| `competitions.js` | Saved competition setups in `competitions/`, `active.json`, templates import, per-club logos and colours. |
| `scene.js` | The scene: sources as layers on one frame, each on or off per output (`visible` for the primary, `out` for the others), scenes (saved sets of sources, shared by the outputs, with a current scene per output), the Output page's state, the WebSocket and SSE feeds that push it to pages and the plugin, game triggers. |
| `sequences.js` | Sequences: steps played in order, waits, repeats, Stream Deck key, time left. Sequences are shared by the outputs and play on the one picked (`startOn` for automatic starts), with one runner per output (`within()` switches between them); only the primary's play music. |
| `music.js` | The stream's music: one player, playlists, fades and ducking, the super shot song. |
| `mics.js` | Live mics plugged into the Mac (`mics.json`, one set per Mac): each mic's input, channel, level, mute and low cut, the master level and mute, and the dips under music, a video's sound, quiet scenes and by hand (worked out in `state()`, which `scene.js` calls). The primary output's own window (`scene.html?fit=1`) opens the devices with Web Audio, mixes them in through a limiter and reports what it hears twice a second (`/api/scene/mics/report`); the Output page reads it from `/api/scene/mics/live`. A Scene View never opens them. A mic plugged into the switcher instead (`on: 'atem'`, one of its Fairlight mic or line inputs, or half of one split in two) is mixed by the switcher: `mics.js` moves its fader through `switcher.js` (`micInputs()`, `setMicFader()`), stepping every 50 ms while a dip fades, takes the faders as it finds them on connecting (sends nothing), and a fader moved on the switcher becomes the mic's level. |
| `sponsors.js`, `exposure.js` | Sponsors, spots on the graphics, ads in sequences; proof of play for the exposure report. |
| `viewers.js` | Live viewer numbers from YouTube and Facebook while a video output is on. |
| `outputs.js` | Up to four outputs, each with its own route (display, chroma, fill+key, NDI, Blackmagic) and on/off; the first is the primary and the only one with sound. Earlier outputs keep a display, the Blackmagic device or an NDI name. The app does the showing. Each output also keeps how it comes into the ATEM (its key and switcher inputs), given to `switcher.js` by `switcherPlan()`. |
| `switcher.js` | The Blackmagic ATEM switcher, if one is set up: finding it (Bonjour via macOS's `dns-sd`), one connection through `atem-connection` (in-process, UDP 9910), its state for the Output page and the plugin's Switcher keys (`/api/switcher/events`, sent on each change), and the cuts, previews and keys the Output page and `/deck/switcher/*` ask for; `switcher.json`. Sends nothing by itself. Also cleans and runs the switcher actions saved on sequence steps and scenes (`run(actions, why, owner)`, `cancel(owner)`): `sequences.js` and `scene.js` call it for the primary output only. Stinger cuts: it plays the scene's stinger through `scene.js` (`stingerSource`, `playStinger`), and `stinger.html` says when it covers the frame (postMessage to `scene.html`, which posts `stingerStarted` to `/api/switcher`), so the cut is timed from the page's own settings plus the line-up. The stinger plays on the output on a downstream key (`stingerOutput()`, Output 1 unless another one that's switched on is), each output has its own line-up (`lineups` in `switcher.json`), and only that output's windows' report counts. Each output's key (`keyChecks`, in its status as `keys`): reads the key an output comes into (`outputs.switcherPlan()`: its Into the switcher as, inputs and signal) and lists what differs; `keySetup` writes only that, when the Output page asks. Cameras per output: `take()` puts the paired upstream keys that must change in the next transition selection for Studio's cuts, autos and stinger cuts (and restores it), and Keys follow the camera (`followSoon`) sets them after a program change made elsewhere. |
| `finals.js`, `fonts.js` | Finals formats per competition and division; the fonts a competition can use. |
| `datadir.js`, `datalocation.js`, `migrations.js`, `savefile.js` | Where settings live, moving them to iCloud Drive, bringing old settings up to date after an update, writing files atomically. |
| `access.js` | Who on the network may change things (the "Let other devices change things" switch), and who may press a Stream Deck link (its key, the plugin's header, or Studio's own pages). |
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
7. The scoreboard travels the same socket as a second message type: a page that sends `{"subscribe":"board"}` gets
   what `GET /api/scoreboard` gives, at once and on every change (`scene.publishBoard`, called from `saveBoards` and
   each second). The ATEM switcher's state (`switcher.js`) travels it a third way, for a page that sends `{"subscribe":"switcher"}` (the Output page), on each change, and to the plugin's Switcher keys over its own SSE feed (`/api/switcher/events`). `sceneevents.js` wraps them for the pages; the HTTP endpoints stay for the plugin and other tools.

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
| `switcher.js` (atem-connection) | about 2 per second each way | The switcher's own heartbeat while connected; after about 5 s of silence it counts as lost and the library reconnects every second. A switcher found by name is looked for again every 15 s while lost, in case its address changed. |
| `scene.js` SSE ping | 25 s | Keeps the plugin's event stream open. |
| `scene.html` mics | 25 ms, 500 ms | In the primary output's window, while mics are set up: the mics' levels follow the settings and the dip; twice a second it reports their levels and trouble to the helper. The Output page reads that twice a second while its Mics section is open. |
| `server.js` pushBoard | on each save, and 1 s | Pushes the scoreboard to the pages following it over the scene socket (scoreboard, control page, goals, countdown) when it has changed. |
| Pages | 1-30 s | Ticker, super shot and streak pages poll the helper only (see "Data and bandwidth" on the Docs page). |

Logging: one debug log, `logs/playhq-graphics.log` in the data folder (15 MB cap), written by the helper and by pages
through `/api/log`. The log file keeps its old name on purpose.

## Tests

`npm test` runs the `node:test` suites in `test/`. `test/support/studio.js` starts a real `server.js` on a free port
with its own data folder; `test/support/playhq.js` is a stand-in PlayHQ with a made-up season around today's date
(`world.fail` and `world.answers` make one request fail or answer oddly, for the PlayHQ outage tests). A
Chromium page-load test runs when a browser is available. The Tests workflow runs them on every pull request and
before each Mac app build; `test/packaging.test.js` checks that every root module is in the app's file list.
