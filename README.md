# FirstPass Studio

Transparent ladder, scoreboard and game graphics for a livestream, fed live from PlayHQ's public data (no API key). Set up for
Thunder League, with saved setups ready for the AMMNA Nationals and GIG WANL (the WA Netball League).

The pages you work in (output, graphics, scoreboard control, competitions setup, athletes and Stream Deck) carry the FirstPass
Studio look from `public/studio.css`, with the Montserrat font served from `public/vendor/montserrat` so it works
offline. The graphics don't use it: they keep the colours, font and logos of the competition in use.

## One-time setup

1. Install the FirstPass Studio app (see **Desktop app** below) and open it.
2. Open the competition setup page and **Import** your competition (Thunder League, AMMNA Nationals or GIG WANL), or make a new one.

## Competition setup

http://localhost:8080/setup.html keeps a saved setup for each competition and switches between them. Each setup has the
organisation's PlayHQ link and which competition and season to use (**Find its competitions** lists them), the names
shown on the graphics (competition, organisation, venue), the game rules (quarters or halves and their length, super
shots), the finals format for the competition and for any division with its own (see **Finals** below), game day settings (court to follow, automatic game selection, minutes before a game
it switches, days ahead that count as this round), nine colours (a colour picker that also takes HEX or RGB, plus brand kit colours pasted in as swatches), panel transparency and the font, the competition logo
in light and dark mode versions (one alone is used for both; beside the title, above it and in the ladder's corner), the team logos (drop files on the page; they match clubs by file
name, and the PlayHQ team list lets you pick a different logo for any club), an optional colour for each club (behind its teams'
names on the scoreboard and behind their logo and name on The Clash) and the PlayHQ Client ID most competitions don't need. The emoji either
side of the title and The Clash's big word are options on those graphics (`?emoji=`, `?word=`), set on each source on the Output page.

Logos and colours belong to clubs, so a club's teams share them in every division. A team's club is its name without the
division on the end ("Comets 21U", "Comets Men" and "Comets Open" are all Comets; "Stormz Div 2" is Stormz), and the team
list's **Club** box links a team to another club, or a new one. Setups saved with a logo or colour per team are moved to
clubs when loaded.

**Use this one** switches every graphic, the control page and the Stream Deck to that competition (the round goes back to
automatic and the scoreboard starts on its first game). Saving the competition in use reloads the graphics.

Setups live in `competitions/<name>/` in the data folder (`settings.json`, `logos/`, `brand/`); see **Saved settings** below.
Studio starts with no competitions: **Import** one of the import configs on the setup page (Thunder League, AMMNA
Nationals, GIG WANL) or make a new one. AMMNA Nationals and GIG WANL come with their PlayHQ organisation link, colours (AMMNA green and gold from its logo;
GIG WANL in Netball WA greens with Gold Industry Group gold) and competition logo. AMMNA's PlayHQ competition is set to
Australian Championships and GIG WANL's to GIG WANL, so both are ready to use. GIG WANL plays super shots in its Open
division only, not 21&Under or Men's (confirmed by Matt). Super shots can be set per division on the setup page: by a division's
full PlayHQ name, or by a word in it ("Open", "21", "Men", which is what GIG WANL comes with). The other rules (AMMNA 10-minute
quarters and no super shots, WANL 15-minute quarters, top 4 Page finals) are guesses to check. `config.json` now only holds this computer's settings (port,
log size, how often to check PlayHQ).

On a carnival day with several rounds (like the AMMNA nationals), "this round" moves on to each round as its first game
comes up (`autoSelectMinutesBefore` ahead), and Up next looks across the whole day.

## Saved settings

Everything Studio saves lives in one data folder on this computer, outside the app, so pulling a new version or
installing an update never touches it:

- Mac: `~/Library/Application Support/FirstPass Studio`
- Set `FIRSTPASS_DATA_DIR` to use another folder.

In it:

- `competitions/<name>/`: each competition's `settings.json`, `logos/`, `brand/`, `photos/` (athlete photos) and
  `athletes.json` (the athlete register from the Athletes page), and `competitions/active.json`, the one in use.
- `control.json`: the control page's choices (the round picked by hand, and the scoreboard's automatic game selection,
  its court, following the PlayHQ clock, how often to check PlayHQ, showing the clock, the ticker speed, finals winners).
- `scoreboard-state.json`: the game on the scoreboard, the scores and the clock.
- `config.json` (optional): this computer's settings. The app's own `config.json` has the defaults (port, log size,
  how often to check PlayHQ, `linkHost`); a `config.json` here changes only the settings it names.
- `logs/`: the debug log.
- `app-settings.json`: the Mac app's own choices (whether Studio opens at login, pages in the browser, the window's size and position).
- `data-version.json` and `backups/`: see **Updates and migrations**.

### Import configs

`imports/<name>/` in the repository holds ready-made competitions (`settings.json`, `logos/`, `brand/`). They aren't
used directly: **Import** on the setup page copies one into the data folder as a new competition, to use as it is or
change. For a new customer, set their competition up on the setup page and click **Save as import config**: it copies
the settings, team logos and competition logo (not athlete photos) into `imports/<name>/`, ready to commit and send as a
pull request. That button only shows when Studio runs from a copy of the repository; the installed app can't change its
own folder.

**Export as template** on the setup page downloads a competition as one `.json` file (settings, team logos and
competition logo as base64, format `firstpass-studio-competition`), which **Import a template file** adds on any
Studio, including the installed app. **Delete this competition** works on any competition, the one in use included:
the graphics switch to the first one left, or to none.

### Updates and migrations

