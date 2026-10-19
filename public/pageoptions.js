// FirstPass Studio - the options each graphics page takes in its link (?board=2 and so on), so the Output
// page can offer them as fields instead of sending people to the home page to read them. The home page
// describes the same options in words: keep the two in step when a page gets a new one.
//
// Each option: { key, label, type: 'select' | 'text' | 'number', ... }. A select's first choice is the
// page's default, with value '' (left out of the link). text and number boxes left empty are left out too.

/* exported PAGE_OPTIONS */
const PAGE_OPTIONS = (() => {
  const show = (key, label, hideLabel = 'Hide') => ({ key, label, type: 'select', choices: [['', 'Show'], ['0', hideLabel]] });
  const board = { key: 'board', label: 'Court', type: 'select', choices: [['', 'Scoreboard 1 (default)'], ['2', 'Scoreboard 2 (second court)']] };
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
  const LOGO_TEMPLATES = ['fun', 'pro', 'coin', 'tiles', 'slices', 'glitch', 'badge', 'doors', 'bounce', 'lightning', 'rings', 'title', 'goal', 'court', 'bibs', 'pass', 'net'];

  return {
    'scoreboard.html': [
      { key: 'position', label: 'Position', type: 'select', choices: [['', 'Bottom centre'], ['top-center', 'Top centre'], ['top-left', 'Top left'], ['bottom-left', 'Bottom left']] },
      board,
    ],
    'ticker.html': [
      { key: 'speed', label: 'Speed', type: 'number', min: 20, max: 600, unit: 'px a second', placeholder: 'from the control page' },
      { key: 'refresh', label: 'Update scores every', type: 'number', min: 0, max: 3600, unit: 's', placeholder: '30', help: '0 loads them once.' },
      board,
    ],
    'title.html': [
      show('fire', 'Emoji'),
      { key: 'emoji', label: 'Different emoji', type: 'text', placeholder: 'the one in the setup' },
      { key: 'logo', label: 'Competition logo', type: 'select', choices: [['', 'Off'], ['show', 'Above the banner']] },
      { key: 'position', label: 'Position', type: 'select', choices: [['', 'Top'], ['bottom', 'Bottom']] },
      mode(),
      board,
    ],
    'branding.html': [
      show('pivt', 'PIVT logo'), show('studio', 'FirstPass Studio logo'), show('comp', 'Competition logo'),
      { key: 'gap', label: 'Gap from centre', type: 'number', min: 0, max: 960, unit: 'px', placeholder: 'default' },
      { key: 'top', label: 'Height from top', type: 'number', min: 0, max: 1080, unit: 'px', placeholder: 'default' },
      { key: 'size', label: 'Size', type: 'number', min: 0.2, max: 5, step: 0.1, unit: '×', placeholder: '1' },
      mode(),
    ],
    'upnext.html': [board],
    'countdown.html': [
      { key: 'label', label: 'Heading', type: 'text', placeholder: 'default' },
      { key: 'end', label: 'Words at zero', type: 'text', placeholder: 'STARTING SOON', help: 'Keep them short. hide fades the card away instead.' },
      { key: 'fade', label: 'Fade out over the last', type: 'number', min: 2, max: 60, unit: 's', placeholder: 'no fade' },
      show('teams', 'Teams', 'Clock only'),
      { key: 'position', label: 'Position', type: 'select', choices: [['', 'Middle'], ['top', 'Top'], ['bottom', 'Bottom']] },
      board,
    ],
    'matchup.html': [show('form', 'Form'), show('h2h', 'Head to head'), board],
    'clash.html': [
      out(),
      { key: 'word', label: 'Big word', type: 'text', placeholder: 'the one in the setup' },
      { key: 'title', label: 'Bottom line', type: 'text', placeholder: 'default' },
      board,
    ],
    'positions.html': [
      { key: 'hold', label: 'Each pairing for', type: 'number', min: 1, max: 60, unit: 's', placeholder: '5' },
      { key: 'loop', label: 'When done', type: 'select', choices: [['', 'Stop'], ['1', 'Keep going round']] },
      { key: 'end', label: 'At the end', type: 'select', choices: [['', 'All seven stay on'], ['out', 'Animate away']] },
      { key: 'show', label: 'Start with', type: 'select', choices: [['', 'One pairing at a time'], ['all', 'All seven at once']] },
      { key: 'pair', label: 'Pairing', type: 'select', choices: [['', 'All of them'], ...['GS', 'GA', 'WA', 'C', 'WD', 'GD', 'GK'].map(p => [p, `${p} only`])] },
      show('games', 'Games played'),
      board,
    ],
    'teamlist.html': [{ key: 'side', label: 'Team', type: 'select', choices: [['', 'Home'], ['away', 'Away']] }, board],
    'shooting.html': [title('default'), board],
    'goals.html': [
      { key: 'layout', label: 'Layout', type: 'select', choices: [['', 'Horizontal (above the scoreboard)'], ['vertical', 'Vertical']] },
      { key: 'count', label: 'Goals', type: 'number', min: 3, max: 30, placeholder: '10' },
      show('times', 'Quarter and time'),
      { key: 'position', label: 'Position', type: 'select', choices: [['', 'Default'], ['top', 'Top (horizontal)'], ['middle', 'Middle (horizontal)'], ['bottom', 'Bottom (horizontal)'], ['left', 'Left (vertical)'], ['right', 'Right (vertical)']] },
      title('Last 10 goals'),
      board,
    ],
    'fulltime.html': [title('default'), board],
    'winner.html': [
      { key: 'winner', label: 'Result', type: 'select', choices: [['', 'From the score'], ['home', 'Home wins'], ['away', 'Away wins'], ['draw', 'Draw']] },
      out(),
      { key: 'word', label: 'Big word', type: 'text', placeholder: 'VICTORY' },
      { key: 'title', label: 'Line under the score', type: 'text', placeholder: 'default' },
      show('score', 'Score'),
      board,
    ],
    'supershot.html': [
      { key: 'team', label: 'Plays', type: 'select', choices: [['', 'By itself for every super shot'], ['home', 'Once, for the home team'], ['away', 'Once, for the away team'], ['none', 'Once, no team']] },
      board,
    ],
    'ladder.html': [
      division,
      { key: 'rows', label: 'Rows', type: 'number', min: 1, max: 40, placeholder: 'all' },
      show('key', 'Finals key'),
      show('logo', 'Competition logo'),
      mode('dark'),
      { key: 'refresh', label: 'Reload every', type: 'number', min: 0, max: 3600, unit: 's', placeholder: 'load once' },
    ],
    'ladderbar.html': [board],
    'finals.html': [
      division,
      { key: 'week', label: 'Week', type: 'number', min: 1, max: 10, placeholder: 'all weeks' },
      title('Finals'),
      { key: 'sub', label: 'Line under the heading', type: 'text', placeholder: 'Top 4 finals…', help: '0 leaves it off.' },
      show('seeds', 'Ladder positions'),
      show('projected', '"If the season ended today"'),
      show('logo', 'Competition logo'),
      mode('dark'),
      board,
    ],
    'fixtures.html': [round, division],
    'results.html': [round, division],
    'topshooters.html': [
      division,
      { key: 'sort', label: 'Order by', type: 'select', choices: [['', 'Points (goals + 2 per super shot)'], ['goals', 'Goals'], ['super', 'Super shots']] },
      { key: 'limit', label: 'Shooters', type: 'number', min: 1, max: 20, placeholder: '8' },
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
    'ad.html': [
      { key: 'tagline', label: 'Tagline', type: 'text', placeholder: 'none' },
      { key: 'out', label: 'At the end', type: 'select', choices: [['', 'Animates away'], ['0', 'Stays on screen']] },
      { key: 'glow', label: 'Glow', type: 'select', choices: [['', 'Only with a background'], ['1', 'Always'], ['0', 'Never']] },
      { key: 'mode', label: 'Wordmark', type: 'select', choices: [['', 'Coloured (white with a background)'], ['light', 'Coloured'], ['dark', 'White']] },
      ...background,
    ],
  };
})();
