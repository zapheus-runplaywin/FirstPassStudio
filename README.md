# PlayHQ Graphics

Transparent Thunder League ladder and scoreboard overlays for OBS, fed live from PlayHQ's public data (no API key).

## One-time setup

1. Install Node.js (the LTS version) from https://nodejs.org if you don't have it.
2. The association's PlayHQ page link is already set in `config.json`.

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

Only the scoreboard updates itself (every second, and it reloads when the helper restarts). Every other page
loads once when OBS shows it: in each Browser source tick **Refresh browser when scene becomes active**, or
right-click the source and choose **Refresh** to get the latest. Divisions are numbered in name order, as listed on the
http://localhost:8080/ page. You can also use part of a name, e.g. `?division=Premier`.

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
with court, division, logos, and the score once a game is finished. `?division=1` shows one division,
`?round=6` shows another round.
http://localhost:8080/results.html is the same page showing only finished games with their scores.

## Live scoreboard

**Which round.** Every page (game list, fixture, results, ticker, up next) uses the round played in the next 5 days,
counting today, so a Tuesday round is picked from the Friday before. Otherwise it's the last round played. Change the 5 with
`roundLookaheadDays` in `config.json`. For testing, pick any round from **Round** on the control page; set it back to
**Automatic** afterwards (the choice is kept in `round-choice.json`). Automatic game selection uses the picked round too, treating its games
as if they were today, so you can test the timed switching on any night.
`ladder.html` without `?division=` shows the division of the game picked on the control page.

**Always a game on.** When the helper starts, or the scoreboard is cleared, it puts a game on with Follow PlayHQ on: the
game for now on the court, otherwise this round's first game on that court, otherwise this round's first game. It is only
left empty if PlayHQ can't be reached or the competition isn't found (check `organisationUrl` and `competitionName`).

**Automatic game selection.** Set `defaultCourt` in `config.json` the day before (e.g. `"Indoor 01"`, or just `"1"`).
With **Pick the game automatically for court** ticked on the control page, the scoreboard shows today's first game on
that court, then switches to each next game 10 minutes before its start time (`autoSelectMinutesBefore`), with
Follow PlayHQ on, the quarter back to Q1 and a full clock. In finals (a round with "Final" in its name) it keeps the
final on until PlayHQ marks it finished, in case of extra time. You can change the court on the control page or with
`/deck/court/2`. Picking a game from the list turns automatic selection off; tick it again (or `/deck/auto/on`) to go back.
`"autoSelectGame": false` in `config.json` starts with it off.

On the control page, pick the game from this round's PlayHQ fixtures and press **Use this game**.
With **Follow PlayHQ** on, the score updates every 5 seconds (change it on the control page) from the same live feed the
playhq.com game page uses, so it needs no API key, but only if someone is live-scoring that game in PlayHQ. The quarter
follows the PlayHQ scorer too (you can still change it in between). Tick **Follow the PlayHQ scorer's clock** (or use
`/deck/clock/playhq/on`) and the clock follows the clock the PlayHQ scorer runs; any clock button switches it back to manual. Otherwise press +1 / +2 / -1 / -2 (or keys A/Z for home, K/M for away,
with Shift for 2) and it switches to manual. The quarter and the countdown clock (Space starts and stops it) are run from the control page.
Everything can also be run from a Stream Deck: see `STREAMDECK.md`, or the API docs at http://localhost:8080/api.html. To line it up with the venue clock, type the venue's time (e.g. 12:34) in
**Match venue clock** and press Enter. For a second court use `scoreboard.html?board=2` with `control.html?board=2`.
Scoreboard position: by default it is centred at the bottom, just above the score ticker with a small gap, so both can be on screen together. `?position=top-center`, `bottom-center`, `top-left` or `bottom-left` moves it.

## Team lists and shooting stats

These follow the game picked on the scoreboard control page (board 1 unless you add `&board=2`):

- http://localhost:8080/title.html: round, competition and venue banner. The venue is `venueName` in `config.json`
  (blank uses the venue from PlayHQ). `?position=bottom` moves it down, `?fire=0` drops the flames.
- http://localhost:8080/upnext.html: the next game on the same court, for half time. With no game picked, it
  assumes the stream is on the first timeslot and shows the game after it.
- http://localhost:8080/clash.html: animated match up. The two logos charge in, smash together in the middle with a flash,
  sparks and lightning, then settle either side of a stamped VS over a big CLASH, with "Battle for <division>", the time
  and court. Tick "Refresh browser when scene becomes active" in OBS so it plays each time the scene comes on.
  `?out=10` animates it away after 10 seconds, `?word=RIVALS` changes the big word, `?title=Grand%20Final` the bottom line.
- http://localhost:8080/matchup.html: both team logos with the division, round, date, time, court and venue. It also shows each team's
  last five results as W/L/D dots and this season's head to head: the win tally under VS and the last three meetings
  (`?form=0` or `?h2h=0` hides them).
- http://localhost:8080/fulltime.html: final score with each team's top shooter and shooting accuracy.
- http://localhost:8080/ladderbar.html: lower third with both teams' ladder position, record, points and percentage.
- http://localhost:8080/ticker.html: scrolling scores from the other games this round. Unlike the other graphics it updates
  its scores itself every 30 seconds (`?refresh=0` to load once, `?speed=80` to scroll slower).
- http://localhost:8080/topshooters.html?division=1: season shooting leaders from every finished game
  (`?sort=goals` or `?sort=super`, `?limit=10`). Players who keep their PlayHQ profile private are left out.
- http://localhost:8080/teamlist.html?side=home and `?side=away`: one team list per team, with its logo.
- http://localhost:8080/shooting.html: goals, super goals, shots and accuracy for each shooter and each team, for quarter breaks.
  The title names the break from the scoreboard's quarter (Q2 = Half time); `?title=Three%20quarter%20time` overrides it.

Line-ups and stats come from the same data the playhq.com game page shows, with no API key. Players who keep their
profile private show as PlayHQ shows them. Only if that has no players and an `apiKey` is set do they come from
PlayHQ's "Summary for the Game v2" instead (settings in `config.json`):
- `apiKey`: the association's PlayHQ API key (optional; leave blank if you don't have one).
- `apiTenant`: the sport name PlayHQ expects with the key (blank uses `netball-australia` from the organisation link).
- `gameSummaryPath`: `/v2/games/{id}/summary`.
The control page shows how many players were found for each team, or the error. If the lists look wrong, send the debug log to Claude.

Team logos live in `public/logos`, named after the team. A logo whose file name doesn't match the PlayHQ team
name can be linked in `config.json`, e.g. `"logoAliases": { "Perth Coastal Netball": "Perth Coastals.png" }`.

## Options

- `&refresh=30` makes a ladder reload itself every 30 seconds (off by default).
- `&rows=8` shows only the top 8 teams.
- `config.json` → `quarterMinutes`: length of a quarter on the scoreboard clock (10).
- `config.json` → `seasonName`: set it (e.g. `"Summer 2026"`) to pin a season; blank means the current one.
- Thunder League colours are in `public/theme.css`. Sizes and position are at the top of `public/ladder.css` and `public/scoreboard.css`.
- The pink marker beside positions 1 to 4 on the ladder marks the finals places; change `-n+4` in `ladder.css` if that differs.
