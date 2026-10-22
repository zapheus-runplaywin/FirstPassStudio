// FirstPass Studio - the words for the end of a night of streaming, from the wrap /api/upnext and /api/introoutro give
// (server.js endOfNight): Up next's end of night card and the outro use the same ones.
//   wrapWords(wrap) -> { title, invite, detail }
//     title   That's the last game of the night (or of the season)
//     invite  Join us again next week / tomorrow / on Saturday / on Saturday 7 November, Grand Final next week,
//             Finals are next, Thanks for a great season, or Congratulations to all our champions after a final
//     detail  the next round and its date, or the season
/* exported wrapWords, wrapDay */
const wrapDay = (() => {
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  // A date (YYYY-MM-DD) as a weekday, or with withDate as "Thursday 29 October".
  return (date, withDate) => {
    const d = new Date(`${date}T12:00:00Z`);
    return Number.isNaN(d.getTime()) ? '' : withDate ? `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` : DAYS[d.getUTCDay()];
  };
})();
function wrapWords(w) {
  // When to come back, in words: next week, tomorrow, on Saturday, or on Saturday 7 November.
  const when = next => {
    if (next.days === 7) return 'next week';
    if (next.days === 1) return 'tomorrow';
    if (next.days > 1 && next.days < 7) return `on ${wrapDay(next.date)}`;
    return next.date ? `on ${wrapDay(next.date, true)}` : 'next round';
  };
  const title = w.seasonOver ? 'That\'s the last game of the season' : 'That\'s the last game of the night';
  if (w.next) return { title, invite: w.next.finals ? `${w.next.round} ${when(w.next)}` : `Join us again ${when(w.next)}`,
    detail: [!w.next.finals && w.next.round, w.next.date && wrapDay(w.next.date, true)].filter(Boolean).join('  ·  ') };
  if (w.finalsNext) return { title, invite: 'Finals are next', detail: 'See you there' };
  return { title, invite: w.finalRound ? 'Congratulations to all our champions' : 'Thanks for a great season',
    detail: [w.season, 'See you next season'].filter(Boolean).join('  ·  ') };
}
