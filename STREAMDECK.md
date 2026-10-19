# Stream Deck buttons

Each button presses one link on Studio. Studio must be on air: open the FirstPass Studio app and keep a Studio
window open for the stream (closing the last one takes Studio off air, and the buttons get no answer).
The **Stream Deck** page in Studio (http://localhost:8080/api.html) has the main links with Copy buttons, the plugin, and
every link in its API reference, where **Try it out** sends any link to the scoreboard. The raw OpenAPI file is `public/openapi.yaml`.

**Setup for each button:** drag a **System → Website** action onto a key, paste a link from below,
and tick **GET request in background** so no browser window opens.
The links below use `localhost`, which works when the Stream Deck is plugged into the Mac running Studio.
The home page shows the same links with the Mac's .local name (for example `http://matts-macbook-pro.local:8080/...`),
which also works from a Stream Deck on another computer on the same network.

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
| Play the super shot animation for home (score unchanged) | http://localhost:8080/deck/home/supershot |
| Play the super shot animation for away (score unchanged) | http://localhost:8080/deck/away/supershot |

**Pressing any score button switches the scoreboard to manual scoring: Follow PlayHQ stops, for the score and the clock.**
Press Follow PlayHQ (`/deck/source/playhq`, below) to go back. A +2 press also plays the super shot animation (see below).

## Game

| Button | Link |
|---|---|
| Automatic game selection on | http://localhost:8080/deck/auto/on |
| Automatic game selection off | http://localhost:8080/deck/auto/off |
| Automatic game selection on / off | http://localhost:8080/deck/auto/toggle |
| Court for automatic selection (court 2) | http://localhost:8080/deck/court/2 |

The court can be its PlayHQ name (`/deck/court/Indoor%2001`) or just its number. Picking a game from the list on the
control page turns automatic selection off.

## Score ticker

| Button | Link |
|---|---|
| Ticker faster | http://localhost:8080/deck/ticker/faster |
| Ticker slower | http://localhost:8080/deck/ticker/slower |
| Ticker normal speed (120) | http://localhost:8080/deck/ticker/normal |
| Ticker at a set speed (80 pixels a second) | http://localhost:8080/deck/ticker/speed/80 |

Faster and slower change it by 20 pixels a second, between 20 and 600. The ticker changes speed within a few
seconds without starting again. The control page has the same buttons. A ticker link with `?speed=` keeps its own speed.

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
- **Pressing any other clock button stops the clock following the PlayHQ scorer** (the score keeps following). Following the PlayHQ clock only works while the score is following PlayHQ.
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

The winner animation is a source in the scene, so its key shows the source (see **Scene (Output page)** below).
It works out the result from the scoreboard score each time it comes on, so one button covers home wins, away wins and draws.
Set it up once:

1. On the Output page, **Add page** and pick **Winner**, keeping **Load the page fresh each time it's shown** ticked (the
   default) so it plays from the start each time it comes on. Add `?out=12` to have it animate away by itself after 12 seconds.
2. On the Stream Deck use a **FirstPass Studio > Source** key for it, or the link http://localhost:8080/deck/layer/winner/toggle.

It celebrates the game picked on the control page, with the names, logos and final score from the scoreboard, so check the
score is right before pressing. To force a result whatever the score, use a source with `?winner=home`, `?winner=away` or `?winner=draw`.

## Super shot

The super shot animation plays by itself: 3 seconds, then it fades out, so the frame is clear again.

1. On the Output page, **Add page** and pick **Super shot**, above the scoreboard, and leave it on.
2. That's it. It plays with the scoring team's logo, name and club colour whenever the scoreboard gets a super shot:
   - a +2 press on the control page or the Stream Deck (http://localhost:8080/deck/home/add2), or
   - while following PlayHQ, the PlayHQ scorer recording a super shot (seen within the 5 second check).

Not played: two normal goals between checks, a scorer changing a goal into a super shot, scores catching up when a game is
picked or scoring switches to Follow PlayHQ, anything after full time, and a −2. A +2 pressed by mistake still plays, so
use −2 to fix the score. Two super shots close together play one after the other.

To play it without changing the score (a test, or a super shot the scoring missed), press
http://localhost:8080/deck/home/supershot or http://localhost:8080/deck/away/supershot.

**Manual instead:** a source with `?team=home`, `?team=away` or `?team=none` (no team, the competition's colours) doesn't
watch the scoreboard; it plays once each time it comes on. Keep **Load the page fresh each time it's shown** ticked, show it with a
**FirstPass Studio > Source** key, and turn it off again before the next one so it replays. Don't keep a manual source and the automatic one on together, or it plays twice.

## Scene (Output page)

For Studio's scene, built on the Output page (http://localhost:8080/output.html).

**FirstPass Studio plugin (easiest).** The Mac app includes a Stream Deck plugin. Install it from the menu bar icon
(**Install the Stream Deck plugin**) or the button on the Output page; the Stream Deck app opens it and installs it (do the same after an
app update to update the plugin). Then drag **FirstPass Studio > Source** onto a key and pick the source in its settings:

- **Press:** show or hide (default), fade in, fade out, refresh the page or restart the video, or turn the video's sound on or off.
- The key shows the source's name and lights up orange while the source is on, whether it was turned on from this key, another key, the
  Output page or a link. A sound key lights while the video's sound is on.
- It follows the source itself, so renaming it on the Output page doesn't break the key. If the source is removed the key says **gone**;
  while Studio isn't running it says **off air**, and a press shows a warning.
- Tick **Use my own title** to show the title you type in Stream Deck instead of the source's name.
- **Studio** stays empty when Studio runs on the same Mac as the Stream Deck; for another Mac type its address, like `http://studio-mac.local:8080`.

**Links.** The plugin isn't needed: these links work in a **Website** action (tick **GET request in background**), but the key
doesn't light up.
Each source in the scene gets these links, using its name in lower case with dashes for spaces
(a source named **Up Next** is `up-next`). The Output page shows and copies every source's links.

| Button | Link |
|---|---|
| Show or hide a source | http://localhost:8080/deck/layer/scoreboard/toggle |
| Fade a source in | http://localhost:8080/deck/layer/scoreboard/on |
| Fade a source out | http://localhost:8080/deck/layer/scoreboard/off |
| Refresh a page source (replays its animation), or start a video again | http://localhost:8080/deck/layer/winner/restart |
| Turn a video's sound on or off | http://localhost:8080/deck/layer/intro/sound/toggle |
| Video sound on / off | http://localhost:8080/deck/layer/intro/sound/on, http://localhost:8080/deck/layer/intro/sound/off |
| Fade every source out | http://localhost:8080/deck/layers/off |
| Show or blank the scene on the Mac's displays or Blackmagic device (Mac app) | http://localhost:8080/deck/output/toggle |
| Video output on / off | http://localhost:8080/deck/output/on, http://localhost:8080/deck/output/off |

Renaming a source on the Output page changes its links (the plugin's keys carry on).

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
