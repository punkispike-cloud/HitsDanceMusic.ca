# Marques (config par radio)

Chaque radio cliente a **un fichier `<slug>.json`** ici. C'est la **source unique**
de tout ce qui est « propre au client ». `hitsdance.json` est la **baseline** (le
site actuel) et sert de référence pour les remplacements.

## Champs

| Champ | Rôle | Exemple |
|---|---|---|
| `slug` | Identifiant court (= nom du fichier) | `hitsdance` |
| `name` | Nom affiché de la radio | `Hits Dance Music` |
| `shortName` | Nom court (PWA) | `Hits Dance Music` |
| `description` | Description (SEO / manifest) | `Radio en ligne live…` |
| `domain` | Domaine public | `hitsdancemusic.ca` |
| `colors.accent` / `accentBright` | Couleur d'accent principale | `#c8102e` |
| `colors.accentGlowRgb` | Mêmes couleurs en RGB (pour les `rgba()`) | `220, 20, 48` |
| `colors.amber` / `amberSoft` | Accents secondaires | `#e8192e` |
| `colors.themeColor` / `bgColor` | Couleurs PWA (barre / fond) | `#0f0f12` / `#0a0a0a` |
| `stream.url` | URL du flux audio live | `https://…/stream` |
| `stream.panel` | Panneau de gestion du flux | `https://…/start/…/` |
| `urls.api` | API backend du client | `https://…railway.app` |
| `urls.presenceWss` | WebSocket compteur visiteurs | `wss://…/ws/presence` |
| `contact.phone` | Téléphone studio (tel/SMS/WhatsApp) | `14182612886` |
| `contact.email` | Courriel public (optionnel) | `` |

## Brancher une nouvelle radio

1. Copier `hitsdance.json` → `brand/<client>.json`, remplir les champs.
2. Déposer les visuels dans `brand/<client>/assets/` (logo, favicon, icônes) — à
   reporter dans `assets/` au build (étape manuelle pour l'instant).
3. Sur **un checkout propre** (jamais sur `main`), bâtir :
   ```bash
   BRAND=<client> node scripts/build-all.mjs
   ```
4. Déployer ce build (nouveau projet Railway + DB ; voir `PLATEFORME-MULTI-RADIO.md`).
5. Côté API du client : régler `ALLOWED_ORIGINS` (domaines du client) et
   `SEED_BRAND=<client>` (pour démarrer avec une DB de contenu vierge).

> ⚠️ Ne **jamais** committer un build client sur `main` : `main` reste la baseline
> Hits Dance Music. `BRAND=hitsdance` est un no-op (sortie identique).
