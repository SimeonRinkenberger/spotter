#!/usr/bin/env python3
"""Build docs/assets/pumpy/covers/<name>.webp from the owner's 1254x1254 PNGs.

    python3 tools/pumpy-covers.py [SOURCE_DIR]

SOURCE_DIR defaults to design/pumpy-cover-concepts beside this checkout: the
owner's originals, untracked, which this script only reads (from a worktree,
pass the main checkout's folder). Needs Pillow and cwebp (Homebrew `webp`).

Why 640x800. A Library tile is 4:5 (style.ts .thumbwrap) and at most ~196 CSS
px wide on an iPhone (440 pt Pro Max, two columns, 18 px gutters, 13 px gap),
so ~587 device px at 3x; the 13-inch iPad in landscape is four columns of
~323 CSS px at 2x, ~646. 640 wide covers every one of them at ~1:1. Nothing
draws a Pumpy cover larger: the detail has no header image, and Train's rows,
the pickers and the source chips are 40-55 CSS px.

Why the art is padded to 4:5 here rather than letterboxed in CSS. The old
category art was square and sat in the tile with object-fit: contain on a
fixed cream, and each drawing's own paper is a slightly different cream
(sampled corners: R 246-255, G 240-254, B 224-243), so a flat CSS band shows a seam
on some of them. Here each band is filled with the drawing's own edge colour,
column by column, the way Apple Music backs artwork with a colour taken from
the artwork; the band is smooth, and so is the paper at 640 (grain sd ~0.5-1
level), so there is no seam and the tile uses object-fit: cover like every
other card. A band costs almost nothing to encode. A drawing whose art runs
into its top or bottom edge sits against that edge, so a chain hanging from
the ceiling is not cut off in mid-air.

Why -q 75 -m 6 -sharp_yuv: the budget is ~1.5 MB for all 35. q75 is ~35 KB
a cover (1.18 MB in all; PSNR 36-38.5 dB, SSIM 0.95-0.98 against the padded
640x800 original); q80 would be 1.44 MB for +0.9 dB SSIM, which does not
survive the tile scaling 640 down to ~490 device px. sharp_yuv keeps the
orange-on-black outlines from bleeding at 4:2:0. The output is deterministic:
re-running this reproduces the committed files byte for byte.
"""
import os
import subprocess
import sys
import tempfile

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
DEFAULT_SRC = os.path.join(REPO, 'design', 'pumpy-cover-concepts')
OUT = os.path.join(REPO, 'docs', 'assets', 'pumpy', 'covers')
W, H = 640, 800
PAD = H - W
CWEBP = ['cwebp', '-quiet', '-q', '75', '-m', '6', '-sharp_yuv', '-metadata', 'none']


def median(values):
    s = sorted(values)
    return s[len(s) // 2]


def paper(px):
    """The drawing's paper: the per-channel median of its outermost ring."""
    ring = [px[x, 0] for x in range(W)] + [px[x, W - 1] for x in range(W)]
    ring += [px[0, y] for y in range(W)] + [px[W - 1, y] for y in range(W)]
    return tuple(median([c[i] for c in ring]) for i in range(3))


def near(c, bg, tol=36):
    return abs(c[0] - bg[0]) + abs(c[1] - bg[1]) + abs(c[2] - bg[2]) <= tol


def touches(px, bg, rows):
    """Art (not paper) within these rows: more than a speck of it."""
    hits = sum(1 for y in rows for x in range(W) if not near(px[x, y], bg, 60))
    return hits > 6


def band(px, bg, rows, reach=24):
    """One colour per column, from the paper in these edge rows around it."""
    out = []
    for x in range(W):
        pool = [px[i, y] for y in rows for i in range(max(0, x - reach), min(W, x + reach + 1))
                if near(px[i, y], bg)]
        out.append(tuple(median([c[k] for c in pool]) for k in range(3)) if pool else bg)
    return out


def build(src, dst):
    art = Image.open(src).convert('RGB').resize((W, W), Image.LANCZOS)
    px = art.load()
    bg = paper(px)
    top, bottom = touches(px, bg, range(0, 4)), touches(px, bg, range(W - 4, W))
    offset = 0 if top and not bottom else PAD if bottom and not top else PAD // 2
    canvas = Image.new('RGB', (W, H), bg)
    cv = canvas.load()
    if offset:
        colours = band(px, bg, range(0, 6))
        for y in range(offset):
            for x in range(W):
                cv[x, y] = colours[x]
    if offset < PAD:
        colours = band(px, bg, range(W - 6, W))
        for y in range(offset + W, H):
            for x in range(W):
                cv[x, y] = colours[x]
    canvas.paste(art, (0, offset))
    with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp:
        canvas.save(tmp.name)
    try:
        subprocess.run(CWEBP + [tmp.name, '-o', dst], check=True)
    finally:
        os.unlink(tmp.name)
    return offset


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SRC
    names = sorted(f[:-4] for f in os.listdir(src) if f.endswith('.png'))
    os.makedirs(OUT, exist_ok=True)
    total = 0
    for name in names:
        dst = os.path.join(OUT, name + '.webp')
        offset = build(os.path.join(src, name + '.png'), dst)
        size = os.path.getsize(dst)
        total += size
        where = {0: 'top', PAD: 'bottom'}.get(offset, 'centre')
        print('%-32s %6d bytes  art at %s' % (name, size, where))
    print('%d covers, %d bytes (%.2f MB), %d bytes each on average'
          % (len(names), total, total / 1048576, total // max(1, len(names))))


if __name__ == '__main__':
    main()
