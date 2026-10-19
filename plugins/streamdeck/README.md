# Timed Sequence — Stream Deck plugin

Press the key to arm it. It counts down to a local time you set, then runs a list of steps
(open things, run commands, call webhooks, press hotkeys, type text), with delays between them.

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
| `ok` / `alert` | Flash a check mark / warning on the key |
| `log <text>` | Write to the plugin log |

Modifiers: `ctrl`, `shift`, `alt` (`option`), `cmd` (Mac only). Named keys: `enter`, `tab`, `esc`, `space`,
`backspace`, `delete`, `up` `down` `left` `right`, `home`, `end`, `pageup`, `pagedown`, `f1`–`f12`, or any single character.

### Example

```
# Go-live at 19:00
open "/Applications/FirstPass Studio.app"
wait 10s
http POST http://homeassistant.local:8123/api/webhook/studio-lights-on
wait 2s
keys ctrl+alt+s
at 19:30
keys ctrl+alt+x
ok
```

## Good to know

- **It can't press your other Stream Deck keys.** The SDK doesn't let plugins trigger other actions.
  To drive Home Assistant, Bitfocus Companion, etc., use their webhook/HTTP APIs (`http`/`post`) or hotkeys (`keys`).
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
  lib/steps.ts              step executors (open/run/http/keys/type…) and the wall-clock wait
  lib/sequence.ts           step-script, time and duration parsing
com.runplaywin.timed-sequence.sdPlugin/
  manifest.json
  ui/timed-sequence.html    settings panel (plain HTML/JS, no external scripts)
  imgs/                     plugin, category, action and key images
test/
  sequence.test.ts          parser and key-combo mapping
  controller.test.ts        state machine with a fake key (timing, stop, repeat, restore, errors)
  plugin.e2e.test.ts        launches src/plugin.ts with the real SDK against a mock Stream Deck app
```

`npm test` runs all three; `npm run typecheck` runs `tsc --noEmit`.

To rebrand, change the UUID in `manifest.json`, the `@action({ UUID })` in `src/actions/timed-sequence.ts`,
the folder name, and the `sdPlugin`/UUID strings in `rollup.config.mjs` and `package.json` together.
