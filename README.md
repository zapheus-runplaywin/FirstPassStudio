# PlayHQ Graphics

Transparent ladder, scoreboard and game overlays for OBS, fed live from PlayHQ's public data (no API key). Set up for
Thunder League, with saved setups ready for the AMMNA Nationals and GIG WANL (the WA Netball League).

The pages you work in (home, scoreboard control, competition setup and the Stream Deck API docs) carry the FirstPass
Studio look from `public/studio.css`, with the Montserrat font served from `public/vendor/montserrat` so it works
offline. The OBS overlays don't use it: they keep the colours, font and logos of the competition in use.

## One-time setup

1. Install Node.js (the LTS version) from https://nodejs.org if you don't have it.
2. Thunder League's PlayHQ link is already set. Other competitions are set up on the competition setup page (below).

## Competition setup

http://localhost:8080/setup.html keeps a saved setup for each competition and switches between them. Each setup has the
organisation's PlayHQ link and which competition and season to use (**Find its competitions** lists them), the names
shown on the graphics (competition, organisation, venue), the game rules (quarters or halves and their length, super
shots, the ladder's finals marker), game day settings (court to follow, automatic game selection, minutes before a game
it switches, days ahead that count as this round), nine colours (a colour picker that also takes HEX or RGB, plus brand kit colours pasted in as swatches), panel transparency and the font, the competition logo
in light and dark mode versions (one alone is used for both; beside the title, above it and in the ladder's corner), the team logos (drop files on the page; they match clubs by file
name, and the PlayHQ team list lets you pick a different logo for any club), an optional colour for each club (behind its teams'
names on the scoreboard and behind their logo and name on The Clash), the emoji either side of the title (any emoji, or none), The Clash's big word and
the PlayHQ Client ID most competitions don't need.

Logos and colours belong to clubs, so a club's teams share them in every division. A team's club is its name without the
division on the end ("Comets 21U", "Comets Men" and "Comets Open" are all Comets; "Stormz Div 2" is Stormz), and the team
list's **Club** box links a team to another club, or a new one. Setups saved with a logo or colour per team are moved to
clubs when loaded.

**Use this one** switches every graphic, the control page and the Stream Deck to that competition (the round goes back to
automatic and the scoreboard starts on its first game). Saving the competition in use reloads the graphics in OBS.

Setups live in `competitions/<name>/` (`settings.json`, `logos/`, `brand/`); see **Saved settings and git** below.
AMMNA Nationals and GIG WANL come with their PlayHQ organisation link, colours (AMMNA green and gold from its logo;
GIG WANL in Netball WA greens with Gold Industry Group gold) and competition logo. AMMNA's PlayHQ competition is set to
Australian Championships; for GIG WANL pick it with **Find its competitions**. Their rules (AMMNA 10-minute quarters,
WANL 15-minute quarters, no super shots, finals marker on the top 4) are guesses to check. `config.json` now only holds this computer's settings (port,
log size, how often to check PlayHQ).

On a carnival day with several rounds (like the AMMNA nationals), "this round" moves on to each round as its first game
comes up (`autoSelectMinutesBefore` ahead), and Up next looks across the whole day.

## Saved settings and git

The repository holds the starting point for every setting, and the setup and control pages save your changes straight
into the same files:

- `competitions/<name>/`: each competition's `settings.json`, `logos/`, `brand/`, `photos/` (athlete photos) and
  `athletes.json` (the athlete register from the Athletes page).
- `competitions/active.json`: the competition in use.

Changes show up in `git status` like any other edit. Commit the ones you want to keep and send them as a pull request;
throw away the rest with `git restore competitions`. A new competition made on the setup page is a new folder in
`competitions/` to commit the same way.

The control page's choices (the round picked by hand, and for each board automatic game selection, its court,
following the PlayHQ clock, how often to check PlayHQ, and showing the clock) stay on this computer in `control.json`,
and live game state (the game on the board, scores, the clock) in `scoreboard-state.json`. Git ignores both. Without
`control.json` the helper starts from the competition setup's defaults and writes a new one.

Older versions saved setups in `settings/` and the round in `round-choice.json`. On its first start the helper copies
them into `competitions/` (so your edits show up as changes) and `control.json` and renames `settings/` to
`settings.old/`, which git ignores; delete it once you're happy.

## Each stream

1. Double-click `Start (Mac).command` or `Start (Windows).bat`. Leave the window open.
   The first time on a Mac, right-click it and choose Open, then Open again, because it was downloaded.
2. Open http://localhost:8080/ to see the three division links (and copy them).
3. In OBS add a **Browser** source per division, width 1920, height 1080:
   - http://localhost:8080/ladder.html?division=1
   - http://localhost:8080/ladder.html?division=2
   - http://localhost:8080/ladder.html?division=3

