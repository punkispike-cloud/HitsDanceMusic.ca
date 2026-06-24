# Lancer Rockfort de bout en bout — SANS AzuraCast (mode pilote)

> Runbook complet pour mettre la radio rock **Rockfort** en ondes **sans AzuraCast**, en
> s'appuyant sur un **hébergeur radio clé en main** (Icecast/Shoutcast + AutoDJ web hébergés
> par un tiers). Mode **pilote** : zéro auditeur au départ, on monte tout pour avoir une
> diffusion. Le volet licences (SOCAN / Ré:Sonne) ne devient pertinent qu'au passage à de la
> **musique commerciale en public** — voir §6.
>
> Sœur AzuraCast de ce doc : [FLUX-CLIENT-SANS-FLUX.md](FLUX-CLIENT-SANS-FLUX.md) (à ignorer ici).

---

## 0. La chaîne de bout en bout (vue d'ensemble)

```
  [HÉBERGEUR RADIO clé en main]            [EN ONDES — code, déjà prêt]
  ┌───────────────────────────┐           ┌──────────────────────────────────────┐
  │ AutoDJ web (ta musique)    │  flux     │ brand/rockradio.json                  │
  │  ├─ playlists par show     │ ───────►  │   stream.url        ─► player.js (audio)│
  │  ├─ Icecast/Shoutcast mount│  titre    │   stream.nowPlayingProxy ─► /np ─► UI  │
  │  └─ now-playing (7.html/JSON) ───────► │   urls.api / presenceWss              │
  └───────────────────────────┘           └──────────────────┬───────────────────┘
            ▲                                                 │ build-brand + deploy
            │ tu téléverses tes MP3                            ▼
     (musique : §2)                                   SITE ROCKFORT (auditeurs)
```

