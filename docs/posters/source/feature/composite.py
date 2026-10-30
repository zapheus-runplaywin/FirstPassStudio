# Puts real Studio pictures on the green screens of the feature poster photos.
# python3 composite.py  ->  writes *-comp.jpg next to the photos in photos/
import cv2, numpy as np, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
P = lambda *a: os.path.join(HERE, *a)

def green(im):
    f = im.astype(np.int16); b, g, r = f[..., 0], f[..., 1], f[..., 2]
    return g - np.maximum(r, b)

def components(im, min_area=250):
    h = cv2.cvtColor(im, cv2.COLOR_BGR2HSV)
    m = cv2.inRange(h, (40, 120, 100), (80, 255, 255))
    n, lab, st, _ = cv2.connectedComponentsWithStats(m)
    return lab, [(i, st[i]) for i in range(1, n) if st[i, 4] >= min_area]

def order(pts):
    # clockwise from top left
    pts = np.array(pts, np.float32).reshape(-1, 2); c = pts.mean(0)
    pts = pts[np.argsort(np.arctan2(pts[:, 1] - c[1], pts[:, 0] - c[0]))]
    return np.roll(pts, -int(pts.sum(1).argmin()), axis=0)

def quad(mask):
    cs, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    hull = cv2.convexHull(np.vstack(cs))
    peri = cv2.arcLength(hull, True)
    for e in np.linspace(0.005, 0.1, 60):
        a = cv2.approxPolyDP(hull, e * peri, True)
        if len(a) == 4: return order(a), hull
    return order(cv2.boxPoints(cv2.minAreaRect(hull))), hull

def fit(src, aspect, left=False):
    # crop src to aspect w/h, keeping the top and the centre (or the left)
    h, w = src.shape[:2]
    if w / h > aspect: nw = int(h * aspect); x = 0 if left else (w - nw) // 2; return src[:, x:x + nw]
    nh = int(w / aspect); return src[:nh]

def put(im, mask, src, q=None, crop=True, left=False, glow=1.0, grow=1.5):
    if q is None: q, hull = quad(mask)
    else: hull = cv2.convexHull(q.astype(np.int32))
    c = q.mean(0); q = c + (q - c) * (1 + grow / max(1, np.linalg.norm(q[0] - q[2]) / 2))
    wq = (np.linalg.norm(q[1] - q[0]) + np.linalg.norm(q[2] - q[3])) / 2
    hq = (np.linalg.norm(q[3] - q[0]) + np.linalg.norm(q[2] - q[1])) / 2
    if crop: src = fit(src, wq / hq, left)
    sh, sw = src.shape[:2]
    M = cv2.getPerspectiveTransform(np.float32([[0, 0], [sw, 0], [sw, sh], [0, sh]]), q)
    warped = cv2.warpPerspective(src, M, (im.shape[1], im.shape[0]), flags=cv2.INTER_AREA, borderMode=cv2.BORDER_REPLICATE)
    region = np.zeros(im.shape[:2], np.uint8); cv2.fillConvexPoly(region, hull.reshape(-1, 2), 255)
    region = cv2.dilate(region, np.ones((7, 7), np.uint8))
    a = np.clip((green(im) - 15) / 70.0, 0, 1) * (region / 255.0)
    a = cv2.GaussianBlur(a.astype(np.float32), (3, 3), 0)[..., None]
    warped = np.clip(warped.astype(np.float32) * glow, 0, 255)
    out = im.astype(np.float32) * (1 - a) + warped * a
    # despill leftover green fringes inside the region
    # and the green light the screen threw on hands and keyboards nearby
    near = cv2.dilate(region, np.ones((241, 121), np.uint8)) > 0
    o = out; mx = np.maximum(o[..., 0], o[..., 2]); sel = near & (o[..., 1] > mx)
    o[..., 1][sel] = mx[sel]
    return o.astype(np.uint8)

def rd(p):
    im = cv2.imread(p, cv2.IMREAD_UNCHANGED)
    if im is None: sys.exit('missing ' + p)
    if im.ndim == 3 and im.shape[2] == 4: im = im[..., :3]
    return im

def base_copy(im, base, m):
    # keep the screens done so far, but restore this screen's green so its key is clean
    out = im.copy(); r = cv2.dilate(m, np.ones((15, 15), np.uint8)) > 0
    out[r] = base[r]; return out

def build(photo, jobs, out):
    base = rd(P('photos', photo)); lab, _ = components(base); im = base.copy()
    for ids, src, kw in jobs:
        m = np.isin(lab, ids).astype(np.uint8) * 255
        im = put(base_copy(im, base, m), m, rd(P('screens', src)), **kw)
    cv2.imwrite(P('photos', out), im, [cv2.IMWRITE_JPEG_QUALITY, 93])

if __name__ == '__main__':
    build('hero-arena.jpg', [
        ([4], 'clash.jpg', {}), ([17], 'planner.jpg', {'left': True}), ([15], 'commentator-stats.jpg', {}),
        ([16], 'output.jpg', {}), ([8], 'socials-matchup.jpg', {}), ([25], 'scene.jpg', {}), ([20], 'scene.jpg', {}),
    ], 'hero-arena-comp.jpg')
    build('big-screen-sponsors.jpg', [
        ([81], 'fulltime.jpg', {}), ([95, 92, 100, 103, 102], 'board-1.jpg', {'crop': False}),
        ([91, 98, 93, 99, 94], 'board-2.jpg', {'crop': False}), ([96], 'board-3.jpg', {'crop': False}),
    ], 'big-screen-sponsors-comp.jpg')
    build('commentary-desk.jpg', [([4], 'planner.jpg', {'left': True}), ([3], 'commentator-stats.jpg', {})], 'commentary-desk-comp.jpg')
    build('fan-phone.jpg', [([1], 'socials-results.jpg', {})], 'fan-phone-comp.jpg')
    build('production-table.jpg', [([3], 'output.jpg', {}), ([1], 'scene.jpg', {}), ([2], 'control.jpg', {})], 'production-table-comp.jpg')
