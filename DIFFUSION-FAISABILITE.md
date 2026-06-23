<!-- Rapport généré par le workflow d audit multi-agents le 2026-06-22 (En Ondes). Question : internaliser la diffusion/AutoDJ dans En Ondes ? -->

# Rapport de faisabilité — Internaliser la diffusion dans En Ondes

> **Question :** Que faut-il pour qu'En Ondes fasse LUI-MÊME ce qu'AzuraCast fait (diffusion + AutoDJ + gestion musicale), tout intégré dans la plateforme, sans dépendre d'AzuraCast ?
>
> **Réponse courte :** C'est faisable, mais « faire lui-même » ne veut PAS dire « tout réécrire ». La voie réaliste est qu'En Ondes **orchestre Icecast + Liquidsoap** (deux briques libres et matures) au lieu de les remplacer. En Ondes possède déjà la moitié haute de la pile (Postgres, S3, admin Next.js, API, now-playing consommé). Le gap est la moitié basse : **produire le flux**. Combler ce gap proprement représente plusieurs mois-personnes, et pour une petite entreprise qui démarre, ce n'est pas la première chose à construire.

---

## 1. Ce qu'AzuraCast fait

AzuraCast n'invente rien sur le plan audio : c'est une **couche d'orchestration** qui pilote des logiciels libres derrière une UI + API uniques. Carte des composants :

| Couche | Composant | Rôle |
|---|---|---|
| **Diffusion (public)** | Icecast-KH / SHOUTcast | Sert le flux à N auditeurs en HTTP. Ne génère pas l'audio. |
| **Moteur AutoDJ** | Liquidsoap | Cœur intelligent : playlists pondérées, crossfade, planification horaire, jingles, transcodage, bascule live↔auto, fallback anti-silence. Config `.liq` **générée dynamiquement** par station. |
| **Pont de contrôle** | HTTP bidirectionnel | Liquidsoap demande `/nextsong` (titre annoté) → PHP choisit ; lecture → `/feedback` → met à jour now-playing. |
| **Données** | MariaDB | Stations, index média, playlists, users, historique, stats. |
| **Cache / queue** | Redis + Symfony Messenger | Workers de fond : ID3, ReplayGain, waveform, webhooks, tâches planifiées. |
| **Stockage** | Local / S3 / Dropbox | Médias indexés en DB ; seul ce qui est en playlist est diffusé. |
| **Proxy + TLS** | NGINX | Sert le flux en 80/443 (port 8000 souvent bloqué), HLS, Let's Encrypt natif + renouvellement auto. |
| **Now-playing temps réel** | Centrifugo | WebSocket/SSE/long-polling, une connexion légère par auditeur. |
| **Live DJ** | Liquidsoap harbor + WebDJ | Le DJ se connecte (BUTT/Mixxx) ou diffuse depuis le navigateur. |
| **App + API** | PHP/Slim, Vue SPA | 250+ endpoints, rôles/permissions, multi-stations (64+/instance), backups, webhooks. |

**Fonctions livrées :** bibliothèque média, playlists (standard/planifiée/cadencée/jingle/avancée), AutoDJ + crossfade, planification horaire, DJ live + WebDJ + enregistrement, API now-playing (3 modes), stats (dont SoundExchange/Prometheus), podcasts RSS, requêtes auditeurs, multi-bitrate/HLS, relais/fallback, webhooks, branding.

**Le point clé à retenir :** AzuraCast EST précisément la couche d'orchestration multi-stations qu'on envisagerait de bâtir. Tout son code est de la glue autour d'Icecast + Liquidsoap.

---

## 2. Ce qu'En Ondes a aujourd'hui

En Ondes est une plateforme **Radio-as-a-Service** déployée sur Railway (5 services), solide sur tout SAUF la production du flux.

**Ce qui existe et est directement réutilisable :**