The data folder has a version number in `data-version.json`. When a new version of Studio changes how settings are
saved, it brings the folder up to date on its first start (`migrations.js`, one numbered step per change), after
copying the whole folder (except the log) to `backups/<date>-v<old version>`. The newest 5 backups are kept; to undo an
update, quit Studio and copy a backup's contents back. A new setting needs no migration: a competition without it gets
the default. If the folder was saved by a newer Studio than the one running, competitions open read-only rather than
lose settings the older version doesn't know.

Versions before October 2026 saved settings inside the app folder (`competitions/`, `control.json`,
`scoreboard-state.json`). The first start of this version copies whatever is still there into the data folder. Git
removes the tracked `competitions/` files when you pull, so import your competition again from **Import configs**
(photos and athlete registers left behind are kept with it).

## Desktop app (Mac)

FirstPass Studio installs as a normal Mac app on Apple silicon Macs (M1 and later), with no Node.js or Terminal needed. Download `FirstPass Studio.dmg`, drag
the app to Applications and open it. It opens the home page in its own window and lives in the menu bar (the **1P**
icon). The Output page and the Stream Deck use the same links as the home page.

**Studio only runs while a Studio window is open.** Opening a Studio window (opening the app, **Open Studio** or any
page in the menu bar icon, ⌘N) puts Studio on air: it serves the graphics and the Stream Deck links, talks to PlayHQ,
and restarts by itself if it stops. Closing the last Studio window takes it off air, so nothing talks to PlayHQ and
the graphics and Stream Deck get no answer until a window opens again. Closing the last window while on air asks
first (**Take Off Air** or **Cancel**), so a stray ⌘W can't stop a stream. Keep a window open, such as the Output
page, for the whole stream.

### Links use the Mac's .local name

The links on the home page, the control page and the Mac app's menu (including **Copy the Studio link**) start with
the Mac's Bonjour name, e.g. `http://matts-macbook-pro.local:8080/`, instead of `localhost`. That name is the
**Local hostname** in System Settings > General > Sharing, and it works on the Mac itself and from a phone,
another computer or a Stream Deck on the same network, without looking up an IP address. The port stays 8080.
`http://localhost:8080` still works on the Mac, so existing links and Stream Deck buttons carry on as they are.
To go back to `localhost` links (or use a fixed name or IP address), set `"linkHost": "localhost"` (or that name) in
`config.json` in the data folder; `"bonjour"` is the default.

Studio has always listened on every network connection, not just this Mac, so anything on the same network can
open the pages and press the Stream Deck links (scores, clock, game). Stream on a network you trust (not open venue
Wi-Fi), or use the Mac's firewall to block incoming connections to FirstPass Studio / Node.

The menu bar icon has: Start/Stop Studio, Open Studio, Scoreboard control, Competition setup, Copy the Studio link,
Install the Stream Deck plugin, Open the settings folder, Open the debug log, Restart Studio, Open at login, Open Studio at
login, Open pages in the browser instead of the app window (with the settings, so it isn't ticked by accident; the app's
`logs/app.log` notes each page it sends to the browser), Check for updates and Quit.

The status line under the version reads "Studio is on air at …" or "Studio is off air". **Start Studio** opens the
home page, which puts Studio on air; **Stop Studio** closes the Studio windows without asking and takes it off air.
Opened at login, the app sits in the menu bar off air unless **Open Studio at login** is ticked (saved as
`startHelperAtLogin` in `app-settings.json` in the data folder), which opens the home page and goes on air. Opened by
hand, it opens the home page.

With **Open pages in the browser instead of the app window** ticked the app can't tell when the browser tabs close, so Studio stays on air from
**Start Studio** (or any page opened from the menu) until **Stop Studio** or Quit.

### The app window

Studio's pages open in the app's own window (`desktop/windows.js`), not the browser: no address bar, tabs or
bookmarks, the Studio header is the title bar (the window buttons sit in it, and dragging it moves the window), and
the app shows in the Dock and ⌘Tab while a window is open, then goes back to just the menu bar icon. A link that opens
a new tab on Studio opens another app window (overlays on a dark background, since they are see-through); links to
anywhere else open in the browser. The app menu has FirstPass Studio > Close Studio Windows (⌥⌘W, asks first while on air), File > New Window (⌘N), Open in Browser (⇧⌘O) and Copy Page Link
(⇧⌘C, the .local link), Edit, View (reload, back ⌘[, forward ⌘], zoom, full screen, developer tools), Go (⌘1 output,
⌘2 graphics, ⌘3 control, ⌘4 setup, ⌘5 athletes, ⌘6 Stream Deck) and Window. Closing the last window takes Studio off air (see
above), and ⌘Q while on air asks first (Quit or Cancel). Quit always quits: if anything holds the app up for 5 seconds after Quit, it exits anyway (logged in `logs/app.log`). While Studio is starting, or if it couldn't start, the window
shows `desktop/offair.html` and opens the page again once Studio answers. The main window's size and position are saved as `windowBounds`, and
**Open pages in the browser instead of the app window** in the menu bar icon (`openInBrowser`, both in `app-settings.json`) sends every page to
the browser as before.

Settings live in the data folder (see **Saved settings**). Updates download in the background and install when the app quits, so they never
interrupt a stream; once one has downloaded, **Restart to update** in the menu installs it straight away. Settings
are brought up to date and backed up on the first start of the new version.

### Building and releasing it