4. For the live scoreboard, add http://localhost:8080/scoreboard.html as another Browser source (1920 x 1080),
   then open http://localhost:8080/control.html in your browser to run it.

Only the scoreboard updates itself (every second, and it reloads when the helper restarts), along with the last 10 goals (every 2 seconds) and the ticker. Every other page
loads once when OBS shows it: in each Browser source tick **Refresh browser when scene becomes active**, or
right-click the source and choose **Refresh** to get the latest. Divisions are numbered in name order, as listed on the
http://localhost:8080/ page. You can also use part of a name, e.g. `?division=Premier`.

Frame rate: every graphic and animation is timed by the clock, not by frames, so it plays at the same speed at 25, 30,
50 or 60 fps. For 1080 50p or 60p, set OBS's Video FPS to 50 or 60 and leave **Use custom frame rate** unticked in each
Browser source, so the pages render at the stream's rate (a custom rate of 30 would make movement look steppy at 60p).

## Example graphics

Double-click `Make Examples (Mac).command` (or `Make Examples (Windows).bat`, or run `node examples.js`) to save a
1920 x 1080 picture of every graphic with PlayHQ's current data in `Examples/<date and time>/`, with an `index.html`
to look through them. Pictures keep the transparent background. They follow the game, round and court picked on the
control page. It uses the running helper or starts one for the run, and needs Node 22+ and Google Chrome, Edge, Brave
or Chromium (set `CHROME_PATH` for another one).

## Debug log

Everything goes into `logs/playhq-graphics.log`: each page opening, errors and warnings from every page
(including OBS), every PlayHQ request and its answer code, Game Summary requests, scoreboard and Stream Deck
changes, and helper errors. Read it at http://localhost:8080/api/log. It never grows past 15 MB
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
them in OBS. `?pivt=0`, `?studio=0` or `?comp=0` leave a logo off; `?gap=320` moves both sides in or out from the
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

**Always a game on.** When the helper starts, or the scoreboard is cleared, it puts a game on with Follow PlayHQ on: the
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
Before a game's electronic scoring starts the helper doesn't ask PlayHQ's live feed for it at all (automatic or picked by hand),
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
**Match venue clock** and press Enter. For a second court use `scoreboard.html?board=2` with `control.html?board=2`.
Scoreboard position: by default it is centred at the bottom, just above the score ticker with a small gap, so both can be on screen together. `?position=top-center`, `bottom-center`, `top-left` or `bottom-left` moves it.

## Team lists and shooting stats

These follow the game picked on the scoreboard control page (board 1 unless you add `&board=2`):

- http://localhost:8080/title.html: round, competition and venue banner. The venue is set on the competition setup page
  (blank uses the venue from PlayHQ). `?position=bottom` moves it down, `?fire=0` drops the emoji
  and `?emoji=⚡` uses a different one on that page only. The competition logo is off by default, since the logos
  page shows it beside the title: `?logo=show` puts it above the banner, `?logo=hide` leaves it off. It is the light mode logo unless you add `?mode=dark`.
- http://localhost:8080/upnext.html: the next game on the same court, for half time. With no game picked, it
  assumes the stream is on the first timeslot and shows the game after it.
- http://localhost:8080/countdown.html: counts down to the scheduled start time of the game picked on the control page,
  with both teams, logos, division, round, court, time and venue. The clock ticks in the page and it asks the helper (never PlayHQ)
  every 5 seconds which game is picked, so it follows a new game without a refresh. The last 10 seconds pulse; at zero it shows
  STARTING SOON. `?end=Game%20on` changes those words, `?end=hide` fades it away instead, `?fade=1` fades it out over the last 5 seconds (`?fade=8` over 8), `?label=` changes the heading,
  `?teams=0` shows the clock only and `?position=top` or `bottom` moves it.
- http://localhost:8080/clash.html: animated match up. The two logos charge in, smash together in the middle with a flash,
  sparks and lightning, then settle either side of a stamped VS over a big CLASH, with "Battle for <division>", the time
  and court. Tick "Refresh browser when scene becomes active" in OBS so it plays each time the scene comes on.
  `?out=10` animates it away after 10 seconds, `?word=RIVALS` changes the big word, `?title=Grand%20Final` the bottom line.
- http://localhost:8080/winner.html: full time celebration, picking the result from the scoreboard score when it opens
  (`?winner=home`, `?winner=away` or `?winner=draw` forces one). For a win the
  team's logo slams in over turning light rays and a big outlined VICTORY, with confetti cannons in their colour, then their
  name, the final score and "def. <other team>". For a draw both logos slide in, see-saw on a beam until level, DRAW is
  stamped between them and the score shows "Honours shared". Tick "Refresh browser
  when scene becomes active" in OBS. `?out=10` animates it away, `?word=CHAMPIONS` changes the big word (the stamp on a draw),
  `?title=` the line under the score and `?score=0` leaves the score off. Club colours from the setup are used, like The Clash.
