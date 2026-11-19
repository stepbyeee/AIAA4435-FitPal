"""Cuts one rendered skeleton into the separate bones the overlay places on a tracked body.

Source: "Pelvis (male) 00 - anterior view.png" from Wikimedia Commons, a BodyParts3D render
(c) The Database Center for Life Science, licensed CC BY-SA 2.1 Japan.
https://commons.wikimedia.org/wiki/File:Pelvis_(male)_00_-_anterior_view.png

Usage: python3 scripts/cut-bones.py path/to/source.png   (needs Pillow)
Writes src/assets/bones/*.png and bones.json: where each piece sits in the source render, and
where the joints are in it. The overlay maps those joints onto the tracked ones.
"""
import json
import math
import os
import sys
from collections import deque

from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'assets', 'bones')
src = Image.open(sys.argv[1]).convert('RGB')
W, H = src.size
px = src.load()

# Joints, read off the render. "R" is the person's right, which is the image's left.
J = {
    'earR': (517, 102), 'earL': (607, 102),
    'shoulderR': (460, 232), 'shoulderL': (667, 232),
    'elbowR': (420, 414), 'elbowL': (700, 414),
    'wristR': (397, 563), 'wristL': (728, 563),
    'indexR': (398, 618), 'indexL': (729, 618),
    'hipR': (510, 568), 'hipL': (625, 568),
    'kneeR': (512, 834), 'kneeL': (610, 834),
    'ankleR': (510, 1052), 'ankleL': (612, 1052),
    'toeR': (482, 1093), 'toeL': (642, 1093),
}
mid = lambda a, b: ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
J['neck'] = mid(J['shoulderR'], J['shoulderL'])
J['pelvis'] = mid(J['hipR'], J['hipL'])