The **Mac app** workflow on GitHub (Actions > Mac app > Run workflow) builds a signed, notarised app for Apple
silicon Macs (M1 and later; Intel Macs aren't supported). Without **Publish** the `.dmg` is attached to the run to try out; with it, it becomes an update for
every installed app. The workflow picks the version: the last published one raised by **Raise the version by**
(patch 0.1.0 to 0.1.1, the default; minor to 0.2.0; major to 1.0.0), or exactly what's typed in **Version**, which must
be higher than the last published one (updates only go to a higher version). The first release uses `version` in
`package.json`; after that `package.json` needn't change.

**Every merge to main publishes automatically**: the workflow runs by itself, builds the next patch version and
publishes it as an update, so installed apps pick up each merged PR. Merges that only change documentation (`.md`
files, `docs/`, the Make Examples scripts) don't publish. To publish a minor or major version
instead, add the label **minor** or **major** to the pull request before merging it: the next publish raises that part and
resets the parts after it (0.1.4 to 0.2.0 or 1.0.0). Any labelled pull request merged since the last published version counts, so
a labelled docs-only one still raises the next version, and major wins over minor. Use **Run workflow** for a specific version
or a test build without publishing. Builds run one at a time, so two quick merges get two versions.

Each run tags the commit of this repository it built from, so any build can be traced to its code: `v0.1.3` for a
published update, `v0.1.3-test.12` for a test build (12 is the run number, so a test build never takes the tag a
published version will need). The tags are under **Tags** on the repository's code page.

Each release's notes list the titles of the pull requests merged since the last published version (found from its
tag), so a clear PR title is what people read on the release. Only the titles go out, with no links, since this
repository is private. A test build shows the same notes in its run summary.

The app includes ffmpeg (for converting ProRes clips in the Studio scene). The workflow builds it from source with
`vendor/ffmpeg/build.sh` (an LGPL build with VP9 and Opus, versions in that file) and caches it, so it's only rebuilt
when `build.sh` changes; that first build adds several minutes. `npm run app` from a checkout uses it too once
`vendor/ffmpeg/build.sh` has been run.
The "ffmpeg updates" workflow checks every Monday for newer FFmpeg, libvpx and opus releases and opens a pull
request raising the versions in `build.sh`; merging it ships the new ffmpeg in the next release. It needs Settings >
Actions > General > "Allow GitHub Actions to create and approve pull requests" ticked. The build only includes what
converting a .mov needs, so most FFmpeg security fixes don't touch it.

The workflow also packs the Studio Stream Deck plugin (`plugins/studio-deck`, `npm run pack`) into the app, where the menu bar menu and the
Output page install it. From a checkout, run `npm install` and `npm run pack` in `plugins/studio-deck` once for those to find it.
It builds the Blackmagic output module the same way (`native/decklink`, `npm run build`, needing Xcode's command line tools but no
Blackmagic software); from a checkout run `npm install` and `npm run build` there once, or the Output page says it's missing.
The NDI output module (`native/ndi`) builds and is run from a checkout the same way, needing no NDI software to build.

Updates come from GitHub Releases, which an app can't read from a private repository, so releases go to a separate
public repository, `zapheus-runplaywin/FirstPassStudio-releases`, holding only the built app.

One-time setup:

1. Create the public repository `FirstPassStudio-releases` with a README (tick **Add a README file**): GitHub can't make a release in an empty repository.
2. In Xcode (Settings > Accounts > Manage Certificates) or at developer.apple.com, create a **Developer ID
   Application** certificate. In Keychain Access export it with its private key as a `.p12` with a password.
