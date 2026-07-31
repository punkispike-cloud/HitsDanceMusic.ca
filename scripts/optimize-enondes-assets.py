#!/usr/bin/env python3
"""En Ondes — Optimisation des assets images du hub (enondes-site/assets).

Recompresse en place les PNG (quantification 256 couleurs, dithering
Floyd-Steinberg) et le JPEG de bannière (qualité 78, progressif) générés par
scripts/gen-enondes-icons.py. N'écrase un fichier que si le résultat est plus
petit. Dimensions et transparence préservées (les icônes maskable gardent leur
plein cadre). Reproductible :  python scripts/optimize-enondes-assets.py
"""
import os
import tempfile

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "enondes-site", "assets")

PNG_TARGETS = [
    "icon-192.png",
    "icon-512.png",
    "icon-maskable-512.png",
    "apple-touch-icon.png",
    "og-image.png",
]
JPEG_TARGETS = {"studio-bg.jpg": 78}


def optimize_png(path):
    src = Image.open(path)
    has_alpha = src.mode in ("RGBA", "LA") or "transparency" in src.info
    img = src.convert("RGBA" if has_alpha else "RGB")
    q = img.quantize(
        colors=256,
        method=Image.Quantize.FASTOCTREE,
        dither=Image.Dither.FLOYDSTEINBERG,
    )
    _save_if_smaller(path, q, "PNG", optimize=True)


def optimize_jpeg(path, quality):
    img = Image.open(path).convert("RGB")
    _save_if_smaller(path, img, "JPEG", quality=quality, optimize=True, progressive=True)


def _save_if_smaller(path, img, fmt, **params):
    before = os.path.getsize(path)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix=os.path.splitext(path)[1])
    os.close(fd)
    try:
        img.save(tmp, fmt, **params)
        after = os.path.getsize(tmp)
        if after < before:
            os.replace(tmp, path)
            print(f"  {os.path.basename(path):28s} {before / 1024:7.1f} Ko -> {after / 1024:6.1f} Ko")
        else:
            os.remove(tmp)
            print(f"  {os.path.basename(path):28s} {before / 1024:7.1f} Ko (déjà optimal, inchangé)")
    except Exception:
        os.remove(tmp)
        raise


def main():
    print(f"Optimisation des assets dans {ASSETS}")
    for name in PNG_TARGETS:
        optimize_png(os.path.join(ASSETS, name))
    for name, quality in JPEG_TARGETS.items():
        optimize_jpeg(os.path.join(ASSETS, name), quality)


if __name__ == "__main__":
    main()
