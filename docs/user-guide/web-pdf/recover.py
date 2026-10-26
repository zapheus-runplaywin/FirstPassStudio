"""Rebuilds ../img-web (the full-size JPEGs the web PDF is made from, not committed) when the screenshot run that
made them isn't to hand: each picture is taken back out of the current web PDF, matched to its screenshot in
../img by eye (a small greyscale copy), and saved under that name. Close ups (img-web/crop) match a crop of the
screenshot from zoom.json. Anything the PDF doesn't hold comes from the WebP in ../img at its own size.
Run before render.js when only the words have changed: python3 recover.py (needs pdfimages and Pillow)."""
import glob, json, os, shutil, subprocess, tempfile
from PIL import Image, ImageChops, ImageStat
HERE = os.path.dirname(os.path.abspath(__file__)); GUIDE = os.path.join(HERE, '..'); WEB = os.path.join(GUIDE, 'img-web')
zoom = json.load(open(os.path.join(HERE, 'zoom.json')))
crop = lambda im, z: im.crop((round(z[0] * im.width), round(z[1] * im.height), round((z[0] + z[2]) * im.width), round((z[1] + z[3]) * im.height)))
shots = {}
for f in glob.glob(os.path.join(GUIDE, 'img', '*.webp')):
    n = os.path.basename(f)[:-5]; shots[n] = Image.open(f).convert('RGB')
    if n in zoom: shots['crop/' + n] = crop(shots[n], zoom[n])
small = lambda im: im.convert('L').resize((48, 27))
found = {}
with tempfile.TemporaryDirectory() as tmp:
    subprocess.run(['pdfimages', '-j', os.path.join(GUIDE, 'FirstPass Studio User Guide (web).pdf'), os.path.join(tmp, 'x')], check=True)
    for f in sorted(glob.glob(os.path.join(tmp, '*.jpg'))):
        im = Image.open(f).convert('RGB'); ar = im.width / im.height
        near = sorted((ImageStat.Stat(ImageChops.difference(small(im), small(s))).mean[0], n) for n, s in shots.items() if abs(s.width / s.height - ar) / ar < 0.03)
        if near and near[0][0] < 12 and im.width > found.get(near[0][1], (None, 0))[1]: found[near[0][1]] = (im, im.width)
    os.makedirs(os.path.join(WEB, 'crop'), exist_ok=True)
    for n, s in shots.items():
        im = found[n][0] if n in found else s
        im.save(os.path.join(WEB, n + '.jpg'), quality=92)
print(len(found), 'pictures from the PDF,', len(shots) - len(found), 'from the WebPs')
