// FirstPass Studio - the one list of the graphics pages.
//
// Every graphic (the pages that go on air, not the Studio pages you work in) is listed here once, in the
// order the Output page's Add a page offers them: the link, the name, the section of the Docs page that
// describes it, and the example pictures the Make Examples script takes of it. The Output page and
// examples.js read this list; a test checks that every graphic in public/ is here, that every page with
// link options (pageoptions.js) is here, and that the Docs page describes every page here. Add a new
// graphic here first, then write it up on the Docs page and give it its options in pageoptions.js.
//
// Each page: { file, name, docs, examples? }
//   file      its link, like 'ladder.html' (results.html is the fixture page's alias for finished games)
//   name      what the Output page calls it
//   docs      the id of the list on the Docs page (graphics.html) it is described in
//   examples  [[caption, link, milliseconds to wait before the picture], ...] for examples.js
(function () {
  'use strict';
  const STUDIO_GRAPHICS = [
    { file: 'scoreboard.html', name: 'Scoreboard', docs: 'sbUrl', examples: [['Live scoreboard', '/scoreboard.html', 4000]] },
    { file: 'ticker.html', name: 'Score ticker', docs: 'gamePages', examples: [['Score ticker', '/ticker.html', 4000]] },
    { file: 'title.html', name: 'Title', docs: 'gamePages', examples: [['Title banner', '/title.html', 3000]] },
    { file: 'branding.html', name: 'Branding logos', docs: 'gamePages', examples: [['Logos beside the title', '/branding.html', 3000]] },
    { file: 'upnext.html', name: 'Up next', docs: 'gamePages', examples: [['Up next', '/upnext.html', 3000], ['Up next: end of night', '/upnext.html?wrap=1', 4500]] },
    { file: 'countdown.html', name: 'Countdown', docs: 'gamePages', examples: [['Countdown to the start of the game', '/countdown.html', 3000]] },
    { file: 'matchup.html', name: 'Match up', docs: 'gamePages', examples: [['Match up', '/matchup.html', 3000]] },
    { file: 'clash.html', name: 'The Clash', docs: 'gamePages', examples: [['The Clash (end of animation)', '/clash.html', 6000]] },
    { file: 'positions.html', name: 'Position match ups', docs: 'gamePages', examples: [['Position match up: GS v GK', '/positions.html?pair=GS', 3000], ['Position match ups: all seven', '/positions.html?show=all', 3000]] },
    { file: 'teamlist.html', name: 'Team list', docs: 'gamePages', examples: [['Home team list', '/teamlist.html?side=home', 3000], ['Away team list', '/teamlist.html?side=away', 3000]] },
    { file: 'shooting.html', name: 'Shooting stats', docs: 'gamePages', examples: [['Shooting stats', '/shooting.html', 3000]] },
    { file: 'goals.html', name: 'Last 10 goals', docs: 'gamePages', examples: [['Last 10 goals', '/goals.html', 3000], ['Last 10 goals: vertical', '/goals.html?layout=vertical', 3000]] },
    { file: 'fulltime.html', name: 'Full time', docs: 'gamePages', examples: [['Full time card', '/fulltime.html', 3000]] },
    { file: 'gamestats.html', name: 'Game stats', docs: 'gamePages', examples: [['Game stats', '/gamestats.html', 3000]] },
    { file: 'commentator.html', name: 'Commentator stats (full screen)', docs: 'gamePages', examples: [['Commentator stats', '/commentator.html', 3500]] },
    { file: 'worm.html', name: 'Score worm', docs: 'gamePages', examples: [['Score worm', '/worm.html?draw=0', 3000]] },
    { file: 'winner.html', name: 'Winner', docs: 'gamePages', examples: [['Winner celebration: home (end of animation)', '/winner.html?winner=home', 5000], ['Winner celebration: away (end of animation)', '/winner.html?winner=away', 5000], ['Winner celebration: draw (end of animation)', '/winner.html?winner=draw', 5000]] },
    { file: 'supershot.html', name: 'Super shot', docs: 'gamePages', examples: [['Super shot: home (mid animation)', '/supershot.html?team=home', 1500]] },
    { file: 'streak.html', name: 'Hot streaks and moments', docs: 'gamePages', examples: [
      ['Heating up: home (mid animation)', '/streak.html?play=heating&team=home', 2200], ['On fire: home (mid animation)', '/streak.html?play=fire&team=home', 1800],
      ['Goal for goal (mid animation)', '/streak.html?play=goalforgoal', 2200], ['Hits the front: home (mid animation)', '/streak.html?play=lead&team=home', 2200],
      ['All square (mid animation)', '/streak.html?play=level', 2200], ['Coming back: away (mid animation)', '/streak.html?play=comeback&team=away', 2200],
      ['On the siren: home (mid animation)', '/streak.html?play=siren&team=home', 2200], ['Back to back super shots: home (mid animation)', '/streak.html?play=backtoback&team=home', 2400]] },
    { file: 'ladder.html', name: 'Ladder', docs: 'list' }, // one example per division, taken by examples.js
    { file: 'ladderbar.html', name: 'Ladder lower third', docs: 'gamePages', examples: [['Ladder lower third', '/ladderbar.html', 3000]] },
    { file: 'lowerthird.html', name: 'Person lower third (athlete or guest)', docs: 'personPages', examples: [['Guest lower third', '/lowerthird.html?type=guest&name=Sam%20Lee&title=Commentator', 2500]] },
    { file: 'commentators.html', name: 'Commentators', docs: 'personPages', examples: [
      ['Commentators: thin line', '/commentators.html?label=Special%20guest%20commentators&name=Honey%20Harrington&name2=Will%20Linter', 2000],
      ['Commentators: box', '/commentators.html?style=box&label=Special%20guest%20commentators&name=Honey%20Harrington&name2=Will%20Linter', 2000]] },
    { file: 'roster.html', name: 'Commentary roster (full screen)', docs: 'personPages', examples: [['Commentary roster', '/roster.html', 2500]] },
    { file: 'finals.html', name: 'Finals', docs: 'finalsPages' }, // one example per division
    { file: 'fixtures.html', name: 'Round fixture', docs: 'fixturePages', examples: [['Round fixture', '/fixtures.html', 3000], ['Next round fixture', '/fixtures.html?round=next', 3000]] },
    { file: 'results.html', name: 'Results', docs: 'fixturePages', examples: [['Round results', '/results.html', 3000]] },
    { file: 'topshooters.html', name: 'Top shooters', docs: 'shooterPages' }, // one example per division
    { file: 'logo.html', name: 'Competition logo animation', docs: 'logoPages', examples: [['Logo animation: fun (mid animation)', '/logo.html?template=fun', 2200], ['Logo animation: pro (mid animation)', '/logo.html?template=pro', 2600],
      ...['coin', 'tiles', 'slices', 'glitch', 'badge', 'doors', 'bounce', 'lightning', 'rings', 'title', 'goal', 'court', 'bibs', 'pass', 'net'].map(t => [`Logo animation: ${t} (mid animation)`, `/logo.html?template=${t}`, 2600])] },
    { file: 'introoutro.html', name: 'Intro and outro', docs: 'introPages', examples: [
      ...['orbit', 'parade', 'tiles', 'spotlight', 'court', 'blueprint'].map(st => [`Intro: ${st}`, `/introoutro.html?style=${st}&out=0&bg=gradient`, 8000]),
      ['Outro', '/introoutro.html?type=outro&out=0&bg=gradient', 8000]] },
    { file: 'stinger.html', name: 'Stinger (transition)', docs: 'stingerPages', examples: [['Stinger (mid transition)', '/stinger.html?sfx=0', 1200]] },
    { file: 'ad.html', name: 'PIVT and FirstPass Studio ad', docs: 'adPages', examples: [['PIVT and FirstPass Studio ad (mid animation)', '/ad.html', 6000]] },
    { file: 'sponsor.html', name: 'Sponsor card', docs: 'gamePages', examples: [['Sponsor card', '/sponsor.html', 2500]] },
    { file: 'sponsorwall.html', name: 'Sponsor wall', docs: 'gamePages', examples: [['Sponsor wall', '/sponsorwall.html', 2500]] },
    { file: 'viewers.html', name: 'Viewers', docs: 'gamePages', examples: [['Viewers', '/viewers.html', 2500], ['Viewers peak', '/viewers.html?show=peak', 2500]] },
    { file: 'testpattern.html', name: 'Test pattern (checking the outputs)', docs: 'testPages' },
  ];
  if (typeof module !== 'undefined' && module.exports) module.exports = { STUDIO_GRAPHICS };
  else window.STUDIO_GRAPHICS = STUDIO_GRAPHICS;
})();
