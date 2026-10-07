# Stream Deck buttons

Each button presses one link on the helper (it must be running).
The same links are documented at http://localhost:8080/api.html (also linked from the home page),
where **Try it out** sends any link to the scoreboard. The raw OpenAPI file is `public/openapi.yaml`.

**Setup for each button:** drag a **System → Website** action onto a key, paste a link from below,
and tick **GET request in background** so no browser window opens.
If the Stream Deck is plugged into a different computer from the one running the helper,
replace `localhost` with that computer's IP address (for example `http://192.168.1.20:8080/...`).

## Scores

| Button | Link |
|---|---|
| Home +1 | http://localhost:8080/deck/home/add1 |
| Home +2 (super shot) | http://localhost:8080/deck/home/add2 |
| Home −1 | http://localhost:8080/deck/home/minus1 |
| Home −2 | http://localhost:8080/deck/home/minus2 |
| Away +1 | http://localhost:8080/deck/away/add1 |
| Away +2 (super shot) | http://localhost:8080/deck/away/add2 |
| Away −1 | http://localhost:8080/deck/away/minus1 |
| Away −2 | http://localhost:8080/deck/away/minus2 |
| Reset scores to 0 | http://localhost:8080/deck/scores/reset |

Pressing any score button switches the scoreboard to manual scoring.

## Game

| Button | Link |
|---|---|
| Automatic game selection on | http://localhost:8080/deck/auto/on |
| Automatic game selection off | http://localhost:8080/deck/auto/off |
| Automatic game selection on / off | http://localhost:8080/deck/auto/toggle |
| Court for automatic selection (court 2) | http://localhost:8080/deck/court/2 |

The court can be its PlayHQ name (`/deck/court/Indoor%2001`) or just its number. Picking a game from the list on the
control page turns automatic selection off.

## Scoring mode

| Button | Link |
|---|---|
| Follow PlayHQ | http://localhost:8080/deck/source/playhq |
| Manual | http://localhost:8080/deck/source/manual |
| Toggle between the two | http://localhost:8080/deck/source/toggle |

Follow PlayHQ only works once a game has been picked on the control page.

## Clock

| Button | Link |
|---|---|
| Start | http://localhost:8080/deck/clock/start |
| Stop | http://localhost:8080/deck/clock/stop |
| Start / stop (one button) | http://localhost:8080/deck/clock/toggle |
| Reset to a full quarter (10:00) | http://localhost:8080/deck/clock/reset |
| Set to 10:00 | http://localhost:8080/deck/clock/set/10:00 |
| Add 1 minute | http://localhost:8080/deck/clock/adjust/1m |
| Take off 1 minute | http://localhost:8080/deck/clock/adjust/-1m |
| Add 10 seconds | http://localhost:8080/deck/clock/adjust/10s |
| Take off 10 seconds | http://localhost:8080/deck/clock/adjust/-10s |
| Add 1 second | http://localhost:8080/deck/clock/adjust/1s |
| Take off 1 second | http://localhost:8080/deck/clock/adjust/-1s |
| Follow the PlayHQ scorer's clock | http://localhost:8080/deck/clock/playhq/on |
| Stop following it | http://localhost:8080/deck/clock/playhq/off |
| Follow on / off (one button) | http://localhost:8080/deck/clock/playhq/toggle |

- Any amount works in an adjust link: `adjust/2m`, `adjust/-30s`, `adjust/90s`. A number on its own counts as seconds.
- Change the time in a set link to anything, e.g. `/deck/clock/set/7:30`.
- Following the PlayHQ clock only works while the score is following PlayHQ. Pressing any other clock button switches the clock back to manual.
- Quarters are 10 minutes. To change that, edit `quarterMinutes` in `config.json`, or use
  `/deck/clock/length/12` (minutes) from a button.

## Quarter

| Button | Link |
|---|---|
| Q1 | http://localhost:8080/deck/quarter/1 |
| Q2 | http://localhost:8080/deck/quarter/2 |
| Q3 | http://localhost:8080/deck/quarter/3 |
| Q4 | http://localhost:8080/deck/quarter/4 |
| Extra time | http://localhost:8080/deck/quarter/5 |
| Next quarter | http://localhost:8080/deck/quarter/next |
| Previous quarter | http://localhost:8080/deck/quarter/prev |

Changing the quarter doesn't touch the clock. Press Reset clock as well when the new quarter starts.
(Tip: a Stream Deck **Multi Action** can do both from one key.)

## Second court

Add `?board=2` to the end of any link, e.g. `http://localhost:8080/deck/home/add2?board=2`.