# 1. Background: the large areas of exact white. Small white specks are highlights on bone.
WHITE = (255, 255, 255)
label = bytearray(W * H)  # 0 unknown, 1 background, 2 not background
for start in range(W * H):
    if label[start] or px[start % W, start // W] != WHITE:
        continue
    seen = [start]
    label[start] = 2
    queue = deque(seen)
    while queue:
        i = queue.popleft()
        x, y = i % W, i // W
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < W and 0 <= ny < H:
                n = ny * W + nx
                if not label[n] and px[nx, ny] == WHITE:
                    label[n] = 2
                    seen.append(n)
                    queue.append(n)
    if len(seen) >= 20:
        for i in seen:
            label[i] = 1
is_bg = lambda x, y: not (0 <= x < W and 0 <= y < H) or label[y * W + x] == 1

def is_red(c):
    return c[0] - c[1] > 22 and c[0] - c[2] > 22

# 2. One RGBA master: background cleared, edges softened, the red pelvis turned back to bone.
TINT = (1.0, 0.972, 0.915)  # the render is neutral grey; bone is slightly warm
master = Image.new('RGBA', (W, H), (0, 0, 0, 0))
mp = master.load()
red = bytearray(W * H)
for y in range(H):
    for x in range(W):
        if is_bg(x, y):
            continue
        r, g, b = px[x, y]
        alpha = 255
        if is_red((r, g, b)):
            red[y * W + x] = 1
            # A red surface is diffuse red plus white highlight: the highlight is the green channel.
            alpha = min(255, int((r - g - 22) / 45 * 255)) if r - g < 67 else 255
            v = min(255, int(0.92 * (r - g) + g + 12))
            r = g = b = v
        elif any(is_bg(x + dx, y + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
            # A light pixel on the outline is bone blended into the white behind it.
            lightest = min(r, g, b)
            if lightest > 205:
                a = max(0.3, (255 - lightest) / 50)
                alpha = int(255 * a)
                r, g, b = (max(0, min(255, int((c - 255 * (1 - a)) / a))) for c in (r, g, b))
        mp[x, y] = (int(r * TINT[0]), int(g * TINT[1]), int(b * TINT[2]), alpha)

def along(a, b, x, y):
    """Distance along a->b and distance from that line, in pixels."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    L = math.hypot(dx, dy)
    t = ((x - a[0]) * dx + (y - a[1]) * dy) / L
    d = abs((x - a[0]) * dy - (y - a[1]) * dx) / L
    return t, d, L

def limb(a, b, before, after, radius):
    """Pixels beside the line a->b: from `before` px ahead of a to `after` px past b, within radius(t, L)."""
    def test(x, y):
        t, d, L = along(a, b, x, y)
        return -before <= t <= L + after and d <= radius(t, L)
    return test

def box(x0, y0, x1, y1):
    return lambda x, y: x0 <= x <= x1 and y0 <= y <= y1

def humerus(side):
    return limb(J['shoulder' + side], J['elbow' + side], 18, 3, lambda t, L: 19 if t < 20 else 24 if t > L - 30 else 17)

def femur(side):
    return limb(J['hip' + side], J['knee' + side], 26, 4, lambda t, L: 42 if t < L * 0.35 else 34 if t > L - 45 else 30)

def torso(x, y):
    if not (436 <= x <= 692 and 163 <= y <= 512) or red[y * W + x]:
        return False
    if y > 470 and abs(x - 565) > 38:  # below the ribs only the backbone belongs here
        return False
    for side in 'RL':  # the arm hangs over the ribs in the render; it is its own piece
        t, d, _ = along(J['shoulder' + side], J['elbow' + side], x, y)
        if t >= 12 and d <= 20:
            return False
    return True

PIECES = {
    'skull': lambda x, y: y < 166 and 500 <= x <= 625,
    'torso': torso,
    'pelvis': lambda x, y: bool(red[y * W + x]),
}
for s in 'RL':
    not_red = lambda f: (lambda x, y: f(x, y) and not red[y * W + x])
    PIECES['humerus' + s] = humerus(s)
    PIECES['forearm' + s] = limb(J['elbow' + s], J['wrist' + s], 3, 2, lambda t, L: 21)
    PIECES['femur' + s] = not_red(femur(s))
    PIECES['shin' + s] = limb(J['knee' + s], J['ankle' + s], 4, 8, lambda t, L: 34 if t < 40 else 26)
PIECES['handR'] = box(340, 561, 440, 680)
PIECES['handL'] = box(690, 561, 790, 680)
PIECES['footR'] = box(455, 1047, 548, H)
PIECES['footL'] = box(575, 1047, 668, H)

def drop_crumbs(piece, smallest=140):
    """Clears islands too small to be bone: slivers of a neighbour's outline left by the cut."""
    pp = piece.load()
    done = bytearray(W * H)
    for start in range(W * H):
        if done[start] or not pp[start % W, start // W][3]:
            continue
        island = [start]
        done[start] = 1
        queue = deque(island)
        while queue:
            i = queue.popleft()
            x, y = i % W, i // W
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < W and 0 <= ny < H:
                    n = ny * W + nx
                    if not done[n] and pp[nx, ny][3]:
                        done[n] = 1
                        island.append(n)
                        queue.append(n)
        if len(island) < smallest:
            for i in island:
                pp[i % W, i // W] = (0, 0, 0, 0)

pieces = {}
for name, inside in PIECES.items():
    piece = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    pp = piece.load()
    for y in range(H):
        for x in range(W):
            if mp[x, y][3] and inside(x, y):
                pp[x, y] = mp[x, y]
    drop_crumbs(piece)
    x0, y0, x1, y1 = piece.getbbox()
    piece.crop((x0, y0, x1, y1)).save(os.path.join(OUT, name + '.png'), optimize=True)
    pieces[name] = {'x': x0, 'y': y0, 'width': x1 - x0, 'height': y1 - y0}

with open(os.path.join(OUT, 'bones.json'), 'w') as f:
    json.dump({'joints': {k: [round(v[0], 1), round(v[1], 1)] for k, v in J.items()}, 'pieces': pieces}, f, indent=2)
    f.write('\n')
print(json.dumps(pieces))
