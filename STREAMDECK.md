# Stream Deck buttons

Each button presses one link on Studio. Studio must be on air: open the FirstPass Studio app and keep a Studio
window open for the stream (closing the last one takes Studio off air, and the buttons get no answer).
The **Stream Deck** page in Studio (http://localhost:8080/api.html) has the main links with Copy buttons, the plugin, and
every link in its API reference, where **Try it out** sends any link to the scoreboard. The raw OpenAPI file is `public/openapi.yaml`.

**Setup for each button:** drag a **System → Website** action onto a key, paste a link from below,
and tick **GET request in background** so no browser window opens.

**The Stream Deck key.** Links copied from Studio (the Stream Deck page, the Output page) have this Mac's key after the
port, like `http://localhost:8080/k/3f9aQ2cB7xLd/deck/home/add1`, so a web page that doesn't know the key can't press them.
The links below are shown without it, and Studio refuses a link without its key, so copy them from the Stream Deck page
instead, or put `/k/<your key>` after `:8080` yourself. The FirstPass Studio plugin needs no key: the first time you press
one of its keys, the Mac asks you to **Allow** "Stream Deck on *computer*", and from then on the plugin signs every press
with its own key pair. Install it again from the Output page if it came with an older Studio (it never asks). If a link gets out, choose **Devices…** in the menu bar icon on the Mac
and press **Make a new key**: every link made before stops working, so copy your Website keys' links again.
A program on another computer can ask for a key of its own instead (`POST /api/pair`, in the Stream Deck page's reference): the Mac asks
you to Allow it, and Devices… can take that one key away without touching the others.
The links below use `localhost`, which works when the Stream Deck is plugged into the Mac running Studio.
The Docs page (http://localhost:8080/graphics.html) shows the same links with the Mac's .local name (for example `http://matts-macbook-pro.local:8080/...`),
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
| Play "heating up" for home (score unchanged) | http://localhost:8080/deck/streak/heating/home |
| Play "on fire" for away (score unchanged) | http://localhost:8080/deck/streak/fire/away |
| Play "goal for goal" (score unchanged) | http://localhost:8080/deck/streak/goalforgoal |
| Play "hits the front" for home (score unchanged) | http://localhost:8080/deck/streak/lead/home |
| Play "all square" (score unchanged) | http://localhost:8080/deck/streak/level |
| Play "coming back" for away (score unchanged) | http://localhost:8080/deck/streak/comeback/away |
| Play "on the siren" for home (score unchanged) | http://localhost:8080/deck/streak/siren/home |
| Play "back to back super shots" for home (score unchanged) | http://localhost:8080/deck/streak/backtoback/home |

**Pressing any score button switches the scoreboard to manual scoring: Follow PlayHQ stops, for the score and the clock.**
Press Follow PlayHQ (`/deck/source/playhq`, below) to go back. A +2 press also plays the super shot animation (see below).

## Game

| Button | Link |
|---|---|
| Automatic game selection on | http://localhost:8080/deck/auto/on |
| Automatic game selection off | http://localhost:8080/deck/auto/off |
| Automatic game selection on / off | http://localhost:8080/deck/auto/toggle |
| Court for automatic selection (court 2) | http://localhost:8080/deck/court/2 |

The court can be its PlayHQ name (`/deck/court/Indoor%2001`) or just its number. Choosing a court also turns automatic
selection on. Picking a game from the list on the control page turns it off.

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
use −2 to fix the score. Two super shots close together play one after the other. It only plays in a division that
plays super shots (set on the competition setup page), and so do the links below.

To play it without changing the score (a test, or a super shot the scoring missed), press
http://localhost:8080/deck/home/supershot or http://localhost:8080/deck/away/supershot.

**Manual instead:** a source with `?team=home`, `?team=away` or `?team=none` (no team, the competition's colours) doesn't
watch the scoreboard; it plays once each time it comes on. Keep **Load the page fresh each time it's shown** ticked, show it with a
**FirstPass Studio > Source** key, and turn it off again before the next one so it replays. Don't keep a manual source and the automatic one on together, or it plays twice.

## Scene (Output page)

For Studio's scene, built on the Output page (http://localhost:8080/output.html).

**FirstPass Studio plugin (easiest).** The Mac app includes a Stream Deck plugin. Install it from the menu bar icon
(**Install the Stream Deck plugin**) or the button on the Output page; the Stream Deck app opens it and installs it (do the same after an
app update to update the plugin). Then drag **FirstPass Studio > Source** onto a key and pick the source in its settings.

The four kinds of key look different at a glance: a **Source** key has a faint eye behind its title and one strip along the bottom, a
**Scene** key has stacked layers and a frame in its colour round the whole key, a **Sequence** key has a play button and its strip
split into four steps, and a **Switcher** key (see **Switcher** below) has a camera and its strip in two halves. For a Source key:


- **Press:** show or hide (default), fade in, fade out, refresh the page or restart the video, or turn the video's sound on or off.
- The key shows the source's name and lights up in its output's colour while the source is on, whether it was turned on from this key, another key, the
  Output page or a link. A sound key lights while the video's sound is on.
- **Colour:** group keys by the part of the stream they belong to: **blue** for the live stream (default), **green** for pre-game,
  **grey** for post-game, **yellow** (dark gold) for ads and **purple** for the quarter time break. The key is dark in its colour while the
  source is off and lights in its output's colour while it's on, in every colour; the strip along the bottom keeps the group's colour either way.
- **Output:** with more than one output in Studio, pick the output the key shows and hides the source on. It lights in that output's
  colour (Output 1 orange, 2 pink, 3 blue, 4 green) with a black title. A key for an output that has been removed says **no output**.
- It follows the source itself, so renaming it on the Output page doesn't break the key. If the source is removed the key says **gone**;
  while Studio isn't running it says **off air**, and a press shows a warning.
- Tick **Use my own title** to show the title you type in Stream Deck instead of the source's name.
- **Studio** stays empty when Studio runs on the same Mac as the Stream Deck; for another Mac type its address, like `http://studio-mac.local:8080`.

**Scene key.** Drag **FirstPass Studio > Scene** onto a key for the scenes (see **Scenes** below):

- **Press:** go to a scene picked in its settings (default), go to the **next** or **previous** scene, or go **back to the current scene as saved**.
- A scene's key lights up in its output's colour while its scene is on there, with a yellow dot in the corner when sources have been turned on or off since; press it
  again to put them back. Next and Previous show the name of the scene they'll go to (and *last* or *first* at the ends, where they do nothing).
  Back to saved names the current scene and shows the dot when there's something to put back.
- **Colour:** the scene's own colour (set in **Edit scenes** on the Output page), or one of the five groups.
- **Output:** with more than one output, the output it plays the scene on. Every output shares the scenes and has its own current
  scene, so a key for Commentary lights while Commentary is on that scene, whatever Output 1 shows; Next, Previous and Back to saved
  go from that output's own current scene.
- It follows the scene by id, so renaming it doesn't break the key; a deleted scene's key says **gone**.

**Sequence key.** Drag **FirstPass Studio > Sequence** onto a key for the sequences (see **Sequences** below):

- **Press:** play the sequence picked in its settings, or stop it while it plays (default); always play it from the first step; or, for
  whatever sequence is playing, **Next**, **Next when waiting**, **Pause / carry on** or **Stop**.
- A sequence's key lights up in its output's colour while it plays there and shows its step and the time left, like **3/5 0:12** (or **paused**, or **Next**
  while the step waits for a press). The Next, Pause and Stop keys light while any sequence plays.
- **Time left:** what the key counts down while the sequence plays: the step's (default), the whole sequence's (**all 1:40**, with
  **+** when part of it waits for Next, the game or a page, and **↻** when it repeats, for the time left this time round), both (one
  line each), or none (just the step number).
- **Next when waiting** is one key for every sequence: it moves on only when the step on now (the innermost, in a sequence inside
  another) is **Until I press Next**, and lights only then; at any other time a press does nothing.
- **Colour:** the sequence's own colour (set in its editor on the Output page), or one of the five groups.
- **Output:** with more than one output, the output it plays the sequence on; Next, Pause and Stop keys act on what that output is playing.
- When a sequence is about to start by itself after the siren, its key counts down to it (**in 0:04**).
- It follows the sequence by id, so renaming it doesn't break the key; a deleted sequence's key says **gone**.

**Switcher key.** Drag **FirstPass Studio > Switcher** onto a key for the ATEM switcher picked on the Output page (see **Switcher** below):

- **Press:** put a camera on preview (default), cut a camera straight to program, stinger to a camera (or to what's on preview), **Cut**,
  **Auto**, an **upstream** or **downstream key** (on / off, on, off, or a downstream key at its own rate), **Fade to black** or back, or
  **run a macro** saved on the switcher. The settings list the cameras by their names in ATEM Software Control, and only the keys this
  switcher has.
- A camera's key lights **red** while it's on program and **green** while it's on preview, whatever it presses, like the switcher's own
  buttons; it follows cuts from anywhere (the switcher's panel, ATEM Software Control, the Output page, a sequence). A key or Fade to
  black lights red while it's on air, and Auto while the switcher is in a transition.
- While the switcher isn't answering, every Switcher key goes dark with a yellow dot and says **offline**; a press is refused (nothing
  is saved up for later) and the key shows a warning. With no switcher picked it says **not set up**; a camera or key this switcher
  hasn't got says **not on it**.
- **Colour:** one of the five groups, for the dark body and the strip.

**Links.** The plugin isn't needed: these links work in a **Website** action (tick **GET request in background**), but the key
doesn't light up. Copied from the Output page they carry the Stream Deck key (see the top of this page).
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

## Switcher (a Blackmagic ATEM, set up on the Output page)

With a switcher picked on the Output page's Switcher card, these links press its buttons. Nothing is saved up while it isn't
answering: the link says so and does nothing. Inputs go by number or by their name in ATEM Software Control; keys and macros
count from 1. A key the switcher doesn't have (a second downstream key on an ATEM Mini Pro) is refused with what it does have.
The plugin's **Switcher** key (above) presses these and lights with the switcher's tally.

| Button | URL to open |
| --- | --- |
| Cut (preview to program, straight away) | http://localhost:8080/deck/switcher/cut |
| Auto (with the switcher's transition) | http://localhost:8080/deck/switcher/auto |
| Stinger (the scene's Stinger page on Output 1, cut underneath it) | http://localhost:8080/deck/switcher/stinger |
| Stinger to Camera 2 | http://localhost:8080/deck/switcher/stinger/2, http://localhost:8080/deck/switcher/stinger/Camera%202 |
| Fade to black, or back | http://localhost:8080/deck/switcher/ftb |
| Put Camera 2 on preview | http://localhost:8080/deck/switcher/preview/2, http://localhost:8080/deck/switcher/preview/Camera%202 |
| Cut Camera 2 straight to program | http://localhost:8080/deck/switcher/program/2 |
| Upstream key 1 on / off | http://localhost:8080/deck/switcher/usk/1/toggle (also on, off) |
| Downstream key 1 on / off | http://localhost:8080/deck/switcher/dsk/1/toggle (also on, off; auto at its own rate) |
| Run the switcher's macro 1 | http://localhost:8080/deck/switcher/macro/1 |

## Scenes (Output page)

A scene is a saved look for the scene's sources: which are on, which are off, and which it leaves as they are. Make them on the
Output page: set the sources up, press **Save what's on now** and name it (Pre-game, Live, Quarter time, Full time…). **Edit scenes**
changes them without touching what's on.

| Button | Link |
|---|---|
| Go to a scene | http://localhost:8080/deck/scene/pre-game |
| Next scene | http://localhost:8080/deck/scene/next |
| Previous scene | http://localhost:8080/deck/scene/prev |
| Back to the current scene as saved | http://localhost:8080/deck/scene/again |

- Going to a scene fades sources in and out to match, each with its own fade. A source that's already on stays on, so the scoreboard
  and ticker don't reload or jump.
- The sources are shared by every scene, so Source keys keep working whichever scene you're in. A source turned on or off after going to a
  scene shows as **changed** on the Output page; `/deck/scene/again` (or pressing the scene's link again) puts it back.
- Next and previous go in the order the scenes are listed on the Output page (by colour: pre-game, live stream, quarter time, post-game, ads; then by name) and stop at the first and last.
- A source added later is off in every scene. A video that fades out by itself when it finishes doesn't count as a change.
- A scene's link uses its name like a source's does, so renaming a scene changes its link.
- The Timed Sequence plugin can press these too, for example `get http://localhost:8080/deck/scene/pre-game` at 18:55.

## Sequences (Output page)

A sequence plays the scene's sources one after another: the run-up to a game, a quarter break, full time. Build them on the
Output page with **+ New sequence**. Each one belongs to the competition in use.

| Button | Link |
|---|---|
| Play a sequence | http://localhost:8080/deck/sequence/quarter-break |
| Play it, or stop it if it's playing | http://localhost:8080/deck/sequence/quarter-break/toggle |
| Next step of whatever is playing | http://localhost:8080/deck/sequence/next |
| Next, only if the step on now is Until I press Next (else nothing) | http://localhost:8080/deck/sequence/advance |
| Pause, or carry on | http://localhost:8080/deck/sequence/pause |
| Stop whatever is playing (does its "then") | http://localhost:8080/deck/sequence/stop |
| Start the one about to start now | http://localhost:8080/deck/sequence/now |
| Cancel the one about to start | http://localhost:8080/deck/sequence/cancel |
| Automatic sequences on / off / switch | http://localhost:8080/deck/sequence/auto/toggle (or `/on`, `/off`) |

- A sequence can start by itself: N minutes before the picked game's scheduled start, at quarter time, half time or three quarter
  time, or at full time. It follows the scoreboard's clock (the PlayHQ scorer's when following, or the one you run), so it needs no
  extra PlayHQ calls. After the siren it waits a few seconds (5 unless you change it) as **Starting**.
- A step can last **until the game moves on** (the clock starts, or the next break or full time), and a sequence can **repeat until play
  resumes** or until N minutes before the start: it finishes the step on screen, then ends. Untick **Automatic sequences on** on the
  Output page (or use the `auto` link) and nothing starts by itself.
- Stop ends the sequence and does its **Then** (go to a scene, turn off what it turned on, or leave it all). Going to a scene, playing
  another sequence or `/deck/layers/off` stops it without its Then.
- The plugin's **Sequence** key (above) presses these links and counts down the step on screen.
- `next`, `advance`, `stop`, `pause`, `resume`, `now`, `cancel` and `auto` can't be sequence names, so these links never clash with one.

## Music (Output page)

The Output page's **Music** player plays songs from the media folder (MP3, M4A, AAC, WAV or AIFF), one at a time or from a
playlist. Music plays wherever video sound plays (the outputs, or the Output page's Scene View while Video output is off) and is never heard twice.

| Button | Link |
|---|---|
| Play or pause | http://localhost:8080/deck/music/toggle |
| Play from the start | http://localhost:8080/deck/music/play |
| Pause, or carry on | http://localhost:8080/deck/music/pause, http://localhost:8080/deck/music/resume |
| Stop | http://localhost:8080/deck/music/stop |
| Fade out and stop | http://localhost:8080/deck/music/fade |
| Next or previous song | http://localhost:8080/deck/music/next, http://localhost:8080/deck/music/prev |
| Load a song (ready to play) | http://localhost:8080/deck/music/load/pre-game-bed |
| Load a playlist and play it | http://localhost:8080/deck/music/playlist/pre-game?play |
| Mute, keeping it running | http://localhost:8080/deck/music/mute/toggle (or `/on`, `/off`) |
| Duck: dip it low (down over the fade out time, up over the fade in time), keeping it running | http://localhost:8080/deck/music/duck/toggle (or `/on`, `/off`) |

- Add `?fade=2` to any of them for a 2 second fade, or `?fade=0` to cut. Without it they use the player's fade in time (play, resume, duck off) or fade out time (stop, pause, fade, duck on).
- Songs are named like sources: lower case with dashes for spaces, without the file's ending (**Pre-game bed.mp3** is `pre-game-bed`).
- While a video with its sound on plays, the music fades out and pauses, then fades back in from where it was (a player setting:
  or lower it, or leave it).
- A sequence can bring its own music; going to a scene or another sequence fades it out. A scene or sequence with **Quiet the music**
  ticked (an interview on court) ducks whatever music is playing (over the fade time) until the next scene, sequence or sequence step without it.
- The super shot song (a music setting, with its own volume) cuts in when the super shot period starts and fades out when it ends.

## Mics (Output page)

The Output page's **Mics** are live mics plugged into the Mac (wireless effects mics, crowd mics), mixed into Output 1's sound
while it's on, or plugged into the ATEM switcher, whose faders Studio moves. They dip while music or a video with sound plays, or a scene quiets the music (each a setting), and by hand.

| Button | Link |
|---|---|
| Mute every mic | http://localhost:8080/deck/mics/mute/toggle (or `/on`, `/off`) |
| Dip them by hand | http://localhost:8080/deck/mics/dip/toggle (or `/on`, `/off`) |
| Every mic up or down 10% | http://localhost:8080/deck/mics/up, http://localhost:8080/deck/mics/down (`?by=5` for another step) |
| Every mic to a level | http://localhost:8080/deck/mics/level/80 |
| Mute one mic | http://localhost:8080/deck/mic/court-mic/mute/toggle (or `/on`, `/off`) |
| One mic up or down 10% | http://localhost:8080/deck/mic/court-mic/up, http://localhost:8080/deck/mic/court-mic/down |

- A mic is named like a source (**Court mic** is `court-mic`), or by its number on the Output page (`/deck/mic/1/up`).

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
