# FirstPass Studio

Transparent ladder, scoreboard and game graphics for a livestream, fed live from PlayHQ's public data (no API key). Set up for
Thunder League, with saved setups ready for the AMMNA Nationals and GIG WANL (the WA Netball League).

The pages you work in (output, graphics, scoreboard control, competitions setup, sponsors, athletes and Stream Deck) carry the FirstPass
Studio look from `public/studio.css`, with the Montserrat font served from `public/vendor/montserrat` so it works
offline. The graphics don't use it: they keep the colours, font and logos of the competition in use.

## Words used here

- **Studio** is the whole thing: the Mac app, the pages you work in and the graphics it puts on screen.
- **The helper** is the small Node server inside Studio (`server.js`) that serves the pages, talks to PlayHQ and saves settings.
  The app calls it "on air" while it runs. Nothing in the app's menus says "helper"; the README and the code do.
- **A source** is one graphic in the scene: a page such as the scoreboard or a lower third, with its own position and options.
- **The scene** is Studio's own 1920 x 1080 frame on the Output page, built from sources switched on and off.
- **A scene** (on the Scenes list) is a saved set of sources to switch on together.
- **A sequence** is a list of steps (scenes, sources, waits and music) that plays in order from one key.
- **The data folder** is where Studio saves everything outside the app: `~/Library/Application Support/FirstPass Studio`,
  or your iCloud Drive folder when settings are moved there.

## One-time setup

1. Install the FirstPass Studio app (see **Desktop app** below) and open it.
2. Open the competition setup page and **Import** your competition (Thunder League, AMMNA Nationals or GIG WANL), or make a new one.

## Competition setup

http://localhost:8080/setup.html keeps a saved setup for each competition and switches between them. Each setup has the
organisation's PlayHQ link and which competition and season to use (**Find its competitions** lists them), the names
shown on the graphics (competition, organisation, venue), the game rules (quarters or halves and their length, super
shots), the finals format for the competition and for any division with its own (see **Finals** below), game day settings (court to follow, automatic game selection, minutes before a game
it switches, days ahead that count as this game night), nine colours (a colour picker that also takes HEX or RGB, plus brand kit colours pasted in as swatches), panel transparency and the font, the competition logo
in light and dark mode versions (one alone is used for both; beside the title, above it and in the ladder's corner), the team logos (drop files on the page; they match clubs by file
name, and the PlayHQ team list lets you pick a different logo for any club), an optional colour for each club (behind its teams'
names on the scoreboard and behind their logo and name on The Clash) and the PlayHQ Client ID most competitions don't need. The emoji either
side of the title and The Clash's big word are options on those graphics (`?emoji=`, `?word=`), set on each source on the Output page.

Logos and colours belong to clubs, so a club's teams share them in every division. A team's club is its name without the
division on the end ("Comets 21U", "Comets Men" and "Comets Open" are all Comets; "Stormz Div 2" is Stormz), and the team
list's **Club** box links a team to another club, or a new one. Setups saved with a logo or colour per team are moved to
clubs when loaded.

**Fonts.** The Font box lists the fonts bundled with Studio first, then fonts added to the competition, then every font
installed on the Mac (`/api/setup-fonts`, from AppKit). Bundled fonts are open licence (OFL) fonts in
`public/vendor/fonts/<id>/`, fetched from Fontsource by `npm run fonts` (add one to `BUNDLED` in `fonts.js` first), so the
graphics load no fonts from the internet. The Socials tab's template sets have their own bundled faces (`TEMPLATE_FONTS`
in `fonts.js`, fetched the same way), which are not offered in the Font box. A Mac font is used by name and shows only on that Mac; elsewhere the graphics fall
back to Montserrat, as they do for any letter a font lacks. **Add a font file** saves TTF, OTF, WOFF or WOFF2 files in the
competition's `fonts/` folder (served at `/fonts/`, and included in template files); the family, weight and style come from
each file's name ("Gotham-BoldItalic.otf", "Club Sans Black.ttf", "Inter-VariableFont_wght.ttf").

