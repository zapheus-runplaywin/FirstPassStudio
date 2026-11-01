// The Mac app itself (desktop/main.js and windows.js), run for real with Playwright's Electron driver: it starts
// in the menu bar off air, Open Studio puts it on air with the Output page, a helper that crashes mid-stream is
// started again with the scores it had, and closing the last Studio window asks, then takes Studio off air.
// The app runs in a settings folder of its own (XDG_CONFIG_HOME on Linux, where CI runs it under xvfb-run; on a
// Mac it would use the real one, so it only runs on Linux). It needs Electron's own binary (npm ci without
// --ignore-scripts, or node node_modules/electron/install.js): without it the test is skipped, or fails when
// STUDIO_TEST_REQUIRE_APP is set (as in CI). Its dialogs are answered by the test.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { ROOT, wait } = require('./support/studio');
const { createWorld, startPlayhq, localZone } = require('./support/playhq');

let electron = null, executablePath = null, why = '';
try {
  ({ _electron: electron } = require('playwright'));
  executablePath = require('electron'); // the binary's path, once it's downloaded
  if (!fs.existsSync(executablePath)) throw new Error(`no Electron binary at ${executablePath}`);
} catch (err) { why = err.message.split('\n')[0]; electron = null; }
if (process.platform !== 'linux') { electron = null; why = 'the app test runs on Linux only (it would use this Mac\'s own settings folder)'; }
else if (electron && !process.env.DISPLAY) { electron = null; why = 'no display: run it under xvfb-run'; }

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

// Starts the app in a settings folder of its own, on a free port. Gives { app, port, log(), answering(), onAir(),
// answer(n), asked() }.
// The free port is found by opening and closing a socket, so a Studio started by another test file (they run side by
// side) can take it first. So answering() only counts this app's own helper, and onAir() starts the app again on
// another port when its helper finds the port taken.
async function launch(t, env = {}) {
  if (!electron) {
    if (process.env.STUDIO_TEST_REQUIRE_APP) assert.fail(`can't run the app: ${why}`);
    t.skip(`can't run the app (${why})`);
    return null;
  }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-app-'));
  const local = path.join(home, 'FirstPass Studio');
  fs.mkdirSync(local, { recursive: true });
  const start = async () => {
    studio.port = await freePort();
    fs.writeFileSync(path.join(local, 'config.json'), JSON.stringify({ port: studio.port, linkHost: 'localhost' }));
    studio.app = await electron.launch({ executablePath, args: [ROOT, '--no-sandbox'], cwd: ROOT, env: { ...process.env, XDG_CONFIG_HOME: home, ...env } });
  };
  const quit = async () => {
    // Quit without asking, then make sure nothing is left on the port.
    await studio.app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0 }); }).catch(() => {});
    await studio.app.close().catch(() => {});
  };
  t.after(async () => {
    await quit();
    fs.rmSync(home, { recursive: true, force: true });
  });
  const studio = {
    app: null, port: null, local,
    log: () => { try { return fs.readFileSync(path.join(local, 'logs', 'app.log'), 'utf8'); } catch { return ''; } },
    // This app's helper, if it is what listens on the port: a process the app started.
    helperPid: () => { const pid = helperPid(studio.port); return pid && startedBy(pid, studio.app.process().pid) ? pid : null; },
    answering: async () => {
      if (!studio.helperPid()) return false;
      try { return (await fetch(`http://127.0.0.1:${studio.port}/api/version`)).ok; } catch { return false; }
    },
    get: async p => (await fetch(`http://127.0.0.1:${studio.port}${p}`)).json(),
    post: async (p, body) => (await fetch(`http://127.0.0.1:${studio.port}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json(),
    // The app's message boxes are answered with button n from now on, and their messages kept for asked().
    async answer(n) {
      await studio.app.evaluate(({ dialog }, n) => {
        globalThis.asked = globalThis.asked || [];
        dialog.showMessageBox = async (win, opts) => { globalThis.asked.push((opts || win).message); return { response: n }; };
      }, n);
    },
    asked: () => studio.app.evaluate(() => globalThis.asked || []),
    async until(fn, ms = 15000) {
      const end = Date.now() + ms;
      let last;
      while (Date.now() < end) { last = await fn(); if (last) return last; await wait(200); }
      throw new Error(`Gave up waiting after ${ms}ms. The app's log:\n${studio.log().slice(-2000)}`);
    },
    // Open Studio, as from the menu bar icon (or the Dock).
    open: () => studio.app.evaluate(({ app }) => app.emit('activate', {}, false)),
    // Open Studio and wait until its helper answers. With the port taken (by something else already listening, or
    // by something that got there first and made the helper exit with code 3) the app is started again on another
    // port, before anything else has been done with it.
    async onAir() {
      for (let attempt = 1; ; attempt++) {
        const taken = () => /Helper stopped \(code 3\)/.test(studio.log());
        const other = helperPid(studio.port);
        if (!other || startedBy(other, studio.app.process().pid)) {
          await studio.open();
          await studio.until(async () => taken() || await studio.answering());
          if (!taken()) return;
        }
        if (attempt === 3) assert.fail(`port ${studio.port} was taken ${attempt} times running`);
        await quit();
        fs.rmSync(path.join(local, 'logs'), { recursive: true, force: true });
        await start();
      }
    },
    // The window showing a Studio page (not the splash).
    studioWindow: () => studio.app.windows().find(w => w.url().startsWith(`http://localhost:${studio.port}`)),
  };
  await start();
  return studio;
}