- http://localhost:8080/supershot.html: 3 second celebration after a successful super shot. A netball flies in and bursts
  with sparks, SUPER and SHOT slam in from either side with the team's logo and name in their club colour,
  then it fades out and leaves the frame clear. Leave it on in OBS: it watches the scoreboard and plays by itself for each
  super shot (a +2 press, or the PlayHQ scorer's super shot count going up while following PlayHQ; `?board=2` for the second court).
  It asks the helper every second, which asks PlayHQ nothing extra. `/deck/home/supershot` plays it without changing the score.
  Manual: `?team=home`, `?team=away` or `?team=none` plays it once when the source comes on instead (tick "Shutdown source when
  not visible" and "Refresh browser when scene becomes active"). Details in STREAMDECK.md.
- http://localhost:8080/goals.html: the last 10 goals of the game, oldest to newest, for showing trends and changes in momentum.
  Each goal is a disc in the scoring team's club colour with its logo (+2 badge for a super goal) and the quarter and time,
  with a momentum line underneath (up for home goals, down for away), each team's count of the 10 and the current run
  (3 or more in a row lights up). `?layout=vertical` stacks it down the right-hand side (`horizontal`, above the scoreboard,
  is the default). Like the scoreboard it updates itself (every 2 seconds), so it can stay on. `?count=8` (3 to 30),
  `?times=0`, `?position=top|middle` (horizontal) or `left` (vertical), `?title=Momentum`, `?board=2`.
  PlayHQ's live feed only has running totals, not a list of goals, so the helper works out the order from the score going
  up between its readings (every 5 seconds while following PlayHQ, split into goals and super goals by PlayHQ's goal
  counts) and from each +1 / +2 press. -1 / -2 takes that team's latest goal off. The list restarts when a game is picked or
  the scores are reset, builds only while the scoreboard (or this page) is open, and marks a gap with a dashed … when a
  team's score jumps by more than 3 at once or the game was picked part way through. Lines starting `[goals]` in the log show each step.
- http://localhost:8080/matchup.html: both team logos with the division, round, date, time, court and venue. It also shows each team's
  last five results as W/L/D dots and this season's head to head: the win tally under VS and the last three meetings
  (`?form=0` or `?h2h=0` hides them).
- http://localhost:8080/fulltime.html: final score with each team's top shooter and shooting accuracy.
- http://localhost:8080/ladderbar.html: lower third with both teams' ladder position, record, points and percentage.
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
PlayHQ's "Summary for the Game v2" instead (Client ID on the setup page, other settings in `config.json`):
- `apiKey`: the association's PlayHQ API key (optional; leave blank if you don't have one).
- `apiTenant`: the sport name PlayHQ expects with the key (blank uses `netball-australia` from the organisation link).
- `gameSummaryPath`: `/v2/games/{id}/summary`.
When a team's line up for the game has fewer than seven players (benches often clear it when they log in and only
add players as they score), the rest of the team's season squad (everyone in its line ups this season) is added after
them under **Squad**, without positions. With no line up at all, the team list is the whole squad. Players in the
partial line up keep their position and stats, and the position match ups page only uses positions from the line up.
The control page shows how many players were found for each team, or the error. If the lists look wrong, send the debug log to Claude.

Team logos are added on the competition setup page, named after the team. A logo whose file name doesn't match the
PlayHQ team name can be picked for that team in the setup page's team list. The same list gives any team its own colour
(**Add colour**, then the colour picker or a pasted HEX or RGB value, or × to go back to the competition's colours; teams with similar names are offered the same colour); the scoreboard and The Clash use it behind that team. The
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

Like the other graphics it loads once: tick **Refresh browser when scene becomes active** in OBS so it starts again each
time the scene comes on.

## Roadmap

- **FirstPassVantage live athlete stats (future):** connect to FirstPassVantage for more detailed athlete stats while a
  game is on (per athlete, beyond the goals and attempts PlayHQ has), to show beside the position match ups, team lists
  and shooting stats. Not built yet.

## Options

- `&refresh=30` makes a ladder reload itself every 30 seconds (off by default).
- `&rows=8` shows only the top 8 teams.
- Quarter (or half) length and the season are on the competition setup page.
- Colours and font are on the competition setup page (the helper writes `theme.css` from them). Sizes and position are at the top of `public/ladder.css` and `public/scoreboard.css`.
- The pink marker beside positions 1 to 4 on the ladder marks the finals places; change `-n+4` in `ladder.css` if that differs.