- **Postgres (Drizzle)** — schéma riche : `artists`, `users` (RBAC superadmin/animateur/lecteur), `shows`, `schedule_slots` (grille 7j, créneaux 0-1440 min), `episodes`, `mixes` (avec tracklist JSONB), `upload_intents`, `analytics_*`, `track_history`, `push_subscriptions`, `audit_log`, `refresh_tokens`.
- **API Hono** — auth JWT + refresh, RBAC, CRUD admin complet, presign S3, analytics, RSS podcasts, Open Graph, Web Push, audit log.
- **Stockage S3** — presign PUT (l'API ne touche pas les octets), `headObject`, `publicUrl`, chemins `episodes/`, `mixes/`, `covers/`.
- **Admin Next.js** — pages animateurs/émissions/grille/podcasts/mixes/utilisateurs/statistiques/journal/notifications, composants upload audio/image + CRUD générique.
- **Site public** — lecteur `player.js`, now-playing `now-playing.js`, grille, présence WebSocket, analytics beacon, PWA/SW, Web Push.
- **Multi-client** — `brand/*.json` + `build-brand.mjs` + `new-client.mjs` (onboard < 1 jour).

**Le fait central — En Ondes NE PRODUIT PAS de flux :**

- Le site **lit** un flux externe : `player.js` fait `audio.src = STREAM_URL` où `STREAM_URL = BRAND.stream.url` (ex. `cast5.asurahosting.com`, Asura Hosting).
- Le now-playing est **consommé**, pas produit : `track-history.ts` est un **poller HTTP** qui interroge `NOWPLAYING_URL` toutes les 30 s (JSON ou SHOUTcast `7.html`), parse, et insère dans `track_history`. L'endpoint `/np` est un **proxy nginx** vers l'hôte externe.
- Aucun AutoDJ, aucun moteur de playout, aucune logique de succession de titres.
- Pas de modèle de **bibliothèque musicale** (pas de table `tracks`/`albums`/`playlists` ; `episodes`/`mixes` sont des contenus à la demande, pas un catalogue à diffuser).
- Pas de transcodage serveur, pas d'ingest live.

**En une phrase :** En Ondes est aujourd'hui la **moitié « gestion + présentation »** d'une radio. Il lui manque la **moitié « production du signal »**. Et — point capital — il consomme déjà un now-playing exactement au format que produit la pile Icecast/Liquidsoap. Le branchement est donc déjà à moitié fait.

---

## 3. LE GAP — ce qui manque exactement pour produire un flux

| # | Manque | Pourquoi c'est bloquant |
|---|---|---|
| 1 | **Serveur de diffusion (Icecast)** | Rien ne sert un flux aux auditeurs en interne. |
| 2 | **Moteur AutoDJ (Liquidsoap)** | Rien n'enchaîne les titres 24/7. C'est la pièce maîtresse et la plus difficile. |
| 3 | **Pont de contrôle backend ⇄ Liquidsoap** | Pas de `/nextsong` annoté ni de `/feedback`, ni de socket telnet/Unix pour skip/inject/switch à chaud. |
| 4 | **Modèle de bibliothèque musicale** | Pas de `tracks` (durée, ISRC, BPM, genre…), `playlists`, `playlist_tracks` (M:N), règles de rotation/pondération, droits. |
| 5 | **Générateur de config** | Pas de templating qui transforme Postgres → `icecast.xml` + `.liq` par station. |
| 6 | **Pré-fetch S3 → local** | Liquidsoap lit des fichiers locaux/HTTP, pas S3 nativement ; il faut un cache piloté par Node (ou URLs signées). |
| 7 | **Transcodage** | Pas d'encodage multi-format/bitrate (lignes `output.icecast(%ffmpeg…)`). |
| 8 | **Ingest live (harbor)** | Pas de réception DJ (encodeur ou WebDJ). |
| 9 | **TLS sur le flux** | Flux HTTP refusé par les navigateurs en HTTPS (mixed-content). Besoin reverse-proxy + Let's Encrypt + renouvellement auto. |
| 10 | **Cycle de vie des process** | Pas de démarrage/redémarrage/watchdog/supervision des process Icecast+Liquidsoap par station. |

Bonne nouvelle : le now-playing (le « retour » de la chaîne) est **déjà consommé** côté site. Le `/feedback` de Liquidsoap remplacera simplement le poller externe.

---

## 4. Architecture réaliste pour combler le gap

**Principe directeur — NE PAS réécrire Icecast ni Liquidsoap.** Les réécrire serait insensé : Liquidsoap est en OCaml, mature, stable des années en production ; le réimplémenter coûterait des années pour un résultat inférieur. La voie réaliste est celle d'AzuraCast et d'Airtime : **En Ondes (Node) devient l'orchestrateur** qui génère la config, lance les process, parle au socket de contrôle, et reçoit le now-playing.

```
                 ┌───────────────────────────────────────────────┐
                 │          EN ONDES (existant, réutilisé)        │
                 │  Postgres (état) · S3 (médias) · Admin Next.js │
                 │            API Hono · Presence WS              │
                 └───────────────┬───────────────────────────────┘
                                 │  (NOUVEAU) couche orchestration
        ┌────────────────────────┼─────────────────────────────────┐
        ▼                        ▼                                  ▼
 ┌─────────────┐        ┌──────────────────┐              ┌──────────────────┐
 │ Générateur  │  écrit │  Pré-fetch S3    │  fichiers    │ Contrôleur socket│
 │ de config   │───────▶│  → cache local   │─────────────▶│ telnet/Unix      │
 │ icecast.xml │        └──────────────────┘   locaux     │ (skip/inject/sw) │
 │  + .liq     │                                          └────────┬─────────┘
 └──────┬──────┘                                                   │ commandes
        │ lance/relance (Docker)                                   ▼
        ▼                                              ┌────────────────────────┐
 ┌──────────────┐   pousse le flux encodé   ┌─────────▶│  LIQUIDSOAP (AutoDJ)   │
 │   ICECAST    │◀──────────────────────────┤          │ playlists · crossfade  │
 │ (diffusion)  │                           │          │ switch() horaire       │
 └──────┬───────┘     /nextsong  ◀──────────┘          │ jingles · fallback     │
        │             /feedback  ──────────▶ API Hono   │ harbor (live DJ)       │
        ▼ 80/443 via nginx (TLS)            (now-playing)└────────────────────────┘
   AUDITEURS  ◀── lecteur player.js (déjà branché sur STREAM_URL + /np)
```

**Composant par composant :**

- **Icecast (diffusion).** Difficulté FAIBLE. Config = un simple XML généré par template (mounts, mots de passe par mount, `fallback-mount` anti-coupure, hooks `on-connect`/`on-disconnect` → webhook vers l'API). Cycle de vie via Docker piloté par Node. Derrière **nginx en terminaison TLS** (Let's Encrypt) — pas le SSL natif d'Icecast (bundle PEM + renouvellement pénibles). Attention : ne pas reverse-proxy Icecast 2.4.x sans chunked encoding ; viser une version récente/master.

- **Liquidsoap (AutoDJ).** Difficulté MOYENNE→ÉLEVÉE — **le vrai coût du projet**. En Ondes génère un `.liq` par station depuis Postgres : `playlist()` pondérées, `rotate()` pour jingles, `switch([({8h-12h},…)])` planifié depuis `schedule_slots`, `cross.smart()` crossfade, `input.harbor` pour le live, `fallback`/`mksafe` anti-silence, `output.icecast(%ffmpeg(...))` pour le transcodage. Le coût principal est **la courbe d'apprentissage du langage Liquidsoap**, pas la plomberie Node.

- **Pont de contrôle.** Deux canaux : (a) **HTTP** — `request.dynamic` appelle `/nextsong` de l'API Hono qui renvoie une URI annotée de métadonnées ; au début de lecture, Liquidsoap poste `/feedback` → l'API met à jour le now-playing (remplace le poller `track-history.ts`). (b) **Socket telnet/Unix** — pour les actions à chaud (skip, injecter un jingle, forcer un titre, changer de playlist) sans redémarrer. **Sécurité : le telnet n'a aucune auth, localhost only** — socket Unix + permissions fichier, jamais exposé.

- **Données.** Tout vit dans le Postgres existant : nouvelles tables `tracks`, `playlists`, `playlist_tracks`, `rotation_rules`. La musique reste sur le **S3 existant** ; un **pré-fetch piloté par Node** télécharge/cache les pistes localement avant lecture (plus fiable qu'un montage s3fs).

- **Branchement au site (déjà fait à moitié).** Le `BRAND.stream.url` pointera vers **notre** Icecast (via nginx) au lieu d'Asura. Le `/np` proxifiera **notre** now-playing au lieu de l'externe. **`player.js`, `now-playing.js`, la présence et les analytics ne changent pas.** C'est le gros avantage : la couche présentation est agnostique de la source du flux.

- **Workers de fond.** Pour ne pas bloquer l'upload : un worker (BullMQ/Redis) pour ID3/durée, ReplayGain (loudness), waveform — exactement le rôle de Symfony Messenger chez AzuraCast.

---

## 5. Plan par phases (ordres de grandeur réalistes)

Estimations pour **1 développeur** compétent mais **débutant en Liquidsoap** (la courbe d'apprentissage domine). Ce sont des ordres de grandeur, pas des engagements.

| Phase | Contenu | Livrable | Effort réaliste |
|---|---|---|---|
| **A — Streaming de base** | 1 Icecast + 1 Liquidsoap + 1 playlist statique générée depuis Postgres, derrière nginx/TLS, branché sur `STREAM_URL` + `/np` (`/feedback`). Pré-fetch S3→local. Watchdog/restart. | Un flux maison joue sur le site existant. | **4–8 semaines** (le 1er `.liq` qui marche bien = le mur) |
| **B — Admin musique/playlists** | Tables `tracks`/`playlists`/`playlist_tracks` + rotation pondérée. Workers ingest (ID3, ReplayGain, waveform). Pages admin Next.js bibliothèque/playlists. | L'opérateur gère sa musique et ses rotations dans En Ondes. | **4–6 semaines** |
| **C — Horaire + jingles** | `switch()` planifié câblé sur `schedule_slots`. Playlists jingle-mode/cadencées. Priorités. | Grille qui pilote réellement la diffusion. | **3–5 semaines** |
| **D — DJ en direct** | `input.harbor` + bascule `fallback` live↔auto + credentials générés. Option encodeur (BUTT/Mixxx) ET WebDJ navigateur (Webcaster.js + `input.harbor.ssl`). Enregistrement. | Animateur au micro, transition propre. | **4–8 semaines** (WebDJ + TLS harbor = le point fragile) |
| **E — Multi-clients + supervision** | Provisioning N stations (config par `brand`), isolation, quotas/compta bande passante, relais Icecast, Prometheus/Grafana + alerting, backups, runbook astreinte. | Parc exploitable et supervisé. | **6–12 semaines** |

**Total brut : ~5 à 10 mois-personnes** pour rejoindre, péniblement, ce qu'AzuraCast offre déjà — et il restera une maintenance perpétuelle.

---

## 6. Risques et charge de maintenance

- **Fiabilité 24/7.** Le daemon plante rarement ; les « pannes mystères » sont de l'**ops** : watchdog systemd/`Restart=`, `restart=true` sur la sortie Icecast, fallback anti-dead-air **par client**. Un flux mort la nuit = client fâché au réveil : **qui répond ? (astreinte)**.
- **HTTPS récurrent.** Bundle PEM + post-hook certbot (reconcat + restart tous les 90 j), ou nginx avec le piège chunked d'Icecast 2.4.x ; wildcard multi-clients = DNS-01. Plomberie multipliée par le nombre de sous-domaines. AzuraCast l'a en natif.
- **CPU transcodage.** Charge **constante 24/7**, ~10 % d'un cœur par destination de diffusion ; se dimensionne en (stations × variantes de bitrate). Sur VPS « shared CPU », throttling au-delà de ~60 % constant → gel. Prévoir du **Dedicated CPU** et mutualiser les encodeurs.
- **Bande passante = poste dominant, identique maison ou AzuraCast.** 100 auditeurs 128k 24/7 ≈ 25 TB/mois. Sur AWS egress ≈ 2 250 $/mois ; sur Hetzner EU ≈ 5 €. **Ne jamais servir du flux depuis un hyperscaler facturé à l'egress.** Le seul vrai levier de coût est l'hébergeur/CDN, **orthogonal** au choix maison vs AzuraCast.
- **Multi-tenant.** Tout-maison = écrire et maintenir le modèle de permissions par station, l'isolation, la compta bande passante. (En Ondes a déjà un risque connu : DB/S3/secrets partagés entre clients à durcir.)
- **Maintenance.** Tout-maison = patcher Icecast + Liquidsoap + nginx + OS + scripts d'orchestration × instances, + tests de non-régression à chaque montée de Liquidsoap (langage qui évolue). AzuraCast = un produit, updates auto (Watchtower) + backups.
- **Juridique (ni technique ni évitable).** Diffuser de la musique au Canada = licences **SOCAN + Re:Sound (Tarif 8), guichet Entandem**, par station/client. Aucun logiciel ne vous en exonère. À cadrer contractuellement : qui détient la licence, vous ou le client ?

---

## 7. Recommandation honnête

Trois voies :

**(a) Tout bâtir maison (orchestrer Icecast+Liquidsoap depuis En Ondes).**
Contrôle total, intégration native dans la marque, pas de dépendance, marge à long terme. Mais **5–10 mois-personnes** initiaux + maintenance à vie + astreinte + expertise Liquidsoap à acquérir. C'est reconstruire ce qu'AzuraCast donne gratuitement.

**(b) AzuraCast comme moteur invisible derrière la marque En Ondes.**
On garde tout l'acquis d'En Ondes (admin, site, analytics, présence, multi-client) et on branche le flux + now-playing sur une instance AzuraCast pilotée par son **API REST**. Time-to-first-stream : jours, pas mois. Gratuit, mature, multi-stations (64+/instance), TLS natif, backups. Inconvénient : dépendance à un produit tiers, modèle de données imposé pour la partie diffusion, et il faut « cacher » AzuraCast derrière la marque. C'est précisément ce qu'En Ondes consomme déjà (now-playing au format SHOUTcast/JSON) — le branchement est quasi immédiat.

**(c) Hybride : démarrer sur AzuraCast, internaliser progressivement.**
Lancer en (b) pour avoir des clients qui paient **maintenant**. Pendant ce temps, construire la couche d'orchestration maison **phase par phase** (Section 5), et basculer client par client quand chaque brique est éprouvée. On apprend Liquidsoap sans risque commercial, on n'internalise que ce qui le mérite, on garde AzuraCast pour les besoins déjà couverts.

**Mon avis pour une petite entreprise qui démarre : voie (c), avec un fort biais (b) au début.**

La priorité d'une jeune entreprise est d'avoir des clients en diffusion **le mois prochain**, pas dans un an. En Ondes a déjà construit la partie différenciante et difficile à imiter (admin propre, branding multi-client, analytics, PWA, now-playing déjà câblé) ; la diffusion brute, elle, est une commodité qu'AzuraCast rend gratuitement. **Commencer en orchestrant AzuraCast derrière la marque** capture cette valeur immédiatement et au risque minimal.

L'internalisation complète (voie a) ne se justifie que si, et quand, un de ces signaux apparaît : volume de clients qui rend la dépendance AzuraCast coûteuse en friction, besoin produit qu'AzuraCast ne couvre pas, ou marge bande passante à optimiser à grande échelle (et encore — ce levier-là est l'hébergeur/CDN, pas le logiciel). Dans ce cas, internaliser **progressivement** (Phase A→E) en gardant AzuraCast en filet de sécurité.

Et quoi qu'il arrive : verrouiller **tout de suite** le coût bande passante (hébergeur EU/unmetered ou CDN devant les mounts) et le **juridique SOCAN/Re:Sound par client** — ces deux points sont identiques dans les trois voies et ne dépendent d'aucun choix logiciel.