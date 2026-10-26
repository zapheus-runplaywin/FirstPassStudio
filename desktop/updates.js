// Updates for the Mac app, from GitHub Releases (the publish setting in package.json), by
// electron-updater. main.js passes in its autoUpdater; the tests pass a stand-in.
//
// Underneath, macOS's updater (Squirrel.Mac) holds one update at a time and won't take another
// until the app restarts. electron-updater hands it each update as soon as it downloads, so an
// app that had downloaded 0.3.11 still installed 0.3.11 after 0.3.12 had come out (the menu even
// said 0.3.12), and then had to restart a second time for 0.3.12. So here downloads stay with
// electron-updater, each newer one replacing the last, and Squirrel is handed the newest only when
// it's installed: "Restart to update" checks once more for anything newer first (and asks before
// getting it instead of the version the menu named), and quitting installs the newest one downloaded.

'use strict';

// How long handing the update to Squirrel (it unzips it and checks its signature) may take.
const INSTALL_TIMEOUT = 90 * 1000;

// onInstall runs just before the update is handed over (the app quits soon after).
function createUpdates({ updater, log = () => {}, onChange = () => {}, onInstall = () => {}, installTimeout = INSTALL_TIMEOUT }) {
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = false; // hand() gives it to Squirrel instead, see above
  let ready = null, fetching = null, installing = false;

  updater.on('update-downloaded', info => { ready = info.version; onChange(); });

  function state() { return { ready, fetching, installing }; }

  // An update has downloaded and nothing is installing it yet.
  function pending() { return !!ready && !installing && !fetching; }

  function check() { return updater.checkForUpdates(); }

  // A version newer than the one downloaded, if one has come out since; askNewer(ready, newer)
  // says whether to get it first (it downloads, then installs) or install the one downloaded. The
  // check itself downloads nothing, so the downloaded version stays there to install. A check that
  // fails (offline, GitHub busy) installs what's already downloaded.
  async function fetchNewest(askNewer) {
    const auto = updater.autoDownload;
    try {
      updater.autoDownload = false;
      const r = await updater.checkForUpdates();
      updater.autoDownload = auto;
      const newer = r && r.isUpdateAvailable && r.updateInfo.version !== ready ? r.updateInfo.version : null;
      if (!newer) return;
      if (!await askNewer(ready, newer)) { log(`[update] ${newer} is out, installing ${ready} as chosen`); return; }
      fetching = newer;
      onChange();
      log(`[update] ${newer} came out since ${ready} downloaded: downloading it first, as chosen`);
      await updater.downloadUpdate();
    } catch (err) {
      log(`[update] Couldn't check for a newer version, installing ${ready}: ${String(err && err.message).split('\n')[0]}`);
    } finally {
      updater.autoDownload = auto;
      fetching = null;
    }
  }

  // Hands the downloaded update to Squirrel, which quits the app and installs it (and opens it
  // again when relaunch is true). Resolves false if that fails or takes too long; on success the
  // app quits.
  function hand(relaunch) {
    installing = true;
    onChange();
    return new Promise(resolve => {
      const failed = err => {
        clearTimeout(timer);
        updater.removeListener('error', failed);
        log(`[update] Couldn't install ${ready}: ${String(err && err.message).split('\n')[0]}`);
        installing = false;
        onChange();
        resolve(false);
      };
      const timer = setTimeout(() => failed(new Error(`not ready after ${installTimeout / 1000} s`)), installTimeout);
      if (timer.unref) timer.unref();
      updater.once('error', failed);
      updater.autoRunAppAfterInstall = relaunch;
      onInstall();
      log(`[update] Installing ${ready}${relaunch ? ' and restarting' : ' as the app quits'}`);
      updater.quitAndInstall();
    });
  }

  // "Restart to update": the version downloaded, or a newer one if askNewer says so, then restart.
  async function restartToUpdate({ askNewer = async () => false } = {}) {
    if (!pending()) return false;
    await fetchNewest(askNewer);
    if (!ready || installing) return false;
    return hand(true);
  }

  // Quitting: the newest version downloaded, without a check that could hold the quit up.
  function installOnQuit() {
    if (!pending()) return Promise.resolve(false);
    return hand(false);
  }

  return { check, state, pending, restartToUpdate, installOnQuit };
}

module.exports = { createUpdates, INSTALL_TIMEOUT };
