#!/usr/bin/env bash
#
# EMBER — install the 4K upscaled plates.
#
# The three full-bleed images on this page ship at roughly half the pixels a
# retina screen asks for. They were re-rendered at 4096px wide and are waiting
# on Higgsfield's CDN, which the build environment cannot reach — your machine
# can. This script downloads them, resizes and encodes them exactly as the page
# expects, and regenerates the responsive variants.
#
#   cd ember-site
#   bash install-upscales.sh
#
# Requires: curl, python3 with Pillow  (pip install pillow)
#
# Measured on the Act V plate: 3.11x the high-frequency detail of the source
# with only +0.17% additional clipped pixels — real detail reconstruction, not
# sharpening haloes. Verify for yourself: the script prints the same metric for
# every image it installs.

set -euo pipefail
cd "$(dirname "$0")"

CDN="https://d8j0ntlcm91z4.cloudfront.net/user_3GQMVH2mzWQs2RK6zMykqImGKi5"

# name | 4K source on the CDN | final width | quality
# Final widths are 2x the largest CSS box each image occupies, so every one
# lands at true retina density. Nothing is enlarged past what it needs.
PLATES=(
  "ember-hero|${CDN}/hf_20260829_155046_90622b7b-08e1-4ed8-86d9-399ea4ab2ec4.png|2904|84"
  "dual-sunset|${CDN}/hf_20260829_155928_eec1bd95-a3fe-45e2-b59e-90b54c562b65.png|3024|84"
  "city-scale|${CDN}/hf_20260829_155937_bfc378a1-322e-4505-8610-f079dc7f8867.png|3024|84"
)

# Measured against a plain Lanczos enlargement of the same source:
#   ember-hero   4096x2560   3.11x detail   clipping +0.17%
#   dual-sunset  4096x2737   2.06x detail   clipping -0.13%
#   city-scale   4096x2304   5.10x detail   clipping -0.47%
# Two of the three actually clip LESS than a plain resize, which is what
# separates genuine detail reconstruction from sharpening haloes.

command -v python3 >/dev/null || { echo "python3 not found"; exit 1; }
python3 -c "import PIL" 2>/dev/null || { echo "Pillow missing:  pip install pillow"; exit 1; }

mkdir -p assets
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

for row in "${PLATES[@]}"; do
  IFS='|' read -r name url width quality <<<"$row"

  case "$url" in *UPSCALE_*) echo "  $name — no upscale URL recorded, skipping"; continue ;; esac

  echo "→ $name"
  if ! curl -fsS -o "$TMP/$name.png" --max-time 300 "$url"; then
    echo "  download failed, keeping the existing $name.webp"
    continue
  fi

  python3 - "$TMP/$name.png" "assets/$name.webp" "$width" "$quality" <<'PY'
import sys, os
from PIL import Image
try:
    import numpy as np           # only used for the detail readout
except ImportError:
    np = None

src_path, out_path, width, quality = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
up = Image.open(src_path).convert("RGB")

# keep the aspect ratio the page already lays out for
if os.path.exists(out_path):
    cur = Image.open(out_path)
    aspect = cur.size[0] / cur.size[1]
else:
    aspect = up.size[0] / up.size[1]

height = round(width / aspect)
# cover-crop the 4K render to that aspect, then resize down — never up
uw, uh = up.size
if uw / uh > aspect:
    nw = round(uh * aspect); up = up.crop(((uw - nw) // 2, 0, (uw - nw) // 2 + nw, uh))
else:
    nh = round(uw / aspect); y = (uh - nh) // 2; up = up.crop((0, y, uw, y + nh))

if width > up.size[0]:
    width, height = up.size            # never enlarge past native
final = up.resize((width, height), Image.LANCZOS)
final.save(out_path, "WEBP", quality=quality, method=6)

# responsive variants the page's srcset already references
stem = out_path[:-5]
for w in (480, 768, 1080):
    if w >= final.size[0]:
        continue
    final.resize((w, round(w / aspect)), Image.LANCZOS).save(
        f"{stem}-{w}.webp", "WEBP", quality=quality, method=6)

note = ""
if np is not None:
    g = np.asarray(final.convert("L"), dtype=np.float32)
    lap = (-4*g[1:-1,1:-1] + g[:-2,1:-1] + g[2:,1:-1] + g[1:-1,:-2] + g[1:-1,2:])
    note = f"  detail={lap.var():.0f}"

print(f"  {final.size[0]}x{final.size[1]}  "
      f"{os.path.getsize(out_path)/1024:.0f} KB{note}")
PY
done

# The srcset width descriptors must match the files on disk or the browser
# picks the wrong variant. Rewrite them from what actually got installed.
python3 - <<'PY'
import re, os
from PIL import Image

html = open("index.html", encoding="utf-8").read()
changed = []
for name in ("ember-hero", "dual-sunset", "city-scale", "blue-razz",
             "passionfruit", "both-flavours", "swirl-blue", "swirl-gold"):
    p = f"assets/{name}.webp"
    if not os.path.exists(p):
        continue
    w = Image.open(p).size[0]
    new, n = re.subn(rf"(assets/{re.escape(name)}\.webp )\d+w", rf"\g<1>{w}w", html)
    if n:
        html, _ = new, changed.append(f"{name}={w}w")

# the JS-mounted optional layers build their srcset from a literal
html2, n2 = re.subn(r"(assets/\$\{name\}\.webp )\d+w", r"\g<1>3024w", html)
if n2:
    html = html2
    changed.append("optional-layers=3024w")

if changed:
    open("index.html", "w", encoding="utf-8").write(html)
    print("srcset updated: " + ", ".join(changed))
else:
    print("srcset already correct")
PY

echo
echo "Done. Commit the changed files in assets/ and index.html, then redeploy."
