"""Builds web.html, the marketing layout of the user guide, from ../index.html (the source of truth).
The words come from the guide unchanged; this only arranges them. Run: python3 build.py"""
import re, os, json

HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, '..', 'index.html')).read()
sections = re.findall(r'(<section class="ch" id="ch\d+">.*?</section>)', src, re.S)
assert len(sections) == 11, len(sections)

def imgs(h):  # screenshots: the full-size JPEGs; logos stay vector
    # The Reference (section class "ch ref") isn't in this PDF, so neither are the pointers to it.
    h = re.sub(r'\n  <p class="more">.*?</p>', '', h)
    h = re.sub(r'src="img/([^"]+)\.webp"', r'src="../img-web/\1.jpg"', h)
    return h.replace('src="img/', 'src="../img/')
sections = [imgs(x) for x in sections]

COURT = '''<div class="court"><svg viewBox="0 0 1280 680" preserveAspectRatio="xMidYMid slice" fill="none" stroke="#fff" stroke-width="3">
<rect x="40" y="40" width="1200" height="600" rx="2"/><line x1="440" y1="40" x2="440" y2="640"/><line x1="840" y1="40" x2="840" y2="640"/>
<circle cx="640" cy="340" r="46"/><path d="M40 160 A180 180 0 0 1 40 520"/><path d="M1240 160 A180 180 0 0 0 1240 520"/></svg></div>'''

HEROES = {1: 'g-scene', 2: 'g-intro', 3: 'g-streak-fire', 4: 's-control-score', 5: 'g-clash', 6: 's-setup-colours',
          7: 'g-sponsorwall', 8: 'g-positions-pair', 9: 'stream-deck-characters', 10: 'g-testpattern', 11: 'g-matchup'}
QUOTES = {
  1: ("Studio does one job on stream night: graphics.", "What Studio is"),
  2: ("The one rule that matters on stream night: keep a Studio window open.", "Getting started"),
  3: ("A sequence can start by itself from the game's clock, carry music, and hand over to another sequence.", "How it fits together"),
  4: ("If one person must do it alone, keep the Stream Deck to the score and clock keys and let the sequences do the breaks.", "Two people, not one"),
  5: ("Cards sit in the space between the title and the scoreboard and shrink to fit when they have more in them than fits.", "The graphics"),
  6: ("Logos and colours belong to clubs: every team of a club, in every division, gets the club's logo and colour.", "Logos"),
  7: ("The vacancy card has a heading, a contact, a message and a link or email for its QR code, so an empty tier finds its own sponsor.", "Tiers"),
  8: ("A photo is saved under the athlete's name for the competition, so an athlete in two divisions needs one photo.", "Photos"),
  9: ("Keys follow their source, scene or sequence by id, so renaming on the Output page doesn't break them.", "The plugin"),
  10: ("Updates download by themselves and install when the app quits, never mid-stream.", "Updates"),
}

cover = '''<div class="page cover" data-title="Cover">
  <div class="shot"></div>
  <div class="top"><div class="brand"><img class="mark" src="../img/1p-studio.svg" alt="1P Studio"><img class="word" src="../img/firstpass-studio.svg" alt="FirstPass Studio"></div><div class="live"><i></i>LIVE FROM PLAYHQ</div></div>
  <div class="txt">
    <div class="kicker">User guide</div>
    <h1>Graphics that<br><em>follow the game.</em></h1>
    <p class="tag">Broadcast graphics for netball livestreams, fed live from PlayHQ and run from one Mac.</p>
    <div class="foot">Version 1 · October 2026 <span>·</span> by <img src="../img-web/pivt.jpg" alt="PIVT"></div>
  </div>
</div>'''

LEADS = [
  ("What Studio is", "The app, the words used and the pages you work in."),
  ("Getting started", "Install, on air and off air, the 1P menu, the checklist."),
  ("Game night, the automated way", "Follow PlayHQ, the base scene, automatic layers, sequences, music, output."),
  ("Running it by hand", "Manual scoring and clock, and a two-person crew."),
  ("The graphics", "Every graphic, pictured, with the options worth knowing."),
  ("Competitions setup", "PlayHQ link, rules, finals, colours, logos, live viewers."),
  ("Sponsors", "Tiers, spots, ads, sponsored moments and proof of play."),
  ("Athletes", "Photos, silhouettes, positions and games played."),
  ("Stream Deck", "The plugin's keys, the links and timed keys."),
  ("Settings and care", "Data folder, iCloud, backups, updates and fixes."),
  ("Quick reference", "Keyboard, the night in nine lines, where things are set."),
]
cards = ''.join(f'<div class="c"><b>{i+1:02d}</b><h4>{t}</h4><p>{d}</p></div>' for i, (t, d) in enumerate(LEADS))
cards += '<div class="c wide"><h4>The sample league</h4><p>Every screenshot comes from Studio running the fictional Elite Netball League: eight clubs named after animals, three divisions, a live game and fictional sponsors.</p></div>'

