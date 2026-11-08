// FirstPass Studio Mac app - saves the Socials tab's pictures (socials.js in the helper asks, over the app's message
// port): each one is the helper's social.html drawn off screen at its full size (1080 wide, up to 1920 tall) and
// saved as a PNG, see-through where the picture is, in Pictures/FirstPass Studio/<competition> <date> <set>/, and
// with zip ticked in <competition> <date> <set>.zip beside it as well. Then Finder shows the folder (or the zip), or
// the Mac's Share menu (AirDrop, Messages, Mail...) opens with the pictures (or the one zip).

'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ShareMenu, shell } = require('electron');

// Waits for social.html's window.socialReady (true, or a message when it has nothing to draw).
const READY = 'Promise.resolve(window.socialReady)';
const PICTURE_TIMEOUT_MS = 20000;
const SETTLE_MS = 300;

// One picture: a hidden, see-through window at the picture's size, drawn off screen; the first paint after the page
// says it's ready is the picture. Like the outputs' scene window (scenewindow.js), a size bigger than the screen
// falls back to half the size at twice the density.
async function take({ url, width, height }) {
  const make = scale => new BrowserWindow({
    width: width / scale, height: height / scale, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
    useContentSize: true, resizable: false, enableLargerThanScreen: true,
    webPreferences: { offscreen: { deviceScaleFactor: scale }, backgroundThrottling: false },
  });
  let win = make(1), scale = 1;
  const [cw, ch] = win.getContentSize();
  if (cw < width || ch < height) { win.destroy(); win = make(scale = 2); }
  try {
    const timeout = new Promise((resolve, reject) => setTimeout(() => reject(new Error('it took too long to draw')), PICTURE_TIMEOUT_MS));
    const picture = (async () => {
      // At half size, social.html draws itself at half size too (?fit=1), which the density doubles back.
      await win.loadURL(scale === 1 ? url : `${url}&fit=1`);
      const ready = await win.webContents.executeJavaScript(READY);
      if (ready !== true) throw new Error(String(ready || 'nothing to draw'));
      // Off screen, Chromium can hand over a frame from before the page finished drawing for a moment, so give it
      // a little time and take the second fresh frame.
      const frame = () => { const p = new Promise(resolve => win.webContents.once('paint', (e, dirty, image) => resolve(image))); win.webContents.invalidate(); return p; };
      await new Promise(r => setTimeout(r, SETTLE_MS));
      await frame();
      const image = await frame();
      const size = image.getSize();
      return size.width === width && size.height === height ? image : image.resize({ width, height, quality: 'best' });
    })();
    return await Promise.race([picture, timeout]);
  } finally {
    win.destroy();
  }
}

module.exports = function socials({ log }) {
  // msg: { type: 'socialsSave', id, folder, carousel, pictures: [{ label, url, width, height }], share, zip, quiet }.
  // Each picture is saved as "<NN> <label>.png", numbered in order. quiet (saved for a phone, which fetches them) opens
  // neither Finder nor the Share menu. Answers
  // { type: 'socialsSaved', id, folder, files, skipped: [{ name, reason }], zip, zipFile, shared } or { ..., error }.
  async function save(child, msg) {
    const answer = m => child.postMessage({ type: 'socialsSaved', id: msg.id, ...m });
    try {
      const folder = path.join(app.getPath('pictures'), 'FirstPass Studio', path.basename(String(msg.folder || 'Socials')));
      fs.mkdirSync(folder, { recursive: true });
      const fileOf = (p, n) => path.join(folder, path.basename(`${String(n).padStart(2, '0')} ${p.label}.png`));
      // A carousel picture draws its place (?page=2/6), so it needs the count of the pictures that are saved.
      const urlOf = (p, n, of) => (msg.carousel ? `${p.url}&page=${n}/${of}` : p.url);
      // A picture that can't be made (nothing to draw, or too slow to draw) is skipped and the rest are still saved.
      const all = msg.pictures || [];
      const files = [], skipped = [], kept = [];
      for (const [i, p] of all.entries()) {
        const file = fileOf(p, i + 1);
        let image;
        try {
          image = await take({ ...p, url: urlOf(p, i + 1, all.length) });
        } catch (err) {
          skipped.push({ name: path.basename(file, '.png'), reason: err.message });
          log(`Socials: skipped ${path.basename(file, '.png')}: ${err.message}`);
          continue;
        }
        fs.writeFileSync(file, image.toPNG());
        files.push(file);
        kept.push(p);
      }
      if (!files.length) {
        throw new Error(skipped.length === 1 ? `${skipped[0].name} couldn't be made: ${skipped[0].reason}`
          : `None of the ${skipped.length} pictures could be made. ${skipped[0].name}: ${skipped[0].reason}`);
      }
      // A carousel with a picture skipped draws the rest again, so they're marked 1/5, 2/5... and numbered without a gap.
      if (msg.carousel && skipped.length) {
        for (const f of files) fs.rmSync(f, { force: true });
        files.length = 0;
        for (const [i, p] of kept.entries()) {
          const file = fileOf(p, i + 1);
          fs.writeFileSync(file, (await take({ ...p, url: urlOf(p, i + 1, kept.length) })).toPNG());
          files.push(file);
        }
      }
      log(`Socials: saved ${files.length} pictures in ${folder}`);
      // The zip: the folder's pictures in a folder of the same name, beside it (written to .part first, so a zip that
      // is there is whole).
      let zip = null;
      if (msg.zip) {
        zip = `${folder}.zip`;
        const part = `${zip}.part`;
        const out = fs.createWriteStream(part);
        const done = new Promise((resolve, reject) => { out.on('finish', resolve); out.on('error', reject); });
        await require('../zip').write(out, files.map(f => ({ name: `${path.basename(folder)}/${path.basename(f)}`, file: f })));
        await done;
        fs.renameSync(part, zip);
        log(`Socials: zipped them in ${zip}`);
      }
      let shared = false;
      const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows().find(w => w.isVisible());
      if (msg.quiet) {
        // Saved for a phone: nothing opens on the Mac.
      } else if (msg.share && ShareMenu && process.platform === 'darwin' && win) {
        new ShareMenu({ filePaths: zip ? [zip] : files }).popup({ window: win });
        shared = true;
      } else if (zip) {
        shell.showItemInFolder(zip);
      } else {
        shell.openPath(folder);
      }
      const shown = f => path.join('Pictures', 'FirstPass Studio', path.basename(f));
      answer({ folder: shown(folder), files, skipped, zip: zip && shown(zip), zipFile: zip, shared });
    } catch (err) {
      log(`Socials: ${err.message}`);
      answer({ error: err.message });
    }
  }
  return {
    // A message from the helper; false when it isn't one of these.
    message(child, msg) {
      if (msg?.type !== 'socialsSave') return false;
      save(child, msg);
      return true;
    },
  };
};
