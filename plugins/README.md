# Plugins

Add-ons for other apps that work alongside PlayHQ Graphics. Each plugin lives in its own folder with its own
README, `package.json` and build. They're separate from the helper (`server.js`), which doesn't need any of them
to run.

| Plugin | Folder | What it does |
|---|---|---|
| Timed Sequence (Stream Deck) | [`streamdeck/`](streamdeck/) | A Stream Deck key that waits until a set time of day, then runs a list of steps with delays in between |

## Timed Sequence (Stream Deck)

Press the key to arm it. It counts down to a time you set, then runs its steps in order: press helper links
(`get http://localhost:8080/deck/...`), call other webhooks, open apps or web pages, run commands, press hotkeys or
type text, with `wait 5s` delays or `at 19:00` pauses in between. Press again to disarm, or to stop a sequence that's
running. It can repeat every day and re-arms itself if Stream Deck restarts.

Example: a key armed for 18:55 that gets the board ready and starts the clock at 19:00 is in
[`STREAMDECK.md`](../STREAMDECK.md#timed-buttons-timed-sequence-plugin).

- **Needs:** Stream Deck app 7.1 or later on Windows 10+ or macOS 12+, and Node.js with npm to build it.
- **Build and install:**

  ```bash
  cd plugins/streamdeck
  npm install
  npm run build
  npx streamdeck dev     # once: turn on Stream Deck developer mode
  npm run link
  npm run restart
  ```

  `npm run pack` makes a `.streamDeckPlugin` file in `plugins/streamdeck/dist/` that installs with a double-click
  on any computer.
- **Full guide:** every step type, the key's options and the project layout are in
  [`streamdeck/README.md`](streamdeck/README.md).

It uses Elgato's official SDK (`@elgato/streamdeck` v3) and is written in TypeScript.

## Adding a plugin

Put it in its own folder here (`plugins/<name>/`), keep its dependencies and build output inside that folder, and add
a row to the table above and a short section like the one for Timed Sequence. Git already ignores `node_modules/`
everywhere; ignore anything else a build produces in the plugin's own `.gitignore`.
