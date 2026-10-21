// PlayHQ Graphics - example graphics.
//
// Takes a 1920x1080 picture of every overlay page with the data PlayHQ has right
// now, and saves them in Examples/<date and time>/ with an index.html to look
// through them. Pictures keep the transparent background.
//
// Run:  node examples.js     (or double click "Make Examples (Mac).command")
// Needs Node 22 or newer and Google Chrome, Microsoft Edge, Brave or Chromium. Set
// CHROME_PATH to use another Chromium based browser.
// Uses the helper if it is already running, otherwise starts it for the run.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = __dirname;
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const PORT = Number(process.env.PORT || CONFIG.port || 8080);
const BASE = `http://localhost:${PORT}`;

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const pf = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
  const list = process.platform === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
  ] : process.platform === 'win32' ? pf.flatMap(p => [
    path.join(p, 'Google/Chrome/Application/chrome.exe'),
    path.join(p, 'Microsoft/Edge/Application/msedge.exe'),
    path.join(p, 'BraveSoftware/Brave-Browser/Application/brave.exe'),
  ]) : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return list.find(p => fs.existsSync(p));
}

async function getJson(p) {
  const res = await fetch(BASE + p);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

function note(message) {
  console.log(message);
  fetch(BASE + '/api/log', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ page: 'examples.js', level: 'info', message }),
  }).catch(() => {});
}

// Uses the running helper, or starts one just for this run.
async function ensureHelper() {
  try { await getJson('/api/structure'); return null; } catch (e) {
    if (!/fetch failed|ECONNREFUSED/i.test(String(e.cause || e))) throw e;
  }
  console.log('Starting the helper for this run...');
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 500));
    try { await getJson('/api/structure'); return child; } catch { /* not up yet */ }
  }
  child.kill();
  throw new Error(`The helper did not start on ${BASE}. Open the FirstPass Studio app first and keep a Studio window open.`);
}

// Drives one headless browser over its DevTools connection. waitMs is how long
// each page gets, in real time, to load and finish animating before its picture.
async function openBrowser(chrome) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'playhq-examples-'));
  const args = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--window-size=1920,1080', 'about:blank'];
  if (process.getuid && process.getuid() === 0) args.unshift('--no-sandbox');
  const proc = spawn(chrome, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let err = '';
    const t = setTimeout(() => reject(new Error(`${path.basename(chrome)} did not start: ${err.slice(-300)}`)), 20000);
    proc.stderr.on('data', d => {
      err += d;
      const m = err.match(/DevTools listening on (ws:\S+)/);
      if (m) { clearTimeout(t); resolve(m[1]); }
    });
    proc.on('exit', () => { clearTimeout(t); reject(new Error(`${path.basename(chrome)} closed: ${err.slice(-300)}`)); });
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('Could not talk to the browser')); });
  let id = 0;
  const waiting = new Map();
  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    const w = waiting.get(msg.id);
    if (!w) return;
    waiting.delete(msg.id);
    if (msg.error) w.reject(new Error(msg.error.message)); else w.resolve(msg.result);
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    waiting.set(++id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const close = () => { try { ws.close(); } catch { /* gone */ } proc.kill(); setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 1000); };

  async function shoot(url, file, waitMs) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    try {
      await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }, sessionId);
      await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } }, sessionId);
      await send('Page.enable', {}, sessionId);
      await send('Page.navigate', { url }, sessionId);
      await new Promise(r => setTimeout(r, waitMs));
      const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      return null;
    } catch (e) {
      return e.message;
    } finally {
      await send('Target.closeTarget', { targetId }).catch(() => {});
    }
  }
  return { shoot, close };
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