// Whether a process was started by another, directly or further down (Linux's /proc: each process's parent).
function startedBy(pid, ancestor) {
  for (let p = pid, hops = 0; p > 1 && hops < 20; hops++) {
    if (p === ancestor) return true;
    try { p = Number(/\) \S+ (\d+)/.exec(fs.readFileSync(`/proc/${p}/stat`, 'utf8'))[1]); } catch { return false; }
  }
  return false;
}

// The helper's process id, from what's listening on its port (Linux's /proc: the socket's inode, then the process
// holding it).
function helperPid(port) {
  const hex = port.toString(16).toUpperCase().padStart(4, '0');
  const inodes = new Set();
  for (const f of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let text = '';
    try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    for (const line of text.split('\n').slice(1)) {
      const c = line.trim().split(/\s+/);
      if (c.length > 9 && c[1].endsWith(`:${hex}`) && c[3] === '0A') inodes.add(c[9]); // 0A: listening
    }
  }
  for (const pid of fs.readdirSync('/proc').filter(d => /^\d+$/.test(d))) {
    let fds = [];
    try { fds = fs.readdirSync(`/proc/${pid}/fd`); } catch { continue; }
    for (const fd of fds) {
      try { const m = /^socket:\[(\d+)\]$/.exec(fs.readlinkSync(`/proc/${pid}/fd/${fd}`)); if (m && inodes.has(m[1])) return Number(pid); } catch { /* gone */ }
    }
  }
  return null;
}

test('the app starts off air in the menu bar, and Open Studio puts it on air with the Output page', async t => {
  const studio = await launch(t);
  if (!studio) return;
  await studio.until(() => /Off air until Studio is opened/.test(studio.log()));
  assert.equal(await studio.answering(), false, 'nothing talks to PlayHQ until Studio is opened');
  assert.equal(studio.studioWindow(), undefined);
  await studio.onAir();
  const win = await studio.until(() => studio.studioWindow());
  await win.waitForLoadState('load');
  assert.equal(new URL(win.url()).pathname, '/');
  await win.waitForSelector('#sources');
  assert.match(studio.log(), /Helper running/);
});

