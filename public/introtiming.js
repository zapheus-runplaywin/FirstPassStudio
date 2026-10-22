// FirstPass Studio - how long each intro and outro style (introoutro.html) runs, in seconds at speed 1, for n teams.
// The page times its animations from these, and the Output page uses them to compare a theme's length with the
// animation's, so the two never disagree.
//   introTiming(style, n)        { ct, wt }: when the competition logo lands (the big moment) and when the words come in
//   introLength(style, n, hold, out)  the whole animation: in, held for hold seconds, then out (0.8 s) unless out is false
/* exported introTiming, introLength, INTRO_OUT_SEC */
const INTRO_OUT_SEC = 0.8; // the content-out animation
function introTiming(style, teams) {
  const n = Math.max(teams || 0, 1);
  switch (style) {
    case 'parade': { const done = n * Math.min(.14, 1.6 / n) + .6; return { ct: done, wt: done + .5 }; }
    case 'tiles': return { ct: 1.3 + 10 * .08 + .8, wt: 1.3 + 10 * .08 + 1.1 }; // a 7 x 3 wall whatever the teams
    case 'spotlight': { const tour = .5 + n * Math.max(.22, Math.min(.42, 3.2 / n)); return { ct: tour + .15, wt: tour + .7 }; }
    case 'court': {
      const catches = n >= 7 ? n : n * 2, per = Math.max(.42, Math.min(.62, 4.6 / catches));
      const ct = 1.7 + (catches - 1) * per + .26 + .6 + .25;
      return { ct, wt: ct + .6 };
    }
    case 'blueprint': { const ct = .35 + n * Math.min(.12, 1 / n) + .9 + .9 + .55 + .85; return { ct, wt: ct + .7 }; }
    default: return { ct: 1.1, wt: 1.9 + n * .04 }; // orbit
  }
}
// The words are all in about a second after they start; then it holds, then animates away.
function introLength(style, teams, hold = 5, out = true) {
  const { wt } = introTiming(style, teams);
  return out ? wt + 1 + hold + INTRO_OUT_SEC : wt + 1;
}
