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
Switching between the two also turns following the PlayHQ scorer's clock on or off to match (see Clock below).

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
- The clock matches the scores: `/deck/source/playhq` (or picking a game) turns following the PlayHQ clock on, and
  `/deck/source/manual` (or any score button) turns it off. Use the clock buttons above afterwards to change that.
- Quarters are 10 minutes. To change that, set the length on the competition setup page (setup.html), or use
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

For a competition played in halves (set on the competition setup page), 1 and 2 are the halves and next goes from 2 to extra time.

Changing the quarter doesn't touch the clock. Press Reset clock as well when the new quarter starts.
(Tip: a Stream Deck **Multi Action** can do both from one key.)

## Winner celebration (full time)

The winner animation is an OBS source, not a helper link, so the button switches OBS rather than press a link.
It works out the result from the scoreboard score each time it comes on, so one button covers home wins, away wins and draws.
Set it up once:

1. In OBS add a **Browser** source, 1920 x 1080, with the link http://localhost:8080/winner.html, and tick
   **Shutdown source when not visible** and **Refresh browser when scene becomes active** so it plays from the start
   each time it comes on. Add `?out=12` to have it animate away by itself after 12 seconds.
2. On the Stream Deck use the **OBS Studio** plugin: a **Scene** action for its scene, or a **Source** (visibility) action for the source.

It celebrates the game picked on the control page, with the names, logos and final score from the scoreboard, so check the
score is right before pressing. To force a result whatever the score, use a source with `?winner=home`, `?winner=away` or `?winner=draw`.

## Super shot

The super shot animation is also an OBS source: 3 seconds, then it fades out by itself, so the frame is clear again.

1. In OBS add a **Browser** source, 1920 x 1080, with http://localhost:8080/supershot.html?team=home and another with
   `?team=away`, each with **Shutdown source when not visible** and **Refresh browser when scene becomes active** ticked.
   (Plain http://localhost:8080/supershot.html plays it without a team, in the competition's colours.)
2. On the Stream Deck use the **OBS Studio** plugin's **Source** (visibility) action for each, next to the +2 buttons.
   A **Multi Action** can add the 2 points (http://localhost:8080/deck/home/add2) and show the source from one key.
   Turn the source off again before the next super shot so it replays.

## Second court

Add `?board=2` to the end of any link, e.g. `http://localhost:8080/deck/home/add2?board=2`.

## Timed buttons (Timed Sequence plugin)

`plugins/streamdeck` is a Stream Deck plugin that waits until a set time of day, then presses a list of links
(and other steps) with delays in between. Build and install it with the steps in `plugins/streamdeck/README.md`.

For example, a key armed for 18:55 that gets the board ready for a 19:00 start:

```
get http://localhost:8080/deck/scores/reset
get http://localhost:8080/deck/quarter/1
get http://localhost:8080/deck/clock/reset
at 19:00
get http://localhost:8080/deck/clock/start
ok
```

Press the key to arm it (it shows a countdown), press again to disarm, or press while it's running to stop it.