test('a helper that crashes mid-stream is started again by itself, with the score and clock it had', async t => {
  const studio = await launch(t);
  if (!studio) return;
  await studio.onAir();
  await studio.post('/api/scoreboard', { type: 'score', side: 'home', delta: 2 });
  await studio.post('/api/scoreboard', { type: 'score', side: 'away', delta: 1 });
  await studio.post('/api/scoreboard', { type: 'clockStart' });
  await wait(1500); // the board is saved a moment after a change
  const pid = studio.helperPid();
  assert.ok(pid, 'the helper is listening');
  process.kill(pid, 'SIGKILL');
  await studio.until(async () => !(await studio.answering()), 5000);
  // Back within a few seconds, a new process, with the same score and the clock still running.
  await studio.until(() => studio.answering(), 15000);
  assert.notEqual(studio.helperPid(), pid);
  const b = await studio.get('/api/scoreboard');
  assert.deepEqual([b.home.score, b.away.score], [2, 1]);
  assert.equal(b.clock.running, true);
  assert.match(studio.log(), /Helper stopped \(code /);
  // The Output page comes back by itself.
  const win = studio.studioWindow();
  await win.waitForSelector('#sources', { timeout: 15000 });
});

test('closing the last Studio window asks first: Cancel stays on air, Take Off Air stops Studio', async t => {
  const studio = await launch(t);
  if (!studio) return;
  await studio.onAir();
  const win = await studio.until(() => studio.studioWindow());
  await win.waitForSelector('#sources');
  // Cancel: the window stays and Studio stays on air.
  await studio.answer(1);
  await studio.app.evaluate(({ BrowserWindow }, port) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes(`:${port}`)).close(), studio.port);
  await studio.until(async () => (await studio.asked()).length === 1);
  assert.deepEqual(await studio.asked(), ['Take Studio off air?']);
  await wait(500);
  assert.equal(await studio.answering(), true);
  assert.ok(studio.studioWindow(), 'the window is still open');
  // Take Off Air: the window closes and nothing answers on the port.
  await studio.answer(0);
  await studio.app.evaluate(({ BrowserWindow }, port) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes(`:${port}`)).close(), studio.port);
  await studio.until(async () => !(await studio.answering()));
  // The log reaches its file a moment after the port closes.
  await studio.until(() => /Helper stopped$/m.test(studio.log()));
  assert.match(studio.log(), /Last Studio window closed/);
  // Open Studio again: back on air.
  await studio.onAir();
});

