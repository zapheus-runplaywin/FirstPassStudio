// Used by positions.html (and test/lineupwait.test.js): what the position match ups show while
// neither team has a line up with positions. PlayHQ only has line ups once a game is being
// scored, so before live scoring starts the page says so instead of staying blank.
// Returns null once either team has a line up, else { title, detail }.
(function (root) {
  // Players added from the season squad (the line up was incomplete) have no position.
  const lineup = team => ((team && team.players) || []).filter(p => !p.fromSquad);

  function lineupWait(data) {
    if (!data) return { title: 'Waiting for PlayHQ', detail: 'The match ups show once the game\'s line ups are read.' };
    if (lineup(data.home).length || lineup(data.away).length) return null;
    if (/no playhq game picked/i.test(data.error || '')) return { title: 'No game picked', detail: 'Pick the PlayHQ game on Scoreboard control.' };
    if (data.scoring === 'live') return { title: 'No line ups yet', detail: 'Live scoring has started, but no line ups are entered on PlayHQ yet. The match ups show as soon as they are.' };
    if (data.scoring === 'finished') return { title: 'No line ups', detail: 'PlayHQ has no line ups for this game.' };
    return { title: 'Live scoring is not active for this game', detail: 'The match ups show once live scoring starts on PlayHQ.' };
  }

  if (typeof module === 'object' && module.exports) module.exports = { lineupWait };
  else root.lineupWait = lineupWait;
})(this);
