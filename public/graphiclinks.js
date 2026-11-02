// FirstPass Studio - every graphic's own link, for the Links list on the Devices tab (devices.js draws it, with Copy
// and Preview): what each one does and the options its link takes. A graphic in pages.js names its group here (group),
// and a test checks that every graphic is here. The Output page offers the same options as fields (pageoptions.js).
//
// GRAPHIC_LINKS.GROUPS: [{ id, title, about }] in the order the list shows them. GRAPHIC_LINKS.LINKS: [{ group, name,
// link, about }]: about is our own HTML. A group with perDivision gets one link per division of the competition in use
// as well (the ladder, finals and top shooters), from /api/structure.
(function () {
  'use strict';
  const LINKS = [];
  const add = (group, name, link, about) => LINKS.push({ group, name, link, about: about || '' });
add('scoreboard', 'Live scoreboard', '/scoreboard.html',
  'Sits centred at the bottom, just above the score ticker with a small gap, so both can be on together. ' +
  '<code>?position=top-center</code>, <code>bottom-center</code>, <code>top-left</code> or <code>bottom-left</code> moves it. ' +
  '<b>Super shot tab:</b> in a division with super shots, when the quarter clock gets to the last 3 minutes (or is already ' +
  'under them when the game is picked), a small yellow "Super shot" tab rises out from behind the bar above the clock, with a pulsing dot and a light ' +
  'sweeping across it now and then. It sinks away when the quarter\'s clock runs out or is reset for the next quarter. It runs off the scoreboard\'s ' +
  'own clock, so it follows the PlayHQ scorer\'s clock when the scoreboard does. The minutes are set per competition on Competitions setup ' +
  '(Game rules, 0 leaves the tab off), and <code>?supershot=0</code> leaves it off this source.');
add('scene', 'Studio scene (what the outputs show)', '/scene.html',
  'Studio\'s own scene, built on the Output page: every source as a layer on one 1920 × 1080 frame. For using the whole scene at one link.');
[['Title banner', '/title.html',
  'Drawn at 80% size, centred between the logos page\'s logos; a long competition name shrinks further so it never runs into them. Options: <code>?emoji=%F0%9F%94%A5</code> puts an emoji either side of the title (any emoji; none without it). On the Output page, pick or type it in the source\'s options. ' +
  'The competition logo is off by default (the logos page shows it beside the title): <code>?logo=show</code> puts it above the banner, <code>?logo=hide</code> leaves it off.'], ['Logos beside the title (PIVT, FirstPass Studio, competition)', '/branding.html',
  'Just the logos, placed either side of the title banner, so the other pages can be turned on and off around them. The competition logo comes from the competition setup. ' +
  'Options: <code>?pivt=0</code>, <code>?studio=0</code> or <code>?comp=0</code> leave a logo off, <code>?gap=320</code> moves both sides in or out from the centre, ' +
  '<code>?top=95</code> moves them up or down, and <code>?size=1.2</code> makes them bigger. ' +
  '<code>?mode=light</code> (the default) uses the FirstPass Studio and competition logos for a light picture behind them; <code>?mode=dark</code> uses the ones for a dark picture.'], ['Match up (with form and head to head)', '/matchup.html'], ['The Clash (animated match up)', '/clash.html',
  'Plays when the page loads, so it plays each time it\'s turned on on the Output page. ' +
  'Options: <code>?out=10</code> animates it away after 10 seconds, <code>?word=RIVALS</code> changes the big word, and ' +
  '<code>?title=Grand%20Final</code> changes the bottom line. Combine them with &amp;, e.g. <code>/clash.html?out=10&amp;word=RIVALS</code>.'], ['Winner celebration (full time)', '/winner.html',
  'Works out the result from the scoreboard score when it opens, so one source covers every game: it loads fresh each time it\'s turned on on the Output page; show it from the Stream Deck with its source\'s links under Scene below. ' +
  'A win: the winner\'s logo slams in over light rays and a big VICTORY, with confetti in their colour, their name, the final score and who they beat. A draw: both logos slide in, see-saw level and DRAW is stamped between them. ' +
  'To force a result, add <code>?winner=home</code>, <code>?winner=away</code> or <code>?winner=draw</code>. ' +
  'Options: <code>?out=10</code> animates it away after 10 seconds, <code>?word=CHAMPIONS</code> changes the big word (or the stamp on a draw), <code>?title=Grand%20Final%20winners</code> changes the line under the score, ' +
  '<code>?score=0</code> leaves the score off. Combine them with &amp;, e.g. <code>/winner.html?out=12&amp;score=0</code>. Uses club colours from the competition setup.'], ['Super shot (after a successful super shot)', '/supershot.html',
  'A 3 second burst after a super shot goes in, small and centred just under the title: a netball flies in and bursts, SUPER and SHOT slam in from either side, then it fades out and leaves the frame clear. ' +
  '<b>Automatic (this link):</b> leave the source on and it plays by itself for every super shot, with that team\'s logo and name in their club colour: ' +
  'a +2 press on Scoreboard control or Stream Deck, or, while following PlayHQ, the PlayHQ scorer recording a super shot. ' +
  'Two normal goals between checks, a scorer correcting a goal to a super shot, scores catching up when a game is picked, anything after full time and a −2 don\'t play it; a +2 pressed by mistake does. ' +
  'Two close together play one after the other. <code>/deck/home/supershot</code> or <code>/deck/away/supershot</code> plays it without changing the score (to test it). ' +
  '<b>Manual:</b> <code>?team=home</code>, <code>?team=away</code> or <code>?team=none</code> (competition colours, no team) doesn\'t watch; it plays once each time the source comes on, so keep <b>Load the page fresh each time it\'s shown</b> ticked and show it from the Stream Deck with its source\'s links under Scene below. ' +
  '<b>Brought to you by:</b> a white tag under it names the sponsor of the moment, set under <b>Sponsored moments</b> on the <a href="/sponsors.html" target="_blank">Sponsors page</a> (one sponsor, or the Elite sponsors taking turns); <code>?sponsor=0</code> leaves it off, <code>?sponsor=Golds%20Bakery</code> always names that one.'], ['Hot streaks and game moments (heating up, on fire, goal for goal, hits the front, all square, coming back, on the siren, back to back)', '/streak.html',
  'About 3½ seconds, small and centred just under the title like the super shot, then it fades out and leaves the frame clear. ' +
  '<b>Heating up:</b> when a team scores 3 goals in a row, their logo and name drop in with "is", HEATING UP rises in letter by letter and warms from their club colour to fire, with embers and "3 in a row". ' +
  '<b>On fire:</b> at 5 in a row, ON FIRE slams in with a flash and a shake, burning, with flames roaring up behind and "5 in a row". ' +
  '<b>Goal for goal:</b> when 10 goals in a row go one each way (home, away, home…), GOAL FOR GOAL comes in from alternate sides, INTENSITY crackles between both logos, and a dot per goal pops in, in each team\'s colour. ' +
  '<b>Game moments:</b> <b>hits the front</b> when a team goes ahead and the other team was the last one ahead (gold chevrons rising, the score); ' +
  '<b>all square</b> when the scores are level again in the last 2 minutes of a quarter (both logos, the score on a see-sawing beam); ' +
  '<b>coming back</b> when a team that was 5 or more down gets within 2 ("from 6 down"); ' +
  '<b>on the siren</b> for a goal with 10 seconds or less left while the clock is running, or just stopped (a red beacon, the quarter and time left); ' +
  '<b>back to back</b> for a team\'s second super shot in a row (two netballs drop in). These use the scoreboard\'s score and clock, so the clock needs to be right for all square and on the siren. ' +
  'One goal plays one at most, in this order: on the siren, back to back, on fire, hits the front, coming back, all square, goal for goal, heating up. ' +
  '<b>Automatic (this link):</b> leave the source on and it plays by itself, from the same goal order as the Last 10 goals graphic (a super shot is one goal): while following PlayHQ, the scorer\'s goals, and the +1 / +2 presses on Scoreboard control or Stream Deck. ' +
  'Each plays once per run: a run that reaches 5 plays on fire (not heating up again), a goal for goal stretch plays once however long it goes, and a −1 then the goal again doesn\'t replay it. ' +
  'Scores catching up when a game is picked part way through, and anything after full time, don\'t play. One that comes with a super shot waits for the super shot graphic to finish, and two close together play one after the other. ' +
  '<b>Brought to you by:</b> each streak and moment can name its sponsor, as the super shot does (Sponsored moments on the Sponsors page; <code>?sponsor=0</code> leaves it off). ' +
  '<code>?heating=0</code>, <code>?fire=0</code>, <code>?goalforgoal=0</code>, <code>?lead=0</code>, <code>?level=0</code>, <code>?comeback=0</code>, <code>?siren=0</code> or <code>?backtoback=0</code> leaves one out. ' +
  '<code>/deck/streak/heating/home</code>, <code>/deck/streak/fire/away</code>, <code>/deck/streak/goalforgoal</code>, <code>/deck/streak/lead/home</code>, <code>/deck/streak/level</code>, <code>/deck/streak/comeback/away</code>, <code>/deck/streak/siren/home</code> or <code>/deck/streak/backtoback/home</code> plays one without changing the score (to test it). ' +
  '<b>Manual:</b> <code>?play=heating</code>, <code>fire</code>, <code>goalforgoal</code>, <code>lead</code>, <code>level</code>, <code>comeback</code>, <code>siren</code> or <code>backtoback</code>, with <code>&amp;team=away</code> for the away team, doesn\'t watch; it plays once each time the source comes on (keep <b>Load the page fresh each time it\'s shown</b> ticked).'], ['Last 10 goals (momentum, updates itself)', '/goals.html',
  'Who scored each of the last 10 goals of the game on the scoreboard, oldest to newest, with the quarter and time of each, a momentum line (up for a home goal, down for an away goal, shaded in the club colours), ' +
  'how many of the 10 each team scored, and the current run (3 or more in a row lights up). Super goals show a +2 badge. Like the scoreboard it updates itself every 2 seconds, so it can stay on screen: new goals pop in and the older ones slide along. ' +
  'PlayHQ only gives running totals, not a list of goals, so the order is worked out by Studio from the score going up between readings (every 5 seconds while following PlayHQ) and from each +1 / +2 press on Scoreboard control or Stream Deck. ' +
  'A -1 or -2 takes that team\'s latest goal off. The list starts again when a new game is picked or the scores are reset. It only builds while the scoreboard (or this page) is open, and if the score jumps by more than 3 for one team at once, or the game was picked part way through, a dashed … marks the gap. ' +
  'Options: <code>?layout=vertical</code> (the default is <code>horizontal</code>, above the scoreboard), <code>?count=8</code> shows a different number of goals (3 to 30), <code>?times=0</code> leaves the quarter and time off, <code>?run=0</code> leaves the current run line off, ' +
  '<code>?position=top</code> or <code>middle</code> moves the horizontal one (it stays between the title and the scoreboard), <code>?position=left</code> puts the vertical one on the left and <code>?title=Momentum</code> changes the heading.'],
 ['Last 10 goals: vertical', '/goals.html?layout=vertical'], ['Up next (half time), and the end of night card after the last game', '/upnext.html',
  'The next game on the same court (any court when that court has nothing later), for half time. With no game picked, it shows the game after the first timeslot. ' +
  '<b>After the last game of the night</b> it shows an end of night card instead: <b>That\'s the last game of the night</b>, the competition logo, name and organisation (from the competition setup, else PlayHQ), a little confetti, and when to join again: ' +
  '<b>next week</b> (or tomorrow, a day, or a date) with the next round and its date, <b>Grand Final next week</b> (the round\'s name) when the next round is a final, ' +
  '<b>Finals are next</b> after the last round when PlayHQ has no finals fixtures yet and a finals format is set, and after that <b>the last game of the season</b> with a thank you (or congratulations to the champions after a final). ' +
  'The next round is the first one dated after tonight in any division. ' +
  'Options: <code>?wrap=1</code> shows the end of night card now (to check it, or to close a stream early), <code>?wrap=0</code> never shows it (the old message instead), ' +
  '<code>?message=See%20you%20at%20finals</code> changes the invite line and <code>?mode=dark</code> uses the dark mode competition logo.'], ['Sponsor card (breaks)', '/sponsor.html',
  'A sponsor of the competition in use from the <a href="/sponsors.html" target="_blank">Sponsors page</a>: its logo on a white plate, name, tagline, offer, website and a QR code to its website, edged in the sponsor\'s brand colour. ' +
  'Each time it comes on it shows the <b>next sponsor in rotation</b> from Major and up: each sponsor\'s turn comes round by its tier\'s share (a sponsor pulled into an empty tier gets that tier\'s share too), never the same one twice running, and not one in the same category as the last while there\'s another. ' +
  'An empty tier set to <b>Advertise vacancy</b> puts the competition\'s vacancy card in the rotation (heading, message, contact and its QR code). Turns are counted while Studio runs. ' +
  'Options: <code>?sponsor=Golds%20Bakery</code> always shows one sponsor, <code>?tiers=naming,elite</code> changes the tiers in rotation (<code>naming</code>, <code>elite</code>, <code>major</code>, <code>partner</code>, <code>supporter</code>), <code>?title=Quarter%20time%20is%20brought%20to%20you%20by</code> changes the heading, ' +
  '<code>?offer=0</code>, <code>?tagline=0</code> and <code>?qr=0</code> leave those out, and <code>?out=12</code> animates it away after 12 seconds (and switches its source off).'],
 ['Sponsor wall (pre-game)', '/sponsorwall.html',
  'Every sponsor of the competition in use, sized by tier with naming rights biggest, and the vacancy card (with its QR code) in an empty tier set to Advertise vacancy. Sponsors outside their deal dates are left out. ' +
  'Options: <code>?title=Tonight\'s%20stream%20is%20proudly%20supported%20by</code> changes the heading, <code>?tiers=naming,elite,major</code> shows only some tiers, <code>?names=1</code> puts each sponsor\'s name under its logo, ' +
  '<code>?tiernames=0</code> leaves the tier names out, and <code>?out=12</code> animates it away after 12 seconds.'],
 ['Viewers (how many are watching)', '/viewers.html',
  'How many are watching the stream right now, added up from the competition\'s YouTube channels and Facebook Pages (<b>Live viewers</b> on the <a href="/setup.html" target="_blank">Competitions setup</a> page, read while a video output is on): a small pill in the top right corner, counting up to each new reading. ' +
  'It stays hidden while no stream is live and below the setup page\'s minimum (50 by default), since a small number can look worse than none; <code>?min=200</code> sets another for this page. It checks Studio every 15 seconds and nothing else. ' +
  '<code>?show=peak</code> is a card with tonight\'s peak instead (for the end of the night; loads once), with <code>?title=</code> for its heading and <code>?out=12</code> to animate it away after 12 seconds.'],
 ['Countdown to the start of the game', '/countdown.html',
  'Counts down (days, hours, minutes and seconds as needed) to the scheduled start time from PlayHQ of the game picked on Scoreboard control, with both teams, their logos, the division, round, court, time and venue. ' +
  'The clock ticks in the page, so it can stay on screen: every 5 seconds it checks with Studio which game is picked (PlayHQ is not asked), so when a new game is picked, by hand or by automatic game selection, it counts down to that one. ' +
  'The last 10 seconds pulse in the accent colour, and at zero it shows <b>STARTING SOON</b> until the next game is picked. ' +
  'Options: <code>?end=Game%20on</code> changes the words at zero (keep them short), <code>?end=hide</code> fades the card away instead, <code>?fade=1</code> fades the whole card out smoothly over the last 5 seconds so it is gone at zero (<code>?fade=8</code> over 8 seconds), <code>?label=Next%20game%20in</code> changes the heading, ' +
  '<code>?teams=0</code> shows the clock only and <code>?position=top</code> or <code>bottom</code> moves it to the top or bottom of the space between the title and the scoreboard (the default is the middle).'], ['Position match ups (athlete photos)', '/positions.html',
  'Goes through the home team from GS to GK, each beside the away athlete they play against (GS v GK, GA v GD, WA v WD, C v C, WD v WA, GD v GA, GK v GS), ' +
  'with photos from the <a href="/athletes.html" target="_blank">Athletes page</a>, then shows all seven together. Positions come from the PlayHQ line up for the game; a position missing from it shows as Unknown. ' +
  'PlayHQ only has line ups once live scoring starts: until then it says live scoring is not active for the game, and starts the match ups by itself when the line ups arrive (<code>?waiting=0</code> leaves it empty instead). ' +
  'It starts again each time it\'s turned on on the Output page. ' +
  'Options: <code>?hold=6</code> seconds per pairing (default 5), <code>?loop=1</code> keeps going round, <code>?end=out</code> animates away after the last pairing, ' +
  '<code>?show=all</code> shows all seven straight away, <code>?pair=C</code> shows one pairing only, <code>?games=0</code> leaves out games played.'], ['Home team list', '/teamlist.html?side=home', 'The game\'s PlayHQ line up. When it has fewer than seven players (benches often clear it), the rest of the season squad is added under <b>Squad</b>, without positions.'],
 ['Away team list', '/teamlist.html?side=away', 'The game\'s PlayHQ line up. When it has fewer than seven players (benches often clear it), the rest of the season squad is added under <b>Squad</b>, without positions.'], ['Shooting stats', '/shooting.html'],
 ['Full time card', '/fulltime.html'], ['Game stats (after the game)', '/gamestats.html',
  'The score by quarter, then team against team with a bar between them: <b>quarters won</b>, <b>best quarter</b> (most points, and which quarter), <b>super shots made</b> (super shot divisions only), ' +
  '<b>3 goal runs</b> and <b>5 goal runs</b> (times a team scored at least 3 or 5 goals in a row; a 5 goal run counts as a 3 goal run too, and a super shot is one goal) and the <b>longest run</b>. ' +
  'Studio works these out from the scoreboard as the game goes: whatever the score goes up by is put on the quarter that is on, and the quarter only moves on when the next one starts, so keep Studio on air for the whole game. ' +
  'A quarter Studio only saw part of (the game was picked part way through, or a score jumped by more than 3 at once) is greyed out and not counted as won; runs count from when Studio picked the game up. ' +
  'Super shots made uses PlayHQ\'s count when following PlayHQ. Halves competitions say halves. ' +
  'Options: <code>?title=Final%20stats</code> changes the heading, and <code>=0</code> leaves a part out: <code>?quarters=0</code> (the score by quarter), <code>?won=0</code>, <code>?best=0</code>, <code>?supershots=0</code>, <code>?runs3=0</code>, <code>?runs5=0</code>, <code>?longest=0</code>.'], ['Commentator stats (full screen, for the commentary desk)', '/commentatorstats.html',
  'A whole screen for a monitor at the commentary desk, not the stream. On the left, both team lists, home above away: each team\'s <b>scoring drought</b> (game time since its last goal, in yellow from 2 minutes) and each athlete\'s <b>games played</b> this season in the division (as on the position match ups). ' +
  'In the middle, big, the Game stats: each team\'s logo with its <b>ladder position</b>, record and <b>form</b> (last 5) under it, <b>head to head</b> this season under the names, and the Game stats rows with <b>shooting %</b> (goals and super shots made from every shot, from PlayHQ\'s live scoring, so only when following PlayHQ and its scorer records shots), <b>biggest lead</b> and <b>lead changes</b> added. ' +
  'On the right, the game clock with the <b>super shot window</b> (when it starts, and while it\'s on), who is <b>on the mic</b> for this game from the <a href="/planner.html" target="_blank">Production Planner</a> and <b>up next</b> on this court, then the <b>moments</b> list (lead changes, coming back, super shots, on fire and the rest of the hot streaks), newest at the top with the last 6 showing, each with its quarter and game time and how long ago it happened. ' +
  'Across the bottom, the last 10 goals, the <b>current run</b> in big numbers and the <b>score worm</b>, redrawn as the game goes. ' +
  'The clock, moments, goals and run follow the game live. The stats <b>auto-refresh</b> in place every 15 seconds and straight away when the score changes: on the Output page, untick <b>Auto-refresh</b> to load them once, or pick every 5, 10, 30 or 60 seconds (<code>?refresh=10</code>, <code>?refresh=0</code> for once). The team lists load when the page comes on and again at each quarter break. ' +
  'Options: <code>?title=</code> changes the stats heading, <code>?bg=0</code> drops the background, and <code>=0</code> leaves a part out: <code>?quarters=0</code>, <code>?shooting=0</code>, <code>?won=0</code>, <code>?best=0</code>, <code>?supershots=0</code>, <code>?runs3=0</code>, <code>?runs5=0</code>, <code>?longest=0</code>, <code>?leads=0</code>, <code>?worm=0</code>, <code>?games=0</code>, <code>?drought=0</code>, <code>?h2h=0</code>, <code>?next=0</code>, <code>?moments=0</code>, <code>?goals=0</code>, <code>?run=0</code>, <code>?mic=0</code>.'], ['Score worm (after the game)', '/worm.html',
  'The margin over the game as a line: above the middle while the home team is ahead, below while the away team is, filled in each club\'s colour (the competition\'s pink and yellow for a club without one, or one that looks too like the other), with the quarters marked and the line drawing itself in; the dot at its tip glows bigger and brighter the faster the margin is changing. ' +
  'It shows each team\'s <b>biggest lead</b> (and in which quarter) and the number of <b>lead changes</b>. ' +
  'In a super shot division the <b>super shot period</b> of each quarter (the last minutes set on the Competitions setup page) is shaded with a yellow cap, and <b>Super shot time</b> shows the points each team scored in it. ' +
  'Studio works it out from the goal order it sees as the game goes, timed by the game clock (a quarter without the clock running has its goals spread evenly across it), so keep Studio on air for the whole game. ' +
  'A stretch Studio wasn\'t watching (the game picked up part way, a score typed in, or a jump of more than 3 at once) is hatched and the line jumps across it dotted. ' +
  'Options: <code>?title=Score%20worm</code> changes the heading, <code>?draw=3</code> seconds to draw the line in (<code>0</code> shows it straight away), <code>?leads=0</code> leaves out the biggest leads and lead changes, <code>?supershot=0</code> leaves out the super shot periods, <code>?colours=0</code> uses the competition\'s colours.'], ['Ladder lower third', '/ladderbar.html', 'Both teams\' ladder position, record, points and percentage, right above the scoreboard and the same width as it.'], ['Score ticker (other courts, updates itself)', '/ticker.html',
  'Scrolling scores from the other games this round, leaving out the game on the scoreboard. It updates its scores itself every 30 seconds (<code>?refresh=0</code> loads once). ' +
  '<b>Speed:</b> set it on Scoreboard control (<b>Ticker speed</b> in pixels a second, with <b>Slower</b>, <b>Faster</b> and <b>Normal (120)</b>) or from the Stream Deck with ' +
  '<code>/deck/ticker/faster</code>, <code>/deck/ticker/slower</code>, <code>/deck/ticker/normal</code> or <code>/deck/ticker/speed/80</code>. Faster and slower change it by 20, between 20 and 600. ' +
  'The ticker asks Studio for the speed every 3 seconds (PlayHQ is not asked) and changes without starting the scroll again; the speed is remembered in control.json. ' +
  '<code>?speed=80</code> fixes the speed for that link only, ignoring Scoreboard control.']]
  .forEach(([n, p, h]) => add('gamePages', n, p, h));
add('fixturePages', 'Round fixture', '/fixtures.html',
  'Every game of a round in every division, sorted by time, with court, division, logos and the score once a game is finished. ' +
  'It shows this round (the one Scoreboard control has, picked by date unless set by hand) and loads once, getting the latest each time it\'s turned on on the Output page. ' +
  'Options: <code>?round=next</code> shows the round after this one (next week), <code>?round=prev</code> the one before, <code>?round=+2</code> or <code>?round=-1</code> counts from this round, ' +
  '<code>?round=6</code> shows round 6 (or a round by name, like <code>?round=Final</code>), and <code>?division=1</code> shows one division. Combine them with &amp;, e.g. <code>/fixtures.html?round=next&amp;division=1</code>. ' +
  'A division without that round is left out. When divisions are on different rounds (one on Round 10, another on Finals Round 1), the heading says Fixture and each game shows its round under its division.');
add('fixturePages', 'Next round fixture (next week)', '/fixtures.html?round=next');
add('fixturePages', 'Round results (finished games)', '/results.html', 'Only the finished games of this round, with their scores. Takes the same <code>?round=</code> and <code>?division=</code> options, e.g. <code>/results.html?round=prev</code> for last week.');
add('fixturePages', 'Fixture board (Full Page, for a screen in the competition room or backstage)', '/fixtureboard.html',
  'The night\'s whole fixture, filling the frame, for a screen in the competition room or backstage rather than the stream, and a picture to share before the night: a card per court (two courts side by side, four as a 2 × 2 grid, six as 3 × 2), each listing its games by time. ' +
  'The heading is <b>Tonight\'s Fixtures</b>, or the day (<b>Tuesday Night\'s Fixtures</b>) for another night. The court the <a href="/planner.html" target="_blank">Production Planner</a> streams that night has a camera, and its games name who is on the mic (special guests marked). ' +
  'Games being played show <b>Live</b> with their score and quarter: the streamed game\'s from the scoreboard, the others\' through the same live reader and cache as the ticker, so the board adds no PlayHQ requests while the ticker is on and at most one a minute per live game when it isn\'t. ' +
  'Finished games grey out with their final score and the winner in yellow (on the streamed court, the score the scoreboard had until PlayHQ has the result); once a time slot is all finished, the one before it drops off. ' +
  'It follows the scoreboard live and reads the fixture again every minute (<code>?refresh=0</code> loads once). The night is the game night picked on Scoreboard control, otherwise today, otherwise the next game night; <code>?date=2026-11-04</code> shows another. <code>?title=</code> changes the heading and <code>?bg=0</code> drops the background.');
[['Logo animation: fun (swoops in, slams down, rockets out; the default)', '/logo.html?template=fun',
  'One big competition logo from the competition setup: it swoops in around the screen, slams down in the middle with a burst in the competition\'s colours, holds, then rockets out. ' +
  'Every template plays once when the page loads, about 5 seconds, then leaves the frame clear, and plays again each time it\'s turned on on the Output page. ' +
  'Pick a template with <code>?template=</code> and its name, as in the links below (<code>?template=random</code> picks a different one each time).'],
 ['Logo animation: pro (wipe, lines and a light sweep)', '/logo.html?template=pro', 'The same logo with a clean, calm reveal.'],
 ['Logo animation: coin (spins in like a tossed coin)', '/logo.html?template=coin', 'Spins in from the distance, its back in the accent colour, lands with sparkles and a light sweep, then spins away.'],
 ['Logo animation: tiles (coloured tiles flip over)', '/logo.html?template=tiles', 'Tiles in the competition\'s colours pop up in a wave and flip over one by one to make the logo, then fall away.'],
 ['Logo animation: slices (strips slide in)', '/logo.html?template=slices', 'Colour bars streak across and the logo slides in strip by strip from alternate sides, then slides out the other way.'],
 ['Logo animation: glitch (colour split, switches off like an old TV)', '/logo.html?template=glitch', 'Flickers on with a colour split and torn slices, glitches twice while it holds, then shrinks to a line and a dot.'],
 ['Logo animation: badge (rings with the competition name)', '/logo.html?template=badge', 'Rings draw round the logo with the competition name turning in a band, then the badge spins away. ' +
  'The name comes from PlayHQ (or the setup\'s display name); <code>?text=Grand%20Final</code> uses other words.'],
 ['Logo animation: doors (full screen panels slam shut)', '/logo.html?template=doors', 'Two striped panels in the competition\'s colours slam shut across the whole screen, the logo punches in on them, then they open again. ' +
  'It covers the picture in the middle, so it works as a transition between scenes.'],
 ['Logo animation: bounce (drops in and bounces)', '/logo.html?template=bounce', 'Drops in from the top and bounces to a stop with a shadow under it, hops once, then jumps off the top of the screen.'],
 ['Logo animation: lightning (bolts strike)', '/logo.html?template=lightning', 'Lightning strikes, the logo flashes on white hot with a jolt, sparks crackle round it, and one last strike takes it away.'],
 ['Logo animation: rings (broken rings spin round it)', '/logo.html?template=rings', 'Broken rings and dots in the competition\'s colours spin into place round the logo and keep turning, then fly apart.'],
 ['Logo animation: title (logo and competition name)', '/logo.html?template=title', 'The logo pops in, slides left and the competition name wipes in beside it on an underline. ' +
  '<code>?text=Grand%20Final</code> changes the words and <code>?sub=Round%206</code> adds a smaller line under them.'],
 ['Logo animation: goal (netball, the ball goes through the ring)', '/logo.html?template=goal', 'A goal post rises, the ball arcs up and drops through the ring with a swish of the net, then the logo punches in where the post was.'],
 ['Logo animation: court (netball, the court draws on)', '/logo.html?template=court', 'A netball court to scale, in the competition\'s colours and in perspective: its lines draw on, the logo stands up on the centre third, then it all folds away.'],
 ['Logo animation: bibs (netball, the seven positions)', '/logo.html?template=bibs', 'The logo pops in and the seven position bibs, GS round to GK, pop in around it, bob while it holds, then fly away.'],
 ['Logo animation: pass (netball, down the court GK to GS)', '/logo.html?template=pass', 'The ball is passed down the court from GK to GS, leaving a line in the accent colour, and the last pass to the middle becomes the logo.'],
 ['Logo animation: net (netball, the logo drops through the ring)', '/logo.html?template=net', 'A big ring and net rise up, the logo drops through it like a goal and the net swishes, then the ring drops away and the logo rises to the middle.'],
 ['Logo animation options (for every template)', '/logo.html?template=coin&out=0',
  '<code>?mode=light</code> (the default) or <code>?mode=dark</code> uses the setup\'s light or dark mode competition logo, ' +
  '<code>?out=0</code> keeps the logo on screen at the end, <code>?size=640</code> sets its height in pixels, and <code>?speed=1.5</code> plays it faster (<code>0.5</code> slower). ' +
  'The page is transparent unless you add a background, which fades in and out with the animation: <code>?bg=gradient</code> is a dark radial gradient, ' +
  '<code>?bg=7f4092</code> (a hex colour without the #, or a colour name) a radial gradient from that colour to a darker shade, <code>?bg2=</code> sets the edge colour, ' +
  '<code>?bg=solid-7f4092</code> a flat colour, and <code>?bgimage=court.jpg</code> a picture from the competition\'s brand folder (competitions/&lt;competition&gt;/brand/) or a full link. ' +
  'Combine them with &amp;, e.g. <code>/logo.html?template=badge&amp;mode=dark&amp;bg=7f4092</code>. The templates after fun and pro use flat, hard edged shapes only, so nothing leaves a halo over key and fill. ' +
  'With no competition logo in the setup the page stays empty.']]
  .forEach(([n, p, h]) => add('logoPages', n, p, h));
add('stingerPages', 'Stinger', '/stinger.html',
  'Slanted bands in the competition\'s colours (accent, highlight, main and the dark panel colour, from the competition setup) sweep across and cover the whole picture, the competition logo punches in on the last one and holds for half a second, then the bands carry on off the other side. ' +
  'It lasts 1.5 seconds and the whole picture is covered from 0.22 to 1.22 seconds, so a cut to another camera or scene can happen underneath it. It plays once each time it\'s turned on on the Output page, then turns itself off. ' +
  'It covers the whole frame on purpose, so it isn\'t fitted between the title and the scoreboard. ' +
  'Options: <code>?hold=1</code> holds the full frame for a whole second (0 to 1 second in steps of 0.1; <code>?hold=0</code> is a quick 1 second stinger), <code>?length=1.5</code> makes the bands sweep in and out more slowly (0.5 to 3 seconds), <code>?logo=0</code> plays it with the colours only, ' +
  '<code>?mode=dark</code> uses the setup\'s dark mode competition logo, <code>?size=560</code> sets the logo\'s height in pixels, and <code>?sfx=80</code> is the whoosh\'s volume in % (<code>0</code> for none). ' +
  'The music carries on under it unless you say: <code>?music=quiet</code> brings the music down quickly, so it\'s down by the time the picture is covered, and keeps it down for the scene you cut to, as a scene with <b>Quiet the music</b> does, until a scene, sequence or step without it; ' +
  '<code>?music=duck</code> brings it down the same way and back up in half a second as the stinger leaves. ' +
  'It reads the competition logo once when it loads. ' +
  'With an ATEM switcher set up (under Video output), <b>Stinger</b> on its card, <code>/deck/switcher/stinger</code> and a sequence or scene\'s <b>Stinger to</b> play it on the output on a downstream key (Output 1 unless another one that\'s on is) and cut the switcher underneath, in the middle of the cover as this stinger\'s own settings make it (so <code>?hold=</code> and <code>?length=</code> still line up).');
add('stingerPages', 'Stinger: colours only', '/stinger.html?logo=0');
const INTRO_HELP = 'The competition logo and name, the organisation, and the logos of every team in a division, for the start and the end of the stream. ' +
  '<b>Intro:</b> Welcome to the competition, with this round, the division, the venue and the date. ' +
  '<b>Outro</b> (<code>?type=outro</code>): the last game of the night (or season) and when to join again, the same words as Up next\'s end of night card: next week with the next round, the finals round\'s name, Finals are next, or a thank you for the season. ' +
  '<b>Styles</b> (<code>?style=</code>), each with its own ending: <b>orbit</b> (the default: the logos spiral in from the edges and settle in a ring round the competition logo that turns slowly), <b>parade</b> (they march in along a line near the bottom with their names and stay there like a line up, the competition logo above), ' +
  '<b>tiles</b> (a wall of team logo tiles flips over, tile by tile, into a mosaic of the competition logo), <b>spotlight</b> (the teams stand under an arch; in the dark a spotlight visits each with its name, then the lights come up), ' +
  '<b>court</b> (netball court lines draw on and the teams play the ball from one goal circle to the other, left to right: each drives in to catch it, turns and passes on, then clears; with fewer than 7 teams each runs on and reoffers for a second catch. The last one shoots, the goal brings in the competition logo, and the teams line up along the side lines), ' +
  '<b>blueprint</b> (on a glowing grid, lasers sketch the team logos like blueprints, they solidify into holographic cards, the camera pushes through them and the competition logo is traced and blasted in as the grid scatters), or <b>random</b>. ' +
  'The teams are the division of the game picked on Scoreboard control; <code>?division=2</code> picks one, <code>?division=all</code> shows one team per club across the competition. Logos get smaller as there are more teams. ' +
  'It holds for 5 seconds once the words are in, then animates away and switches its source off: <code>?hold=10</code> holds longer, <code>?out=0</code> stays on screen. ' +
  'Options: <code>?message=</code> changes the yellow line, <code>?speed=1.5</code> plays it faster (0.5 slower), <code>?mode=dark</code> the dark mode competition logo, ' +
  '<code>?bg=</code>, <code>?bg2=</code> and <code>?bgimage=</code> a background as on the logo animations (it is see-through without them; the blueprint style brings its own grid), ' +
  'and <code>?fit=1</code> fits it between the title and the scoreboard instead of full screen. Plays once each time it comes on. ' +
  '<b>Sound:</b> each style has its own effects (orbit a swirl, parade footsteps, tiles clicks and clacks, spotlight a light\'s clunk for each team and the lights swelling up, court the umpire\'s whistle, catches and passes and the net\'s swish, blueprint a grid hum, lasers and zaps), with a boom as the competition logo lands, a lift as the words come in and a whoosh as it leaves. ' +
  '<code>?sfx=40</code> sets their volume in % (80 without it), <code>?sfx=0</code> turns them off. <code>?theme=</code> plays a song or sound from the media folder with it, at <code>?volume=</code>% (100). ' +
  '<code>?themefit=</code> lines the theme up: <b>start</b> (the default) starts it with the animation, <b>logo</b> ends it as the competition logo lands (good for a short stinger), <b>end</b> ends it as the animation finishes, and <b>stretch</b> plays the animation up to 25% faster or slower so it lasts as long as the theme. ' +
  'On the Output page the source\'s options say how long the theme and the animation are, and warn when they are more than 25% apart. Music playing on the Output page fades out while an intro or outro with a theme is on. ' +
  'The sound plays where Studio\'s sound goes (not in these previews); as a page on its own, like an OBS browser source, it plays itself (<code>?sound=0</code> keeps it quiet).';
[['Intro', '/introoutro.html', INTRO_HELP], ['Outro', '/introoutro.html?type=outro'],
 ...['parade', 'tiles', 'spotlight', 'court', 'blueprint'].map(st => [`Intro: ${st}`, `/introoutro.html?style=${st}`])]
  .forEach(([n, p, h]) => add('introPages', n, p, h));
[['Athlete lower third', '/lowerthird.html?name=Jane%20Smith',
  'For the breaks and before and after the game, when the stream cuts to someone on camera. An athlete\'s name in big letters, their team name under it and their club\'s logo beside it. ' +
  'The athlete is found by name among the competition\'s athletes (everyone in the PlayHQ line ups read so far, the same list as <b>All athletes</b> on the <a href="/athletes.html" target="_blank">Athletes page</a>); ' +
  'case, punctuation and word order don\'t matter. That gives their team, and the team\'s logo comes from its club on the competition setup page. On the Output page the <b>Name</b> box suggests the athletes as you type: only the active competition\'s, from divisions in its current PlayHQ season. ' +
  'Pick a <b>Team</b> to narrow them to one team, or tick <b>Only athletes in the picked game</b> for the two teams in the game on the scoreboard. ' +
  'An athlete who plays for more than one team shows the one in the game picked on the scoreboard, else the first: <code>?team=Knights</code> picks it. ' +
  'The bar is always the same size and every name the same font size: a long name is squeezed narrower to fit (to 70% of its width before its letters get any smaller); ' +
  '<code>?display=Chris%20Montgomery</code> (<b>Name on screen</b>) shows a shorter name, while the athlete is still found by <code>?name=</code>. ' +
  'Options: <code>?title=Captain</code> adds a word after the team name, <code>?tag=Player%20of%20the%20match</code> a small pink tab above the bar, <code>?photo=1</code> their photo (or silhouette) beside the logo. ' +
  'It sits on the left, lined up with the scoreboard and just above it; <code>?position=center</code> centres it, <code>?position=bottom</code> or <code>bottom-center</code> puts it lower for when the scoreboard is off. ' +
  'For two people on screen at once (an interview or the commentary box), add a second source: <code>?position=right</code> mirrors the bar on the right at half width, and <code>?position=left-half</code> is the left one at half width, so the two sit side by side over the scoreboard (<code>bottom-right</code> and <code>bottom-left-half</code> put them lower). ' +
  '<code>?out=8</code> animates it away after 8 seconds. Loads once; it plays in again each time it\'s turned on on the Output page.'],
 ['Guest or commentator lower third', '/lowerthird.html?type=guest&name=Sam%20Lee&title=Commentator',
  'The same bar with a guest\'s or commentator\'s name, their title under it (<code>?title=Special%20guest</code>) and the competition logo from the competition setup page ' +
  '(the dark mode logo for the dark bar; <code>?mode=light</code> uses the light mode one). Takes the same <code>?tag=</code>, <code>?position=</code> and <code>?out=</code> options. ' +
  'Add one source per person to the Output page and change the name and title there. For the commentary team, <b>Commentators: lower thirds</b> below puts up a bar for each person the Production Planner has on the mic, from one link.'],
 ['Commentators: thin line', '/commentators.html?label=Special%20guest%20commentators&name=Honey%20Harrington&name2=Will%20Linter',
  'Names the people on the mic in one thin line: the words in a pink tab, then the names, like <b>SPECIAL GUEST COMMENTATORS</b> Honey Harrington and Will Linter. ' +
  '<code>?name=</code>, <code>?name2=</code>, <code>?name3=</code> and <code>?name4=</code> are the people (joined with commas and a yellow "and"). With no names it shows whoever the <a href="/planner.html" target="_blank">Production Planner</a> has on the mic for the game on the scoreboard. <code>?label=</code> is the tab (Commentators without it, Commentator for one name, Special guest commentators when everyone planned is a guest, <code>?label=0</code> leaves it off). ' +
  'It sits on the left, lined up with the scoreboard and just above it, like the person lower third; <code>?position=center</code> centres it, and <code>?position=bottom</code> or <code>bottom-center</code> puts it lower for when the scoreboard is off. ' +
  'Many names are squeezed narrower to fit the scoreboard\'s width before they get smaller. <code>?out=8</code> animates it away after 8 seconds. Loads once; it plays in again each time it\'s turned on.'],
 ['Commentators: box', '/commentators.html?style=box&label=Special%20guest%20commentators&name=Honey%20Harrington&name2=Will%20Linter',
  'The same names as an upper third (<code>?style=box</code>): a box with the pink tab across its top and each name on a line of its own, in the top right corner beside the competition logo and lined up with it. ' +
  '<code>?position=under-left</code> and <code>under-right</code> put it just under the title banner and the logos, lined up with the scoreboard\'s left or right edge, and <code>?position=center</code> centres it there; away from the corner the box shows the competition logo itself. ' +
  '<code>?logo=1</code> always shows it and <code>?logo=0</code> never does; <code>?mode=light</code> uses the light mode one. Takes the same names, <code>?label=</code> and <code>?out=</code>.'],
 ['Commentators: lower thirds', '/commentators.html?style=lowerthirds&photo=1',
  'A person lower third for each commentator (<code>?style=lowerthirds</code>), in the same bar as the guest lower third, side by side across the scoreboard\'s width: one person gets the full bar on the left, two sit left and right (the right one mirrored), and three share the width. ' +
  'With no names it shows whoever the <a href="/planner.html" target="_blank">Production Planner</a> has on the mic for the game on the scoreboard, a planned special guest with a <b>Special guest</b> tab; typed names (<code>?name=</code> to <code>?name3=</code>) are used instead. ' +
  '<code>?title=</code> is the yellow line under each name (Commentator without it, <code>?title=0</code> leaves it off), and <code>?label=</code> puts the same tab over every bar (<code>?label=0</code> none). ' +
  '<code>?photo=1</code> shows each commentator\'s headshot from the Production Planner in place of the competition logo; anyone without one keeps the logo. ' +
  'They sit low, for when the scoreboard is off; <code>?position=above</code> puts them just above it. <code>?mode=light</code> uses the light mode logo, <code>?out=8</code> animates them away after 8 seconds. Loads once; it plays in again each time it\'s turned on.']]
  .forEach(([n, p, h]) => add('personPages', n, p, h));
[['PIVT and FirstPass Studio ad', '/ad.html',
  'The PIVT and FirstPass Studio logos animated together for 10 seconds: PIVT slams in, FirstPass Studio wipes in below it, they hold, then sweep away. ' +
  'Plays once when the page loads, then leaves the frame clear, and plays again each time it\'s turned on on the Output page. ' +
  'It is a light web page, not a video, so there is no ProRes file to load. The page is transparent and uses the coloured FirstPass Studio wordmark (<code>?mode=light</code>); ' +
  '<code>?mode=dark</code> uses the white one for a dark picture behind it. Add a background that fades in and out with the ad: <code>?bg=gradient</code> is a dark radial gradient, ' +
  '<code>?bg=0f172a</code> (or a colour name) a radial gradient from that colour to a darker shade (<code>?bg2=</code> sets the edge colour), <code>?bg=solid-0f172a</code> a flat colour, ' +
  'and <code>?bgimage=court.jpg</code> a picture from the competition\'s brand folder (or a full link); with a background the white wordmark is used unless you add <code>?mode=light</code>. ' +
  '<code>?tagline=Live%20netball%20every%20Thursday</code> adds a line of text under the logos, and <code>?out=0</code> keeps the logos on screen at the end. ' +
  'A soft glow sits behind the logos only when there is a background; <code>?glow=1</code> adds it on the transparent page (it shows as an oval over key and fill), <code>?glow=0</code> removes it. ' +
  'Combine them with &amp;, e.g. <code>/ad.html?bg=gradient&amp;tagline=Live%20netball</code>.']]
  .forEach(([n, p, h]) => add('adPages', n, p, h));
[['Test pattern', '/testpattern.html',
  'Not for air: a 1920 × 1080 pattern on a see-through background for checking the Output page\'s outputs and the switcher\'s key end to end. ' +
  'A 1-pixel border and 1, 2 and 4-pixel lines stay crisp when nothing is scaling the picture; grey or shimmering lines mean something between Studio and the switcher is resizing it ' +
  '(for a display output, set the display to exactly 1920 × 1080 in System Settings). Solid ramps show banding from the signal path, and the transparency ramps and soft shapes show whether the key follows the transparency ' +
  '(with Pre Multiplied Key on, the ramps fade evenly from nothing to solid). Add it as a source on the Output page and put it on the key.']]
  .forEach(([n, p, h]) => add('testPages', n, p, h));

const FINALS_ABOUT = 'Who plays who in the division\'s finals, week by week, in the format set for that division on Competitions setup, with the teams from the ladder. Until the home and away games are ' +
  'finished it says <b>If the season ended today</b>. Each game shows the teams\' ladder positions, logos and scores; the winner lights up and ' +
  'moves on to the next game, and the champions show under it once the grand final is decided. ' +
  'PlayHQ\'s finals games (rounds with "final" or "play-off" in their name) are used when it has them, with their day, time, court and score. ' +
  'PlayHQ often has no finals fixtures, so pick each winner (and the score, if you like) in <b>Finals</b> on Scoreboard control; a PlayHQ result always wins over one picked there. ' +
  'The ladder marks the same finals places: double chance or a week off in the highlight colour, elimination finals in the accent colour, ' +
  'playing for third in the small print colour, with a line under the last finals place and a key under the ladder (<code>?key=0</code> leaves it off). ' +
  'Loads once. Options: <code>?week=2</code> shows one week only, <code>?title=Grand%20Final%20day</code> changes the heading, ' +
  '<code>?seeds=0</code> leaves off the ladder positions, <code>?sub=Double%20chance%20for%20the%20top%202</code> changes the line under the heading (it says <b>Top 4 finals</b> and so on; <code>?sub=0</code> leaves it off), <code>?projected=0</code> leaves off "If the season ended today", ' +
  '<code>?logo=0</code> leaves off the competition logo (<code>?mode=light</code> uses the light mode one), and without <code>?division=</code> ' +
  'it shows the division of the game picked on Scoreboard control.';

  const GROUPS = [
    { id: 'scoreboard', title: 'Live scoreboard' },
    { id: 'scene', title: 'The scene' },
    { id: 'gamePages', title: 'Game graphics (for the game picked on the scoreboard)', about: 'The cards (match up, team lists, fixtures, ladders and the rest) sit in the space between the title at the top and the scoreboard at the bottom, with room around them. ' +
      'A card with more in it than fits (a long team list, a big ladder) is shrunk to fit. The animations (The Clash, winner and the logo animations) play in that space too. The super shot is smaller, centred just under the title. The ladder lower third sits right above the scoreboard, the same width as it.' },
    { id: 'ladders', title: 'Ladders (one per division)', perDivision: { name: 'Ladder', link: '/ladder.html?division=' } },
    { id: 'personPages', title: 'Lower thirds (introducing an athlete, a guest or the commentators)' },
    { id: 'fixturePages', title: 'Round fixture and results (current round, all divisions)' },
    { id: 'logoPages', title: 'Competition logo animations (17 templates, about 5 seconds each)' },
    { id: 'introPages', title: 'Intro and outro (six styles, full screen, about 8 seconds)' },
    { id: 'stingerPages', title: 'Stinger (a transition in the competition\'s colours, 1.5 seconds)' },
    { id: 'adPages', title: 'PIVT and FirstPass Studio ad (10 seconds, for the breaks)' },
    { id: 'testPages', title: 'Test pattern (checking the video outputs)' },
    { id: 'finalsPages', title: 'Finals (one per division)', perDivision: { name: 'Finals', link: '/finals.html?division=' }, about: FINALS_ABOUT },
    { id: 'shooterPages', title: 'Top shooters (season, one per division)', perDivision: { name: 'Top shooters', link: '/topshooters.html?division=' } },
  ];
  const api = { GROUPS, LINKS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.GRAPHIC_LINKS = api;
})();
