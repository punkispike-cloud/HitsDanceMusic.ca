#!/usr/bin/env python3
"""En Ondes — Générateur d'icônes du hub (PNG) + image de partage social.

Redessine la marque « ondes » (cf. enondes-site/assets/favicon.svg) en PIL et
exporte le jeu complet utilisé par le manifest PWA, l'apple-touch-icon et les
balises og:image. Reproductible :  python scripts/gen-enondes-icons.py

Sorties (enondes-site/assets/) :
  icon-192.png, icon-512.png        — purpose "any" (fond arrondi rx=14)
  icon-maskable-512.png             — purpose "maskable" (plein cadre, zone sûre)
  apple-touch-icon.png (180)        — iOS (plein cadre opaque)
  og-image.png (1200x630)           — aperçu réseaux sociaux
"""
import math
import os
from PIL import Image, ImageDraw, ImageFont, ImageChops

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "enondes-site", "assets")
LOGO = os.path.join(OUT, "logo.png")          # vrai logo déposé (si présent)
USE_LOGO = os.path.exists(LOGO)

BG = (13, 19, 32, 255)      # #0d1320
BG2 = (10, 14, 22, 255)     # #0a0e16
BLUE = (58, 160, 255)       # #3aa0ff
PURPLE = (184, 108, 224)    # #b86ce0
SS = 4                      # supersampling

# Recadrage du « device » (micro + platine) dans le logo portrait, en fractions
# de la largeur/hauteur → robuste si le logo est régénéré à une autre taille.
DEV_CX, DEV_CY = 0.496, 0.440   # centre du micro+platine (remonté pour exclure le wordmark)
DEV_HALF = 0.385                # demi-côté du carré (cadrage du device)


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(len(a)))


def h_gradient(w, h, c1, c2):
    row = Image.new("RGB", (max(1, w), 1))
    for x in range(w):
        row.putpixel((x, 0), lerp(c1, c2, x / max(1, w - 1)))
    return row.resize((w, h))


def dome(x1, y1, x2, y2, r):
    """Centre + angles (convention PIL, y vers le bas) d'un arc en dôme vers le haut."""
    cx = (x1 + x2) / 2
    d = abs(x2 - x1)
    cy = y1 + math.sqrt(max(0.0, r * r - (d / 2) ** 2))
    a1 = math.degrees(math.atan2(y1 - cy, x1 - cx)) % 360
    a2 = math.degrees(math.atan2(y2 - cy, x2 - cx)) % 360
    if a2 < a1:
        a2 += 360
    return cx, cy, a1, a2


def draw_mark(mask, s, ox, oy):
    """Dessine la marque (2 arcs + point) dans un masque L, en unités /64."""
    d = ImageDraw.Draw(mask)
    w = max(1, round(4 * s))

    def px(x, y):
        return (ox + x * s, oy + y * s)

    # Point
    r = 4.5
    d.ellipse([px(32 - r, 42 - r), px(32 + r, 42 + r)], fill=255)

    # Arc interne (plein) et externe (0.6)
    for (x1, y1, x2, y2, rad, fill) in [
        (22, 36, 42, 36, 14, 255),
        (15, 29, 49, 29, 24, 153),
    ]:
        cx, cy, a1, a2 = dome(x1, y1, x2, y2, rad)
        bbox = [px(cx - rad, cy - rad), px(cx + rad, cy + rad)]
        bbox = [bbox[0][0], bbox[0][1], bbox[1][0], bbox[1][1]]
        d.arc(bbox, a1, a2, fill=fill, width=w)


def rounded_alpha(P, radius):
    m = Image.new("L", (P, P), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, P - 1, P - 1], radius=radius, fill=255)
    return m


def make_icon(size, rounded=True, mark_scale=1.0, bg=BG):
    P = size * SS
    base = Image.new("RGBA", (P, P), bg)
    mask = Image.new("L", (P, P), 0)
    s = (P / 64) * mark_scale
    off = (P - 64 * s) / 2
    draw_mark(mask, s, off, off)
    grad = h_gradient(P, P, BLUE, PURPLE).convert("RGBA")
    base.paste(grad, (0, 0), mask)
    if rounded:
        base.putalpha(rounded_alpha(P, int(round(14 / 64 * P))))
    return base.resize((size, size), Image.LANCZOS)