(async () => {
  const chrome = findChrome();
  if (!chrome) throw new Error('No Chrome, Edge, Brave or Chromium found. Install Google Chrome, or set CHROME_PATH.');
  if (typeof WebSocket === 'undefined') throw new Error(`This needs Node 22 or newer (you have ${process.version}).`);
  const helper = await ensureHelper();
  let browser;
  try {
    const st = await getJson('/api/structure');
    // A freshly started helper picks its game a few seconds after starting.
    let sb = {};
    for (let i = 0; i < 20; i++) {
      sb = await getJson('/api/scoreboard').catch(() => ({}));
      if (sb.gameId) break;
      await new Promise(r => setTimeout(r, 500));
    }
    // An athlete from the picked game's home line up, for the athlete lower third.
    const sheets = await getJson('/api/teams').catch(() => ({}));
    const athlete = ((sheets.home && sheets.home.players) || []).map(p => p.name).find(Boolean);
    const pages = [
      ['Live scoreboard', '/scoreboard.html', 4000],
      ['Title banner', '/title.html', 3000],
      ['Logos beside the title', '/branding.html', 3000],
      ['Match up', '/matchup.html', 3000],
      ['The Clash (end of animation)', '/clash.html', 6000],
      ['Winner celebration: home (end of animation)', '/winner.html?winner=home', 5000],
      ['Winner celebration: away (end of animation)', '/winner.html?winner=away', 5000],
      ['Winner celebration: draw (end of animation)', '/winner.html?winner=draw', 5000],
      ['Super shot: home (mid animation)', '/supershot.html?team=home', 1500],
      ['Heating up: home (mid animation)', '/streak.html?play=heating&team=home', 2200],
      ['On fire: home (mid animation)', '/streak.html?play=fire&team=home', 1800],
      ['Goal for goal (mid animation)', '/streak.html?play=goalforgoal', 2200],
      ['Hits the front: home (mid animation)', '/streak.html?play=lead&team=home', 2200],
      ['All square (mid animation)', '/streak.html?play=level', 2200],
      ['Coming back: away (mid animation)', '/streak.html?play=comeback&team=away', 2200],
      ['On the siren: home (mid animation)', '/streak.html?play=siren&team=home', 2200],
      ['Back to back super shots: home (mid animation)', '/streak.html?play=backtoback&team=home', 2400],
      ['Last 10 goals', '/goals.html', 3000],
      ['Last 10 goals: vertical', '/goals.html?layout=vertical', 3000],
      ['Up next', '/upnext.html', 3000],
      ['Countdown to the start of the game', '/countdown.html', 3000],
      ['Position match up: GS v GK', '/positions.html?pair=GS', 3000],
      ['Position match ups: all seven', '/positions.html?show=all', 3000],
      ['Home team list', '/teamlist.html?side=home', 3000],
      ['Away team list', '/teamlist.html?side=away', 3000],
      ['Shooting stats', '/shooting.html', 3000],
      ['Full time card', '/fulltime.html', 3000],
      ['Game stats', '/gamestats.html', 3000],
      ['Score worm', '/worm.html?draw=0', 3000],
      ['Ladder lower third', '/ladderbar.html', 3000],
      ...(athlete ? [[`Athlete lower third: ${athlete}`, `/lowerthird.html?name=${encodeURIComponent(athlete)}`, 2500]] : []),
      ['Guest lower third', '/lowerthird.html?type=guest&name=Sam%20Lee&title=Commentator', 2500],
      ['Score ticker', '/ticker.html', 4000],
      ['Round fixture', '/fixtures.html', 3000],
      ['Next round fixture', '/fixtures.html?round=next', 3000],
      ['Round results', '/results.html', 3000],
      ['Logo animation: fun (mid animation)', '/logo.html?template=fun', 2200],
      ['Logo animation: pro (mid animation)', '/logo.html?template=pro', 2600],
      ...['coin', 'tiles', 'slices', 'glitch', 'badge', 'doors', 'bounce', 'lightning', 'rings', 'title', 'goal', 'court', 'bibs', 'pass', 'net']
        .map(t => [`Logo animation: ${t} (mid animation)`, `/logo.html?template=${t}`, 2600]),
      ['PIVT and FirstPass Studio ad (mid animation)', '/ad.html', 6000],
      ...st.grades.map(g => [`Ladder: ${g.name}`, `/ladder.html?division=${g.division}`, 3000]),
      ...st.grades.map(g => [`Top shooters: ${g.name}`, `/topshooters.html?division=${g.division}`, 6000]),
      ...st.grades.map(g => [`Finals: ${g.name}`, `/finals.html?division=${g.division}`, 3000]),
    ];
    const stamp = new Date();
    const pad = n => String(n).padStart(2, '0');
    const folderName = `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())} ${pad(stamp.getHours())}${pad(stamp.getMinutes())}`;
    const dir = path.join(ROOT, 'Examples', folderName);
    fs.mkdirSync(dir, { recursive: true });
    const game = sb.gameId ? `${sb.home.name} v ${sb.away.name}` : 'no game picked';
    note(`Making ${pages.length} example graphics in Examples/${folderName} (game: ${game}) with ${path.basename(chrome)}`);

    browser = await openBrowser(chrome);
    const made = [];
    for (const [i, [name, p, waitMs]] of pages.entries()) {
      const file = `${pad(i + 1)} ${name.replace(/[:/\\?*"<>|]/g, '').replace(/\s+/g, ' ')}.png`;
      const err = await browser.shoot(BASE + p, path.join(dir, file), waitMs);
      console.log(`${err ? 'FAILED' : 'ok    '} ${name}${err ? ': ' + err : ''}`);
      if (err) note(`Example of ${p} failed: ${err}`);
      else made.push({ name, p, file });
    }

    fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Example graphics ${esc(folderName)}</title>
<style>body{margin:0;padding:24px;font:15px system-ui,sans-serif;background:#111;color:#eee}h1{margin:0 0 4px}p{color:#aaa;margin:0 0 24px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(560px,1fr));gap:24px}figure{margin:0}
figure img{width:100%;display:block;border-radius:6px;background:#3a3a3a conic-gradient(#333 25%,#444 0 50%,#333 0 75%,#444 0) 0 0/32px 32px}
figcaption{padding:8px 0;color:#ccc}code{color:#ffcd00}</style>
<h1>Example graphics</h1><p>${esc(st.competition)} · ${esc(st.season && st.season.name)} · scoreboard game: ${esc(game)} · made ${esc(stamp.toLocaleString())}. The checks show where the page is transparent.</p>
<div class="grid">${made.map(m => `<figure><a href="${encodeURI(m.file)}"><img src="${encodeURI(m.file)}" alt=""></a><figcaption>${esc(m.name)} <code>${esc(m.p)}</code></figcaption></figure>`).join('')}</div>`);
    note(`Example graphics done: ${made.length} of ${pages.length} made`);
    console.log(`\nSaved in ${dir}\nOpen index.html there to look through them.`);
    if (process.platform === 'darwin' && !process.env.NO_OPEN) spawn('open', [path.join(dir, 'index.html')], { stdio: 'ignore', detached: true }).unref();
  } finally {
    if (browser) browser.close();
    if (helper) helper.kill();
  }
})().catch(e => { console.error(`\nCould not make the examples: ${e.message}`); process.exitCode = 1; });
