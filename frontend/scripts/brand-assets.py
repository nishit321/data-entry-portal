"""Derive the portal's brand assets from the Authority's seal.

    python scripts/brand-assets.py public/brand/nca-logo.jpeg public

Run from the `frontend` directory. Requires Pillow.

The supplied file is a JPEG: square, no transparency, on a near-white #F7F7F7 ground. The seal
itself is a circle, so the ground can be cut away cleanly rather than hidden behind a white chip.
That matters because the sidebar and the sign-in panel are navy: a light square would sit on them
like a sticker.

Run again if the source is ever replaced. Nothing here is hand-tuned to this file beyond the
background tolerance; the circle is measured, not assumed.
"""

import sys
from PIL import Image, ImageDraw

src_path, public_dir = sys.argv[1], sys.argv[2]
SS = 4  # supersampling factor, so the cut edge is smooth rather than stepped

im = Image.open(src_path).convert('RGB')
w, h = im.size
px = im.load()
bg = px[0, 0]


def is_background(c, tol=14):
    return all(abs(a - b) <= tol for a, b in zip(c, bg))


# Measure the seal rather than trusting it to be centred: it is not.
xs = [x for x in range(w) if any(not is_background(px[x, y]) for y in range(0, h, 2))]
ys = [y for y in range(h) if any(not is_background(px[x, y]) for x in range(0, w, 2))]
left, right, top, bottom = xs[0], xs[-1], ys[0], ys[-1]
side = max(right - left, bottom - top) + 1
cx, cy = (left + right) // 2, (top + bottom) // 2
print(f'seal: {side}px across, centred at ({cx}, {cy})')

box = (cx - side // 2, cy - side // 2, cx - side // 2 + side, cy - side // 2 + side)
seal = im.crop(box)

# A circular alpha mask, drawn large and shrunk so the edge is anti-aliased.
mask = Image.new('L', (side * SS, side * SS), 0)
ImageDraw.Draw(mask).ellipse((0, 0, side * SS - 1, side * SS - 1), fill=255)
mask = mask.resize((side, side), Image.LANCZOS)

full = seal.convert('RGBA')
full.putalpha(mask)

# 256px, not the source's full width. The seal is shown at 36 to 48px on screen and 48px on paper,
# where 256px still leaves roughly 500dpi. The untrimmed version was 280KB for a 36px mark, which
# is most of a page load spent on something the size of a thumbnail.
APP_PX = 256
transparent = full.resize((APP_PX, APP_PX), Image.LANCZOS)

# Cut to a palette before saving. The seal is four or five flat colours, but it arrived as a JPEG,
# and JPEG leaves a fine speckle across every flat area that PNG then has to store faithfully -
# 104KB of stored noise for a mark displayed at 36px. An octree palette throws the speckle away
# and is the one quantiser in Pillow that keeps the alpha channel.
PALETTE_COLOURS = 64
paletted = transparent.quantize(colors=PALETTE_COLOURS, method=Image.FASTOCTREE)
paletted.save(f'{public_dir}/brand/nca-logo.png', optimize=True)
print(f'wrote brand/nca-logo.png  ({APP_PX}px, {PALETTE_COLOURS} colours, for the app)')

# Email clients handle transparency badly and some force a dark ground, so this one keeps white.
on_white = Image.new('RGB', (side, side), (255, 255, 255))
on_white.paste(seal, (0, 0), mask)
on_white.resize((200, 200), Image.LANCZOS).save(
    f'{public_dir}/brand/nca-logo-email.png', optimize=True
)
print('wrote brand/nca-logo-email.png  (white ground, for email)')

# iOS composites a transparent icon onto black, so this one keeps white too.
on_white.resize((180, 180), Image.LANCZOS).save(
    f'{public_dir}/apple-touch-icon.png', optimize=True
)
print('wrote apple-touch-icon.png')

icon_sizes = [16, 32, 48, 64]
transparent.save(
    f'{public_dir}/favicon.ico',
    sizes=[(s, s) for s in icon_sizes],
)
print('wrote favicon.ico  ' + ', '.join(f'{s}x{s}' for s in icon_sizes))

transparent.resize((32, 32), Image.LANCZOS).save(f'{public_dir}/favicon-32.png', optimize=True)
print('wrote favicon-32.png')
