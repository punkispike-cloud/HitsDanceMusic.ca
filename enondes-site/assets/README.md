# Assets du hub « En Ondes »

Images servies par le site (hero + icônes PWA) :

| Fichier | Rôle |
|---|---|
| `favicon.svg` | onglet navigateur (vectoriel) |
| `apple-touch-icon.png` | icône iOS |
| `icon-192.png`, `icon-512.png` | icônes PWA (any) |
| `icon-maskable-512.png` | icône PWA maskable |
| `studio-bg.jpg` | bannière du hero (accueil) |
| `og-image.png` | aperçu de partage (1200×630) |

> Les icônes/OG sont régénérées depuis le logo par `scripts/gen-enondes-icons.py`
> (bascule sur la marque dessinée si aucun logo n'est fourni).

## Optimisation

Les images sont compressées par `scripts/optimize-enondes-assets.py` (Pillow :
PNG quantifiés 256 couleurs, JPEG progressif q78 — ~1 042 Ko → ~242 Ko).
À relancer après toute régénération par `gen-enondes-icons.py` :

```bash
python scripts/optimize-enondes-assets.py
```

## Aperçu local

Ouvre **`enondes-site/index.html`** dans un navigateur (double-clic). Aucune installation requise.