def load_font(size, bold=True):
    for name in (["arialbd.ttf", "ariblk.ttf", "segoeuib.ttf"] if bold else ["arial.ttf", "segoeui.ttf"]):
        try:
            return ImageFont.truetype("C:/Windows/Fonts/" + name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def make_og(w=1200, h=630):
    img = h_gradient(w, h, BG2, BG).convert("RGBA")
    # halos discrets
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([-200, -300, 700, 400], fill=(58, 160, 255, 28))
    gd.ellipse([700, -200, 1500, 500], fill=(184, 108, 224, 26))
    img = Image.alpha_composite(img, glow)

    icon = make_icon(180, rounded=True)
    img.alpha_composite(icon, (90, h // 2 - 90))

    d = ImageDraw.Draw(img)
    fbig = load_font(96, bold=True)
    fsub = load_font(40, bold=False)
    x = 310
    # Wordmark dégradé : texte blanc puis teinte via masque dégradé
    word = "En Ondes"
    d.text((x, 250), word, font=fbig, fill=(231, 237, 247, 255))
    d.text((x, 360), "Écoute tes radios, en direct.", font=fsub, fill=(154, 166, 189, 255))
    d.text((x, 415), "enondes.ca", font=load_font(34, bold=True), fill=(95, 184, 255, 255))
    return img.convert("RGB")


# ---------------------------------------------------------------------------
# Variantes À PARTIR DU VRAI LOGO (si enondes-site/assets/logo.png est présent)
# ---------------------------------------------------------------------------

def device_square(half_frac):
    """Recadre un carré centré sur le micro+platine du logo portrait."""
    im = Image.open(LOGO).convert("RGBA")
    w, h = im.size
    cx, cy = DEV_CX * w, DEV_CY * h
    half = half_frac * w
    return im.crop((int(cx - half), int(cy - half), int(cx + half), int(cy + half)))


def radial_mask(w, h, inner=0.5, outer=1.0):
    """Masque alpha radial (opaque au centre, fondu vers les bords)."""
    m = Image.new("L", (w, h), 0)
    px = m.load()
    cx, cy = w / 2, h / 2
    maxd = math.hypot(cx, cy)
    for y in range(h):
        for x in range(w):
            d = math.hypot(x - cx, y - cy) / maxd
            if d <= inner:
                v = 255
            elif d >= outer:
                v = 0
            else:
                v = int(255 * (1 - (d - inner) / (outer - inner)))
            px[x, y] = v
    return m


def make_icon_logo(size, rounded=True, maskable=False):
    P = size * SS
    crop = device_square(DEV_HALF).resize((P, P), Image.LANCZOS)
    canvas = Image.new("RGBA", (P, P), BG)
    if maskable:
        # Zone de sécurité : on réduit le device à ~80 % et on fond les bords
        # dans le fond (pas de wordmark, pas de couture visible).
        s = int(P * 0.80)
        small = crop.resize((s, s), Image.LANCZOS)
        small.putalpha(ImageChops.multiply(small.split()[3], radial_mask(s, s, 0.7, 1.06)))
        canvas.alpha_composite(small, ((P - s) // 2, (P - s) // 2))
    else:
        canvas.alpha_composite(crop)
    if rounded:
        canvas.putalpha(rounded_alpha(P, int(round(14 / 64 * P))))
    return canvas.resize((size, size), Image.LANCZOS)


def make_og_logo(w=1200, h=630):
    bg = h_gradient(w, h, BG2, BG).convert("RGBA")
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([-220, -260, 560, 460], fill=(56, 198, 255, 34))
    gd.ellipse([760, 190, 1520, 880], fill=(255, 93, 177, 30))
    bg = Image.alpha_composite(bg, glow)
    # Logo (device + wordmark) fondu à gauche
    logo = Image.open(LOGO).convert("RGBA")
    lh = 560
    lw = int(logo.width * lh / logo.height)
    logo = logo.resize((lw, lh), Image.LANCZOS)
    logo.putalpha(ImageChops.multiply(logo.split()[3], radial_mask(lw, lh, 0.30, 1.02)))
    lx = 78
    bg.alpha_composite(logo, (lx, (h - lh) // 2))
    # Accroche à droite
    d = ImageDraw.Draw(bg)
    tx = lx + lw + 54
    d.text((tx, 236), "Écoute tes radios,", font=load_font(60, True), fill=(238, 242, 251, 255))
    d.text((tx, 304), "en direct.", font=load_font(60, True), fill=(122, 214, 255, 255))
    d.text((tx, 392), "Le réseau de radios · en français", font=load_font(29, False), fill=(151, 163, 189, 255))
    d.text((tx, 438), "enondes.ca", font=load_font(31, True), fill=(255, 93, 177, 255))
    return bg.convert("RGB")


def save(img, name):
    path = os.path.join(OUT, name)
    img.save(path)
    print(f"  [ok] {name} ({img.size[0]}x{img.size[1]})")


def main():
    os.makedirs(OUT, exist_ok=True)
    if USE_LOGO:
        print("[gen-icons] generation depuis le vrai logo (logo.png)...")
        save(make_icon_logo(192, rounded=True), "icon-192.png")
        save(make_icon_logo(512, rounded=True), "icon-512.png")
        save(make_icon_logo(512, rounded=False, maskable=True), "icon-maskable-512.png")
        save(make_icon_logo(180, rounded=False), "apple-touch-icon.png")
        save(make_og_logo(), "og-image.png")
    else:
        print("[gen-icons] generation depuis la marque dessinee (pas de logo.png)...")
        save(make_icon(192, rounded=True), "icon-192.png")
        save(make_icon(512, rounded=True), "icon-512.png")
        save(make_icon(512, rounded=False, mark_scale=0.62), "icon-maskable-512.png")
        save(make_icon(180, rounded=False), "apple-touch-icon.png")
        save(make_og(), "og-image.png")
    print("[gen-icons] done")


if __name__ == "__main__":
    main()
