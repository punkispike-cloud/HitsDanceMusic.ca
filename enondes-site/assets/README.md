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

## Optimisation (à faire avec un outil d'image)

Plusieurs PNG dépassent 200 Ko (`icon-512.png`, `icon-maskable-512.png`, `og-image.png`).
À recompresser quand un outil est disponible, p. ex. :

```bash
pngquant --quality=65-85 --ext .png --force assets/icon-512.png assets/icon-maskable-512.png assets/og-image.png
```

## Aperçu local

Ouvre **`enondes-site/index.html`** dans un navigateur (double-clic). Aucune installation requise.
