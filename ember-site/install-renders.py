#!/usr/bin/env python3
"""
EMBER — render install pipeline.

Drop the eight new PNGs into a folder, point this at it, and it does the whole
job: crops each to the aspect ratio its container actually uses, exports WebP
q92, and writes the 480/768/1080 responsive variants the page already
references in its srcset.

    pip install pillow
    python3 install-renders.py ~/Downloads/ember-renders

Filenames it looks for (from ASSETMAP.txt) — extension can be .png/.jpg/.webp:

    01-colonnade-pool        02-swirl-blue          03-swirl-gold
    04-blue-razz-macro       05-passionfruit-macro  06-dual-splash-sunset
    07-dual-splash-dark      08-city-scale

Anything missing is skipped with a note; the page falls back to what is
already in assets/ and still renders correctly.
"""

import sys, os
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required:  pip install pillow")

HERE = Path(__file__).resolve().parent
ASSETS = HERE / "assets"

# source stem -> (output stem, target aspect W/H, crop bias 0..1 top->bottom)
# aspect matches the CSS container so nothing is squashed or letterboxed.
# Aspects follow each source's NATIVE ratio wherever the container allows it.
# These renders are 1536x1024, so every pixel cropped is resolution we cannot
# get back — the CSS was widened to match rather than the images cut to fit.
PLAN = {
    "01-colonnade-pool":     ("ember-hero",     16 / 10, 0.50),   # native 1.60, no crop
    "02-swirl-blue":         ("swirl-blue",     3 / 2,   0.50),   # native 1.50, no crop
    "03-swirl-gold":         ("swirl-gold",     3 / 2,   0.50),   # native 1.50, no crop
    "04-blue-razz-macro":    ("blue-razz",      4 / 5,   0.45),   # portrait card, centre-weighted
    "05-passionfruit-macro": ("passionfruit",   4 / 5,   0.45),
    "06-dual-splash-sunset": ("dual-sunset",    3 / 2,   0.50),
    "07-dual-splash-dark":   ("both-flavours",  4 / 5,   0.45),
    "08-city-scale":         ("city-scale",     16 / 9,  0.40),   # sky headroom absorbs it
}

VARIANTS = [480, 768, 1080]
EXTS = (".png", ".jpg", ".jpeg", ".webp", ".PNG", ".JPG", ".JPEG", ".WEBP")


def find(src_dir: Path, stem: str):
    for ext in EXTS:
        p = src_dir / f"{stem}{ext}"
        if p.exists():
            return p
    # tolerate a leading-number-free or differently-suffixed name
    for p in sorted(src_dir.iterdir()):
        if p.is_file() and p.suffix in EXTS and p.stem.lower().startswith(stem.lower()):
            return p
    return None


def crop_to(img: Image.Image, aspect: float, bias: float) -> Image.Image:
    w, h = img.size
    cur = w / h
    if abs(cur - aspect) < 0.001:
        return img
    if cur > aspect:                      # too wide -> trim sides, keep centre
        new_w = int(round(h * aspect))
        x = (w - new_w) // 2
        return img.crop((x, 0, x + new_w, h))
    new_h = int(round(w / aspect))        # too tall -> trim vertically at bias
    y = int(round((h - new_h) * bias))
    y = max(0, min(y, h - new_h))
    return img.crop((0, y, w, y + new_h))


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    src_dir = Path(sys.argv[1]).expanduser().resolve()
    if not src_dir.is_dir():
        sys.exit(f"Not a directory: {src_dir}")
    ASSETS.mkdir(exist_ok=True)

    done, missing = [], []
    for stem, (out, aspect, bias) in PLAN.items():
        src = find(src_dir, stem)
        if not src:
            missing.append(stem)
            continue

        img = Image.open(src).convert("RGB")
        native = img.size
        img = crop_to(img, aspect, bias)

        full = ASSETS / f"{out}.webp"
        img.save(full, "WEBP", quality=92, method=6)

        made = []
        for w in VARIANTS:
            if w >= img.width:
                continue          # never upscale past native
            h = int(round(w / aspect))
            img.resize((w, h), Image.LANCZOS).save(
                ASSETS / f"{out}-{w}.webp", "WEBP", quality=92, method=6)
            made.append(str(w))

        done.append(f"  {src.name}  {native[0]}x{native[1]}"
                    f"  ->  {out}.webp  {img.width}x{img.height}"
                    f"  (+{', '.join(made) or 'no'} variants)")

    # Rewrite the manifest so the page knows which optional layers to request.
    # Only the three that are optional matter here; the rest overwrite existing
    # filenames the page already references unconditionally.
    optional = [n for n in ("swirl-blue", "swirl-gold", "city-scale")
                if (ASSETS / f"{n}.webp").exists()]
    (ASSETS / "renders.js").write_text(
        "/* Which optional renders are installed in assets/.\n"
        "   install-renders.py rewrites this file automatically — you should not need to\n"
        "   edit it by hand. An empty list means the page uses its built-in treatment for\n"
        "   those acts and issues no requests for them. */\n"
        "window.EMBER_RENDERS = "
        + ("[" + ", ".join(f'"{n}"' for n in optional) + "]" if optional else "[]")
        + ";\n"
    )

    print("\nInstalled:")
    print("\n".join(done) if done else "  nothing — no matching files found")
    if missing:
        print("\nNot found (page falls back to existing assets, still renders):")
        for m in missing:
            print(f"  {m}")
    print(f"\nOptional layers now live: {', '.join(optional) or 'none'}")
    print(f"Wrote into {ASSETS}\n"
          "Reload the page — srcset already points at these filenames.\n")


if __name__ == "__main__":
    main()
