# FirstPass Studio — Stream Deck plugin

Keys for FirstPass Studio's own scene (the Output page). The **Source** key shows or hides a source and lights up
while it's on. The **Scene** key goes to a saved scene (or the next or previous one, or back to the current one as
saved), lights up while its scene is on, and shows a yellow dot when sources have changed since. The **Sequence** key plays a sequence (or presses Next,
Pause or Stop for whatever is playing), lights up while it plays and counts down the step on screen, the whole sequence or both (its Time left setting), or to a
sequence about to start by itself after the siren. The **Switcher** key presses the ATEM switcher picked on the Output page (a camera to preview
or program, a stinger, Cut, Auto, a key, Fade to black or a macro) and lights with its tally: red on program, green on preview. It follows the scene live through Studio's `/api/scene/events`, so the key changes the moment the
source does, whether it was turned on from the key, the Output page or a `/deck/layer` link; Switcher keys follow `/api/switcher/events` the same way.
The **Replay** key plays, pauses, jumps, nudges or stops the 4K replay or practice game started on the Recordings tab, whichever is running
(`/deck/replay/...`, `/deck/practice/...`), and lights while one runs; with no events for those, it asks `/api/replay` and `/api/practice` each second.

The Mac app's release workflow packs this plugin into the app, and the app installs it (menu bar icon >
**Install the Stream Deck plugin**, or the button on the Output page). How to use the key is in
[`STREAMDECK.md`](../../STREAMDECK.md#scene-output-page).

The first press on a Studio asks it to pair (the Mac shows Allow or Deny); from then on every press is signed with
the plugin's own key pair (`src/lib/identity.ts`), kept in the plugin's global settings so it survives updates.

Built on Elgato's SDK (`@elgato/streamdeck` v3), TypeScript and Rollup, like the Timed Sequence plugin beside it.
Needs the Stream Deck app 7.1 or later.

## Working on it

```bash
npm install
npm run build              # -> com.runplaywin.firstpass-studio.sdPlugin/bin/plugin.js
npx streamdeck dev         # once: turn on Stream Deck developer mode
npm run link               # symlink the .sdPlugin folder into Stream Deck's plugins folder
npm run restart            # restart the plugin so Stream Deck picks up the build
```

`npm run watch` rebuilds on save and restarts the plugin. `npm run pack` writes
`dist/com.runplaywin.firstpass-studio.streamDeckPlugin`, the file the app ships and Studio's
`POST /api/scene/streamdeck` opens. `npm test` runs the unit tests and an end-to-end test that starts a real Studio
(`server.js` with an empty data folder) and the real plugin against a fake Stream Deck app. `npm run typecheck` runs `tsc`.

## Layout

```
src/
  plugin.ts            registers the action and connects to Stream Deck
  actions/source.ts    SDK action: one SourceKey per key on screen; answers the settings panel's list request
  actions/scene.ts     SDK action: one SceneKey per key on screen; answers the settings panel's scene list request
  actions/sequence.ts  SDK action: one SequenceKey per key on screen, redrawn each second while it counts down
  actions/runorder.ts  SDK action: one RunOrderKey per key on screen; answers the settings panel's saved orders request
  actions/switcher.ts  SDK action: one SwitcherKey per key on screen; answers the settings panel's cameras and keys request
  actions/playback.ts  SDK action: one PlaybackKey per key on screen, asking what's playing back each second
  lib/source-key.ts    what a key shows (lit, title) and which link a press opens (no SDK)
  lib/scene-key.ts     what a Scene key shows (lit, changed dot, title) and which link a press opens (no SDK)
  lib/sequence-key.ts  what a Sequence key shows (lit, step and time left) and which link a press opens (no SDK)
  lib/runorder-key.ts  what a Run order key shows (what plays next, lit while queued) and which link a press opens (no SDK)
  lib/switcher-key.ts  what a Switcher key shows (tally red or green, on air, not answering) and which link a press opens (no SDK)
  lib/playback-key.ts  what a Replay key shows (lit while a replay or practice game runs, Play or Pause) and which link a press opens (no SDK)
  lib/colours.ts       each kind's colour and picture, the output disc, tally colours, and the key images drawn from them
  lib/identity.ts      the plugin's Ed25519 key pair (in the global settings), pairing with a Studio, and signing presses
  lib/studio.ts        one live scene (and switcher) connection per Studio address, shared by its keys; presses and the lists
com.runplaywin.firstpass-studio.sdPlugin/
  manifest.json
  ui/source.html       Source key settings panel (plain HTML/JS)
  ui/scene.html        Scene key settings panel
  ui/sequence.html     Sequence key settings panel
  ui/runorder.html     Run order key settings panel
  ui/switcher.html     Switcher key settings panel
  ui/playback.html     Replay key settings panel
  imgs/                plugin, category, action and key images per kind (each kind's colour off and on, with Output 1's disc)
test/
  source.test.ts       parsing, key views, links, and the feed reconnecting
  scene.test.ts        Scene key views (current, changed, next/previous at the ends), links, the dot
  sequence.test.ts     Sequence key views (playing, paused, Next, off air, gone, time left), links, settings panel time list
  runorder.test.ts     Run order key views (head, more queued, gone items, another output, Load), links, manifest and panel
  switcher.test.ts     Switcher key views (tally, on air, not answering, not on it), links
  playback.test.ts     Replay key views (replay, practice, demo, following the video, nothing running), links, manifest and panel
  colours.test.ts      kinds' colours, output discs, key images and contrast, no colour in the settings panels
  plugin.e2e.test.ts   real SDK + real Studio + fake Stream Deck app (+ Studio's stand-in ATEM for the Switcher key)
```

Each key has an Output setting (an output's id; Output 1 when empty): it follows that output's view of the scene
(`forOutput` in `lib/studio.ts`), presses that output's `/deck/output/<id>/...` links, and shows its number and colour in
the disc from the scene feed's `outputs` (`outputMark`, which remembers them while Studio is off air). The manifest sets the
titles along the bottom, white on the dark off state and black on the lit one.

A key follows its source by id, so renaming the source on the Output page keeps the key working. Keys off screen
(another page or profile) stop following, so a page nobody can see keeps no connection open.
