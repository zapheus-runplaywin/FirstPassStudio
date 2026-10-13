# Timed Sequence — Stream Deck plugin

Press the key to arm it. It counts down to a local time you set, then runs a list of steps
(switch OBS scenes, show/hide OBS sources, call webhooks, open things, run commands, press hotkeys, type text),
with delays between them. Think of it as a Multi Action with a start time.

Built on Elgato's official SDK (`@elgato/streamdeck` v3) with the standard TypeScript + Rollup setup
from `streamdeck create`.

- Stream Deck app **7.1+**, Windows 10+ / macOS 12+
- Node.js 20+ and npm on your machine to build (the plugin itself runs on Stream Deck's bundled Node 24)

## Build and install

```bash
npm install
npm run build              # -> com.runplaywin.timed-sequence.sdPlugin/bin/plugin.js
npx streamdeck dev         # once: turn on Stream Deck developer mode
npm run link               # symlink the .sdPlugin folder into Stream Deck's plugins folder
npm run restart            # restart the plugin so Stream Deck picks up the build
```

The action appears under **Timed Sequence** in the action list.

While working on it, `npm run watch` rebuilds on save and restarts the plugin automatically.

To make an installable file to share or keep: `npm run pack` writes
`dist/com.runplaywin.timed-sequence.streamDeckPlugin` (double-click it to install).
`npm run validate` checks the manifest and files without packing.

## Using it

1. Drag **Timed Sequence** onto a key.
2. In the settings panel set **Start at** (local time on this computer, seconds optional) and type the **Steps**.
3. Press the key (or **Arm**). The key turns green and shows the start time and a countdown.
4. At that time the steps run in order; the key shows `RUN 2/6` and any wait's countdown.

| Key press while… | Does |
|---|---|
| Idle (`14:30 OFF`) | Arms for the next 14:30 (today, or tomorrow if it's passed) |
| Armed (green, countdown) | Disarms |
| Running (`RUN n/N`) | Stops the sequence immediately |

**Test run now** runs the steps immediately; if the key was armed, it stays armed afterwards.

Options:

- **Repeat every day:** re-arms for the same time tomorrow after each run.
- **Arm automatically when Stream Deck starts.**
- **Stop the sequence** on error (otherwise it logs the error and carries on).
- **Skip if late:** if the computer was asleep at the start time and wakes more than N minutes later, skip instead of running late. 0 = always run.

The armed time is saved with the key, so if Stream Deck restarts before the start time it re-arms itself.
Switching pages or profiles doesn't cancel anything; timers keep running in the background.

## Step reference

One step per line. Lines starting with `#` or `//` are comments.

| Step | What it does |
|---|---|
| `wait 5s` | Delay. Also `delay`/`sleep`. Accepts `500ms`, `90` (seconds), `1m30s`, `2h`, `00:02:00` |
| `at 14:45` | Wait until another local time (next occurrence). `14:45:30`, `2:45pm` also work |
| `open <target>` | Open a URL (default browser), file, folder, or app (`open Spotify` on Mac; full path or `.exe` on Windows) |
| `run <command>` | Run a shell command and **wait** for it to finish (cmd.exe on Windows, sh on Mac) |
| `start <command>` | Launch a shell command and continue straight away |
| `http POST <url> [body]` | HTTP request: GET/POST/PUT/PATCH/DELETE/HEAD. Shorthands: `get <url>`, `post <url> {...}`. JSON bodies get `Content-Type: application/json` |
| `keys ctrl+shift+s` | Press a key combo in the focused window. Several combos: `keys ctrl+a ctrl+c` |
| `type Hello there` | Type text into the focused window |
| `obs scene <scene>` | Switch OBS to a scene |
| `obs show <source>` | Show a source in the current OBS scene. Also `obs hide` and `obs toggle` |
| `obs show <source> in <scene>` | Show/hide/toggle a source in a named scene (it doesn't have to be the one on air) |
| `ok` / `alert` | Flash a check mark / warning on the key |
| `log <text>` | Write to the plugin log |

Modifiers: `ctrl`, `shift`, `alt` (`option`), `cmd` (Mac only). Named keys: `enter`, `tab`, `esc`, `space`,
`backspace`, `delete`, `up` `down` `left` `right`, `home`, `end`, `pageup`, `pagedown`, `f1`–`f12`, or any single character.

Scene and source names are matched exactly as they appear in OBS (capitals and spaces count). Names can contain spaces
without quotes; if a name contains the word "in", put the names in quotes: `obs show "Sign in board" in "Full Time"`.

### Example

```
# Pre-game at 18:55, start at 19:00
obs scene Pre Game
get http://localhost:8080/deck/scores/reset
wait 2s
obs hide Winner in Full Time
at 19:00
obs scene Live
obs show Scoreboard
get http://localhost:8080/deck/clock/start
ok
```

## OBS setup

The `obs` steps talk to OBS directly through the WebSocket server built into OBS 28 and later, so you don't need the
OBS Studio Stream Deck plugin for them (it can stay installed).

1. In OBS: **Tools → WebSocket Server Settings**, tick **Enable WebSocket server**. Click **Show Connect Info** for the
   port and password.
2. In the key's settings, under **OBS**, enter the address (`localhost:4455` if OBS is on this computer, or e.g.
   `192.168.1.20:4455` for another one) and the password, then click **Test connection**. It lists OBS's scenes so you
   can copy the exact names.

The OBS address and password are shared by every Timed Sequence key; set them once. The plugin connects when an `obs`
step first runs and reconnects by itself if OBS is restarted. If OBS isn't reachable the step fails with the reason
(and the sequence stops, unless **Stop the sequence** on error is unticked).

## Good to know

- **It can't press your other Stream Deck keys** or run other plugins' actions: the SDK doesn't let plugins trigger
  other actions. OBS scenes and sources are built in (`obs` steps); for other apps use their webhook/HTTP APIs
  (`get`/`post`) or hotkeys (`keys`).
- **The OBS password** is kept in Stream Deck's settings for this plugin, in plain text like other Stream Deck plugin settings.
- **Hotkeys and typing go to whatever window is focused** at that moment. Add an `open` + `wait` first to bring the right app forward.
- **macOS:** `keys` and `type` need Accessibility permission for Stream Deck
  (System Settings → Privacy & Security → Accessibility). macOS asks the first time.
- **Windows:** `keys`/`type` use PowerShell + `WScript.Shell.SendKeys`. The Windows key can't be sent this way.
- **Sleep:** a sleeping computer can't run anything. On wake it runs immediately (or skips, if *Skip if late* is set).
- **Deleting an armed key:** disarm it first, otherwise its timer stays alive until the plugin restarts.
- **Logs:** `com.runplaywin.timed-sequence.sdPlugin/logs/` (in the linked folder). For full message tracing set
  `streamDeck.logger.setLevel("trace")` in `src/plugin.ts`.

## Project layout

```
src/
  plugin.ts                 registers the action and connects to Stream Deck
  actions/timed-sequence.ts SDK action: routes key/settings/property-inspector events to a controller per key
  lib/controller.ts         per-key state machine: idle -> armed -> running -> idle / re-armed (SDK-free)
  lib/steps.ts              step executors (open/run/http/obs/keys/type…) and the wall-clock wait
  lib/obs.ts                OBS WebSocket (v5) client and the scene / source-visibility actions
  obs-service.ts            the shared OBS connection, using the address/password in Stream Deck's global settings
  lib/sequence.ts           step-script, time and duration parsing
com.runplaywin.timed-sequence.sdPlugin/
  manifest.json
  ui/timed-sequence.html    settings panel (plain HTML/JS, no external scripts)
  imgs/                     plugin, category, action and key images
test/
  sequence.test.ts          parser and key-combo mapping
  controller.test.ts        state machine with a fake key (timing, stop, repeat, restore, errors)
  obs.test.ts               OBS steps against a mock OBS (password, scenes, sources, errors, reconnect)
  plugin.e2e.test.ts        launches src/plugin.ts with the real SDK against a mock Stream Deck app and mock OBS
  support/mock-obs.ts       the mock OBS WebSocket server
```

`npm test` runs them all; `npm run typecheck` runs `tsc --noEmit`.

To rebrand, change the UUID in `manifest.json`, the `@action({ UUID })` in `src/actions/timed-sequence.ts`,
the folder name, and the `sdPlugin`/UUID strings in `rollup.config.mjs` and `package.json` together.