**Le principe :** En Ondes ne **produit** pas le flux — il le **lit**. Le player, le now-playing,
la présence et les analytics sont déjà câblés ([vérif E2E confirmée](#5-vérification-e2e-finale)).
« Brancher la radio » = remplir les champs de `brand/rockradio.json`, rebuild, redeploy.

---

## 1. État actuel (ce qui est fait / ce qui manque)

| Bloc | État | Note |
|---|---|---|
| Identité (nom, slogan, couleurs) | ✅ Fait | `brand/rockradio.json` (palette ambre #cf9b3f) |
| Site web bespoke | ✅ Fait | branche `client/rockradio`, worktree `.preview-rock/` |
| 7 animateurs · 13 émissions · grille 7 j | ✅ Fait | `api/src/db/seed-rockradio.ts` |
| API / Admin / Presence | ✅ Build vert | partagés (plateforme En Ondes) |
| **Visuels Rockfort** (logo/favicon/icônes) | ❌ **À faire** | `brand/rockradio/assets/` est vide → hériterait des visuels Hits Dance |
| **Hash Service Worker** | ⚠️ Désync | régénérer avant déploiement (`build-sw.mjs`) |
| **Le flux audio** | ❌ **À faire** | `stream.url` = `CHANGEME` → besoin d'un hébergeur |
| **La banque de musique** | ❌ **À faire** | §2 |
| **Déploiement** | ❌ **À faire** | §3 |

---

## 2. La musique (la banque de pistes)

### 2.1 Où piger — pilote gratuit / libre de droits

| Source | Pourquoi | Format |
|---|---|---|
| **Pixabay Music** | Gratuit, **sans attribution**, licence couvre la diffusion, section rock. | MP3 |
| **Free Music Archive** | Gros catalogue rock **Creative Commons** (vérifier CC0 vs CC-BY). | MP3 |
| **Internet Archive** (archive.org) | 💎 **Live Music Archive** : concerts live de groupes qui autorisent le partage + netlabels + domaine public. | MP3/FLAC |
| **Jamendo** | Catalogue indé CC ; download gratuit. **Jamendo Licensing** = vraie licence radio (plus tard). | MP3 |
| **Bandcamp** (groupes QC) | ⭐ L'angle Rockfort : groupes indé/émergents, souvent « name your price ». Permission directe (§2.2). | MP3/FLAC |
| Uppbeat / Epidemic / Artlist | Payant, qualité pro, **licence diffusion incluse** (étape suivante). | MP3 |

### 2.2 Courriel-type aux groupes (permission de diffusion)

```
Objet : Rockfort (radio rock) aimerait diffuser votre musique

Bonjour [nom du groupe],

Je lance Rockfort, une nouvelle webradio rock 24/7 (classiques, hard, indé d'ici).
On a un bloc dédié à la scène émergente — Garage QC / Indé d'ici — et votre son y aurait
tout à fait sa place.

Est-ce que vous me donnez la permission de diffuser vos morceaux sur l'antenne ?
On crédite l'artiste à l'écran (now-playing) à chaque passage, et on peut pointer vers
votre Bandcamp / vos réseaux.

Si oui, un simple « oui, vous avez ma permission de diffuser [titres ou tout l'album] »
par retour de courriel me suffit. Merci, et longue vie au rock !

[Ton nom] — Rockfort
[site / courriel]
```

> Garde chaque réponse « oui » (preuve de permission). Un dossier `permissions/` suffit pour le pilote.

### 2.3 Structure de playlists (colle à la grille)

Range tes fichiers en dossiers — l'AutoDJ de l'hébergeur s'en sert pour les rotations :

```
/Rotation-Rock      → classic rock (colonne du jour : Rotation Rock, Réveil Distorsion, Café Granite)
/Heavy              → métal / hard / stoner (Heavy Hour, Autoroute 666 nuit)
/Garage-QC          → punk / garage / indé local (Garage QC, Indé d'ici)  ← Bandcamp QC
/Deep-Cuts          → faces B, classiques rares (Vinyle & Whisky, Légendes du Riff)
/Ballades           → power ballads (Power Ballades dimanche)
/Jingles            → idents station « Rockfort » (optionnel, 5–10 s)
```

### 2.4 Pratique

- **Format** : MP3 320 kbps (ou FLAC), avec **tags ID3 propres** (Artiste + Titre) → c'est ce que
  le now-playing de Rockfort affiche à l'écran.
- **Volume de départ** : **200–400 pistes** (≈ 15–30 h) → l'AutoDJ tourne 24/7 sans répétition gênante.
- **Conseil pilote** : Pixabay + Internet Archive (Live Music Archive) + une dizaine de groupes
  Bandcamp QC = une banque rock légale et gratuite en une soirée.

---

## 3. Le flux SANS AzuraCast (hébergeur clé en main)

### 3.1 Choisir un hébergeur

Une compagnie roule **Icecast/Shoutcast + un AutoDJ web** pour toi. Tu téléverses tes MP3 (§2),
tu bâtis tes playlists, tu reçois une **URL de flux** + un **now-playing**. Zéro serveur, zéro
Liquidsoap, **zéro AzuraCast**.

| Hébergeur | Note |
|---|---|
| **AsuraHosting** | Déjà éprouvé chez Hits Dance — la plateforme parle déjà son format. Point de départ sûr. |
| RadioKing / Radio.co | AutoDJ web très simple, interface FR (RadioKing). |
| Caster.fm / Shoutcheap | Économiques, Shoutcast/Icecast standard. |

Coût indicatif : ~5–20 $/mois selon auditeurs/stockage/bitrate.

### 3.2 Ce que tu récupères de l'hébergeur (à noter)

- **URL du flux (mount)** — ex. `https://server.host.com:8000/stream` ou `https://host/listen/rockfort/radio.mp3`
  → ira dans `stream.url`.
- **Now-playing** — souvent un `…/7.html` (Shoutcast) ou un endpoint JSON de statistiques
  → ira dans `stream.nowPlayingProxy`.
- **Panneau d'admin** (gestion playlists/AutoDJ) → `stream.panel` (optionnel, info interne).
- ⚠️ **HTTPS obligatoire** : le flux doit être servi en `https://` (sinon le navigateur bloque le
  *mixed-content* sur un site HTTPS). La plupart des hébergeurs l'offrent — confirme-le.

---

## 4. Déploiement + branchement

### 4.1 Choisir la voie de déploiement

| Voie | Quand | Ce que ça donne |
|---|---|---|
| **(a) Instance dédiée** *(reco pilote)* | Rockfort = démo/pilote autonome | Nouveau projet Railway (web `client/rockradio` + api + admin + Postgres), `SEED_BRAND=rockradio` → DB démarre avec la grille rock. Isolé d'Hits Dance. |
| (b) Tenant multi-tenant | Quand le parc grandit | Onboarder Rockfort dans la plateforme En Ondes prod via **admin → /parc → Provisionner**. Mais le **site bespoke rock** reste un déploiement web séparé (la branche `client/rockradio`). |

> Le **site rock** (design ampli/sunburst) est propre à Rockfort → il se déploie **toujours** depuis
> la branche `client/rockradio`, peu importe la voie. Le multi-tenant partage l'API/admin, pas la face.

### 4.2 Remplir `brand/rockradio.json` (le branchement, le cœur)

Sur un **checkout propre de `client/rockradio`** (jamais sur `main`), édite [`brand/rockradio.json`](brand/rockradio.json) :

```jsonc
"stream": {
  "url": "https://<host>/stream",          // ← mount Icecast/Shoutcast de l'hébergeur
  "panel": "https://<host>/panel/",         // ← panneau admin (info interne)
  "host": "<host>",                          // ← nom d'hôte du flux
  "nowPlayingProxy": "https://<host>/7.html" // ← now-playing (7.html ou JSON)
},
"urls": {
  "api": "https://<rockfort-api>.up.railway.app",        // ← après déploiement de l'api
  "presenceWss": "wss://<rockfort-presence>.up.railway.app/ws/presence"
},
"contact": { "phone": "<tel ou vide>", "email": "" }
```

### 4.3 Builder + déployer

```bash
# Sur un checkout/worktree de client/rockradio (PAS main) :
BRAND=rockradio node scripts/build-all.mjs   # rebrand + regénère brand.generated.js + RESYNC le hash SW
git add -A && git commit -m "config(rockfort): branchement flux + URLs prod"
git push   # → Railway redéploie le web Rockfort
```

> `build-all.mjs` enchaîne build-brand → build-html → build-sw : il **règle automatiquement** le
> hash du Service Worker (l'anomalie §1). Le `nginx.conf` du web Rockfort doit autoriser l'hôte du
> flux dans la **CSP** (`connect-src` + `media-src`) et pointer `/np` vers `nowPlayingProxy` —
> `build-brand` propage `host`/`nowPlayingProxy`, vérifie le résultat avant de pousser.

---

## 5. Vérification E2E finale

À faire une fois déployé, dans l'ordre :

- [ ] **Site en ligne** : la page Rockfort charge (titre, hero, grille rock, animateurs).
- [ ] **Le son joue** : clic ▶ → l'audio démarre (flux de l'hébergeur). *Si silence : vérifier que
      `stream.url` est en `https://` et joignable.*
- [ ] **Now-playing** : le titre/artiste en cours s'affiche dans le player (`#liveTrackLine`).
      *Si vide : vérifier `nowPlayingProxy` + le proxy `/np` (CSP `connect-src`).*
- [ ] **Grille** : la programmation 7 jours s'affiche (depuis l'API, sinon fallback hardcodé).
- [ ] **Présence** : compteur d'auditeurs live (si `presenceWss` branché).
- [ ] **PWA** : installable, icônes Rockfort (pas Hits Dance — voir §7 visuels).
- [ ] **AutoDJ 24/7** : laisse tourner — l'AutoDJ de l'hébergeur enchaîne sans silence.

---

## 6. Licences (mode pilote → public)

- **Pilote, zéro auditeur, musique libre/CC/permission directe (§2)** : rien à payer, c'est propre.
- **Au passage à de la musique commerciale diffusée en public** : il faut **SOCAN + Ré:Sonne
  (Tarif 8, via Entandem)**, par station. Aucun logiciel n'en exonère. À cadrer à ce moment-là —
  pas maintenant. Réf. [_private/ATTESTATION-LICENCES.md](_private/ATTESTATION-LICENCES.md).

---

## 7. Correctifs code à faire avant go-live (côté En Ondes)

Repérés par la vérification E2E — à exécuter sur la branche `client/rockradio` :

1. **Visuels Rockfort** : déposer logo + favicon + icônes PWA (192/512) dans
   `brand/rockradio/assets/` (actuellement vide → sinon visuels Hits Dance hérités).
2. **Hash Service Worker** : réglé automatiquement par `BRAND=rockradio node scripts/build-all.mjs`
   (§4.3) — ne pas oublier de commit le `sw.js` régénéré.
3. *(Optionnel)* Dépolluer les libellés résiduels « Hits Dance / hitradio » (cosmétique, non bloquant).

---

## Récap — qui fait quoi

| # | Étape | Qui | Réf |
|---|---|---|---|
| 1 | Bâtir la banque de musique | **Toi** (je fournis sources + courriel + structure) | §2 |
| 2 | Ouvrir un compte hébergeur radio | **Toi** | §3.1 |
| 3 | Téléverser musique + playlists + AutoDJ | **Toi** (dans le panneau de l'hébergeur) | §2.3 |
| 4 | Récupérer URL flux + now-playing | **Toi** → me les donner | §3.2 |
| 5 | Générer les visuels Rockfort | **Moi** (code) | §7.1 |
| 6 | Remplir `brand/rockradio.json` + build + resync SW | **Moi** (code) | §4.2–4.3 |
| 7 | Déployer (instance/tenant Railway) | **Toi + moi** | §4.1 |
| 8 | Vérif E2E finale | **Toi + moi** | §5 |