intro = f'''<div class="page intro" data-title="About this guide">
  <div class="kick">About this guide</div>
  <h2>Graphics that <em>follow the game.</em></h2>
  <div class="lede">
    <div><p>FirstPass Studio is a Mac app that draws broadcast graphics for a netball livestream and sends them to your vision switcher. The scores, clocks, ladders, fixtures and line-ups come from PlayHQ's public data, so there is nothing to type in during the game.</p></div>
    <div><p>This guide starts with the way most nights run, one operator and Studio doing the rest, then covers running it by hand, setting up a competition, sponsors, athletes and the Stream Deck.</p></div>
  </div>
  <div class="stats">
    <div class="stat"><b>5 s</b><span>The live score, quarter and clock read from PlayHQ every 5 seconds while the game is scored.</span></div>
    <div class="stat"><b>31</b><span>Broadcast graphics, from the scoreboard and ladder to the sponsor wall, plus a test pattern.</span></div>
    <div class="stat"><b>17</b><span>Competition logo animations, and six intro and outro styles.</span></div>
    <div class="stat"><b>1</b><span>Operator on a followed night. Sequences run the run-up, the breaks and full time.</span></div>
  </div>
  <div class="flow">
    <div class="node"><small>In</small><h4>PlayHQ</h4><p>The fixture, ladder, line-ups and the live score from the scorer's tablet. No account, no key.</p></div>
    <div class="arrow"><i></i></div>
    <div class="node mid"><small>On your Mac</small><h4>FirstPass Studio</h4><p>Builds one 1920 × 1080 scene from layers: the base scene, automatic layers, scenes and sequences.</p></div>
    <div class="arrow"><i></i></div>
    <div class="node"><small>Out</small><h4>Your switcher</h4><p>A display, a Blackmagic device or NDI, with fill and key or a chroma colour over the cameras.</p></div>
  </div>
  <div class="showcase">
    <figure data-frame="win" data-title="Output"><img src="../img-web/s-output-sequence-playing.jpg" alt="A sequence playing on the Output page"></figure>
    <figure data-frame="mon"><img src="../img-web/crop/g-supershot.jpg" alt="The super shot celebration"><p>The Output page runs the show; the super shot plays by itself.</p></figure>
  </div>
  <div class="inside"><h3>Inside</h3><div class="grid">{cards}</div></div>
</div>'''

MOSAIC = ['crop/g-ladder', 'crop/g-clash', 'crop/g-matchup', 'crop/g-streak-fire', 'crop/g-positions-pair', 'crop/g-supershot', 'g-teamlist', 'g-intro', 'crop/g-sponsorwall', 'crop/g-worm', 'crop/g-gamestats', 'crop/g-fulltime', 'crop/g-streak-siren', 'crop/g-logo', 'crop/g-countdown', 'crop/g-fixtures', 'crop/g-endofnight', 'crop/g-streak-heating']
mosaic = '''<div class="page mosaic" data-title="FirstPass Studio User Guide">
  <div class="grid">''' + ''.join(f'<div style="background-image:url(../img-web/{t}.jpg)"></div>' for t in MOSAIC) + '''</div>
  <div class="veil"></div>
  <div class="panel"><img class="mark" src="../img/1p-studio.svg" alt="1P Studio"><img class="word" src="../img/firstpass-studio.svg" alt="FirstPass Studio"><div class="kicker">User guide</div>
    <p>Broadcast graphics for netball livestreams, fed live from PlayHQ and run from one Mac.</p></div>
  <div class="by"><div>Version 1 · October 2026 <span>·</span> by <img src="../img-web/pivt.jpg" alt="PIVT"></div></div>
</div>'''

back = f'''<div class="page back" data-title="FirstPass Studio">{COURT}
  <img class="mark" src="../img/1p-studio.svg" alt="1P Studio">
  <img class="word" src="../img/firstpass-studio.svg" alt="FirstPass Studio">
  <div class="by">Made by <img src="../img-web/pivt.jpg" alt="PIVT"></div>
  <p>FirstPass Studio is made by PIVT. The Elite Netball League, its clubs, athletes and sponsors are fictional.</p>
</div>'''

chapters = ''.join(f'<div class="page chapter" data-ch="{i+1}" data-hero="../img-web/{HEROES[i+1]}.jpg" data-title="{LEADS[i][0]}">{COURT if False else ""}{sec}</div>'
                   for i, sec in enumerate(sections))

doc = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><title>FirstPass Studio User Guide</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,400;0,600;0,800;0,900;1,800;1,900&display=swap">
<link rel="stylesheet" href="web.css"></head><body>
{mosaic}{cover}{intro}{chapters}{back}
<script>const QUOTES = {json.dumps(QUOTES)}; const ZOOM = {open(os.path.join(HERE, 'zoom.json')).read()}; const COURT = {json.dumps(COURT)};</script>
<script src="layout.js"></script></body></html>'''
open(os.path.join(HERE, 'web.html'), 'w').write(doc)
print('web.html', len(doc))
