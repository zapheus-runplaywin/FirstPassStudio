"""Resizes each picture to 1.6 times the width it is shown at in the web PDF (sizes.json from render.js)."""
import json, os, sys
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, 'out', 'img'); os.makedirs(OUT, exist_ok=True)
sizes = json.load(open(os.path.join(HERE, 'out', 'sizes.json')))
mapping = {}
for src, w in sizes.items():
    path = os.path.normpath(os.path.join(HERE, src))
    if not path.endswith('.jpg') or not os.path.exists(path): continue
    im = Image.open(path).convert('RGB')
    target = min(im.width, round(w * 1.6))
    name = src.replace('../', '').replace('/', '_')
    if target < im.width: im = im.resize((target, round(im.height * target / im.width)), Image.LANCZOS)
    im.save(os.path.join(OUT, name), quality=82, optimize=True)
    mapping[src] = 'out/img/' + name
json.dump(mapping, open(os.path.join(HERE, 'out', 'shrunk.json'), 'w'))
print(len(mapping), 'pictures')
