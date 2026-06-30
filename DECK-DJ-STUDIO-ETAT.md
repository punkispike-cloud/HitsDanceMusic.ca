# Deck DJ Studio — état du développement

> Note de reprise pour l'équipe / le futur soi.  
> Dernière mise à jour : **2026-06-29** (implémentation du plan « Deck DJ Studio (Web Audio + Cloudflare R2) »).

---

## Où on en est

Le **studio de mix dans l'admin** est codé de bout en bout côté application. Le flux complet est en place :

**Bibliothèque de pistes** → **Studio (2 decks, mix live)** → **Rendu MP3 (navigateur)** → **Upload R2** → **Ligne `mixes`** → **Lecture publique** (`podcasts.html`, si publié).

Tout tourne dans le navigateur (Web Audio API + lamejs) et réutilise l'infra S3 existante (compatible Cloudflare R2).

### ✅ Fait (code)

| Zone | Détail |
|------|--------|
| **Stockage R2** | `api/src/env.ts` + `api/src/lib/s3.ts` — `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`, rétro-compatible AWS |
| **Schéma DB** | Table `tracks` + enum `upload_kind` étendu avec `'track'` |
| **Migrations** | `0017_tracks_library.sql` (tracks) ; `0018`/`0019` = dérive pré-existante (polls, `radios.distribution`) capturée au même moment |
| **API bibliothèque** | CRUD **`/v1/admin/library`** (pas `/v1/admin/tracks` — conflit avec `/v1/admin/tracks/recent` = historique now-playing) |
| **Uploads** | `kind: "track"` → dossier `tracks/` + `confirm` rattache l'audio à une ligne `tracks` |
| **Admin /pistes** | CRUD + téléversement audio (`AudioUpload kind="track"`) |
| **Admin /studio** | 2 decks, EQ 3 bandes, crossfader equal-power, pitch, sync B→A, waveform canvas, chargement bibliothèque ou disque, capture automation, rendu OfflineAudioContext → MP3, publication mix (presign → PUT → confirm) |
| **Moteur audio** | `admin/lib/audio/` — `studio-engine.ts`, `encode.ts`, `bpm.ts`, `types.ts` |
| **Dépendance** | `@breezystack/lamejs` (fork ESM ; l'original `lamejs` casse avec Next 16) |
| **CSP site public** | `nginx.conf` — `https://*.r2.dev` dans `media-src`, `connect-src`, `img-src` |
| **Sidebar** | Liens « Pistes » et « Studio DJ » |

### Déviations par rapport au plan initial (volontaires)

- **`/v1/admin/library`** au lieu de `/v1/admin/tracks` (namespace now-playing déjà pris).
- **Waveform canvas maison** au lieu de `wavesurfer.js` (intégration plus fiable avec notre moteur).
- **Estimateur BPM maison** (autocorrélation) au lieu de `web-audio-beat-detector` (évite WASM lourd en build Next).
- **Pas de route publique `/v1/tracks`** pour la bibliothèque — le studio utilise l'admin authentifié.

---

## Ce qu'il reste (ops — toi)

Rien de bloquant côté code pour un premier test une fois R2 configuré :

1. **Bucket Cloudflare R2** + clés d'accès API S3.
2. **Variables Railway (service `api`)** :
   ```
   S3_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
   S3_REGION=auto
   S3_BUCKET=<nom-du-bucket>
   S3_ACCESS_KEY_ID=...
   S3_SECRET_ACCESS_KEY=...
   S3_PUBLIC_BASE_URL=https://pub-xxxx.r2.dev   # ou domaine custom
   S3_FORCE_PATH_STYLE=true
   ```
3. **CORS du bucket R2** — autoriser en `GET` / `PUT` / `HEAD` :
   - l'origine **admin** (Railway) — chargement pistes dans le studio + uploads ;
   - l'origine **site public** — lecture des mixes sur `podcasts.html`.
4. **(Optionnel)** domaine custom R2 → l'ajouter aussi dans `nginx.conf` (CSP).
5. **Déploiement** — les migrations **0017–0019** s'appliquent via le `preDeployCommand` existant (`node dist/db/deploy.js`).  
   ✅ `0019` (`ALTER TABLE radios ADD COLUMN distribution`) est désormais **idempotente** (`ADD COLUMN IF NOT EXISTS`) : plus de correction manuelle requise même si la colonne existe déjà en prod.

---

## Ce qu'il reste (produit — plus tard)

| Priorité | Sujet |
|----------|--------|
| **Hors périmètre actuel** | **Live DJ** : deck → `input.harbor` AzuraCast via Webcaster.js (nécessite serveur AzuraCast / Oracle) |
| **Amélioration** | Effets avancés : ✅ **reverb** (envoi humide/sec par deck, impulse synthétique, défaut sec = zéro régression) + ✅ **key detection** (chromagramme Goertzel + profils Krumhansl, lecture seule affichée à côté du BPM) ; reste **loops** |
| ~~Rendu offline multi-`play` par deck~~ | ✅ **FAIT** : rendu multi-segments (banque de clips → 1 source par clip joué ; set > 2 pistes par deck ; ré-cues/seeks collapsés). `studio-engine.ts` `render()`. |
| **Amélioration** | Route publique `/v1/library` si un jour le site public doit lister la bibliothèque |
| **Parallèle (autre chantier)** | Pages admin **Demandes**, **Sondages** ; migrations polls (`0018`/`0019`) — voir fichiers non liés au studio |

---

## Comment tester (local)

```bash
# API
cd api && npm install && npm run typecheck
# DB : DATABASE_URL requis pour npm run db:migrate (ou laisser le deploy Railway)

# Admin
cd admin && npm install && npm run typecheck && npm run dev
```

1. Admin → **Pistes** : créer une piste, téléverser un MP3 (nécessite S3/R2 configuré).
2. Admin → **Studio DJ** : charger la piste sur deck A, play, ajuster crossfader/EQ, **Rendre le mix**.
3. Prévisualiser le rendu → **Publier comme mix** (brouillon).
4. Admin → **Mixes** : passer le mix en **Publié** + date de publication.
5. Site → `podcasts.html` : le mix apparaît si l'API publique et la CSP le permettent.

Sans R2 : le studio fonctionne quand même avec **Ordinateur** (fichier local) et le rendu MP3 ; seuls l'upload et la bibliothèque persistée sont bloqués.

---

## Fichiers clés (repère rapide)

```
api/src/env.ts, api/src/lib/s3.ts
api/src/db/schema.ts          → table tracks
api/src/routes/admin.ts       → /v1/admin/library
api/src/routes/uploads.ts     → kind track
api/migrations/0017_tracks_library.sql

admin/app/(admin)/pistes/page.tsx
admin/app/(admin)/studio/page.tsx
admin/lib/audio/studio-engine.ts
admin/components/waveform.tsx

nginx.conf                    → CSP *.r2.dev
```

---

## État git au moment de cette note

> **MàJ 2026-06-29 (reprise)** : le gros WIP est **commité sur `main`** en 3 blocs
> (typecheck admin ✅ + api ✅ avant commit). **Rien n'est encore poussé** (`git push` à faire).

| Commit | Contenu |
|--------|---------|
| `94ea480` **feat(studio)** | Deck DJ Studio (Web Audio + R2) : bibliothèque, 2 decks, rendu MP3, upload R2, migration 0017, CSP nginx + fondation data-layer admin partagée (schema/hooks/types/sidebar) |
| `9d3f146` **feat(requests,polls)** | Demandes de titres (`song_requests`, 0016, /demandes) + Sondages en direct (widget accueil, /sondages, 0018/0019) |
| `754b6a6` **feat(replay,distribution)** | Replay catch-up AzuraCast (gaté), distribution plateformes externes (owner), analytics/parc/statistiques/maintenance |

Note : les fichiers partagés multi-chantiers (`schema.ts`, `admin.ts`, `sidebar.tsx`,
`hooks.ts`, `types.ts`, `_journal.json`) sont allés **entiers dans le commit `94ea480`**.

## Reprise — par où recommencer

1. **(optionnel)** `git push` les 3 commits ci-dessus.
2. **Ops R2** : bucket Cloudflare + variables Railway + CORS (cf. section « Ce qu'il reste (ops) »).
3. ✅ **Migration `0019`** (`ADD COLUMN distribution`) : rendue **idempotente**
   (`ADD COLUMN IF NOT EXISTS`) — plus rien à corriger à la main.
4. **Tester** le parcours piste → studio → mix publié → lecture sur `podcasts.html`.

Relire ce fichier + `git status` / `git log --oneline -5` avant de reprendre.
