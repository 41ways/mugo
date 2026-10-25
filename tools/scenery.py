"""첫 화면 창밖 그림 조각을 만든다.
raw/scn_*.png (제미나이, 자홍 바탕) → public/img/scn/*.webp (투명 바탕, 밤 색, 가까운 것은 가로 번짐)
사용: python tools/scenery.py
raw/ 는 그림을 뽑은 컴퓨터에만 있다.
"""
import json
import os

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'raw')
OUT = os.path.join(ROOT, 'public', 'img', 'scn')
os.makedirs(OUT, exist_ok=True)


def dewatermark(im, R=32):
    """오른쪽 아래 반짝이(4갈래 별)를 바깥 픽셀 중앙값으로 메운다."""
    im = im.convert('RGB')
    W, H = im.size
    cx, cy = W - 121, H - 121
    px = im.load()
    k = R ** (2 / 3)
    mask = {(x, y) for y in range(cy - R, cy + R + 1) for x in range(cx - R, cx + R + 1)
            if abs(x - cx) ** (2 / 3) + abs(y - cy) ** (2 / 3) <= k}
    while mask:
        done = []
        for (x, y) in mask:
            cols = [px[x + dx, y + dy] for dx in (-1, 0, 1) for dy in (-1, 0, 1)
                    if (x + dx, y + dy) not in mask and 0 <= x + dx < W and 0 <= y + dy < H]
            if len(cols) >= 3:
                px[x, y] = tuple(sorted(c[i] for c in cols)[len(cols) // 2] for i in range(3))
                done.append((x, y))
        if not done:
            break
        mask.difference_update(done)
    return im


def key(im):
    """자홍을 투명으로. 테두리 번짐을 걷고 자홍 기운을 뺀다. → float RGBA 배열(0~1 알파)"""
    a = np.array(im).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mm = np.clip((np.minimum(r, b) - g) / 255.0, 0, 1)
    alpha = np.clip(1 - (mm - 0.08) / 0.3, 0, 1)
    hole = ndimage.binary_dilation(alpha < 0.5, iterations=1)
    alpha = np.minimum(alpha, 1 - ndimage.gaussian_filter(hole.astype(np.float32), 0.8))
    spill = np.minimum(r, b) - g
    k = spill > 4
    a[..., 0] = np.where(k, np.minimum(r, g + 10), r)
    a[..., 2] = np.where(k, np.minimum(b, g + 2), b)
    a[alpha < 0.999] *= 0.45
    # 제미나이 그림은 가장자리에 어두운 테두리가 한 줄 있다 — 잘라 낸다
    alpha[:16], alpha[-16:], alpha[:, :16], alpha[:, -16:] = 0, 0, 0, 0
    return np.dstack([a[..., :3], alpha])


def night(rgba, dark):
    """밤으로 눌러 어둡게. 따뜻하게 켜진 불빛(창·등)은 남긴다."""
    rgb = rgba[..., :3]
    lum = rgb.mean(-1)
    warm = (rgb[..., 0] - rgb[..., 2])
    keep = np.clip((lum - 140) / 60, 0, 1) * np.clip((warm - 20) / 40, 0, 1)
    out = rgb * dark * (1 - keep[..., None]) + rgb * keep[..., None]
    rgba = rgba.copy()
    rgba[..., :3] = out
    return rgba


def blur_x(rgba, px, mode='constant'):
    """가로 번짐 — 빨리 지나가는 것일수록 길게. 알파를 곱한 채로 번지게 해서 테두리가 검게 안 뜬다."""
    if px < 1:
        return rgba
    k = np.ones(int(px) * 2 + 1) / (int(px) * 2 + 1)
    pre = rgba[..., :3] * rgba[..., 3:4]
    al = ndimage.convolve1d(rgba[..., 3], k, axis=1, mode=mode)
    pre = np.stack([ndimage.convolve1d(pre[..., i], k, axis=1, mode=mode) for i in range(3)], -1)
    rgb = pre / np.maximum(al[..., None], 1e-4)
    return np.dstack([rgb, al])


def crop(rgba, box=None):
    if box:
        x0, y0, x1, y1 = box
        rgba = rgba[y0:y1, x0:x1]
    ys, xs = np.where(rgba[..., 3] > 0.04)
    pad = 2
    return rgba[max(ys.min() - pad, 0):ys.max() + pad + 1, max(xs.min() - pad, 0):xs.max() + pad + 1]


def pick(rgba, cx, cy):
    """(cx, cy) 를 품은 그림 덩어리만 잘라낸다. 칸을 넘는 그림이 있어서 칸으로 자르면 안 된다."""
    m = ndimage.binary_dilation(rgba[..., 3] > 0.3, iterations=6)
    lab, _ = ndimage.label(m)
    k = lab[cy, cx]
    assert k, (cx, cy)
    sl = ndimage.find_objects(lab)[k - 1]
    out = rgba[sl].copy()
    out[..., 3] *= (lab[sl] == k)
    return crop(out)


def feather_x(rgba, n):
    """파노라마 이음매 — 양끝을 서서히 투명하게 해서 이어 붙일 때 겹쳐 녹인다."""
    rgba = rgba.copy()
    w = rgba.shape[1]
    ramp = np.ones(w)
    ramp[:n] = np.linspace(0, 1, n)
    ramp[w - n:] = np.linspace(1, 0, n)
    rgba[..., 3] *= ramp[None, :]
    return rgba


def save(rgba, name, h=None, q=82):
    im = Image.fromarray(np.dstack([rgba[..., :3].clip(0, 255), rgba[..., 3:4] * 255]).astype(np.uint8), 'RGBA')
    if h and im.height > h:
        im = im.resize((round(im.width * h / im.height), h), Image.LANCZOS)
    im.save(os.path.join(OUT, name + '.webp'), quality=q, method=6)
    return im.size


def load(name):
    return key(dewatermark(Image.open(os.path.join(RAW, name))))


meta = {}

# 먼 하늘·바다는 그대로 (img/title_scenery.webp)

# 중간 거리 파노라마 셋 — 땅 윗선이 그림 높이의 몇 % 인지도 적어 둔다
for nm, dark in (('hills', 0.62), ('lake', 0.7), ('moor', 0.5)):
    p = night(load('scn_%s.png' % nm), dark)
    ys = np.where(p[..., 3].max(1) > 0.5)[0]
    top = ys.min()
    p = feather_x(p[max(top - 20, 0):], 170)
    size = save(p, 'mid_' + nm, h=520)
    meta["mid_" + nm] = {"w": size[0], "h": size[1], "seam": 170 / p.shape[1]}

# 가까운 둑 풀숲 띠
if os.path.exists(os.path.join(RAW, 'scn_grass.png')):
    p = night(load('scn_grass.png'), 0.55)
    ys = np.where(p[..., 3].max(1) > 0.5)[0]
    p = feather_x(p[max(ys.min() - 10, 0):], 40)
    p = blur_x(p, 3)
    size = save(p, 'grass', h=360)
    meta['grass'] = {'w': size[0], 'h': size[1], 'seam': 40 / p.shape[1]}

# 가까운 것들 — 지나가는 빠르기에 맞춰 번지게
sheet = load('scn_sprites.png')
SPR = {'pine': (150, 200), 'bare': (470, 330), 'cottage': (860, 240), 'pole': (1210, 200),
       'fence': (205, 635), 'hay': (590, 610), 'lamp': (912, 600), 'man': (1210, 590)}
for nm, (x, y) in SPR.items():
    p = pick(sheet, x, y)
    p = night(p, 0.5 if nm != 'pole' else 0.32)
    p = blur_x(p, {'pole': 5, 'lamp': 2}.get(nm, 2))
    size = save(p, nm, h=420)
    meta[nm] = {'w': size[0], 'h': size[1]}

# 끼어드는 것들: 역 · 이름판 · 철교 · 마주 오는 객차 · 터널 바위
ev = load('scn_events.png')
EW, EH = ev.shape[1] // 2, ev.shape[0] // 2
sign = pick(ev, 140, 165)
size = save(night(sign, 0.6), 'sign')
meta['sign'] = {'w': size[0], 'h': size[1]}
st = pick(ev, 460, 330)
size = save(night(st, 0.55), 'station', h=420)
meta['station'] = {'w': size[0], 'h': size[1]}
br = pick(ev, 1025, 330)
size = save(blur_x(night(br, 0.35), 3), 'bridge', h=420)
meta['bridge'] = {'w': size[0], 'h': size[1]}
# 객차: 창 안이 자홍으로 비었으면 따뜻한 불빛으로 채운다(바깥과 이어지지 않은 구멍만)
car = pick(ev, 360, 620)
solid = ndimage.binary_fill_holes(car[..., 3] > 0.5)
holes = solid & (car[..., 3] < 0.5)
holes = ndimage.binary_dilation(holes, iterations=2) & solid
car[holes, 0:3] = np.array([236, 178, 104]) * (0.85 + 0.15 * np.random.default_rng(1).random((holes.sum(), 1)))
car[holes, 3] = 1
size = save(blur_x(night(car, 0.6), 16), 'train', h=420)
meta['train'] = {'w': size[0], 'h': size[1]}
# 터널: 바위 벽(왼쪽 바위만 잘라 세로로 길게 쓴다)과 돌 입구
for i, (x0, x1) in enumerate(((716, 872), (1180, 1334))):
    rock = ev[EH + 20:ev.shape[0] - 30, x0:x1].copy()
    rock[..., 3] = 1
    size = save(blur_x(night(rock, 0.45), 4, 'nearest'), 'rock%d' % i, h=420)
    meta['rock%d' % i] = {'w': size[0], 'h': size[1]}

with open(os.path.join(OUT, 'meta.json'), 'w', encoding='utf-8') as f:
    json.dump(meta, f, ensure_ascii=False, indent=1)
print(json.dumps(meta, ensure_ascii=False))