3. At appleid.apple.com create an app-specific password. Your Team ID is under Membership at developer.apple.com.
4. Create a fine-grained GitHub token with **Contents: read and write** on `FirstPassStudio-releases`.
5. In this repository's Settings > Secrets and variables > Actions, add:
   - `MAC_CERTIFICATE`: the `.p12` as base64 (`base64 -i certificate.p12 | pbcopy`)
   - `MAC_CERTIFICATE_PASSWORD`: its password
   - `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
   - `RELEASES_TOKEN`: the token from step 4

To build on your own Mac instead: `npm install`, then `npm run dist` (signs with the Developer ID certificate in your
keychain; set `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` to notarise). The app is in `dist/`.
`npm run app` runs it from the repository without building (needs Node.js, the LTS version, from https://nodejs.org).
`npm start` runs Studio on its own, without the app, for working on the pages; it uses the same data folder and port,
so don't run it while the app is on air.

## Each stream

1. Open the FirstPass Studio app. Its home page opens and Studio goes on air; leave a Studio window open for the
   whole stream (closing the last one takes Studio off air).
2. Open **Output** (⌘1) and add the graphics you need with **Add page** (the scoreboard, a ladder per division, and so
   on), then turn on the display or Blackmagic output that feeds your switcher (see **Output** below).
3. Open **Scoreboard control** (⌘3 in the app, or from the 1P icon) to run the scoreboard.
4. Turn graphics on and off from the Output page or the Stream Deck.

Only the scoreboard updates itself (every second, and it reloads when Studio restarts), along with the last 10 goals (every 2 seconds), the ticker, the
automatic super shot (every second) and the countdown (every 5 seconds, asking Studio only). Every other page
loads once, and again each time it's turned on on the Output page (with **Load the page fresh each time it's shown**, the
default), or press **Refresh page** to get the latest. Divisions are numbered in name order, as listed on the
http://localhost:8080/ page. You can also use part of a name, e.g. `?division=Premier`.

Frame rate: every graphic and animation is timed by the clock, not by frames, so it plays at the same speed at 25, 30,
50 or 60 fps. The Blackmagic and NDI outputs render at the video format's frame rate.

## Output (the Studio scene)

http://localhost:8080/output.html (**Output** in the menu, ⌘1 in the app) builds Studio's own scene: one 1920 x 1080 frame of
sources drawn as layers, top layer first, sent to a display, a Blackmagic device or NDI® for your switcher.

- **Sources:** **Add page** adds any Studio graphic (or any web address); **Add image** adds a PNG, JPG, GIF, WebP or SVG, and
  **Add video** an MP4, WebM or MOV, saved in the data folder's `media` folder. Each opens a
  dialog to pick it. A new source goes above the selected one (on top if none is selected), hidden, and is selected so its
  settings are ready to change. The page list splits into pages not in the scene yet and pages already in it, and **Add all
  unused pages** adds every Studio graphic not in the scene, hidden, in that order. Drag a source (by its ⋮⋮ or anywhere on
  its row) to move it up or down the layers, or use ↑ and ↓.
- **Page options:** a Studio graphic's link options (position, heading, division, round, animate away and so on) show as fields under its
  **Address**, so there's no need to look them up; they're saved in the address. The list is `public/pageoptions.js`: add a page's
  new option there as well as on the home page.
- **On / Off** fades a source in or out, with its own **Fade** time in milliseconds (0 is a cut).
- **Position and scale** place it on the frame (**Full frame** fits it to 1920 x 1080). A page's **Page size** is the size it's drawn at
  (1920 x 1080 for full-frame graphics).
- **Load the page fresh each time it's shown** (on by default) reloads a page as it fades in, so its animation replays, and unloads it
  when hidden. Untick it to keep a page running while hidden so it shows instantly.
  **Refresh page** reloads it now.
- **Preview** opens the selected source on its own in a new window, like the home page's Preview buttons.
- **Videos:** play from the beginning each time they're shown (untick to carry on where they stopped), can loop, and fade out when they
  finish unless looping. **Sound** turns a video's sound on or off with a volume; it plays through the Mac's audio output, and the Output page's preview is silent unless **Preview sound** is ticked. **Restart video** starts it again from the top.
- **ProRes:** Chromium (which draws the pages) can't play ProRes, so a .mov added to the media folder is converted to a WebM beside it
  (VP9, keeping a ProRes 4444 clip's transparency) and any source using it switches over when that's done. The original is kept. A .mov with no transparency (H.264, or ProRes exported
  without alpha) gives an opaque WebM: the Output page and the log say so. This needs
  ffmpeg, which the Mac app includes (an LGPL build made by `vendor/ffmpeg/build.sh`; see `vendor/ffmpeg/LICENSE.md`). Running from a
  checkout, run `vendor/ffmpeg/build.sh` once or `brew install ffmpeg`, or set `ffmpegPath` in config.json. MP4 and WebM files play as they are.
- **Stream Deck plugin:** the Mac app includes a FirstPass Studio plugin for the Stream Deck app (`plugins/studio-deck`). Install it from the
  menu bar icon (**Install the Stream Deck plugin**) or the Output page's button: Stream Deck opens it and installs or updates it. Its
  **Source** key shows or hides a source picked in its settings (or fades it in or out, restarts it, or turns a video's sound on or off), shows
  the source's name, and lights up while the source is on, however it was turned on. It follows the source's id, so renaming it doesn't break
  the key, and it shows **off air** while Studio isn't running.
- **Stream Deck links:** each source has `/deck/layer/<name>/on`, `off`, `toggle` and `restart` links, videos also `/deck/layer/<name>/sound/on`,
  `off` and `toggle`, and `/deck/layers/off` hides everything (see `STREAMDECK.md`). The Output page copies them.
- **Preview:** a live preview of the scene, on a checkerboard so see-through parts show. It runs the scene's pages a second time, so turn
  it off when the Mac is busy. **Preview sound** plays the scene's sound from the preview, with or without an output on;
  a display or Blackmagic output is muted while it does, so it never plays twice. It goes back to the outputs when the Output page closes, and only one Output
  page plays it at a time (click another page's preview to bring the sound there). A line under the preview says why it's silent, if it is.
  **Pop out** opens the preview in its own window (`/preview.html`) that you can resize, move to another screen or make full screen while
  testing, with a floating **Sources** list of On/Off buttons (and Hide all) to show or hide sources from there (its – button tucks it away); it plays the sound just as the preview does, and the Output page's preview turns off while it's open (so the scene only runs
  once more) and comes back when the window closes.
- **Display output (Mac app):** sends the scene full screen to the Mac's extra displays (HDMI into a switcher), scaled to fit.
  **Chroma** puts it over a solid colour (green #00b140 by default, blue, or any colour) on one display, for a switcher that keys on that
  colour. **Fill and key** needs two extra displays: fill is the scene over black, key is white wherever the scene shows and black where it's
  see-through (grey where partly see-through), for the switcher's fill and key inputs. How many extra displays a Mac can drive depends on its
  chip (a plain M1 drives one, an M1/M2/M3 Pro two, Max more), so fill and key is only offered with two connected. Sound plays through the
  Mac's audio output. Each output opens full screen in its own window: leave full screen (green button or ⌃⌘F) to move it to another
  display or get at other apps, and the scene scales to fit. **Output on/off**, Esc on an output window, closing it, or
  `/deck/output/on|off|toggle` shows or blanks the displays without changing the setup, and they go dark when Studio goes off air. Saved as `outputs.json` in the data folder. Run without the app
  (`npm start`) there are no displays to send to.
- **Blackmagic output (Mac app):** sends the scene out of a Blackmagic UltraStudio or DeckLink.
  **Fill and key** uses the device's external keyer (fill on one SDI out, key on the other); **fill only** sends just the picture. Pick the
  device and the video format the switcher runs at (1080i50 is picked first when the device can key it). The fill is premultiplied, as
  Chromium draws it; tick **Straight** if the switcher's key expects unpremultiplied fill. It needs Blackmagic Desktop Video installed, not the SDK,
  and the device free (quit any other app using it, such as Media Express, first). The scene renders off screen at the format's frame
  rate (`desktop/decklink.js`) and `native/decklink`, a small Node-API module built against the DeckLink SDK headers in
  `native/decklink/sdk` (Blackmagic's permissive licence), plays the latest picture out; when nothing changes the device repeats it. Sound
  plays through the Mac's audio output. Output on/off and `/deck/output/on|off|toggle` work the same, and late or dropped frames are logged
  in the app log.
- **NDI® output (Mac app):** sends the scene over the network as NDI sources at the video format picked (1080p or 720p at 25, 29.97, 30,
  50, 59.94 or 60). **Fill and key** makes two sources, *Source name Fill* (the scene over black) and *Source name Key* (white where it shows);
  **chroma** makes one, *Source name Chroma*, over the chroma colour; **with transparency** makes one, *Source name*, carrying alpha for
  receivers that key on NDI's transparency. They appear as "MAC NAME (Source name …)"; the source name is FirstPass Studio unless changed.
  It needs NDI's runtime for Mac (free, the libNDI installer from ndi.link/NDIRedistV6Apple), which puts `libndi.dylib` in `/usr/local/lib`;
  failing that, Studio uses the copy inside an NDI Tools app if it finds one (`desktop/ndi.js` looks in /Applications). Studio doesn't ship the runtime.
  The scene renders off screen as for Blackmagic (`desktop/scenewindow.js`, `desktop/ndi.js`) and `native/ndi`, a Node-API module built
  against the NDI SDK's header files in `native/ndi/sdk` (MIT licence), loads the runtime and sends each source at the frame rate, repeating
  the latest picture, only while something is receiving it. Each 1080p source is roughly 100 to 150 Mbit/s, so use a wired network. Sound
  plays through the Mac's audio output, not over NDI. Output on/off and `/deck/output/on|off|toggle` work the same.
  NDI® is a registered trademark of Vizrt NDI AB.

The scene is saved as `scene.json` in the data folder. http://localhost:8080/scene.html is the scene on its own, 1920 x 1080.

## Example graphics

From a copy of the repository, double-click `Make Examples (Mac).command` (or run `node examples.js`) to save a
1920 x 1080 picture of every graphic with PlayHQ's current data in `Examples/<date and time>/`, with an `index.html`
to look through them. Pictures keep the transparent background. They follow the game, round and court picked on the
control page. It uses Studio if it is on air (keep a Studio window open), or starts it on its own for the run, and needs Node 22+ and Google Chrome, Edge, Brave
or Chromium (set `CHROME_PATH` for another one).

## Debug log

Everything goes into `logs/playhq-graphics.log` in the data folder: each page opening, errors and warnings from every page
(including the Output page and its outputs), every PlayHQ request and its answer code, Game Summary requests, scoreboard and Stream Deck
changes, and Studio errors. Read it at http://localhost:8080/api/log. It never grows past 15 MB
(`logMaxMB` in `config.json`): when full, the oldest half is removed. If something goes wrong, send that file to Claude.

## Round fixture

http://localhost:8080/fixtures.html shows every game in the current round of all divisions, sorted by time,
with court, division, logos, and the score once a game is finished. `?division=1` shows one division.
`?round=` picks another round: `?round=next` is the round after this one (next week), `?round=prev` the one before,
`?round=+2` or `?round=-1` counts from this round, and `?round=6` (or a name like `?round=Final`) is that round.
"This round" is the one the control page has. A division without the round asked for is left out.
http://localhost:8080/results.html is the same page showing only finished games with their scores.

## Logos beside the title

http://localhost:8080/branding.html shows only the PIVT and FirstPass Studio logos (left) and the competition logo
from the setup page (right), placed either side of the title banner, so other pages can be turned on and off around
them. `?pivt=0`, `?studio=0` or `?comp=0` leave a logo off; `?gap=320` moves both sides in or out from the
centre, `?top=95` moves them up or down, and `?size=1.2` makes them bigger. `?mode=light` (the default) uses the
logos made for a light picture behind them: blue First, orange Pass and gold STUDIO, and the setup's light mode
competition logo. `?mode=dark` uses the ones for a dark picture: white FirstPass, gold STUDIO and the dark mode
competition logo. A competition with only one logo uses it in both modes. The logo files are in `public/studio/`.

## Live scoreboard

**Which round.** Every page (game list, fixture, results, ticker, up next) uses the round played in the next 5 days,
counting today, so a Tuesday round is picked from the Friday before. Otherwise it's the last round played. Change the 5 with
the days setting on the competition setup page. For testing, pick any round from **Round** on the control page; set it back to
**Automatic** afterwards (the choice is kept in `control.json`). Automatic game selection uses the picked round too, treating its games
as if they were today, so you can test the timed switching on any night.
`ladder.html` without `?division=` shows the division of the game picked on the control page. Its corner logo is the
dark mode competition logo, since it sits on the coloured header; `?mode=light` uses the light mode one.

**Always a game on.** When Studio starts, or the scoreboard is cleared, it puts a game on with Follow PlayHQ on: the
game for now on the court, otherwise this round's first game on that court, otherwise this round's first game. It is only
left empty if PlayHQ can't be reached or the competition isn't found (check `organisationUrl` and `competitionName`).

**Automatic game selection.** Set the court to follow on the competition setup page the day before (e.g. `"Indoor 01"`, or just `"1"`).
With **Pick the game automatically for court** ticked on the control page, the scoreboard shows today's first game on
that court, then switches to each next game when its electronic scoring starts (**Electronic scoring starts [x] minutes before the game**
on the setup page, default 10; 20 or 30 suit games further apart), with
Follow PlayHQ on, the quarter back to Q1 and a full clock. In finals (a round with "Final" in its name) it keeps the
final on until PlayHQ marks it finished, in case of extra time. You can change the court on the control page or with
`/deck/court/2`. Picking a game from the list turns automatic selection off; tick it again (or `/deck/auto/on`) to go back.
Untick **Pick the game automatically** on the setup page to start with it off.
Before a game's electronic scoring starts Studio doesn't ask PlayHQ's live feed for it at all (automatic or picked by hand),
since PlayHQ only answers "not electronically scored"; the control page says when it will start checking.

On the control page, pick the game from this round's PlayHQ fixtures and press **Use this game**.
With **Follow PlayHQ** on, the score updates every 5 seconds (change it on the control page) from the same live feed the
playhq.com game page uses, so it needs no API key, but only if someone is live-scoring that game in PlayHQ. The quarter
follows the PlayHQ scorer too (you can still change it in between). The clock matches the scores: switching between
**Follow PlayHQ** and **Manual** (or a score press switching to manual) also turns **Follow the PlayHQ scorer's clock** on or off,
and the control page says so. You can still change the clock afterwards (the tick box, `/deck/clock/playhq/on|off`, or
any clock button, which switches it back to manual). Otherwise press +1 / +2 / -1 / -2 (or keys A/Z for home, K/M for away,
with Shift for 2) and it switches to manual. The quarter and the countdown clock (Space starts and stops it) are run from the control page.
Everything can also be run from a Stream Deck: see `STREAMDECK.md`, or the API docs at http://localhost:8080/api.html. To line it up with the venue clock, type the venue's time (e.g. 12:34) in
**Match venue clock** and press Enter. Studio runs one scoreboard: for a second court, run a second Studio on another Mac.
Scoreboard position: by default it is centred at the bottom, just above the score ticker with a small gap, so both can be on screen together. `?position=top-center`, `bottom-center`, `top-left` or `bottom-left` moves it.

## Team lists and shooting stats

These follow the game picked on the scoreboard control page:

- http://localhost:8080/title.html: round, competition and venue banner. The venue is set on the competition setup page
  (blank uses the venue from PlayHQ). `?position=bottom` moves it down and `?emoji=🔥` puts an emoji
  either side of the title (none without it). The competition logo is off by default, since the logos
  page shows it beside the title: `?logo=show` puts it above the banner, `?logo=hide` leaves it off. It is the light mode logo unless you add `?mode=dark`.
- http://localhost:8080/upnext.html: the next game on the same court, for half time. With no game picked, it
  assumes the stream is on the first timeslot and shows the game after it.
- http://localhost:8080/countdown.html: counts down to the scheduled start time of the game picked on the control page,
  with both teams, logos, division, round, court, time and venue. The clock ticks in the page and it asks Studio (never PlayHQ)
  every 5 seconds which game is picked, so it follows a new game without a refresh. The last 10 seconds pulse; at zero it shows
  STARTING SOON. `?end=Game%20on` changes those words, `?end=hide` fades it away instead, `?fade=1` fades it out over the last 5 seconds (`?fade=8` over 8), `?label=` changes the heading,
  `?teams=0` shows the clock only and `?position=top` or `bottom` moves it.
- http://localhost:8080/clash.html: animated match up. The two logos charge in, smash together in the middle with a flash,
  sparks and lightning, then settle either side of a stamped VS over a big CLASH, with "Battle for <division>", the time
  and court. It plays each time it's turned on on the Output page.
  `?out=10` animates it away after 10 seconds, `?word=RIVALS` changes the big word, `?title=Grand%20Final` the bottom line.
- http://localhost:8080/winner.html: full time celebration, picking the result from the scoreboard score when it opens
  (`?winner=home`, `?winner=away` or `?winner=draw` forces one). For a win the
  team's logo slams in over turning light rays and a big outlined VICTORY, with confetti cannons in their colour, then their
  name, the final score and "def. <other team>". For a draw both logos slide in, see-saw on a beam until level, DRAW is
  stamped between them and the score shows "Honours shared". It plays
  each time it's turned on on the Output page. `?out=10` animates it away, `?word=CHAMPIONS` changes the big word (the stamp on a draw),
  `?title=` the line under the score and `?score=0` leaves the score off. Club colours from the setup are used, like The Clash.
- http://localhost:8080/supershot.html: 3 second celebration after a successful super shot. A netball flies in and bursts
  with sparks, SUPER and SHOT slam in from either side with the team's logo and name in their club colour,
  then it fades out and leaves the frame clear. Leave it on: it watches the scoreboard and plays by itself for each
  super shot (a +2 press, or the PlayHQ scorer's super shot count going up while following PlayHQ).
  It asks Studio every second, which asks PlayHQ nothing extra. `/deck/home/supershot` plays it without changing the score.
  Manual: `?team=home`, `?team=away` or `?team=none` plays it once when the source comes on instead (keep **Load the page
  fresh each time it's shown** ticked). Details in STREAMDECK.md.
- http://localhost:8080/goals.html: the last 10 goals of the game, oldest to newest, for showing trends and changes in momentum.
  Each goal is a disc in the scoring team's club colour with its logo (+2 badge for a super goal) and the quarter and time,
  with a momentum line underneath (up for home goals, down for away), each team's count of the 10 and the current run
  (3 or more in a row lights up). `?layout=vertical` stacks it down the right-hand side (`horizontal`, above the scoreboard,
  is the default). Like the scoreboard it updates itself (every 2 seconds), so it can stay on. `?count=8` (3 to 30),
  `?times=0`, `?position=top|middle` (horizontal) or `left` (vertical), `?title=Momentum`.
  PlayHQ's live feed only has running totals, not a list of goals, so Studio works out the order from the score going
  up between its readings (every 5 seconds while following PlayHQ, split into goals and super goals by PlayHQ's goal
  counts) and from each +1 / +2 press. -1 / -2 takes that team's latest goal off. The list restarts when a game is picked or
  the scores are reset, builds only while the scoreboard (or this page) is open, and marks a gap with a dashed … when a
  team's score jumps by more than 3 at once or the game was picked part way through. Lines starting `[goals]` in the log show each step.
- http://localhost:8080/matchup.html: both team logos with the division, round, date, time, court and venue. It also shows each team's
  last five results as W/L/D dots and this season's head to head: the win tally under VS and the last three meetings
  (`?form=0` or `?h2h=0` hides them).
- http://localhost:8080/finals.html?division=1: the division's finals, week by week (see **Finals** below).
- http://localhost:8080/fulltime.html: final score with each team's top shooter and shooting accuracy.
- http://localhost:8080/ladderbar.html: lower third with both teams' ladder position, record, points and percentage. It sits
  right above the scoreboard, scaled to the scoreboard's width.

The cards (match up, up next, countdown, position match ups, team lists, shooting stats, full time, fixtures, ladders,
top shooters, finals and last 10 goals) sit in the space between the title at the top and the scoreboard at the bottom,
with room around them. public/fit.js sets that space and shrinks a card that has more in it than fits. The Clash, the
winner celebration, super shot and the logo animations are moved and scaled into the same space (`data-fit-box` on their
stage gives the part of the frame their content uses); a logo animation's `?bg=` background still fills the screen.
- http://localhost:8080/ticker.html: scrolling scores from the other games this round. Unlike the other graphics it updates
  its scores itself every 30 seconds (`?refresh=0` to load once). Its speed is set on the control page (**Ticker speed**, with
  Slower, Faster and Normal) or from the Stream Deck (`/deck/ticker/faster`, `slower`, `normal`, `speed/80`), and changes within a
  few seconds without starting again. `?speed=80` fixes the speed for that link only (pixels a second; 120 is normal).
- http://localhost:8080/topshooters.html?division=1: season shooting leaders from every finished game
  (`?sort=goals` or `?sort=super`, `?limit=10`). Players who keep their PlayHQ profile private are left out.
- http://localhost:8080/teamlist.html?side=home and `?side=away`: one team list per team, with its logo.
- http://localhost:8080/shooting.html: goals, super goals, shots and accuracy for each shooter and each team, for quarter breaks.
  The title names the break from the scoreboard's quarter (Q2 = Half time); `?title=Three%20quarter%20time` overrides it.

Line-ups and stats come from the same data the playhq.com game page shows, with no API key. Players who keep their
profile private show as PlayHQ shows them. Only if that has no players and an `apiKey` is set do they come from
PlayHQ's "Summary for the Game v2" instead (on the competition setup page; the path is a machine setting in `config.json`):
- **Client ID**: the association's PlayHQ API key (optional; leave blank if you don't have one).
- **Tenant**: the sport name PlayHQ expects with the key (blank uses `netball-australia` from the organisation link).
- `gameSummaryPath` in `config.json`: `/v2/games/{id}/summary`.
When a team's line up for the game has fewer than seven players (benches often clear it when they log in and only
add players as they score), the rest of the team's season squad (everyone in its line ups this season) is added after
them under **Squad**, without positions. With no line up at all, the team list is the whole squad. Players in the
partial line up keep their position and stats, and the position match ups page only uses positions from the line up.
The control page shows how many players were found for each team, or the error. If the lists look wrong, send the debug log to Claude.

Team logos are added on the competition setup page, named after the team. A logo whose file name doesn't match the
PlayHQ team name can be picked for that team in the setup page's team list. The same list gives a club its own colour
(**Add colour**, then the colour picker or a pasted HEX or RGB value, or × to go back to the competition's colours), shared by every team of that club; the scoreboard and The Clash use it behind those teams. The
match up page keeps the competition's colours.

## Athlete photos and position match ups

http://localhost:8080/athletes.html (**Athletes** in the menu) keeps a photo of each athlete for the competition in use.
Pick a team to see every athlete PlayHQ has in its line ups this season (from its finished games and its next game), with
their number, usual position and how many games they've played. Then:

- **Add photo** on an athlete, or drop a photo onto them. It is saved as `competitions/<name>/photos/<athlete name>.png`
  (or `.jpg`), so it matches that athlete in every game and every team. Photos are made at most 1000 pixels before they're
  saved; cut-out PNGs with a transparent background look best.
- **Several photos at once:** drop photos named after their athletes (`Jane Smith.jpg`, `smith_jane.png` and
  `Noah OBrien.png` all work: case, punctuation and word order don't matter). Ones that match nobody on the team are
  listed first in the photo library, where **Give to an athlete** renames them to that athlete.
- **An athlete PlayHQ doesn't list yet:** type their name exactly as PlayHQ will show it and add the photo.

One athlete, one photo: photos go by the athlete's name across the whole competition, so an athlete who plays in more
than one division (or for more than one team) needs only one photo. Each athlete card says which other teams and
divisions they play for, and **All athletes** lists everyone seen so far, once each, with a search box.

With no photo, the graphics show a generic silhouette: female, male, or plain when the gender isn't known. The gender
comes from PlayHQ's profile when it sends one; under each athlete you can pick Female or Male instead.

**Games** on an athlete opens their games and positions played:

- **Positions played:** the positions in this season's PlayHQ line ups are ticked already; tick any others they've played.
- **Games played:** one line per division, and optionally per club, with the number of games and an **As of** date.
  Games PlayHQ shows after that date in that division (and that club, if one is picked) are added on, so the figure
  keeps up through the season without retyping. With no date the number is used as it is. With no line for a division,
  its games played are this season's games from PlayHQ. A game counts when the athlete is named in the team's line up.

The card shows the games per division and positions played. The position match ups show the games played in the
game's division (for the club, when the athlete has a line for it) beside the athlete's number; `?games=0` leaves it off.

The page keeps a register of the competition's athletes in `competitions/<name>/athletes.json`: the teams and divisions
each one has played for, their PlayHQ ids and gender, any gender you picked, and the games and positions played you typed in. It fills in as line ups are read
(opening a team, or the game on the control page). Photos and the register are files in the competition's folder, so
commit the ones you want to keep like any other setting.

http://localhost:8080/positions.html shows the game picked on the control page position by position: the home team's
line up from GS to GK, each beside the away athlete they play against (home GS v away GK, GA v GD, WA v WD, C v C,
WD v WA, GD v GA, GK v GS), with their photos, names, numbers and captains. It then shows all seven pairings together.
Positions come from the line up entered on PlayHQ for that game. Some competitions' line ups miss positions: any
position with nobody listed shows **Unknown** (with the plain silhouette for the photo), and the debug log says which. Only a
game with no line up at all leaves the page empty. Full position names ("Goal Shooter") are read as GS and so on. An
athlete without a photo shows the generic silhouette for their gender.

- `?hold=6`: seconds per pairing (default 5).
- `?loop=1`: keeps going round instead of finishing on all seven.
- `?end=out`: animates away after the last pairing instead of showing all seven.
- `?show=all`: shows all seven pairings straight away.
- `?pair=C`: shows one pairing only, by the home team's position.
- `?games=0`: leaves out each athlete's games played.

Like the other graphics it loads once, and starts again each time it's turned on on the Output page.

## Roadmap

- **FirstPassVantage live athlete stats (future):** connect to FirstPassVantage for more detailed athlete stats while a
  game is on (per athlete, beyond the goals and attempts PlayHQ has), to show beside the position match ups, team lists
  and shooting stats. Not built yet.

## Finals

Each competition setup has a finals format, and each division can have its own (setup page, **Finals**). The formats, in
`finals.js`:

- Top 2: **Grand final** (1 v 2) and **Best of three** (game 3 only if needed).
- Top 4: **Semis then grand final** (1 v 4, 2 v 3), **Page** (1 v 2 winner straight to the grand final, the loser gets a second
  chance, 3 v 4 loser out, then a preliminary final) and **Placings day** (1 v 2 for the title, 3 v 4 for third).
- Top 6: **Byes for 1 and 2** (3 v 6 and 4 v 5, then 1 plays the lower winner and 2 the higher) and **Double chance for 1 and 2**.
- Top 8: **AFL style** (top 4 double chance), **Straight knockout** and **Carnival placings** (a knockout over three weeks with
  play-offs, so every team gets a place 1 to 8).
- Every team: **Every team plays on grand final day** (1 v 2 for the title, 3 v 4 for third, 5 v 6 for fifth and so on down the
  whole ladder, one game each, nobody knocked out; with an odd number of teams the last one has no game). Its games are made
  for the number of teams on the division's ladder (`finals.sized`), and the finals graphic shows them in two columns.

The ladder marks the finals places by what each earns (double chance or week off in yellow, elimination in pink, playing
for third or a place lower down in the small print colour), draws a line under the last one, and adds a key when places earn different things
(`?key=0` leaves it off). Setups saved with only a number of finals places get the nearest format.

`finals.html?division=1` shows who plays who week by week, with the teams from the ladder ("If the season ended today"
until the home and away games are finished), logos, scores, the winner of each game moving on, and the champions once the
grand final is decided. PlayHQ's finals games (rounds with "final" or "play-off" in their name) are used when it has them,
with their time, court and score. PlayHQ often has no finals fixtures, so the control page's **Finals** section lets you
pick each winner (the score is optional); those are kept in `control.json`, and a PlayHQ result always wins. Options:
`?week=2` one week only, `?title=` a different heading, `?sub=` other words for the "Top 4 finals" line under it (`?sub=0` none), `?seeds=0`, `?projected=0`, `?logo=0`, `?mode=light`.

## Options

- `&refresh=30` makes a ladder reload itself every 30 seconds (off by default).
- `&rows=8` shows only the top 8 teams.
- Quarter (or half) length and the season are on the competition setup page.
- Colours and font are on the competition setup page (Studio writes `theme.css` from them). Sizes and position are at the top of `public/ladder.css` and `public/scoreboard.css`.
- The ladder marks the finals places from the division's finals format (see **Finals**); their colours are at the top of the finals part of `public/ladder.css`.

## Licence

FirstPass Studio is open source under the MIT licence; see [LICENSE](LICENSE). Bundled third-party code keeps its own
licence (Montserrat in `public/vendor/montserrat/OFL.txt`, Swagger UI in `public/vendor/swagger-ui/LICENSE`). Team and
competition logos belong to their owners and are not covered by the MIT licence.
