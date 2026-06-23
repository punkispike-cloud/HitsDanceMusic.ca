# Assets — marque En Ondes

## 📥 Dépose ton logo ici

Enregistre le **PNG haute résolution** de ton logo (le micro + table tournante néon)
dans ce dossier sous le nom :

```
brand/enondes/assets/logo.png
```

> Astuce : garde aussi la **plus grande version possible** (≥ 1024 px) — on redimensionne
> toujours vers le bas, jamais vers le haut.

## 🛠️ Ce que je génère ensuite (dès que `logo.png` est là)

| Fichier | Taille | Usage |
|---|---|---|
| `favicon.png` / `.ico` | 32×32, 48×48 | onglet navigateur |
| `icon-192.png` | 192×192 | PWA / accueil mobile |
| `icon-512.png` | 512×512 | PWA / splash |
| `apple-touch-icon.png` | 180×180 | iOS |
| `og-image.png` | 1200×630 | partage réseaux sociaux |

> ⚙️ Méthode : j'installe `sharp` (Node), je **recadre une zone carrée** (centrée sur le
> micro/table — la partie reconnaissable, pas le texte), puis je redimensionne. Le tout
> branché dans le manifest.

## 🎨 Variantes utiles à produire (idéalement par toi, ou via un outil)
- **Wordmark** : le texte « En Ondes » seul, **fond transparent** → entête de site, courriels.
- **Version fond clair** : le logo actuel est dark-only ; une version qui tient sur blanc
  servira pour factures/docs.
