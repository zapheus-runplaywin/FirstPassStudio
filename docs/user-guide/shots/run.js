// Takes the user guide's Studio screenshots (docs/user-guide/img/s-*.webp, and the full-size JPEGs the
// web PDF is made from in img-web/) on the Elite Netball League (league.js): Studio and the stand-in PlayHQ
// are started on this computer, the night is set up through Studio's own API (sources, scenes, sequences,
// run order, music, sponsors, planner), and each page is photographed by Playwright's Chromium.
//   node docs/user-guide/shots/run.js            every shot, dark (img-web, for the web PDF and the page) and light (img-print, for the print PDF)
//   node docs/user-guide/shots/run.js output     only the shots whose name has "output" in it
//   KEEP=1 node docs/user-guide/shots/run.js     set up and leave Studio running to look at (prints its link)
// See README.md.

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const { startStudio, wait } = require('../../../test/support/studio');
const league = require('./league');
const { SHOTS } = require('./shots');

const GUIDE = path.join(__dirname, '..');
const only = process.argv[2] || '';
const WIDTH = 1440; // the 13" MacBook's default window, so every shot fits the smaller Mac

// Renders an SVG in the assets folder to a PNG (with Montserrat from Studio's own fonts).
async function svgToPng(browser, file, width) {
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  const svg = fs.readFileSync(file, 'utf8');
  const font = path.join(__dirname, '../../../vendor/fonts');
  await page.setContent(`<style>body{margin:0;background:transparent}</style><div id="x" style="display:inline-block;width:${width}px">${svg.replace('<svg ', '<svg style="width:100%;height:auto;display:block" ')}</div>`);
  const png = await page.locator('#x').screenshot({ omitBackground: true });
  await page.close();
  return png;
}

