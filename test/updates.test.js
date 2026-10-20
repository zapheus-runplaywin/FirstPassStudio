// The Mac app's updates (desktop/updates.js) always install the newest version: an update that
// came out after another had downloaded installs in one restart, not two.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdates } = require('../desktop/updates.js');

// Stands in for electron-updater's autoUpdater. publish() puts a version on GitHub; a check
// finds the newest and downloads it, firing update-downloaded when finished.
function fakeUpdater() {
  const u = new EventEmitter();
  u.latest = null; u.current = '0.3.10'; u.installs = []; u.checks = 0; u.offline = false; u.slow = false;
  u.publish = v => { u.latest = v; };
  u.checkForUpdates = async () => {
    u.checks++;
    if (u.offline) throw new Error('getaddrinfo ENOTFOUND github.com');
    if (!u.latest || u.latest === u.current) return { isUpdateAvailable: false, updateInfo: { version: u.current } };
    const version = u.latest;
    const downloadPromise = new Promise(resolve => setTimeout(() => {
      u.emit('update-downloaded', { version });
      resolve([`/cache/FirstPass-Studio-${version}-arm64-mac.zip`]);
    }, u.slow ? 20 : 0));
    return { isUpdateAvailable: true, updateInfo: { version }, downloadPromise };
  };
  // What Squirrel would install: the newest download at the moment it's handed over.
  u.downloaded = null;
  u.on('update-downloaded', info => { u.downloaded = info.version; });
  u.quitAndInstall = () => { u.installs.push({ version: u.downloaded, relaunch: u.autoRunAppAfterInstall, autoInstallOnAppQuit: u.autoInstallOnAppQuit }); };
  return u;
}

const settle = () => new Promise(r => setTimeout(r, 30));

test('downloads are not handed to Squirrel as they arrive, so a newer one can replace them', async () => {
  const u = fakeUpdater();
  const updates = createUpdates({ updater: u });
  assert.equal(u.autoInstallOnAppQuit, false);
  assert.equal(u.autoDownload, true);
  u.publish('0.3.11');
  await (await updates.check()).downloadPromise;
  u.publish('0.3.12');
  await (await updates.check()).downloadPromise;
  assert.equal(u.installs.length, 0);
  assert.deepEqual(updates.state(), { ready: '0.3.12', fetching: null, installing: false });
});

test('Restart to update installs a version that came out after the last download, in one restart', async () => {
  const u = fakeUpdater();
  u.slow = true;
  const changes = [];
  const updates = createUpdates({ updater: u, onChange: () => changes.push(updates.state()) });
  u.publish('0.3.11');
  await (await updates.check()).downloadPromise;
  u.publish('0.3.12'); // out since, not downloaded yet
  updates.restartToUpdate();
  await settle();
  assert.equal(u.installs.length, 1);
  assert.deepEqual(u.installs[0], { version: '0.3.12', relaunch: true, autoInstallOnAppQuit: false });
  assert.ok(changes.some(s => s.fetching === '0.3.12'), 'the menu shows the newer version downloading');
  assert.deepEqual(updates.state(), { ready: '0.3.12', fetching: null, installing: true });
});

test('Restart to update with nothing newer installs the downloaded version straight away', async () => {
  const u = fakeUpdater();
  const updates = createUpdates({ updater: u });
  u.publish('0.3.11');
  await (await updates.check()).downloadPromise;
  updates.restartToUpdate();
  await settle();
  assert.deepEqual(u.installs.map(i => i.version), ['0.3.11']);
});

test('Restart to update offline still installs what has downloaded', async () => {
  const logs = [];
  const u = fakeUpdater();
  const updates = createUpdates({ updater: u, log: m => logs.push(m) });
  u.publish('0.3.11');
  await (await updates.check()).downloadPromise;
  u.offline = true;
  updates.restartToUpdate();
  await settle();
  assert.deepEqual(u.installs.map(i => i.version), ['0.3.11']);
  assert.ok(logs.some(m => /Couldn't check for a newer version, installing 0\.3\.11: getaddrinfo ENOTFOUND/.test(m)));
});

test('quitting installs the newest download without checking again and without reopening', async () => {
  const u = fakeUpdater();
  let installed = false;
  const updates = createUpdates({ updater: u, onInstall: () => { installed = true; } });
  u.publish('0.3.11');
  await (await updates.check()).downloadPromise;
  u.publish('0.3.12');
  await (await updates.check()).downloadPromise;
  const checks = u.checks;
  assert.equal(updates.pending(), true);
  updates.installOnQuit();
  await settle();
  assert.equal(u.checks, checks);
  assert.deepEqual(u.installs, [{ version: '0.3.12', relaunch: false, autoInstallOnAppQuit: false }]);
  assert.equal(installed, true);
  assert.equal(updates.pending(), false, 'a second quit does not hand it over again');
});

test('nothing downloaded: quitting and restarting install nothing', async () => {
  const u = fakeUpdater();
  const updates = createUpdates({ updater: u });
  assert.equal(updates.pending(), false);
  assert.equal(await updates.installOnQuit(), false);
  assert.equal(await updates.restartToUpdate(), false);
  assert.equal(u.installs.length, 0);
});

test('an install that fails reports false and leaves the update ready to try again', async () => {
  const u = fakeUpdater();
  const logs = [];
  const updates = createUpdates({ updater: u, log: m => logs.push(m) });
  u.publish('0.3.11');
  await (await updates.check()).downloadPromise;
  u.quitAndInstall = () => setTimeout(() => u.emit('error', new Error('Code signature did not match\nmore detail')), 0);
  assert.equal(await updates.installOnQuit(), false);
  assert.ok(logs.includes("[update] Couldn't install 0.3.11: Code signature did not match"));
  assert.deepEqual(updates.state(), { ready: '0.3.11', fetching: null, installing: false });
  assert.equal(updates.pending(), true);
  assert.equal(u.listenerCount('error'), 0, 'its error listener is removed');
});

test('an install that never finishes gives up after the timeout', async () => {
  const u = fakeUpdater();
  const updates = createUpdates({ updater: u, installTimeout: 10 });
  u.publish('0.3.11');
  await (await updates.check()).downloadPromise;
  u.quitAndInstall = () => {};
  const keepAlive = setTimeout(() => {}, 1000);
  assert.equal(await updates.installOnQuit(), false);
  clearTimeout(keepAlive);
  assert.equal(updates.pending(), true);
});