test('the Socials tab\'s pictures are drawn by the app and saved as PNGs at their full size, see-through where they should be', async t => {
  const playhq = await startPlayhq(createWorld());
  t.after(() => playhq.close());
  const studio = await launch(t, { PLAYHQ_API_URL: playhq.url, PLAYHQ_SPECTATOR_URL: playhq.spectatorUrl, TZ: localZone(playhq.world.now).tz });
  if (!studio) return;
  await studio.onAir();
  const tpl = fs.readFileSync(path.join(ROOT, 'templates', 'Thunder League.json'));
  await fetch(`http://127.0.0.1:${studio.port}/api/setup-template`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: tpl });
  const pictures = path.join(studio.local, 'Pictures');
  // Finder is stubbed: on Linux, shell.showItemInFolder asks a file manager over D-Bus and can hold the app's main
  // process while it waits.
  await studio.app.evaluate(({ app, shell }, dir) => {
    app.setPath('pictures', dir);
    shell.openPath = async p => { globalThis.opened = p; return ''; };
    shell.showItemInFolder = p => { globalThis.shown = p; };
  }, pictures);
  const info = await studio.until(async () => { const s = await studio.get('/api/socials'); return s.nights && s.nights.length && s; });
  assert.equal(info.app, true, 'the helper knows the app is there to save them');
  const date = info.next;
  const saved = await studio.post('/api/socials/export', { date, set: 'upcoming', items: [
    { name: 'Game night fixture', link: `/social.html?kind=fixtures&size=story&date=${date}`, size: 'story' },
    { name: 'Polaroid', link: `/social.html?kind=polaroid&size=square&date=${date}`, size: 'square' },
  ] });
  assert.ok(!saved.error, saved.error);
  assert.deepEqual(saved.files, ['01 Game night fixture (story).png', '02 Polaroid (square).png']);
  const folder = path.join(pictures, 'FirstPass Studio', `Thunder League ${date} Upcoming`);
  assert.equal(await studio.app.evaluate(() => globalThis.opened), folder, 'Finder shows the folder');
  const png = f => fs.readFileSync(path.join(folder, f));
  const size = buf => [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  assert.deepEqual(size(png(saved.files[0])), [1080, 1920]);
  assert.deepEqual(size(png(saved.files[1])), [1080, 1080]);
  // The polaroid has no photo, so its window is see-through: the middle of the picture is clear, its corner isn't.
  const alpha = await studio.app.evaluate(({ nativeImage }, file) => {
    const img = nativeImage.createFromPath(file);
    const { width } = img.getSize();
    const bmp = img.toBitmap();
    const at = (x, y) => bmp[(y * width + x) * 4 + 3];
    return { middle: at(540, 500), corner: at(10, 10) };
  }, path.join(folder, saved.files[1]));
  assert.equal(alpha.middle, 0);
  assert.equal(alpha.corner, 255);
  // A played night's Results go in their own folder.
  const played = info.nights.filter(n => n.results).pop().date;
  const results = await studio.post('/api/socials/export', { date: played, set: 'results', items: [
    { name: 'Ladder Division 1', link: `/social.html?kind=ladder&size=story&date=${played}&division=Division%201`, size: 'story' }] });
  assert.ok(!results.error, results.error);
  assert.deepEqual(size(fs.readFileSync(path.join(pictures, 'FirstPass Studio', `Thunder League ${played} Results`, results.files[0]))), [1080, 1920]);
  // As a zip: one .zip beside the folder holding the folder's pictures, shown in Finder.
  const zipped = await studio.post('/api/socials/export', { date: played, set: 'results', zip: true, items: [
    { name: 'Results', link: `/social.html?kind=results&size=square&date=${played}`, size: 'square' }] });
  assert.ok(!zipped.error, zipped.error);
  assert.equal(zipped.zip, path.join('Pictures', 'FirstPass Studio', `Thunder League ${played} Results.zip`));
  const zipFile = path.join(pictures, 'FirstPass Studio', `Thunder League ${played} Results.zip`);
  assert.equal(await studio.app.evaluate(() => globalThis.shown), zipFile, 'Finder shows the zip');
  const list = await require('../zip').entries(zipFile);
  assert.deepEqual(list.map(e => e.name), [`Thunder League ${played} Results/01 Results (square).png`]);
  // Only the Socials tab's own picture is drawn.
  const r = await fetch(`http://127.0.0.1:${studio.port}/api/socials/export`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ date, items: [{ name: 'x', link: '/output.html', size: 'square' }] }) });
  assert.equal(r.status, 400);
});

test('Help > FirstPass Studio User Guide opens the guide in a window of its own, once', async t => {
  const studio = await launch(t);
  if (!studio) return;
  await studio.onAir();
  const win = await studio.until(() => studio.studioWindow());
  await win.waitForSelector('#sources');
  const choose = () => studio.app.evaluate(({ Menu }) => {
    const help = Menu.getApplicationMenu().items.find(i => i.role === 'help');
    help.submenu.items.find(i => i.label === 'FirstPass Studio User Guide').click();
  });
  const guides = () => studio.app.windows().filter(w => w.url().includes('/guide/'));
  await choose();
  const guide = (await studio.until(() => guides().length && guides()))[0];
  await guide.waitForLoadState('load');
  assert.match(await guide.title(), /FirstPass Studio User Guide/);
  // The Output page stays where it was, and choosing it again brings the same guide window forward.
  assert.equal(new URL(win.url()).pathname, '/');
  await choose();
  await wait(1000);
  assert.equal(guides().length, 1);
});