// A short tone as a song (the music needs real files in the media folder).
function tone(file, sec, hz) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=${sec}`, '-ac', '2', '-b:a', '96k', file]);
}

async function setUp(browser) {
  const world = league.createWorld();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-guide-'));
  const studio = await startStudio(null, { world, dataDir, removeDataDir: true, env: { STUDIO_GUIDE_SHOTS: '1' } });
  const scene = a => studio.post('/api/scene', a);

  // The competition, from its template, with its own logo.
  const tpl = league.template();
  tpl.brand['Elite Netball League.png'] = (await svgToPng(browser, path.join(league.ASSETS, 'Elite Netball League.svg'), 400)).toString('base64');
  await studio.post('/api/setup-template', tpl);

  // Media: the songs and a sponsor's video.
  const media = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-guide-media-'));
  const songs = { 'Warm up anthem.mp3': [180, 220], 'Crowd pumper.mp3': [150, 260], 'Break beats.mp3': [90, 330], 'Super shot sting.mp3': [90, 440] };
  for (const [name, [sec, hz]] of Object.entries(songs)) {
    tone(path.join(media, name), sec, hz);
    await studio.request('POST', `/api/scene/media?name=${encodeURIComponent(name)}&level=0`, fs.readFileSync(path.join(media, name)), { 'content-type': 'application/octet-stream' });
  }
  fs.rmSync(media, { recursive: true, force: true });

  // Sources: every graphic tonight could need, top layer first as the Output page lists them.
  const pages = [
    ['Viewers', 'viewers.html'], ['Person lower third', 'lowerthird.html'], ['Super shot', 'supershot.html'], ['Hot streaks', 'streak.html'],
    ['Winner', 'winner.html'], ['The Clash', 'clash.html'], ['Intro', 'introoutro.html'], ['Outro', 'introoutro.html?type=outro'],
    ['Logo animation', 'logo.html'], ['Countdown', 'countdown.html'], ['Match up', 'matchup.html'], ['Up next', 'upnext.html'],
    ['Position match ups', 'positions.html'], ['Team list home', 'teamlist.html?side=home'], ['Team list away', 'teamlist.html?side=away'],
    ['Shooting stats', 'shooting.html'], ['Last 10 goals', 'goals.html'], ['Full time', 'fulltime.html'], ['Game stats', 'gamestats.html'],
    ['Score worm', 'worm.html'], ['Ladder', 'ladder.html'], ['Ladder lower third', 'ladderbar.html'], ['Round fixture', 'fixtures.html'],
    ['Results', 'results.html'], ['Top shooters', 'topshooters.html'], ['Finals', 'finals.html'], ['Sponsor card', 'sponsor.html'],
    ['Sponsor wall', 'sponsorwall.html'], ['Score ticker', 'ticker.html'], ['Branding logos', 'branding.html'], ['Title', 'title.html'],
    ['Scoreboard', 'scoreboard.html'],
  ];
  await scene({ type: 'add', sources: pages.map(([name, url]) => ({ type: 'browser', name, url })) });
  const st = await studio.get('/api/scene');
  const id = name => { const s = st.sources.find(x => x.name === name); if (!s) throw new Error(`No source ${name}`); return s.id; };
  const show = async names => { await scene({ type: 'hideAll' }); for (const n of names) await scene({ type: 'show', id: id(n) }); };

  // Scenes: saved from what's on.
  const SCENES = {
    'Pre-game': ['Title', 'Branding logos', 'Countdown', 'Score ticker'],
    'Live game': ['Scoreboard', 'Title', 'Branding logos', 'Score ticker', 'Super shot', 'Hot streaks'],
    'Interview': ['Person lower third', 'Branding logos', 'Score ticker'],
    'Quarter time': ['Scoreboard', 'Shooting stats', 'Branding logos', 'Score ticker'],
    'Full time': ['Full time', 'Branding logos', 'Score ticker', 'Winner'],
    'Clear': [],
  };
  const COLOUR = { 'Pre-game': 'green', 'Live game': 'blue', 'Interview': 'blue', 'Quarter time': 'purple', 'Full time': 'grey', 'Clear': 'grey' };
  for (const [name, on] of Object.entries(SCENES)) { await show(on); await scene({ type: 'sceneSave', name, colour: COLOUR[name] }); }

  // Music: two playlists and the super shot song.
  await scene({ type: 'playlistAdd', changes: { name: 'Pre-game warm up', tracks: ['Warm up anthem.mp3', 'Crowd pumper.mp3'], shuffle: true } });
  await scene({ type: 'playlistAdd', changes: { name: 'Break beats', tracks: ['Break beats.mp3'] } });
  const sc = await studio.get('/api/scene');
  const playlist = name => sc.playlists.find(p => p.name === name).id;
  const sceneId = name => sc.scenes.find(s => s.name === name).id;

  // Sequences: the night's shape.
  const step = (names, sec) => ({ sources: names.map(id), length: sec ? { type: 'time', sec } : { type: 'next' } });
  const seqs = [
    { name: 'Run-up', colour: 'green', start: { type: 'before', min: 15 }, repeat: 'until', until: { moment: 'before', min: 2 },
      music: { playlist: playlist('Pre-game warm up') }, then: { type: 'scene', scene: sceneId('Pre-game') },
      steps: [step(['Ladder'], 20), step(['Round fixture'], 20), step(['Match up'], 15), step(['Sponsor wall'], 10)] },
    { name: 'Walk out', colour: 'blue', steps: [step(['The Clash'], 12), step(['Team list home'], 15), step(['Team list away'], 15), step(['Position match ups'])],
      then: { type: 'scene', scene: sceneId('Live game') } },
    { name: 'Quarter time', colour: 'purple', start: { type: 'break', breaks: ['qt', '3qt'], afterSec: 5 }, repeat: 'until', until: { moment: 'resume' },
      music: { playlist: playlist('Break beats') }, then: { type: 'scene', scene: sceneId('Live game') },
      steps: [step(['Shooting stats'], 25), step(['Last 10 goals'], 20), { kind: 'ads', count: 1 }] },
    { name: 'Stats roll', colour: 'purple', hidden: true, steps: [step(['Shooting stats'], 25), step(['Score worm'], 20)] },
    { name: 'Ad break', colour: 'yellow', hidden: true, steps: [{ kind: 'ads', count: 2 }] },
    { name: 'Half time', colour: 'purple', start: { type: 'break', breaks: ['ht'], afterSec: 5 }, repeat: 'until', until: { moment: 'resume' },
      music: { playlist: playlist('Break beats') }, then: { type: 'scene', scene: sceneId('Live game') },
      steps: [{ kind: 'scene', scene: sceneId('Quarter time') }, { kind: 'sequence', sequence: 'STATS' }, step(['Ladder lower third'], 15),
        { kind: 'sequence', sequence: 'ADS' }, step(['Sponsor card'], 10)] },
    { name: 'Full time', colour: 'grey', start: { type: 'fulltime', afterSec: 5 }, then: { type: 'scene', scene: sceneId('Full time') },
      steps: [step(['Winner'], 8), step(['Full time'], 20), step(['Game stats'], 20), step(['Score worm'], 15), step(['Results'], 15)] },
    { name: 'Sponsor break', colour: 'yellow', steps: [step(['Sponsor wall'], 10), { kind: 'ads', count: 2 }] },
    { name: 'Stream close', colour: 'grey', steps: [step(['Outro'], 20), step(['Logo animation'], 8)] },
  ];
  for (const s of seqs) {
    // A step that plays another sequence names it by its id, known once that one is made.
    const made = (await studio.get('/api/scene')).sequences;
    const idOf = n => made.find(x => x.name === n)?.id;
    for (const st of s.steps) if (st.kind === 'sequence') st.sequence = idOf(st.sequence === 'STATS' ? 'Stats roll' : 'Ad break');
    await scene({ type: 'seqAdd', changes: s });
  }

  // Tonight: live game on, the run order queued.
  await scene({ type: 'sceneGo', scene: 'Live game' });
  const sc2 = await studio.get('/api/scene');
  const seqId = name => sc2.sequences.find(s => s.name === name).id;
  for (const n of ['Sponsor break', 'Walk out']) await scene({ type: 'roAdd', kind: 'sequence', id: seqId(n) });

  // Sponsors, with logos.
  const comp = (await studio.get('/api/setup')).active;
  const SPONSORS = [['Summit Sportswear', 'naming'], ['Nova Energy', 'elite'], ['Harbour Credit Union', 'major'], ['Metro Toyota', 'major'],
    ['Coastline Physio', 'partner'], ['Golds Bakery', 'supporter']];
  for (const [name, tier] of SPONSORS) {
    const r = await studio.post('/api/sponsors', { name, website: `${name.toLowerCase().replace(/\W+/g, '')}.com.au`, competitions: { [comp]: { tier } } });
    const s = (r.sponsors || []).find(x => x.name === name);
    if (!s) continue;
    const png = await svgToPng(browser, path.join(league.ASSETS, 'sponsors', `${name}.svg`), 320);
    await studio.request('POST', `/api/sponsors/logo?id=${s.id}&which=logo&name=${encodeURIComponent(name)}.png`, png, { 'content-type': 'application/octet-stream' });
  }

  // Tonight so far for the sponsor report: two and a half hours on air, as exposure.js writes it.
  const ids = Object.fromEntries((await studio.get('/api/sponsors')).sponsors.map(x => [x.name, x.id]));
  const lines = [];
  const end = world.now, begin = end - 150 * 60000;
  const seen = (name, p, src, every, len, qr = false) => {
    for (let t = begin; t + len * 1000 < end; t += every * 1000) lines.push({ t: 'seen', s: ids[name], c: comp, p, src, air: true, qr, from: t, to: t + len * 1000 });
  };
  seen('Summit Sportswear', 'tab', 'Scoreboard', 600, 590);
  seen('Summit Sportswear', 'under-title', 'Title', 600, 590);
  for (const [i, n] of ['Nova Energy', 'Harbour Credit Union', 'Metro Toyota', 'Coastline Physio', 'Golds Bakery'].entries()) {
    seen(n, 'ticker', 'Score ticker', 300, [40, 30, 30, 20, 10][i]);
    seen(n, 'card', 'Sponsor card', 1800 + i * 120, [20, 15, 15, 10, 10][i], i < 3);
  }
  for (const n of ['Nova Energy', 'Harbour Credit Union', 'Metro Toyota']) seen(n, 'wall', 'Sponsor wall', 2700, 10, true);
  seen('Nova Energy', 'moment', 'Super shot', 900, 4);
  for (let t = begin + 1200000, i = 0; t < end; t += 1500000, i++) {
    const n = ['Nova Energy', 'Harbour Credit Union', 'Metro Toyota'][i % 3];
    lines.push({ t: 'play', s: ids[n], c: comp, file: `${n} 15s.mp4`, kind: 'video', at: t, air: true });
  }
  const exp = path.join(dataDir, 'sponsors', 'exposure');
  fs.mkdirSync(exp, { recursive: true });
  fs.writeFileSync(path.join(exp, `${world.today}.jsonl`), lines.map(l => JSON.stringify(l)).join('\n') + '\n');

  // Game recording stays off for the pictures.
  await studio.post('/api/recordings', { record: false });

  // The planner: tonight's commentators.
  const plan = await studio.post('/api/planner/pool', { pool: [{ name: 'Sam Lee' }, { name: 'Jordan Ellis' }, { name: 'Honey Harrington', guest: true }] });
  const [sam, jordan, honey] = plan.pool;
  const tonight = plan.nights.find(n => n.date === world.today);
  const court1 = tonight.games.filter(g => g.court === 'Court 1').map(g => g.time.slice(0, 5)).sort();
  const people = [[sam.id, jordan.id], [sam.id, honey.id], [jordan.id], [sam.id]];
  await studio.post('/api/planner/night', { date: world.today, court: 'Court 1', slots: Object.fromEntries(court1.map((t, i) => [t, people[i % people.length]])) });

  // Studio follows PlayHQ for the game on Court 1.
  await studio.until(async () => (await studio.get('/api/scoreboard'))?.home?.score > 0, 20000).catch(() => {});
  return studio;
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.STUDIO_TEST_CHROMIUM || undefined });
  const studio = await setUp(browser);
  console.log(`Studio: ${studio.base}  (data ${studio.dataDir})`);
  if (process.env.KEEP) { console.log('Leaving it running: Ctrl-C to stop.'); await new Promise(() => {}); }
  try {
    for (const theme of ['dark', 'light']) {
      const out = path.join(GUIDE, theme === 'dark' ? 'img-web' : 'img-print');
      fs.mkdirSync(out, { recursive: true });
      const context = await browser.newContext({ viewport: { width: WIDTH, height: 900 }, deviceScaleFactor: 2, colorScheme: theme });
      for (const shot of SHOTS.filter(s => s.name.includes(only))) {
        const page = await context.newPage();
        try { await shot.take({ page, studio, wait, out: path.join(out, `${shot.name}.jpg`) }); console.log(theme, shot.name); }
        catch (err) { console.log(theme, shot.name, 'FAILED', err.message.split('\n')[0]); }
        await page.close();
      }
      await context.close();
    }
  } finally {
    await browser.close();
    await studio.stop();
  }
  // The guide's own pictures: WebPs at most 1200 wide, dark in img/ (the page and the web PDF) and light in
  // img/light/ (the print PDF).
  execFileSync('python3', ['-c', `
import glob, os, sys
from PIL import Image
guide, only = sys.argv[1], sys.argv[2]
for src, dst in (('img-web', 'img'), ('img-print', os.path.join('img', 'light'))):
    os.makedirs(os.path.join(guide, dst), exist_ok=True)
    for f in glob.glob(os.path.join(guide, src, 's-*.jpg')):
        name = os.path.basename(f)[:-4]
        if only not in name: continue
        im = Image.open(f).convert('RGB')
        if im.width > 1200: im = im.resize((1200, round(im.height * 1200 / im.width)), Image.LANCZOS)
        im.save(os.path.join(guide, dst, name + '.webp'), quality=86, method=6)
`, GUIDE, only], { stdio: 'inherit' });
}

main().catch(err => { console.error(err); process.exit(1); });