The graphics were drawn with Montserrat, so every other font is made to measure like it (`normalise` in `fonts.js`):
theme.css gives each of its faces `size-adjust` so its capitals are as tall as Montserrat's, and ascent, descent and line
gap overrides so its line box is as tall as Montserrat's with the capitals centred in it the same way. Text then fills its
box and sits centred whatever the font. A narrow font (capitals narrower than Montserrat's, such as Oswald or Bebas Neue)
stands taller, by up to a fifth, so it doesn't look small, and the setup's **Text size** (80 to 130%, `fontSize`) scales any
font other than Montserrat on top. Bundled fonts and added font files are measured from their files; a Mac font is measured
by the Mac (`macFaces`, AppKit) and loaded as "Studio <font>" faces by PostScript name, with the font itself next in
case a face isn't found.

**Use this one** switches every graphic, the control page and the Stream Deck to that competition (the game night goes back to
automatic and the scoreboard starts on its first game). Saving the competition in use reloads the graphics.

Setups live in `competitions/<name>/` in the data folder (`settings.json`, `logos/`, `brand/`, `fonts/`); see **Saved settings** below.
Studio starts with no competitions: **Import a template file** on the setup page (the starter competitions are in
`templates/`: Thunder League, AMMNA Nationals, GIG WANL, West Coast Thunder) or make a new one, which starts from scratch with the default settings. AMMNA Nationals and GIG WANL come with their PlayHQ organisation link, colours (AMMNA green and gold from its logo;
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
- Or a folder in iCloud Drive, in a subfolder named after the Mac (see **Settings in iCloud Drive** below).
- Set `FIRSTPASS_DATA_DIR` to use another folder (and `FIRSTPASS_LOCAL_DIR` for the files that stay on the computer).

In it:

- `competitions/<name>/`: each competition's `settings.json`, `logos/`, `brand/`, `photos/` (athlete photos) and
  `athletes.json` (the athlete register from the Athletes page), `planner.json` (the Production Planner's commentators and
  nights), `socials.json` (the Socials tab's sponsor strip, logo, colour set and template set choices), and `competitions/active.json`, the one in use.
- `sponsors/`: the sponsors (`sponsors.json`) and their logos, shared by every competition (see **Sponsors** below).
- `control.json`: the control page's choices (the game night picked by hand, and the scoreboard's automatic game selection,
  its court, following the PlayHQ clock, how often to check PlayHQ, showing the clock, the ticker speed, finals winners).
- `scoreboard-state.json`: the game on the scoreboard, the scores and the clock.
- `config.json` (optional): this computer's settings. The app's own `config.json` has the defaults (port, log size,
  how often to check PlayHQ, `linkHost`, `remoteChanges`); a `config.json` here changes only the settings it names.
- `logs/`: the debug log (`playhq-graphics.log`) and the app log (`app.log`: updates, What's new, outputs and windows).
- `app-settings.json`: the Mac app's own choices (the window's size and position, the version What's new was last shown for).
- `data-version.json` and `backups/`: see **Updates and migrations**.

### Settings in iCloud Drive

**Settings folder > Move to iCloud Drive…** in the Mac app's menu picks a folder in iCloud Drive and moves the settings
into `<that folder>/<Local hostname>/`, so Macs on one Apple account each keep their own (`datalocation.js`). Where they
are is saved on the Mac only, in `data-location.json` in the local folder; `studio-computer.json` in the subfolder names
the Mac using it, and a different Mac with the same name is refused. The move backs up to the local
`backups/<date>-before-move`, copies, checks every file's size, then removes the originals. The debug logs,
`scoreboard-state.json`, `game-cache.json`, `last-game-summary.json`, `app-settings.json` and `backups/` stay local
(`LOCAL_ONLY`). Before going on air the app downloads any file iCloud has evicted (`.<name>.icloud` placeholders, via
`brctl download`); if the iCloud folder is missing, Studio won't start rather than start empty. `PROVIDERS` in
`datalocation.js` is where other cloud drives (Dropbox, Google Drive, OneDrive in `~/Library/CloudStorage`) would go.
**Move back to this Mac…** reverses it. **Restore from another Mac…** copies another Mac's subfolder over this
Mac's (`restore()`: back up to `backups/<date>-before-restore`, copy into a hidden `.restoring-<date>` folder, check
sizes, then swap); the other Mac's folder is only read. This Mac's own `config.json` settings stay as they were
(`MACHINE_ONLY`: `remoteChanges`, `ffmpegPath`, `apiBaseUrl`, `gameSummaryPath`, `port`, `linkHost`), here and in
Restore… from a backup, so restored settings can't turn the lock off or pick the program run as ffmpeg. On a Mac whose settings are local, `restoreToCloud()` puts them
in a new subfolder for this Mac beside the other Mac's and points this Mac there. `npm start` follows `data-location.json` too.

### Template files

**Export as template** on the setup page downloads a competition as one `.json` file (settings, team logos,
competition logo and its sponsors with their logos, as base64, format `firstpass-studio-competition`), which **Import a
template file** adds on any Studio, including the installed app. Its sponsors join the Sponsors page at their tier in the
new competition; one already there by the same name (case aside) is the same sponsor, shown on the new competition too,
keeping its own details and taking a logo only where it has none. `templates/` in the repository holds the starter competitions as template files.
`imports/<name>/` still holds the same competitions as folders, but the setup page no longer lists them. **Delete this competition** works on any competition, the one in use included:
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
removes the tracked `competitions/` files when you pull, so import your competition again from its template file in `templates/`
(photos and athlete registers left behind are kept with it).

## Desktop app (Mac)

FirstPass Studio installs as a normal Mac app on Apple silicon Macs (M1 and later), with no Node.js or Terminal needed. Download `FirstPass Studio.dmg`, drag
the app to Applications and open it. It opens the Output page in its own window and lives in the menu bar (the **1P**
icon). The Output page and the Stream Deck use the same links as the Docs page. A status line under its title (from
`/api/health`) shows the game on the board, whether the scores and clock follow PlayHQ and how long since PlayHQ last
answered (amber when a reading is overdue, red after a minute of errors, with the error), and whether the video output is
on, so a problem Studio keeps off the stream still shows on the page that stays open all night.

**Studio only runs while a Studio window is open.** Opening a Studio window (opening the app, **Open Studio** or any
page in the menu bar icon, ⌘N) puts Studio on air: it serves the graphics and the Stream Deck links, talks to PlayHQ,
and restarts by itself if it stops. Closing the last Studio window takes it off air, so nothing talks to PlayHQ and
the graphics and Stream Deck get no answer until a window opens again. Closing the last window while on air asks
first (**Take Off Air** or **Cancel**), so a stray ⌘W can't stop a stream. Keep a window open, such as the Output
page, for the whole stream.

**What's new.** The first time the app opens after an update, a window lists what changed in each version since the one
last opened (the titles in the release notes, bundled into the app when it's built, so it works offline). It doesn't put
Studio on air; **Open Studio** in it does. Opened at login, it waits until Studio is first opened. A fresh install
doesn't show it. **What's new…** in the menu bar icon shows the latest changes again.

### Links use the Mac's .local name

The links on the Docs page, the control page and the Mac app's menu (including **Copy the Studio link**) start with
the Mac's Bonjour name, e.g. `http://matts-macbook-pro.local:8080/`, instead of `localhost`. That name is the
**Local hostname** in System Settings > General > Sharing, and it works on the Mac itself and from a phone,
another computer or a Stream Deck on the same network, without looking up an IP address. The port stays 8080.
`http://localhost:8080` still works on the Mac, so existing links and Stream Deck buttons carry on as they are.
To go back to `localhost` links (or use a fixed name or IP address), set `"linkHost": "localhost"` (or that name) in
`config.json` in the data folder; `"bonjour"` is the default.

Studio listens on every network connection, not just this Mac, so anything on the same network can open the pages.
Changing things (pressing the Stream Deck links for scores, clock and game, switching scenes, running sequences, saving
settings) is the job of **Only this Mac can change things** in the menu bar icon (`"remoteChanges": false` in
`config.json`). The app ticks it every time it opens. Ticked, the devices in **Devices…** still can, within their
level: a phone or another computer pairs from `/pair.html` (`POST /api/pair` with `"browser": true`; the Mac's dialog
offers **Allow scoring only**, **Allow everything** or Deny) and gets a device cookie (`studio_device`, HttpOnly,
SameSite=Strict, set when it collects the answer); scoring only covers `POST /api/scoreboard`, `POST /api/rounds` and
the score, clock, quarter and game `/deck` links (`access.scoring()`); link sets and plugins can do everything.
Untick it to let every phone and computer change things until Studio quits. A plain `node server.js` with no `config.json` setting lets them. Ticked, Studio takes changes only from this Mac (by any of its own addresses, so the
Stream Deck plugin on it and links by its `.local` name still work) and answers other devices' changes with a 403 that
says so, while they can still open every graphic, the scoreboard and the scene. Private data follows the same switch:
the settings and scene backups, the athlete register, the debug log, the sponsor reports and the competition setup
answer only this Mac while it is ticked. Leave it ticked on open venue Wi-Fi. Whatever the switch says, a change must
come from Studio's own pages or from a program (the Stream Deck plugin, a Website key, `curl`): a request that a
browser marks as coming from a web page on another site (its `Origin` or `Sec-Fetch-Site` header), or that asks for
Studio by a name this Mac doesn't answer to (its `Host` header: localhost, the Mac's addresses, its `.local` name and
`linkHost` are fine), gets a 403 that says so. Stream Deck links (`/deck/...`) are plain GETs, which a hidden image on
another site can also fire, so links copied from Studio carry this Mac's key after the port (`/k/<key>/deck/...`,
kept with the devices list in `devices.json` in the local data folder, never in a backup or iCloud); the Studio Stream Deck plugin pairs once
(it asks on its first press, sending its Ed25519 public key; the Mac shows Allow / Deny) and then signs every press
over `GET\n<path and query>\n<time in ms>` with `x-studio-device`, `x-studio-time` and `x-studio-sign` headers; Studio
takes a signature within a minute of its time and only once (`devices.signed()`). The plugin keeps its key pair in the
Stream Deck's global settings, so it survives restarts and plugin updates. Until any plugin has paired, the plugin's
old `x-studio-deck` header still counts, so plugins installed before pairing keep working; after that it doesn't. Studio's own pages are known by their `Referer`. A link without any of those is
refused with a 403 saying to copy it again from the Output page (logged once per address). **Devices…** in the menu bar icon
lists what may change things from another device, starting with This Mac's links, with when each key was made and last used;
**Make a new key** there gives up a set's old key, so every link copied with it stops working (`devices.js`; the list and
its buttons answer only the Mac itself, whether or not the lock is ticked). **New link set…** (there, or in the picker on
the Output page and the Stream Deck page) makes a named set such as "Office Stream Deck" with its own key; on the Mac
those pages copy links for the set picked (`public/linksets.js`, remembered in the browser), so one Stream Deck's
Website keys can be given a new key or removed without touching the others. Link sets never run out. A program on another device can ask for a
key of its own: `POST /api/pair` with `{"name": "Office Stream Deck"}` (allowed while the lock is ticked) opens an
Allow / Deny dialog on the Mac, Deny the default, naming the device and its address; the request also shows on the
Devices page. One request at a time, for five minutes, and a denied address waits a minute to ask again. The program
asks `GET /api/pair/<id>` with its token in an `x-studio-pair` header until the answer comes; once allowed it gets
its key once, with the start of its links (`base`), and Devices… lists it and can take it away alone. A device
unused for 90 days drops off the list and has to ask again (This Mac's links never do). Paired keys press links like
This Mac's key, so they too need the lock unticked from another device for now. Reads of private data get the same `Host` check, so a page that has
pointed its own name at this Mac (DNS rebinding) can't read them; graphics answer to any name. Studio also sends no
CORS header, so another site can't read its answers.

The menu bar icon has: Stop Studio (only while on air), Open Studio, Scoreboard control, Competition setup, Copy the
Studio link, Devices…, Install the Stream Deck plugin, Open the settings folder, Open the debug log, Open the app log, Restart Studio, Open at
login, Only this Mac can change things, Check for updates and Quit.

The status line under the version reads "Studio is on air at …" or "Studio is off air". The app always starts in the
menu bar off air, at login or opened by hand; **Open Studio** (or any page in the menu) shows the splash, puts Studio
on air and opens the page. **Stop Studio** closes the Studio windows without asking and takes it off air. Opening the
app again while it is running opens Studio.

### The app window

Studio's pages open in the app's own window (`desktop/windows.js`), not the browser: no address bar, tabs or
bookmarks, the Studio header is the title bar (the window buttons sit in it, and dragging it moves the window), and
the app shows in the Dock and ⌘Tab while a window is open, then goes back to just the menu bar icon. A link that opens
a new tab on Studio opens another app window (overlays on a dark background, since they are see-through); links to
anywhere else open in the browser. The app menu has FirstPass Studio > Close Studio Windows (⌥⌘W, asks first while on air), File > New Window (⌘N), Open in Browser (⇧⌘O) and Copy Page Link
(⇧⌘C, the .local link), Edit, View (reload, back ⌘[, forward ⌘], zoom, full screen, developer tools), Go (⌘1 output,
⌘2 Production Planner, ⌘3 control, ⌘4 setup, ⌘5 sponsors, ⌘6 athletes, ⌘7 Stream Deck, ⌘8 Socials, ⌘9 docs) and Window. Closing the last window takes Studio off air (see
above), and ⌘Q while on air asks first (Quit or Cancel). Quit always quits: if anything holds the app up for 5 seconds after Quit, it exits anyway (logged in `logs/app.log`). While Studio is starting, or if it couldn't start, the window
shows `desktop/offair.html` and opens the page again once Studio answers. The main window's size and position are saved as `windowBounds` in `app-settings.json`.

Settings live in the data folder (see **Saved settings**). Updates download in the background and install when the app quits, so they never
interrupt a stream; once one has downloaded, **Restart to update** in the menu installs it straight away. Either way it's the
newest version downloaded: a newer one that comes out after the first has downloaded replaces it in the background (the
menu then names it). **Restart to update** checks once more first, and if a newer version is out than the one the menu
named it asks: **Get 0.3.12** (the menu shows "Downloading 0.3.12…", then Studio restarts on it) or **Install 0.3.11 now**.
macOS's updater only takes one update per restart, so `desktop/updates.js` hands it the update only when it's installed.
macOS's updater closes every window before the app hears it's quitting, so **Restart to update** first does what Quit
does (stops the helper and the outputs, and tells the windows not to ask), keeps the outputs on for the new version, and
closes any window still open after 5 seconds, unless a page with unsaved changes asked and you chose Stay. Each step is
in `logs/app.log` (`[update]` lines).
Settings are brought up to date and backed up on the first start of the new version.

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
instead, add the label **build-minor** or **build-major** to the pull request before merging it: the next publish raises that part and
resets the parts after it (0.1.4 to 0.2.0 or 1.0.0). Any labelled pull request merged since the last published version counts, so
a labelled docs-only one still raises the next version, and major wins over minor. (They aren't plain **minor** and
**major** because Dependabot puts labels with those names on its own pull requests when they exist in the repository.) Use **Run workflow** for a specific version
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
4. Create a fine-grained GitHub token with **Contents: read and write** on `FirstPassStudio-releases` only (no other
   repository, no other permission), with an expiry; make a new one when it runs out.
5. In this repository's Settings > Environments, create `release` and tick **Deployment branches: selected branches**
   with `main`, so only a merge to main can use the secrets below; then add them to that environment (Settings >
   Secrets and variables > Actions, as repository secrets, also works):
   - `MAC_CERTIFICATE`: the `.p12` as base64 (`base64 -i certificate.p12 | pbcopy`)
   - `MAC_CERTIFICATE_PASSWORD`: its password
   - `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
   - `RELEASES_TOKEN`: the token from step 4

The app is built hardened: its code is one signed archive (`asar`, checked against the signature at every start) with
Electron's fuses set so the app can't be run as a plain Node or handed code by an environment variable, and with only the
three entitlements it needs (`build/entitlements.mac.plist`). ffmpeg, the native modules and the Stream Deck plugin are
unpacked beside the archive (`asarUnpack`) and the code reaches them through `unpacked.js`. A new file the app runs,
loads as a native module or hands to another program goes in `asarUnpack` too (`test/app-hardening.test.js` checks).
The fuses leave `file://` as a browser has it, which can't read inside the archive, so the app's own pages (the splash,
What's new, Back up settings, off air) are served as `studio://app/desktop/...` by `desktop/windows.js`, from `desktop/`
and `public/` only.

To build on your own Mac instead: `npm install`, then `npm run dist` (signs with the Developer ID certificate in your
keychain; set `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` to notarise). The app is in `dist/`.
`npm run app` runs it from the repository without building (needs Node.js, the LTS version, from https://nodejs.org).
`npm start` runs Studio on its own, without the app, for working on the pages; it uses the same data folder and port,
so don't run it while the app is on air.
`npm test` runs the tests (they also run on every pull request, as the Tests check). The ones that need PlayHQ run
Studio against a stand-in for it (`test/support/playhq.js`, a made-up Thunder League season around today's date), in a
data folder of their own, so they never touch PlayHQ or your settings.

## Each stream

1. Open the FirstPass Studio app. The Output page opens and Studio goes on air; leave a Studio window open for the
   whole stream (closing the last one takes Studio off air).
2. Open **Output** (⌘1) and add the graphics you need with **Add page** (the scoreboard, a ladder per division, and so
   on), then turn on the display or Blackmagic output that feeds your switcher (see **Output** below).
3. Open **Scoreboard control** (⌘2 in the app, or from the 1P icon) to run the scoreboard.
4. Turn graphics on and off from the Output page or the Stream Deck.

The Docs page has a **Before you go on air** checklist for the night, and `docs/ARCHITECTURE.md` says how Studio is put
together (which file owns what, how a request reaches PlayHQ, what runs on a timer) for anyone working on it.
The user guide, `docs/user-guide/index.html` (also as PDFs in the same folder, one for the web and one for print), walks a new user
through a game night, from the automated set-up with PlayHQ to running it by hand, with every page and graphic pictured.

Only the scoreboard, the last 10 goals and the countdown update themselves (Studio pushes each change to them the moment it
happens, and they reload when Studio restarts), along with the ticker and the automatic super shot (every second, asking Studio only). Every other page
loads once, and again each time it's turned on on the Output page (with **Load the page fresh each time it's shown**, the
default), or press **Refresh page** to get the latest. Divisions are numbered in name order, as listed on the
http://localhost:8080/graphics.html page. You can also use part of a name, e.g. `?division=Premier`.

Frame rate: every graphic and animation is timed by the clock, not by frames, so it plays at the same speed at 25, 30,
50 or 60 fps. The Blackmagic and NDI outputs render at the video format's frame rate.

## Output (the Studio scene)

http://localhost:8080/ (the Output page, also at /output.html; **Output** in the menu, ⌘1 in the app) builds Studio's own scene: one 1920 x 1080 frame of
sources drawn as layers, top layer first, sent to a display, a Blackmagic device or NDI® for your switcher.

- **Test pattern:** http://localhost:8080/testpattern.html (in **Add page**) is a 1920 x 1080 pattern on a see-through background for checking an output
  and the switcher's key end to end: 1-pixel border and 1, 2 and 4-pixel lines (grey or shimmering means something is resizing the picture),
  solid ramps (banding) and transparency ramps and soft shapes (with Pre Multiplied Key on they fade evenly). Not for air.
- **Sources:** **Add page** adds any Studio graphic (or any web address); **Add image** adds a PNG, JPG, GIF, WebP or SVG, and
  **Add video** an MP4, WebM or MOV, saved in the data folder's `media` folder. Each opens a
  dialog to pick it. A new source goes above the selected one (on top if none is selected), hidden, and is selected so its
  settings are ready to change. The page list splits into pages not in the scene yet and pages already in it, and **Add all
  unused pages** adds every Studio graphic not in the scene, hidden, in that order. Drag a source (by its ⋮⋮ or anywhere on
  its row) to move it up or down the layers, or use ↑ and ↓.
- **Export and import:** **Export sources** downloads `FirstPass Studio scene <date>.zip`: `scene.json` (the sources, as in the data
  folder's scene.json) and a `media/` folder with the images and videos the sources use. Untick **Export with their images and videos** for a
  small file of just the sources. **Import sources** replaces every source in the scene with the ones in an exported .zip (a zip of that
  folder made in Finder works, and so does a bare `scene.json`), after a confirm. Imported sources start hidden and keep their ids, so
  Stream Deck **Source** keys still work. Their media is copied into the media folder: a file already there with the same contents is
  reused, and one with the same name but different contents is never overwritten (the imported file is saved as `name (2).ext` and its
  sources use that). Media that's in neither the zip nor the media folder is listed as missing on the Output page, and an imported .mov
  that hasn't been converted yet converts. `/api/scene/export` (`?media=0` without media) and `POST /api/scene/import` (the file as the body) do the same.
- **Page options:** a Studio graphic's link options (position, heading, division, round, animate away and so on) show as fields under its
  **Address**, so there's no need to look them up; they're saved in the address. The list is `public/pageoptions.js`: add a page's
  new option there as well as on the Docs page.
- **On / Off** fades a source in or out, with its own **Fade** time in milliseconds (0 is a cut).
- **Position and scale** place it on the frame (**Full frame** fits it to 1920 x 1080). A page's **Page size** is the size it's drawn at
  (1920 x 1080 for full-frame graphics).
- **Load the page fresh each time it's shown** (on by default) reloads a page as it fades in, so its animation replays, and unloads it
  when hidden. Untick it to keep a page running while hidden so it shows instantly.
  **Refresh page** reloads it now.
- **Preview** opens the selected source on its own in a new window, like the Docs page's Preview buttons; the small **PVW** button beside a source's On / Off in the list does the same. Previews open at half size (960 x 540, the page still laid out at 1080p and scaled down, on a checkerboard), so a few fit on one screen; resize the window to make one bigger.
- **Videos:** play from the beginning each time they're shown (untick to carry on where they stopped), can loop, and fade out when they
  finish unless looping. **Sound** turns a video's sound on or off with a volume; it plays through the Mac's audio output, and the Output page's Scene View plays it only while **Video output** is off. **Restart video** starts it again from the top.
- **ProRes:** Chromium (which draws the pages) can't play ProRes, so a .mov added to the media folder is converted to a WebM beside it
  (VP9, keeping a ProRes 4444 clip's transparency) and any source using it switches over when that's done. The original is kept. A .mov with no transparency (H.264, or ProRes exported
  without alpha) gives an opaque WebM: the Output page and the log say so. This needs
  ffmpeg, which the Mac app includes (an LGPL build made by `vendor/ffmpeg/build.sh`; see `vendor/ffmpeg/LICENSE.md`). Running from a
  checkout, run `vendor/ffmpeg/build.sh` once or `brew install ffmpeg`, or set `ffmpegPath` in config.json. MP4 and WebM files play as they are.
- **Stream Deck plugin:** the Mac app includes a FirstPass Studio plugin for the Stream Deck app (`plugins/studio-deck`). Install it from the
  menu bar icon (**Install the Stream Deck plugin**) or the Output page's button: Stream Deck opens it and installs or updates it. Its
  **Source** key shows or hides a source picked in its settings (or fades it in or out, restarts it, or turns a video's sound on or off), shows
  the source's name, and lights up while the source is on, however it was turned on. It follows the source's id, so renaming it doesn't break
  the key, and it shows **off air** while Studio isn't running. Its **Scene** key goes to a scene (or the next, the previous, or back to the
  current one as saved), lights while its scene is on and shows a yellow dot when sources have changed since. Its **Sequence** key plays a
  sequence and counts down its step. Its **Switcher** key presses the ATEM switcher picked on the Output page (a camera to preview or program,
  a stinger, Cut, Auto, a key, Fade to black or a macro) and lights like the switcher's own buttons: red on program, green on preview.
- **Stream Deck links:** each source has `/deck/layer/<name>/on`, `off`, `toggle` and `restart` links, videos also `/deck/layer/<name>/sound/on`,
  `off` and `toggle`, and `/deck/layers/off` hides everything (see `STREAMDECK.md`). The Output page copies them.
- **Scenes:** saved looks for the same sources. Each scene sets every source on or off, or leaves it as it is. **Save what's on now**
  makes one from the sources as they are; clicking a scene goes to it, turning sources on and off to match while one that's already on stays on
  (not reloaded). The sources are shared, so a source turned on or off by hand afterwards changes everywhere, is marked **changed**, and the bar
  under the scenes offers **Back to saved**, **Save over** the scene, or **Save as new scene**. **Edit scenes** shows a grid (sources down, scenes
  across) to set each one On, Off or Leave, rename, colour (the Stream Deck colour groups), reorder, copy or delete scenes, without changing what's on.
  A source added later is off in every scene. Links: `/deck/scene/<name>`, `/deck/scene/next` and `/deck/scene/prev` (in the scenes' order,
  stopping at the ends) and `/deck/scene/again` (back to saved). The pop-out Scene View has the scenes as buttons too. Exports include the scenes.
- **Sequences:** the scene's sources played one after another (run-up, quarter break, full time), built on the Output page with **+ New sequence**.
  Each step turns on the sources picked for it and stays for a set time, until it finishes (its videos end, or pages that switch themselves off;
  at most the video's length plus 3 s, or a minute for a page), until the game moves on, or until Next. It plays once, repeats
  until stopped, or repeats until play resumes or N minutes before the start (finishing its step), then goes to a scene, turns off what it turned on, or leaves it all. It only turns off sources it turned on. Next, Pause
  and Stop on its card; going to a scene, another sequence or hiding everything stops it without its Then, and hiding the step's source
  moves on. One at a time, run by Studio itself (sequences.js), not saved while playing. Saved per competition as `sequences.json` in its folder.
  Game triggers: a sequence can start by itself N minutes before the picked game's start, at the breaks it ticks, or at full time, a few
  seconds after the siren, from the scoreboard state server.js sends each second (`gameSnapshot()`, no extra PlayHQ calls). It waits as
  pending (Start now, Cancel). A "before the start" moment that passed before Studio started (opened inside the window) is skipped, for the operator to start by hand. The Automatic sequences switch is kept in `sequence-settings.json` in the data folder.
  Break lengths (quarterBreakMinutes, halfTimeMinutes, threeQuarterBreakMinutes) are competition settings, for the editor's hint.
  Links: `/deck/sequence/<name>` (plays; `/toggle`, `/stop`), `/deck/sequence/next`, `/advance` (Next only for an Until I press Next step), `/pause`, `/resume`, `/stop`, `/now`, `/cancel`
  and `/deck/sequence/auto/on|off|toggle`.
- **Music:** music.js keeps one player (song or playlist, position, fades, mute, duck) in Studio; every unmuted scene.html plays it with an
  `<audio>` element, so it follows video sound. Playlists and the player's settings are in `music.json` in the data folder. Songs are audio
  files in media/; added with levelling on, ffmpeg's loudnorm writes an M4A and the original goes to media/originals. It fades out and
  pauses under a visible video with sound on (scene.js tells it). Sequences can carry music (`music`: song or playlist, startStep,
  startAtSec, fadeInSec; `musicEnd`: fade, cut, or continue into a `then: { type: 'sequence' }`; with none, a sequence step's own
  music plays while that step's sequence does), and scenes and sequences can be `quiet`.
  Links: `/deck/music/play|stop|pause|resume|toggle|next|prev|fade`, `/load/<song>`, `/playlist/<name>`, `/mute|duck/on|off|toggle`, each `?fade=N`.
- **Scene View:** the scene as it is right now, on a checkerboard so see-through parts show (your switcher decides whether it's on air). It runs the scene's pages a second time, so untick
  **Live View** when the Mac is busy. The Scene View plays the scene's sound only while **Video output** is off (for testing);
  with a display, Blackmagic or NDI output on, the output carries the sound and the Scene View is silent, so it never plays twice. Only one Output
  page plays it at a time (click another page's Scene View to bring the sound there). A line under the Scene View says why it's silent, if it is.
  **Pop out** opens the Scene View in its own window (`/preview.html`) that you can resize, move to another screen or make full screen while
  testing, with a floating **Sources** list of On/Off buttons (and Hide all) to show or hide sources from there (its – button tucks it away); it plays the sound just as the Scene View does, and the Output page's Scene View turns off while it's open (so the scene only runs
  once more) and comes back when the window closes.
- **Display output (Mac app):** sends the scene full screen to the Mac's extra displays (HDMI into a switcher), scaled to fit.
  **Chroma** puts it over a solid colour (green #00b140 by default, blue, or any colour) on one display, for a switcher that keys on that
  colour. **Fill and key** needs two extra displays: fill is the scene over black, key is white wherever the scene shows and black where it's
  see-through (grey where partly see-through), for the switcher's fill and key inputs. How many extra displays a Mac can drive depends on its
  chip (a plain M1 drives one, an M1/M2/M3 Pro two, Max more), so fill and key is only offered with two connected. Sound plays through the
  Mac's audio output. Each output opens full screen in its own window: leave full screen (green button or ⌃⌘F) to move it to another
  display or get at other apps, and the scene scales to fit. **Output on/off**, Esc on an output window, closing it, or
  `/deck/output/on|off|toggle` shows or blanks the displays without changing the setup, and they go dark when Studio goes off air. Saved as `outputs.json` in the data folder. Run without the app
  (`npm start`) there are no displays to send to. A display that isn't set to exactly 1920 x 1080 (a 720p signal, or a scaled or HiDPI
  setting) makes the scene softer; the Output page says so and how to change it in System Settings. The same key settings apply as for Blackmagic below.
- **Blackmagic output (Mac app):** sends the scene out of a Blackmagic UltraStudio or DeckLink.
  **Fill and key** uses the device's external keyer (fill on one SDI out, key on the other); **fill only** sends just the picture. Pick the
  device and the video format the switcher runs at (only 1080p formats are offered, as interlaced and 720p look soft; 1080p50 is picked first
  when the device can key it, and a 1080i format saved earlier is replaced by it). Every 1080p format the device names is listed; one it
  reports it can't send is marked *(device says it can't)* (older UltraStudios with HD-SDI rather than 3G-SDI stop at 1080p30) and can
  still be tried, and if it fails the Output page says the device can't send it. The fill is premultiplied, as Chromium draws it; leave **Straight** off (straight fill into a Pre Multiplied Key leaves a light fringe round logos and text) and tick it only if the switcher's key can't take premultiplied fill (every ATEM can, so the switcher's key check asks for it off).
  For the cleanest key, turn the switcher's **Pre Multiplied Key** on (clip and gain aren't used then); with it off, clip and gain cut into soft edges
  and the edges go dark. The log says the size of the pictures going out (`sending 1920 x 1080 pictures`). It needs Blackmagic Desktop Video installed, not the SDK,
  and the device free (quit any other app using it, such as Media Express, first). The scene renders off screen at the format's frame
  rate (`desktop/decklink.js`) and `native/decklink`, a small Node-API module built against the DeckLink SDK headers in
  `native/decklink/sdk` (Blackmagic's permissive licence), plays the latest picture out; when nothing changes the device repeats it. Sound
  plays through the Mac's audio output. Output on/off and `/deck/output/on|off|toggle` work the same, and late or dropped frames are logged
  in the app log.
- **NDI® output (Mac app):** sends the scene over the network as NDI sources at the video format picked (1080p at the same rates a Blackmagic
  device offers, 23.98 to 120, or 720p at 25, 29.97, 30, 50, 59.94 or 60). **Fill and key** makes two sources, *Source name Fill* (the scene over black) and *Source name Key* (white where it shows);
  **chroma** makes one, *Source name Chroma*, over the chroma colour; **with transparency** makes one, *Source name*, carrying alpha for
  receivers that key on NDI's transparency. They appear as "MAC NAME (Source name …)"; the source name is the output's name (and follows it when the output is renamed) unless *Use my own name* is ticked and another typed.
  The runtime comes from `/usr/local/lib` (NDI's installer) or from inside an NDI Tools app; a copy inside an app is loaded only when its
  code signature is Vizrt's or NewTek's (`desktop/signed.js`), since a library runs inside Studio. The app log names any copy left alone.
  It needs NDI's runtime for Mac (free, the libNDI installer from ndi.link/NDIRedistV6Apple), which puts `libndi.dylib` in `/usr/local/lib`;
  failing that, Studio uses the copy inside an NDI Tools app if it finds one (`desktop/ndi.js` looks in /Applications). Studio doesn't ship the runtime.
  The scene renders off screen as for Blackmagic (`desktop/scenewindow.js`, `desktop/ndi.js`) and `native/ndi`, a Node-API module built
  against the NDI SDK's header files in `native/ndi/sdk` (MIT licence), loads the runtime and sends each source at the frame rate, repeating
  the latest picture, only while something is receiving it. Frames are handed to NDI without waiting (NDI compresses the fill and key
  on its own threads, at the same time), and once a minute the app log gives the frames a second sent and the new pictures a second the
  scene drew, to tell a busy Mac from a lossy network. Each 1080p source is roughly 100 to 150 Mbit/s, so use a wired network (over
  Wi-Fi moving graphics stutter), at the frame rate the switcher or stream runs at. `npm test` in `native/ndi` also checks the timing
  against a stand-in runtime that is slow to compress. Sound
  plays through the Mac's audio output, not over NDI. Output on/off and `/deck/output/on|off|toggle` work the same.
  NDI® is a registered trademark of Vizrt NDI AB.

The scene is saved as `scene.json` in the data folder. http://localhost:8080/scene.html is the scene on its own, 1920 x 1080.

## Example graphics

The graphics are listed once, in `public/pages.js` (link, name, Docs page section, example pictures): the Output page's
**Add a page** and the Make Examples script read it, and a test checks every graphic in `public/`, every page in
`pageoptions.js` and the Docs page against it. A new graphic goes there first.

From a copy of the repository, double-click `Make Examples (Mac).command` (or run `node examples.js`) to save a
1920 x 1080 picture of every graphic with PlayHQ's current data in `Examples/<date and time>/`, with an `index.html`
to look through them. Pictures keep the transparent background. They follow the game, round and court picked on the
control page. It uses Studio if it is on air (keep a Studio window open), or starts it on its own for the run, and needs Node 22+ and Google Chrome, Edge, Brave
or Chromium (set `CHROME_PATH` for another one).

## Where a graphic's styles live

`public/graphics.css` holds only what two or more graphics share: the 1920 x 1080 see-through page frame centred in
the zone between the title and the scoreboard, the card panel and its footer, the sponsor footer, the pink tab, the
logo fallback and the game card header (match up, up next, full time, game stats, score worm, top shooters). Each
page's own layout goes in a `<style>` block in that page, after the `graphics.css` link. Colours, fonts and the
transparency come from the generated `theme.css`, so a competition's look is the same whichever file a rule is in.
A new graphic links `theme.css` and `graphics.css` and keeps its own rules in the page; a rule belongs in
`graphics.css` only once a second page needs it. The scoreboard and the ladder keep their own sheets.

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
"This round" is the one the control page has. A division without the round asked for is left out. When divisions are on
different rounds (one on Round 10, another on Finals Round 1), the heading says Fixture and each game shows its round under its division.
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

**Which game night.** The control page's game list, the ticker and up next use a game night: every division's games on one date,
whatever round each division is up to (one division on Round 10 and another on Finals Round 1 the same night are listed together, each
game with its own round). Automatic is the first night any division plays in the next 5 days, counting today, so a Tuesday night is
picked from the Friday before. Otherwise it's the last night played. Change the 5 with the days setting on the competition setup page.
Pick another night from **Game night** on the control page (each names its rounds); set it back to **Automatic** afterwards (the choice
is kept in `control.json`). Pages that show one round (the fixture, results) use each division's round on that night, and a division
with no games that night is left out. Automatic game selection uses the picked night too, following its games on the court by their
time: the game due now, otherwise the next to come, otherwise (a night already played) its last. `POST /api/rounds` takes
`{ "night": "2026-10-31" }` (blank for automatic); a round's number or name still works, meaning the night it is played in the first
division that has it.
`ladder.html` without `?division=` shows the division of the game picked on the control page. Its corner logo is the
dark mode competition logo, since it sits on the coloured header; `?mode=light` uses the light mode one.

**Always a game on.** When Studio starts, or the scoreboard is cleared, it puts a game on with Follow PlayHQ on: the
game for now on the court, otherwise this game night's first game on that court, otherwise its first game. It is only
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

On the control page, pick the game from this game night's PlayHQ fixtures and press **Use this game**.
With **Follow PlayHQ** on, the score updates every 5 seconds (change it on the control page, from 1 to 120 seconds) from the same live feed the
playhq.com game page uses, so it needs no API key, but only if someone is live-scoring that game in PlayHQ. The quarter
follows the PlayHQ scorer too (you can still change it in between). The clock matches the scores: switching between
**Follow PlayHQ** and **Manual** (or a score press switching to manual) also turns **Follow the PlayHQ scorer's clock** on or off,
and the control page says so. You can still change the clock afterwards (the tick box, `/deck/clock/playhq/on|off`, or
any clock button, which switches it back to manual). Otherwise press +1 / +2 / -1 / -2 (or keys A/Z for home, K/M for away,
with Shift for 2) and it switches to manual. The quarter and the countdown clock (Space starts and stops it) are run from the control page.
Everything can also be run from a Stream Deck: see `STREAMDECK.md`, or the API docs at http://localhost:8080/api.html. To line it up with the venue clock, type the venue's time (e.g. 12:34) in
**Match venue clock** and press Enter. Studio runs one scoreboard: for a second court, run a second Studio on another Mac.
Scoreboard position: by default it is centred at the bottom, just above the score ticker with a small gap, so both can be on screen together. `?position=top-center`, `bottom-center`, `top-left` or `bottom-left` moves it.

Super shot tab: in a division with super shots, a small "Super shot" tab rises above the scoreboard's clock in the last minutes of each quarter (3 by default, "Super shots in the last [x] minutes" on the setup page, 0 for none) and sinks away when the quarter's clock runs out or is reset. `?supershot=0` leaves it off.

## Team lists and shooting stats

These follow the game picked on the scoreboard control page:

- http://localhost:8080/title.html: round, competition and venue banner. The venue is set on the competition setup page
  (blank uses the venue from PlayHQ). `?position=bottom` moves it down and `?emoji=🔥` puts an emoji
  either side of the title (none without it). The competition logo is off by default, since the logos
  page shows it beside the title: `?logo=show` puts it above the banner, `?logo=hide` leaves it off. It is the light mode logo unless you add `?mode=dark`.
- http://localhost:8080/upnext.html: the next game on the same court, for half time. With no game picked, it
  assumes the stream is on the first timeslot and shows the game after it. After the last game of the night it
  shows an end of night card instead: "That's the last game of the night", the competition logo, name and organisation
  (from the competition setup, else PlayHQ), and when to join again: next week (or tomorrow, a day, a date) with the next
  round, the finals round's name when the next round is a final, "Finals are next" after the last round when a finals format
  is set, or a thank you for the season after that. `?wrap=1` shows the card now, `?wrap=0` never shows it, `?message=`
  changes the invite line and `?mode=dark` uses the dark mode competition logo.
- http://localhost:8080/stinger.html: a 1.5 second transition. Slanted bands in the competition's colours sweep across and
  cover the whole frame from 0.22 to 1.22 seconds, with the competition logo on the last band, so a cut can happen underneath,
  then carry on off the other side. `?hold=` (seconds on the full frame, 0 to 1 in steps of 0.1, 0.5 by default; 0 is a quick 1 second stinger),
  `?length=` (how long the bands take, 0.5 to 3 seconds), `?logo=0` (colours only), `?mode=dark`, `?size=`
  (logo height) and `?sfx=` (whoosh volume in %, 80 by default). `?music=quiet` ducks the music by the time the frame is covered and
  keeps it down for the scene cut to (until one without Quiet the music); `?music=dip` brings it back up as it leaves. For a switcher or player that plays stingers from a file,
  `node docs/stinger/render.js "Thunder League"` renders it from a competition template to a 1080p50 ProRes 4444 `.mov`
  with alpha (`--fps`, `--length`, `--hold`, `--logo 0`; needs ffmpeg with ProRes). `docs/stinger/` has Thunder League's.
- http://localhost:8080/introoutro.html: the intro (or `?type=outro`, the outro) for the start and end of the stream, full screen,
  about 8 seconds: the competition logo, name and organisation with the logos of a division's teams, in one of six
  styles (`?style=orbit`, `parade`, `tiles`, `spotlight`, `court`, `blueprint`, or `random`). The intro welcomes viewers to this
  round, division and venue; the outro uses the end of night card's words. `?division=2` or `all`, `?message=`, `?hold=`,
  `?out=0`, `?speed=`, `?mode=dark`, `?bg=`/`?bg2=`/`?bgimage=` and `?fit=1` (between the title and the scoreboard).
  Each style has its own sound effects (`?sfx=` volume in %, 80 by default, 0 for none). `?theme=` plays a song from the
  media folder with it (`?volume=` in %) and `?themefit=start|logo|end|stretch` lines it up with the start, the competition
  logo landing, or the end, or stretches the animation up to 25% to last as long as the theme. The Output page warns when
  the theme and animation lengths are more than 25% apart. Music fades out while a themed intro or outro is on.
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
- http://localhost:8080/streak.html: hot streaks, about 3½ seconds each, small under the title like the super shot.
  "<team> is HEATING UP" at 3 goals in a row, "<team> is ON FIRE" at 5 in a row, and "GOAL FOR GOAL INTENSITY" when
  10 goals in a row go one each way. Leave it on: it plays by itself from the goal order the Last 10 goals graphic uses
  (a super shot is one goal), once per run (a run reaching 5 plays on fire, not heating up again), never for scores
  catching up or after full time, and after any super shot graphic. `?heating=0`, `?fire=0`, `?goalforgoal=0` leave one
  out; `/deck/streak/heating/home`, `/deck/streak/fire/away`, `/deck/streak/goalforgoal` play one to test.
  Game moments on the same page: "<team> HITS THE FRONT" when the lead swaps, "ALL SQUARE" when it's level in the last
  2 minutes of a quarter, "<team> is COMING BACK" when a team 5 or more down gets within 2, "<team> ON THE SIREN!" for a
  goal with 10 seconds or less left while the clock runs, and "<team> BACK TO BACK SUPER SHOTS". One goal plays one at
  most (siren, back to back, on fire, hits the front, coming back, all square, goal for goal, heating up, in that order).
  `?lead=0`, `?level=0`, `?comeback=0`, `?siren=0`, `?backtoback=0` leave one out; `/deck/streak/lead/home` etc. test them.
  Manual: `?play=heating|fire|goalforgoal|lead|level|comeback|siren|backtoback` (`&team=away`) plays once when the source comes on.
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
- http://localhost:8080/gamestats.html: after the game, the score by quarter, then quarters won, best quarter, super shots made,
  3 and 5 goal runs and the longest run for each team. Studio works the quarters out from the scoreboard as the game goes
  (/api/stats), so keep it on air for the whole game; `?quarters=0`, `?won=0`, `?best=0`, `?supershots=0`, `?runs3=0`,
  `?runs5=0` and `?longest=0` leave parts out, `?title=` changes the heading. Lines starting `[stats]` in the log say when a quarter isn't sure.
- http://localhost:8080/commentator.html: the whole screen, for a commentary desk monitor rather than the stream. Team lists
  on the left with scoring drought and games played this season (line-ups loaded at the start and each quarter break),
  the game stats big in the middle (each logo with ladder position, record and form under it, head to head under the names)
  with shooting % (from PlayHQ's live counts, /api/stats `stats.shooting`), biggest lead and lead changes, on the right the
  clock with the super shot window, who is on the mic and up next, then a moments list (streaks, lead changes and super
  shots, newest at the top, the last 6, each with its quarter, game time and how long ago), and across the bottom the last
  10 goals (goals.html `?fill=1&run=0` in a frame, its goals spread to fill the tile), the current run and the score worm. The stats refresh in place every 15 seconds
  and on a score change (`?refresh=5|10|30|60`, `?refresh=0` loads once; Studio only, no PlayHQ); the rest follows the board live.
- http://localhost:8080/worm.html: after the game, the score worm: the margin over the game, home above the line and away
  below in club colours, with the quarters marked, each team's biggest lead and the lead changes. The line draws itself in.
  Studio works it out from the goal order it saw (/api/worm); a stretch it wasn't watching is hatched. `?draw=3` seconds to
  draw (0 shows it straight away), `?leads=0`, `?colours=0` (competition colours), `?title=`. In super shot
  divisions the super shot period of each quarter is shaded, with the points each team scored in it (`?supershot=0` hides it).
- http://localhost:8080/ladderbar.html: lower third with both teams' ladder position, record, points and percentage. It sits
  right above the scoreboard, scaled to the scoreboard's width.
- http://localhost:8080/lowerthird.html?name=Jane%20Smith: lower third introducing an athlete (name, team name, club logo),
  found by name among the competition's athletes (the athlete register the Athletes page shows). `?type=guest&name=Sam%20Lee&title=Commentator`
  is the guest or commentator version, with the competition logo. Options `?team=`, `?title=`, `?tag=`, `?photo=1`,
  `?position=center|bottom|bottom-center|right|left-half|bottom-right|bottom-left-half`, `?mode=light`, `?out=8`. It sits on the left,
  lined up with the scoreboard, just above it; `right` and `left-half` are half width, for two people on screen side by side.
  The Output page suggests the active competition's athletes (current season divisions only, from `/api/lowerthird/athletes`),
  narrowed by the Team option or the "Only athletes in the picked game" tick box.
  The bar has one fixed width (900px, 660px for the half-width positions) and the name one font size: a long name is
  squeezed narrower (down to 70%) before it gets smaller; the half-width bars use 44px names instead of 50px for everyone, and `?display=` shows a shorter name in its place.
- http://localhost:8080/commentators.html?label=Special%20guest%20commentators&name=Honey%20Harrington&name2=Will%20Linter: the
  commentators' names in one thin line above the scoreboard (a pink tab, then "Honey Harrington and Will Linter"). `?style=box`
  is an upper third instead: a box in the top right corner beside the competition logo, with the tab and a line per name. `?name=` to
  `?name4=`, `?label=` (Commentators by default, Commentator for one name, `0` for none), `?position=center|bottom|bottom-center`
  for the line and `under-left|under-right|center` for the box (under the title, with the competition logo in the box),
  `?logo=1|0`, `?mode=light`, `?out=8`. Long names are squeezed before they shrink.

The cards (match up, up next, countdown, position match ups, team lists, shooting stats, full time, fixtures, ladders,
top shooters, finals and last 10 goals) sit in the space between the title at the top and the scoreboard at the bottom,
with room around them. public/fit.js sets that space and shrinks a card that has more in it than fits. The Clash, the
winner celebration and the logo animations are moved and scaled into the same space (`data-fit-box` on their
stage gives the part of the frame their content uses); a logo animation's `?bg=` background still fills the screen.
The super shot plays at 30% of its full size, centred just under the title (`data-fit-scale=".3"` and
`data-fit-place="under-title"` on its stage).
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

## Sponsors

http://localhost:8080/sponsors.html (**Sponsors** in the menu) keeps the sponsors of the competition in use, by tier:
Naming rights, Elite, Major, Partner and Supporter. Each competition can call them by the Metals names (Naming rights,
Platinum, Gold, Silver, Bronze) or its own. The share beside each tier (5, 3, 2, 1, ½) is how screen time is split when a
sponsor has no target of its own.

- **A sponsor** has a colour logo and a white one for dark panels (without one, graphics make the colour logo white), a
  tagline, website, offer, brand colour, category (keeps competing sponsors apart in rotation), deal start and end dates
  (graphics skip a sponsor outside them) and optional targets: minutes on screen and ad plays per stream.
- **Shown on:** a sponsor can be on more than one competition, at its own tier in each, and is kept once in
  `sponsors/sponsors.json` in the data folder, with its logos in `sponsors/<id>/`. Competitions from the same PlayHQ
  organisation are listed first.
- **QR code:** made on this Mac for the sponsor's website, with tracking tags (`utm_source=livestream&utm_medium=qr`,
  the competition and the spot) so the sponsor sees visits from the stream in their own website analytics. Untick
  **Add tracking tags** to leave the link as it is. **Save QR code as PNG** saves a copy for the sponsor's own use.
- **When a tier has no sponsor:** Pull up or Pull down (a sponsor pulled up from the nearest tier below, or down from the nearest
  tier above, with one takes its spots), Skip tier, or Advertise vacancy: the competition's vacancy card goes where a card fits and the tier is skipped
  elsewhere. The vacancy card (heading, message, contact, and a link or email for its QR code) is the competition's, kept in
  its `settings.json` with the tier names and rules. Without a link it's never shown.

`GET /api/sponsors/pick?tier=major&place=card` says which sponsors fill a tier's spots in the competition in use after
those rules: `{ tier, sponsors }`, `{ tier, from, sponsors }` when pulled into an empty tier, `{ vacancy }` or `{ skip: true }`.

### Sponsors on the graphics

- **Sponsor card** (`/sponsor.html`, breaks) and **sponsor wall** (`/sponsorwall.html`, pre-game): see the Docs page.
  The card shows the next sponsor in rotation from Major and up, by tier share, never the same one twice running.
- **Naming rights** (the naming rights tier, or what its empty-tier rule gives instead): a "Presented by" tab over the
  home team on the scoreboard (checked every 5 minutes), a pill under the title banner, and a line under the countdown.
- **Rotation, Major and up:** the footer of the game stats, shooting stats and top shooters cards; each time a card
  comes on it's the next sponsor's turn.
- **Ticker:** the next sponsor in rotation from Partner and up leads the line of scores, with its tagline.
- **End of night card** (Up next after the last game): "Thanks to our sponsors" with their logos, Major and up
  (`?sponsors=all` every tier, `?sponsors=0` none).
- Every spot takes `?sponsor=0` for none or `?sponsor=Golds%20Bakery` to always show one sponsor. With no sponsors the
  graphics look as they always did.

### Sponsor ads

- **Ads on a sponsor:** up to 10 videos or stills in the sponsor's editor (**Add a video or still** saves the file to
  the media folder, or pick one already there). A still stays on for its seconds (3 to 60, 8 by default).
- **Sponsor ads step** (**+ Add sponsor ads** in a sequence on the Output page): plays the next 1 to 5 ads. Sponsors with
  an ad take turns by their tier's share, never the same one twice running, competitors apart, and each sponsor's own
  ads take turns. A video plays to its end with its sound (music gets out of the way as for any video), a still for its
  seconds. They play in sources the step adds to the scene the first time: **Sponsor ad (video)**, **Sponsor ad
  (still)**, and **House ad** (`ad.html`), which plays when no sponsor has an ad, unless the step's tick box is off; with
  nothing to play the step goes straight on. An ad whose file has left the media folder is passed over.
- **`/deck/sponsor/ad`** plays the next ad by hand, outside any sequence.
- Turns are counted while Studio runs. Ad files aren't in competition templates; copy the media with the Output page's
  export.

### Sponsored moments

The super shot (`supershot.html`) and the hot streaks and game moments (`streak.html`) show a white **Brought to you by**
tag under the big words. **Sponsored moments** on the Sponsors page sets, for each moment (super shot, heating up, on fire,
goal for goal, hits the front, all square, coming back, on the siren, back to back), one sponsor that owns it, **No
sponsor**, or (the default) the Elite tier's sponsors taking turns, one per play. An empty Elite tier follows its rule
(Pull up, Pull down or Skip; a vacancy shows nothing). An owner whose deal has ended goes back to the turns.
`?sponsor=0` on the page leaves the tag off and `?sponsor=Golds%20Bakery` always names that sponsor. Each tag counts as
2 seconds on screen in the sponsor report (place "Sponsored moments") when the page is on in the scene.

### Live viewers

On the Competitions setup page, **Live viewers** lists where the competition streams, for its admin to fill in: any
number of YouTube channels and Facebook Pages (**Add a YouTube channel**, **Add a Facebook Page**).

- **YouTube:** the channel's ID (UC…), its @handle, or the live video's link, and a YouTube Data API key (Google Cloud,
  free). Studio finds the channel's live video with a search (100 of the key's 10,000 daily units, at most every 5
  minutes and only until it finds one), then reads its viewers every 30 seconds (1 unit each).
- **Facebook:** the Page's ID or link, and a Page access token from a Meta app the Page's admin makes (no app review for
  their own Page; use a long-lived token).
- Studio reads them only while a video output is on, adds them up, and shows the total on the Output page. **Check now**
  reads them straight away and shows each stream's number or what's wrong (a bad key, not live).
- Keys and tokens are kept on this Mac only (`stream-keys.json` in the local folder): never in iCloud, templates or
  exports. The streams themselves go with the competition.
- Each reading on air is saved with the sponsor log, so the sponsor report shows **viewer-minutes** (the people watching
  while each sponsor was on screen) and the night's peak and average.

**Viewers graphic** (`viewers.html`, opt-in): a small "204 watching" pill top right, counting up to each new reading,
or with `?show=peak` a card with tonight's peak for the end of the night. It stays hidden while no stream is live and
below **The viewers graphic shows from** on the setup page (50 by default; `?min=` for one page), since small numbers can
look worse than none.

### Sponsor report

http://localhost:8080/sponsorreport.html (**Sponsor report** on the Sponsors page) shows what each sponsor got on screen,
to save as a PDF and send them after the night (**Print or save as PDF**).

- **What counts:** a graphic in the scene that's on and showing the sponsor (the scoreboard tab, title, countdown, stat
  card footers, ticker, sponsor card, sponsor wall, end of night card) and their ads. Each graphic tells Studio which
  sponsor it was given when it loaded, and Studio looks at the scene once a second. Only while a video output is on
  (rehearsals don't count), unless **Count time with no video output on** is ticked. A page used on its own outside
  the scene isn't counted.
- **The report:** per sponsor, time on screen (two graphics at once count once), where (time per place), ad plays and
  which ads, time with their QR code up (the sponsor card), and progress against their targets (per stream, so two
  nights double them). **Every showing** lists each one with its time, place and source. Pick tonight, any nights, or
  the whole season, for any competition.
- **The Sponsors page** shows tonight so far on each sponsor's card, against their target.
- A night runs to 4 am. The log is kept in `sponsors/exposure/` in the settings folder, one file a night.

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
divisions they play for, and **All athletes** lists everyone seen so far, once each, with a search box. A player in a
line up (the position match ups, Top shooters) is matched by their PlayHQ id first, then by name: the register keeps
each athlete's PlayHQ ids, so a player whose name changes in PlayHQ during the season keeps the photo (and approval)
kept under their old name.

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
each one has played for, their PlayHQ ids and gender, any gender you picked, the games and positions played you typed in, and
`photoOk` once *Approved for photo use* is ticked. A photo goes on a graphic (`/api/teams`, the lower third, the Socials
pictures) only for an approved athlete, else the silhouette; `/photos/<file>` serves an unapproved one only to someone who may
change the athletes (the athletes page), never to a device that only watches. `POST /api/athletes/approval
{ athletes: [names], approved }` sets it (*Approve all for photo use* sends the team's list). It fills in as line ups are read
(opening a team, or the game on the control page). Photos and the register are files in the competition's folder, so
commit the ones you want to keep like any other setting.

http://localhost:8080/positions.html shows the game picked on the control page position by position: the home team's
line up from GS to GK, each beside the away athlete they play against (home GS v away GK, GA v GD, WA v WD, C v C,
WD v WA, GD v GA, GK v GS), with their photos, names, numbers and captains. It then shows all seven pairings together.
Positions come from the line up entered on PlayHQ for that game. Some competitions' line ups miss positions: any
position with nobody listed shows **Unknown** (with the plain silhouette for the photo), and the debug log says which.

PlayHQ only has a game's line ups once live scoring starts (its game page has no line ups or stats before the scorer starts
the game). Until then the page says **Live scoring is not active for this game**, with both teams' logos. If live scoring has
started but the bench hasn't entered line ups it says **No line ups yet**, and a finished game without them says **No line
ups**. It checks PlayHQ again every 10 seconds and starts the match ups by itself as soon as either team's line up arrives,
so it can be left on. Full position names ("Goal Shooter") are read as GS and so on. An
athlete without a photo shows the generic silhouette for their gender.

- `?hold=6`: seconds per pairing (default 5).
- `?loop=1`: keeps going round instead of finishing on all seven.
- `?end=out`: animates away after the last pairing instead of showing all seven.
- `?show=all`: shows all seven pairings straight away.
- `?pair=C`: shows one pairing only, by the home team's position.
- `?games=0`: leaves out each athlete's games played.
- `?waiting=0`: leaves the page empty until the line ups arrive, instead of saying live scoring is not active.

Once the match ups have started it doesn't change, and it starts again each time it's turned on on the Output page.

## Production Planner

The **Production Planner** tab (`planner.html`, ⌘2, before Scoreboard control) plans the season: the court Studio streams each game night and up to
three commentators for each game on it. Studio streams one court a night; another court is another Mac running its own Studio.

- **Commentators:** a list per competition (name, and a Guest tick for a special guest). Adding a name suggests people
  from your other competitions' lists. Click the circle beside a name (or drop a photo on the row) to add their headshot,
  for the Socials tab's Commentary team picture; the × on it takes it off (`POST`/`DELETE /api/planner/headshot?id=`,
  saved in `competitions/<name>/headshots/`, served at `/headshots/`).
- **Nights:** every date any division plays this season, from PlayHQ's fixture (by date, not round). Pick the court, then
  add people to each game. A night with no plan of its own takes the plan of the last planned night before it (the court,
  and the people game by game in time order), so a regular team is planned once.
- **Fixture changes:** the people belong to the time on the court, not the game, because the desk is set up at the court.
  When PlayHQ moves a game to another court or date, the slot keeps its people and says *Fixture changed*; a game that has
  gone from the court keeps its row so its people can be moved.
- **On the night:** tonight's planned court (the game night picked by hand on Scoreboard control, otherwise today) is set
  as Scoreboard control's court once when the night arrives, which also turns on automatic game selection. Changing the
  court or picking a game by hand there is never undone; the Planner flags it at the top instead.
- **Graphics:** `commentators.html` with no `?name=` shows whoever is planned for the game on the scoreboard
  (`/api/planner/onair`), with the tab *Special guest commentators* when everyone planned is a guest, and
  `commentator.html` shows them under the clock (`?mic=0` leaves that out). `fixtureboard.html`, the **Fixture board (Full Page)**,
  is the night's whole fixture for a screen in the competition room or backstage (or to share before the night): a
  card per court (side by side up to three, then two rows: 2 × 2 for four, 3 × 2 for six) with its games by time, headed *Tonight's Fixtures* or the day (*Tuesday Night's Fixtures*). The
  planned court has a camera and its games name who is on the mic. Live games show their score and quarter (the
  streamed one from the scoreboard, the rest through the ticker's reader and cache, `games.js` `withLiveScores`, so
  no extra PlayHQ requests while the ticker reads, at most one a minute per live game otherwise); finished games grey
  out with the winner in yellow (on the streamed court, the score the scoreboard had when it moved on, `lastGame` in
  the board, until PlayHQ has the result), and only the last finished time slot stays (`/api/planner/fixtureboard`;
  `?date=`, `?title=`, `?bg=0`, `?refresh=0`).

Saved in `competitions/<name>/planner.json`. Reading `/api/planner` is private like the athlete register (this Mac and
allowed devices when the lock is on); `/api/planner/onair` and `/api/planner/fixtureboard` stay open for the graphics.

## Socials

The **Socials** tab (`socials.html`, ⌘8) makes pictures of a game night for social media, as PNGs at Instagram's sizes:
square 1080 x 1080, portrait 1080 x 1350 and Story 1080 x 1920. Pick the night by date (every division playing that night),
Upcoming or Results (a night with results opens on Results) and the sizes; untick what you don't want.

- **Upcoming:** the game night fixture (every game on every court, by time), a match up for each game, *On the stream* (the
  court Studio streams, each game's division and who calls it, from the Production Planner), *Commentary team* (who is on
  the mic that night, two to a picture and a picture for each pair, with their headshot from the Production Planner, initials until one is added, and a Special guest
  pill for a guest) and a polaroid for a match photo.
- **Results:** the night's final scores (each division, the winner highlighted), a full time card per game, the ladder of
  each division that played (as PlayHQ has it now, "after Round N" when it's the division's latest night with results,
  with the finals line), each division's top six shooters that night (one picture per division, `&division=`, from each finished
  game's line ups, read once and kept) and a polaroid per game with its score as the caption (and the opponent, division, round and date under it). A game shows once PlayHQ has its final score.
- **Polaroid:** drop a photo on it, drag the preview to frame it and set the zoom. With no photo its window is
  see-through, for the social team to put their own photo under it in another app. Photos stay on this Mac
  (`socials-photos/` in the local folder, the newest 40), never in a backup or iCloud.
- **Sponsors and logos:** each picture has a sponsor strip tick (naming, elite and major sponsors), and two ticks under Options put
  the FirstPass Studio mark (bottom right) and the PIVT logo (bottom left) on every picture; all are kept in
  `competitions/<name>/socials.json`.
- **Template:** a template set for every picture: *Default* (the stream's own look), *Fun*, *Dynamic*, *Junior*, *Retro*,
  *Futuristic*, *Professional*, *Thunder*, *Geometric*, *Gradient*, *Striped*, *High contrast*, *3D* (real perspective),
  *Neon*, *Poster*, *Splash*, *Game Day*, *Arena*, *Hero*, *Final*, and three netball sets: *Court* (the court's lines,
  thirds and circles), *Bib* (a bib with its position letters) and *Goal* (the ring, net and post, and a netball). Hero and Final stand a picked athlete's photo (best as a
  cut-out PNG from the Athletes tab) tall, in front of the title; Final sets the title's last word in a script face (`script`, `--sfont`).
  Each is a class on `social.html`'s body (`t-<id>`, styled in `public/social-templates.css`) with its own display face
  for titles, times and scores (`TEMPLATES` in `socials.js`); colours still come from the colour set, so any template
  takes any colour set. Kept in `socials.json` (`template`); `?template=<id>` asks for one.
- **Athletes' photos:** only athletes who approved their photo's use (Athletes tab). Top shooters shows each shooter's
  photo, matched by PlayHQ id then name, with the team logo as a badge. A Match up or Full time card picks an athlete for each side
  (division, team, then name; `&home=` `&away=`), drawn over the team's logo, and a polaroid can use an athlete's photo
  (`&athlete=`). `GET /api/socials/athletes` lists who can be picked.
- **Colours:** a colour set for every picture. *Competition colours* is the stream's own look; the others are made from
  the competition's main, highlight and accent colours (Accent first, Highlight ground, Accent ground, Night, Day, Two
  colours), so they follow the competition when its colours change. *New colour set* adds your own (up to 12). A set
  whose highlight is under 3:1 against its ground says *low contrast*. Kept in `socials.json` (`colours`, `colourSets`).
- **Saving:** *Select all* and *Select none* tick or untick every picture at once. *Save pictures* saves the ticked ones in `Pictures/FirstPass Studio/<competition> <date> Upcoming/` (or
  `Results/`), with *As a zip* also as `<competition> <date> Upcoming.zip` beside it (Share then sends the zip), and
  opens the folder; *Share…* saves them and opens the Mac's Share menu (AirDrop, Messages, Mail). The Mac app draws each
  picture off screen at full size (`desktop/socials.js`), so saving needs the app; the previews work anywhere.

Each picture is a page of its own, `social.html?kind=fixtures|matchup|onstream|commentators|polaroid|results|fulltime|ladder|topshooters&size=square|portrait|story`
(`&date=`, `&game=`, `&division=`, `&sponsor=0|1`, `&mark=0|1`, `&pivt=0|1`, `&colours=`, `&title=`; the polaroid's `&photo=`, `&px=`,
`&py=`, `&zoom=`, `&caption=`, `&note=`). Everything comes from Studio (`/api/socials/night`, `&with=ladders` or
`&with=shooters` for the pictures that need them), which reads the fixture, results and ladders through the same cache
as the other pages, and each finished game's line up once, so the tab asks PlayHQ for nothing more.

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
licence (Montserrat in `public/vendor/montserrat/OFL.txt`, the graphics' fonts under the SIL Open Font Licence in
`public/vendor/fonts/<font>/LICENSE`, Swagger UI in `public/vendor/swagger-ui/LICENSE`). Team and
competition logos belong to their owners and are not covered by the MIT licence.
