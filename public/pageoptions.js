// FirstPass Studio - the options each graphics page takes in its link (?position=top and so on), so the Output
// page can offer them as fields instead of sending people to the Docs page to read them. The Docs page
// describes the same options in words: keep the two in step when a page gets a new one.
//
// Each option: { key, label, type: 'select' | 'text' | 'number', ... }. A select's first choice is the
// page's default, with value '' (left out of the link). text and number boxes left empty are left out too.
// picks: [[value, button text], ...] adds quick pick buttons under a text box.
// list: 'athletes' suggests the active competition's athletes (from the Athletes page) as you type in a text box;
// with gameOnly a tick box under it narrows them to the two teams in the picked game. list: 'teams' on a select
// adds the teams those athletes play for as choices, and narrows the athlete suggestions to the one picked.
// list: 'audio' on a select adds the songs in the media folder as choices. lengthCheck (the intro and outro's theme
// timing) shows under it how the theme's length compares with the animation's. chroma: what happens to the option
// while the chroma output is chroma key safe (chroma.js), shown under it then; the option itself is kept.

/* exported PAGE_OPTIONS */
const PAGE_OPTIONS = (() => {
  const show = (key, label, hideLabel = 'Hide') => ({ key, label, type: 'select', choices: [['', 'Show'], ['0', hideLabel]] });
  const division = { key: 'division', label: 'Division', type: 'text', placeholder: 'the picked game\'s division', help: 'A division number, like 1.' };
  const round = { key: 'round', label: 'Round', type: 'text', placeholder: 'this round', help: 'next, prev, +2, -1, a round number like 6, or a name like Final.' };
  const mode = (dflt = 'light') => ({ key: 'mode', label: 'Logo', type: 'select', choices: dflt === 'light'
    ? [['', 'Light mode logo (for a light picture behind)'], ['dark', 'Dark mode logo (for a dark picture behind)']]
    : [['', 'Dark mode logo (default)'], ['light', 'Light mode logo']] });
  const out = (stays = 'Stays on screen') => ({ key: 'out', label: 'Animate away after', type: 'number', min: 0, max: 600, unit: 's', placeholder: stays.toLowerCase() });
  const title = placeholder => ({ key: 'title', label: 'Heading', type: 'text', placeholder });
  const background = [
    { key: 'bg', label: 'Background', type: 'text', placeholder: 'none (see-through)', help: 'gradient, a colour like 7f4092 (a gradient from it), or solid-7f4092 for a flat colour.' },
    { key: 'bg2', label: 'Background edge', type: 'text', placeholder: 'a darker shade', help: 'The gradient\'s edge colour, like 1e293b.' },
    { key: 'bgimage', label: 'Background picture', type: 'text', placeholder: 'none', help: 'A file in the competition\'s brand folder, like court.jpg, or a full link.' },
  ];
  // A sponsor spot (sponsorspot.js): the competition's sponsor by default, 0 for none, or a sponsor's name.
  const spot = (placeholder, picks = [['', 'From the Sponsors page'], ['0', 'None']]) => ({ key: 'sponsor', label: 'Sponsor', type: 'text', placeholder, picks,
    help: 'A sponsor\'s name as on the Sponsors page to always show that one, or 0 for no sponsor.' });
  const LOGO_TEMPLATES = ['fun', 'pro', 'coin', 'tiles', 'slices', 'glitch', 'badge', 'doors', 'bounce', 'lightning', 'rings', 'title', 'goal', 'court', 'bibs', 'pass', 'net'];

  return {
    'scoreboard.html': [
      { key: 'position', label: 'Position', type: 'select', choices: [['', 'Bottom centre, above the ticker'], ['bottom-center', 'Bottom centre (no gap for the ticker)'], ['top-center', 'Top centre'], ['top-left', 'Top left'], ['bottom-left', 'Bottom left']] },
      { key: 'supershot', label: 'Super shot tab', type: 'select', choices: [['', 'On, in the super shot minutes'], ['0', 'Off']],
        help: 'A small "Super shot" tab above the clock in the last minutes of each quarter (3 unless the competition setup says otherwise), for divisions with super shots.' },
      spot('naming rights sponsor, in a tab over the home team'),
    ],
    'ticker.html': [
      { key: 'speed', label: 'Speed', type: 'number', min: 20, max: 600, unit: 'px a second', placeholder: 'from the control page' },
      { key: 'refresh', label: 'Update scores every', type: 'number', min: 0, max: 3600, unit: 's', placeholder: '30', help: '0 loads them once.' },
      spot('next sponsor in rotation, Partner and up, first in the line'),
    ],
    'title.html': [
      { key: 'emoji', label: 'Emoji either side', type: 'text', placeholder: 'None',
        picks: [...['🔥', '⚡', '🌩️', '🏆', '⭐', '👑', '💥', '🏐', '💜'].map(e => [e, e]), ['', 'None']],
        help: 'Type or paste any emoji, pick one here, or open your computer\'s emoji picker in the box (Mac: Control + Command + Space, Windows: Windows key + full stop). Leave it empty for none.' },
      { key: 'logo', label: 'Competition logo', type: 'select', choices: [['', 'Off'], ['show', 'Above the banner']] },
      { key: 'position', label: 'Position', type: 'select', choices: [['', 'Top'], ['bottom', 'Bottom']] },
      mode(),
      spot('naming rights sponsor, under the banner'),
    ],
    'branding.html': [
      show('pivt', 'PIVT logo'), show('studio', 'FirstPass Studio logo'), show('comp', 'Competition logo'),
      { key: 'gap', label: 'Gap from centre', type: 'number', min: 0, max: 960, unit: 'px', placeholder: 'default' },
      { key: 'top', label: 'Height from top', type: 'number', min: 0, max: 1080, unit: 'px', placeholder: 'default' },
      { key: 'size', label: 'Size', type: 'number', min: 0.2, max: 5, step: 0.1, unit: '×', placeholder: '1' },
      mode(),
    ],
    'countdown.html': [
      { key: 'label', label: 'Heading', type: 'text', placeholder: 'default' },
      { key: 'end', label: 'Words at zero', type: 'text', placeholder: 'STARTING SOON', help: 'Keep them short. hide fades the card away instead.' },
      { key: 'fade', label: 'Fade out over the last', type: 'number', min: 2, max: 60, unit: 's', placeholder: 'no fade',
        chroma: 'no fade: the card goes at zero instead.' },
      show('teams', 'Teams', 'Clock only'),
      { key: 'position', label: 'Position', type: 'select', choices: [['', 'Middle'], ['top', 'Top'], ['bottom', 'Bottom']] },
      spot('naming rights sponsor, under the clock'),
    ],
    'matchup.html': [show('form', 'Form'), show('h2h', 'Head to head')],
    'upnext.html': [
      { key: 'wrap', label: 'End of night card', type: 'select', choices: [['', 'After the last game of the night'], ['1', 'Show it now'], ['0', 'Never']] },
      { key: 'message', label: 'Invite line', type: 'text', placeholder: 'Join us again next week', help: 'Replaces the line saying when to join again.' },
      mode(),
      { key: 'sponsors', label: 'Sponsors on the end of night card', type: 'select', choices: [['', 'Major and up'], ['all', 'Every tier'], ['0', 'None']] },
    ],
    'clash.html': [
      out(),
      { key: 'word', label: 'Big word', type: 'text', placeholder: 'CLASH' },
      { key: 'title', label: 'Bottom line', type: 'text', placeholder: 'default' },
    ],
    'positions.html': [
      { key: 'hold', label: 'Each pairing for', type: 'number', min: 1, max: 60, unit: 's', placeholder: '5' },
      { key: 'loop', label: 'When done', type: 'select', choices: [['', 'Stop'], ['1', 'Keep going round']] },
      { key: 'end', label: 'At the end', type: 'select', choices: [['', 'All seven stay on'], ['out', 'Animate away']] },
      { key: 'show', label: 'Start with', type: 'select', choices: [['', 'One pairing at a time'], ['all', 'All seven at once']] },
      { key: 'pair', label: 'Pairing', type: 'select', choices: [['', 'All of them'], ...['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK'].map(p => [p, `${p} only`])] },
      show('games', 'Games played'),
      show('waiting', 'Message before live scoring'),
    ],
    'teamlist.html': [{ key: 'side', label: 'Team', type: 'select', choices: [['', 'Home'], ['away', 'Away']] }],
    'shooting.html': [title('default'), spot('next sponsor in rotation, Major and up, in the footer')],
    'goals.html': [
      { key: 'layout', label: 'Layout', type: 'select', choices: [['', 'Horizontal (above the scoreboard)'], ['vertical', 'Vertical']] },
      { key: 'count', label: 'Goals', type: 'number', min: 3, max: 30, placeholder: '10' },
      show('times', 'Quarter and time'),
      { key: 'position', label: 'Position', type: 'select', choices: [['', 'Default'], ['top', 'Top (horizontal)'], ['middle', 'Middle (horizontal)'], ['bottom', 'Bottom (horizontal)'], ['left', 'Left (vertical)'], ['right', 'Right (vertical)']] },
      title('Last 10 goals'),
    ],
    'fulltime.html': [title('default')],
    'gamestats.html': [
      title('Game stats'),
      show('quarters', 'Score by quarter'), show('won', 'Quarters won'), show('best', 'Best quarter'), show('supershots', 'Super shots made'),
      show('runs3', '3 goal runs'), show('runs5', '5 goal runs'), show('longest', 'Longest run'),
      spot('next sponsor in rotation, Major and up, in the footer'),
    ],
    'sponsor.html': [
      { key: 'sponsor', label: 'Sponsor', type: 'text', placeholder: 'the next one in rotation', help: 'A sponsor\'s name as on the Sponsors page, to always show that one.' },
      { key: 'tiers', label: 'Tiers in rotation', type: 'select', choices: [['', 'Major and up'], ['naming,elite', 'Elite and up'], ['naming', 'Naming rights only'], ['naming,elite,major,partner,supporter', 'Every tier']] },
      title('Brought to you by'),
      show('offer', 'Offer'), show('tagline', 'Tagline'), show('qr', 'QR code'),
      out(),
    ],
    'viewers.html': [
      { key: 'show', label: 'Shows', type: 'select', choices: [['', 'Watching now, live (top right)'], ['peak', "Tonight's peak, as a card"]] },
      { key: 'min', label: 'Only from', type: 'text', placeholder: 'the setup page minimum', help: 'Hidden below this many watching (the Competitions setup page sets the usual minimum).' },
      title("Tonight's peak"),
      out(),
    ],
    'sponsorwall.html': [
      title('Proudly supported by'),
      { key: 'tiers', label: 'Tiers', type: 'select', choices: [['', 'Every tier'], ['naming,elite,major', 'Major and up'], ['naming,elite,major,partner', 'Partner and up']] },
      { key: 'names', label: 'Sponsor names', type: 'select', choices: [['', 'Logos only'], ['1', 'Under each logo']] },
      show('tiernames', 'Tier names'),
      out(),
    ],
    'worm.html': [
      title('Score worm'),
      { key: 'draw', label: 'Draw the line in', type: 'number', min: 0, max: 15, placeholder: '3 seconds (0 shows it straight away)' },
      show('leads', 'Biggest leads and lead changes'),
      show('supershot', 'Super shot periods (super shot divisions)'),
      { key: 'colours', label: 'Colours', type: 'select', choices: [['', 'Club colours'], ['0', 'Competition colours']] },
    ],
    'winner.html': [
      { key: 'winner', label: 'Result', type: 'select', choices: [['', 'From the score'], ['home', 'Home wins'], ['away', 'Away wins'], ['draw', 'Draw']] },
      out(),
      { key: 'word', label: 'Big word', type: 'text', placeholder: 'VICTORY' },
      { key: 'title', label: 'Line under the score', type: 'text', placeholder: 'default' },
      show('score', 'Score'),
    ],
    'supershot.html': [
      { key: 'team', label: 'Plays', type: 'select', choices: [['', 'By itself for every super shot'], ['home', 'Once, for the home team'], ['away', 'Once, for the away team'], ['none', 'Once, no team']] },
      spot('Brought to you by: from the Sponsors page'),
    ],
    'streak.html': [
      { key: 'play', label: 'Plays', type: 'select', choices: [['', 'By itself for every streak and moment'], ['heating', 'Once: heating up'], ['fire', 'Once: on fire'], ['goalforgoal', 'Once: goal for goal'],
        ['lead', 'Once: hits the front'], ['level', 'Once: all square'], ['comeback', 'Once: coming back'], ['siren', 'Once: on the siren'], ['backtoback', 'Once: back to back super shots']] },
      { key: 'team', label: 'Team (when played once)', type: 'select', choices: [['', 'Home'], ['away', 'Away']] },
      spot('Brought to you by: from the Sponsors page'),
      show('heating', 'Heating up (3 in a row, by itself)', 'Leave out'),
      show('fire', 'On fire (5 in a row, by itself)', 'Leave out'),
      show('goalforgoal', 'Goal for goal (10, by itself)', 'Leave out'),
      show('lead', 'Hits the front (by itself)', 'Leave out'),
      show('level', 'All square, last 2 minutes (by itself)', 'Leave out'),
      show('comeback', 'Coming back (by itself)', 'Leave out'),
      show('siren', 'On the siren (by itself)', 'Leave out'),
      show('backtoback', 'Back to back super shots (by itself)', 'Leave out'),
    ],
    'lowerthird.html': [
      { key: 'type', label: 'Who', type: 'select', choices: [['', 'An athlete (team and club logo)'], ['guest', 'A guest or commentator (competition logo)']] },
      { key: 'team', label: 'Team', type: 'select', choices: [['', 'Any team']], list: 'teams',
        help: 'Narrows the names suggested below to one team, and shows that team for an athlete who plays for more than one.' },
      { key: 'name', label: 'Name', type: 'text', placeholder: 'type or pick a name', list: 'athletes', gameOnly: true,
        help: 'An athlete\'s name as PlayHQ has it (suggestions are this competition\'s athletes from the Athletes page); for a guest, any name.' },
      { key: 'display', label: 'Name on screen', type: 'text', placeholder: 'the name above',
        help: 'A shorter name to show, like Chris Montgomery. Long names are squeezed narrower to fit, keeping the same size; use this when one is squeezed too far.' },
      { key: 'title', label: 'Smaller line', type: 'text', placeholder: 'the athlete\'s team, or nothing for a guest',
        picks: [['Commentator', 'Commentator'], ['Special guest', 'Special guest'], ['Coach', 'Coach'], ['Captain', 'Captain'], ['Umpire', 'Umpire']],
        help: 'A guest\'s title. For an athlete it goes after their team name, like Captain.' },
      { key: 'tag', label: 'Tab above', type: 'text', placeholder: 'none', picks: [['Player of the match', 'Player of the match'], ['On the mic', 'On the mic'], ['Special guest', 'Special guest'], ['', 'None']] },
      { key: 'photo', label: 'Athlete photo', type: 'select', choices: [['', 'Off'], ['1', 'Beside the logo']] },
      { key: 'position', label: 'Position', type: 'select', choices: [['', 'Left, just above the scoreboard'], ['center', 'Centre, just above the scoreboard'], ['bottom', 'Left, at the bottom (scoreboard off)'], ['bottom-center', 'Centre, at the bottom (scoreboard off)'], ['right', 'Right, half width (two people on screen)'], ['left-half', 'Left, half width (two people on screen)'],
          ['bottom-right', 'Right, half width, at the bottom (scoreboard off)'], ['bottom-left-half', 'Left, half width, at the bottom (scoreboard off)']],
        help: 'For two people on screen at once, add a second lower third source: put one on Right and the other on Left, half width, so they don\'t overlap.' },
      mode('dark'),
      out(),
    ],
    'ladder.html': [
      division,
      { key: 'rows', label: 'Rows', type: 'number', min: 1, max: 40, placeholder: 'all' },
      show('key', 'Finals key'),
      show('logo', 'Competition logo'),
      mode('dark'),
      { key: 'refresh', label: 'Reload every', type: 'number', min: 0, max: 3600, unit: 's', placeholder: 'load once' },
    ],
    'finals.html': [
      division,
      { key: 'week', label: 'Week', type: 'number', min: 1, max: 10, placeholder: 'all weeks' },
      title('Finals'),
      { key: 'sub', label: 'Line under the heading', type: 'text', placeholder: 'Top 4 finals…', help: '0 leaves it off.' },
      show('seeds', 'Ladder positions'),
      show('projected', '"If the season ended today"'),
      show('logo', 'Competition logo'),
      mode('dark'),
    ],
    'fixtures.html': [round, division],
    'results.html': [round, division],
    'topshooters.html': [
      division,
      { key: 'sort', label: 'Order by', type: 'select', choices: [['', 'Points (goals + 2 per super shot)'], ['goals', 'Goals'], ['super', 'Super shots']] },
      { key: 'limit', label: 'Shooters', type: 'number', min: 1, max: 20, placeholder: '8' },
      spot('next sponsor in rotation, Major and up, in the footer'),
    ],
    'introoutro.html': [
      { key: 'type', label: 'Intro or outro', type: 'select', choices: [['', 'Intro: welcome to the competition'], ['outro', 'Outro: last game of the night, join us again']] },
      { key: 'style', label: 'Style', type: 'select', choices: [['', 'Orbit (default)'], ['parade', 'Parade'], ['tiles', 'Tiles'], ['spotlight', 'Spotlight'], ['court', 'Court'], ['blueprint', 'Blueprint'], ['random', 'A different one each time']] },
      { key: 'division', label: 'Teams from', type: 'text', placeholder: 'the picked game\'s division', help: 'A division number like 1, or all for one team per club across the competition.' },
      { key: 'message', label: 'Yellow line', type: 'text', placeholder: 'the round, or when to join again' },
      { key: 'hold', label: 'On screen for', type: 'number', min: 0, max: 600, unit: 's', placeholder: '5', help: 'After the words come in, before it animates away.' },
      { key: 'out', label: 'At the end', type: 'select', choices: [['', 'Animates away'], ['0', 'Stays on screen']] },
      { key: 'speed', label: 'Speed', type: 'number', min: 0.25, max: 4, step: 0.25, unit: '×', placeholder: '1' },
      { key: 'fit', label: 'Size', type: 'select', choices: [['', 'Full screen'], ['1', 'Between the title and the scoreboard']] },
      mode(),
      ...background,
      { key: 'sfx', label: 'Sound effects volume', type: 'number', min: 0, max: 100, unit: '%', placeholder: '80', help: 'Each style has its own effects. 0 turns them off.' },
      { key: 'theme', label: 'Theme', type: 'select', list: 'audio', choices: [['', 'None']], help: 'Played with the animation: a song or sound already in Studio (added here or in Music), or Add a sound to add one, like a short stinger.' },
      { key: 'themefit', label: 'Theme timing', type: 'select', lengthCheck: true, choices: [['', 'Starts with the animation'], ['logo', 'Ends as the competition logo lands'],
        ['end', 'Ends as the animation finishes'], ['stretch', 'Stretch the animation to fit the theme (up to 25%)']] },
      { key: 'volume', label: 'Theme volume', type: 'number', min: 0, max: 100, unit: '%', placeholder: '100' },
    ],
    'logo.html': [
      { key: 'template', label: 'Animation', type: 'select', choices: [['', 'fun (default)'], ...LOGO_TEMPLATES.slice(1).map(t => [t, t]), ['random', 'A different one each time']] },
      { key: 'text', label: 'Words', type: 'text', placeholder: 'the competition name', help: 'For the badge and title animations.' },
      { key: 'sub', label: 'Smaller line', type: 'text', placeholder: 'none', help: 'For the title animation.' },
      { key: 'out', label: 'At the end', type: 'select', choices: [['', 'Animates away'], ['0', 'Stays on screen']] },
      { key: 'size', label: 'Logo height', type: 'number', min: 50, max: 1080, unit: 'px', placeholder: '640' },
      { key: 'speed', label: 'Speed', type: 'number', min: 0.25, max: 4, step: 0.25, unit: '×', placeholder: '1' },
      mode(),
      ...background,
    ],
    'stinger.html': [
      { key: 'hold', label: 'Holds the full frame for', type: 'number', min: 0, max: 1, step: 0.1, unit: 's', placeholder: '0.5', help: '0 to 1 second in steps of 0.1. 0 for a quick 1 second stinger.' },
      { key: 'length', label: 'Bands in and out', type: 'number', min: 0.5, max: 3, step: 0.1, unit: 's', placeholder: '1', help: 'How long the bands take to sweep in and out, around the hold.' },
      { key: 'logo', label: 'Competition logo', type: 'select', choices: [['', 'On the last band'], ['0', 'Left out (colours only)']] },
      { key: 'size', label: 'Logo height', type: 'number', min: 50, max: 1080, unit: 'px', placeholder: '560' },
      mode(),
      { key: 'sfx', label: 'Whoosh volume', type: 'number', min: 0, max: 100, unit: '%', placeholder: '80', help: '0 turns it off.' },
      { key: 'music', label: 'Music', type: 'select', choices: [['', 'Carries on as it is'], ['quiet', 'Quieted for the next scene'], ['dip', 'Dips while it plays']],
        help: 'Quieted: down by the time the frame is covered and kept down, as a scene with Quiet the music does, until a scene, sequence or step without it. Dips: back up as the stinger leaves.' },
    ],
    'ad.html': [
      { key: 'tagline', label: 'Tagline', type: 'text', placeholder: 'none' },
      { key: 'out', label: 'At the end', type: 'select', choices: [['', 'Animates away'], ['0', 'Stays on screen']] },
      { key: 'glow', label: 'Glow', type: 'select', choices: [['', 'Only with a background'], ['1', 'Always'], ['0', 'Never']],
        chroma: 'no glow.' },
      { key: 'mode', label: 'Wordmark', type: 'select', choices: [['', 'Coloured (white with a background)'], ['light', 'Coloured'], ['dark', 'White']] },
      ...background,
    ],
  };
})();
