# Créer un flux complet pour un client qui n'en a pas (AzuraCast + En Ondes)

> Ce runbook part de l'**installation déjà faite** d'AzuraCast (voir
> [INSTALL-AZURACAST.md](INSTALL-AZURACAST.md)) et explique **comment AzuraCast se branche sur
> En Ondes**, puis **comment monter un flux complet** (musique → AutoDJ 24/7 → DJ live) pour un
> client qui part de zéro. Public visé : l'opérateur En Ondes. Le client, lui, ne voit que le résultat.

---

## 1. Comment AzuraCast se branche sur En Ondes (l'architecture)

```
   ┌─────────────────────────────┐         API REST          ┌──────────────────────────────┐
   │  EN ONDES (api Railway)      │  ───────────────────────► │  SERVEUR AZURACAST           │
   │  Console owner → Parc        │   X-API-Key               │  (Hetzner/OVH, 1 seul serveur)│
   │  "Provisionner une radio"    │   POST /api/admin/stations│                              │
   │                              │ ◄───────────────────────  │  1 client = 1 STATION        │
   │  enregistre sur le tenant :  │   {stationId, mount, np}  │  (Icecast + Liquidsoap AutoDJ)│
   │   • streamUrl  (mount Icecast)│                          │                              │
   │   • nowPlayingUrl (/api/now…) │                          │  stream.enondes.ca           │
   └─────────────┬───────────────┘                           └──────────────┬───────────────┘
                 │                                                           │
        le SITE du client lit streamUrl (lecteur) + nowPlayingUrl (titre)   │ diffuse l'audio
                 │                                                           │
                 └──────────────────► AUDITEURS ◄───────────────────────────┘
```

**Les faits clés :**
- **Un seul serveur AzuraCast** héberge **toutes** les stations clientes (64+ par instance). C'est
  le *moteur invisible*. La face publique reste **le site En Ondes** (`enable_public_page: false`).
- Quand tu fais **Parc → Provisionner une radio**, En Ondes appelle l'API AzuraCast
  ([`createStation`](api/src/services/azuracast.ts:58)) → la station se crée toute seule, et son
  **mount Icecast** (`streamUrl`) + son **now-playing** (`nowPlayingUrl`) sont **câblés au tenant**
  ([owner.ts](api/src/routes/owner.ts:136)).
- Ça ne se déclenche **que si** `AZURACAST_BASE_URL` + `AZURACAST_API_KEY` sont posés sur l'api, et
  **qu'aucun** `streamUrl` n'a été fourni à la main. Sinon : le tenant est créé sans station (tu
  brancheras un flux externe via `streamUrl`).
- C'est **best-effort** : si AzuraCast échoue, la radio est quand même créée (statut `provisioning`)
  et l'erreur exacte est renvoyée dans `station.error`.

> ⚠️ **Ce que la création automatique fait :** une station **vide** (Icecast + AutoDJ prêts).
> **Ce qu'elle ne fait PAS :** monter la musique, créer les playlists, démarrer l'AutoDJ, configurer
> le DJ live. **C'est ça, « le flux complet » — les étapes 3 à 7 ci-dessous.**

---

## 2. Prérequis (à valider une fois)

- [ ] Serveur AzuraCast installé + HTTPS (`https://stream.enondes.ca`) — [INSTALL-AZURACAST.md].
- [ ] Clé API AzuraCast générée (super-admin → My Account → API Keys).
- [ ] Sur l'api Railway : `AZURACAST_BASE_URL=https://stream.enondes.ca` + `AZURACAST_API_KEY=…` → redeploy.
- [ ] Le client **détient ses licences SOCAN + Ré:Sonne** (Tarif 8 / Entandem) — attestation signée
      **avant** le go-live ([_private/ATTESTATION-LICENCES.md](_private/ATTESTATION-LICENCES.md)).

---

## 3. Étape A — Provisionner la radio (crée la station vide)

1. Admin En Ondes → login **owner** → **Parc → Provisionner une nouvelle radio**.
2. Remplis : nom, slug, forfait, contacts, prix mensuel. **Laisse le champ flux vide** (c'est ce
   qui déclenche la création AzuraCast automatique).
3. Valide. En Ondes appelle AzuraCast → la station se crée. La réponse contient `station.created: true`.
4. **Vérifie** dans `https://stream.enondes.ca` (admin AzuraCast) que la nouvelle station apparaît.

> Si `station.created: false` + une erreur : vérifie la clé API, que `stream.enondes.ca` est
> joignable depuis Railway (DNS + HTTPS OK), et les droits admin de la clé. Re-tente après correction.

---

## 4. Étape B — Monter la musique (la bibliothèque)

Dans l'admin AzuraCast → **[la station] → Music Files** :
- **Téléverse** la musique de départ (glisser-déposer), OU en gros volume via **SFTP** (AzuraCast →
  station → SFTP Users → crée un accès, puis FileZilla vers `stream.enondes.ca`).
- Range en **dossiers** (ex. `/Rotation`, `/Jazz`, `/Soir`) — ça simplifie les playlists.
- Laisse AzuraCast lire les **métadonnées** (artiste/titre) — elles alimenteront le now-playing.

> 🎵 **Musique de départ :** soit le client te fournit sa bibliothèque (clé USB / lien), soit il a
> sa propre source. **On ne fournit jamais de musique sous licence** — c'est au client (licences à lui).

---

## 5. Étape C — Créer les playlists

Station → **Playlists → Add Playlist** :
- **« Rotation générale »** (type *General Rotation*) → assigne le gros de la musique. C'est le fond 24/7.
- Optionnel : playlists par **ambiance/heure** (ex. « Matin », « Soir »), avec **programmation**
  (onglet *Schedule* d'une playlist → plages horaires) pour varier selon le moment de la journée.
- Optionnel : **jingles / IDs station** (type *Once per X songs*) pour l'identité d'antenne.
- **Poids (weight)** : ajuste la fréquence relative des playlists.

---

## 6. Étape D — Démarrer l'AutoDJ (le 24/7)

- Avec au moins **une playlist active + de la musique**, l'**AutoDJ (Liquidsoap)** joue
  automatiquement en boucle. Vérifie en haut de la page station : le lecteur doit jouer un titre.
- Règle le **crossfade / fondu** : station → **Profile → Edit → AutoDJ** (durée de fondu, gap).
- **Redémarre le backend** si besoin : station → **Restart Broadcasting**.
- ✅ À ce stade, le flux **diffuse 24/7 tout seul**. Le mount Icecast joue.

---

## 7. Étape E — (Optionnel) Activer le DJ live

Pour qu'un animateur prenne l'antenne en direct (sa voix/ses sets passent **par-dessus** l'AutoDJ) :
1. Station → **Streamer/DJ Accounts → Add** → crée un identifiant + mot de passe pour l'animateur.
2. Station → **Profile** → note le **port DJ/source** et le **mount** (ex. `/`).
3. L'animateur se connecte avec **BUTT**, **Mixxx**, **OBS** (plugin) — ou le **Web DJ** intégré
   d'AzuraCast (rien à installer) : station → **Web DJ** → micro + fichiers dans le navigateur.
4. Quand le DJ est connecté, il **prend le dessus** sur l'AutoDJ ; à la déconnexion, l'AutoDJ reprend.

> 🎛️ **Deux modèles à proposer (voir [_private/OFFRE-DETAILLEE.md](_private/OFFRE-DETAILLEE.md) §4) :**
> *« On s'occupe de tout »* (on monte musique + playlists) pour les non-techniques, ou *« Tu gères
> ta musique »* (on lui donne l'accès AzuraCast à ses couleurs) pour les DJ/collectifs.

---

## 8. Étape F — Câbler et vérifier dans En Ondes

Le provisioning a déjà posé `streamUrl` (mount Icecast) + `nowPlayingUrl` sur le tenant. À confirmer :
1. **Stream joue** : ouvre le `streamUrl` dans un navigateur/VLC → tu dois entendre l'audio.
2. **Now-playing répond** : ouvre `https://stream.enondes.ca/api/nowplaying/<shortName>` → JSON avec
   le titre en cours. *(Le poller En Ondes parse déjà ce format —
   [track-history.ts](api/src/services/track-history.ts).)*
3. **Site du client** : le lecteur du site pointe sur `streamUrl`, le titre s'affiche via
   `nowPlayingUrl`. *(Pour une instance par client : reporte le `streamUrl` dans la config de marque
   du site — `brand/<client>.json` → champ flux — puis rebuild/redeploy. Pour le multi-tenant : le
   tenant porte déjà les deux champs.)*
4. **Santé** : Parc → la pastille de santé du flux doit passer **🟢 up** (route owner `/health`).
5. Passe la radio de **`provisioning` → `active`** dans le Parc.

---

## 9. Étape G — Go-live

- [ ] Attestation **licences signée** (SOCAN + Ré:Sonne).
- [ ] Lecteur testé sur **mobile + bureau**, titre en cours OK.
- [ ] Domaine du client branché (si applicable).
- [ ] Statut **active**, santé **🟢**.
- [ ] Formation faite (le client sait gérer SA musique s'il est en mode autonome).

---

## 10. Dépannage rapide

| Symptôme | Cause probable | Correctif |
|---|---|---|
| `station.created: false` au provisioning | clé API / URL injoignable / droits | revérifier `AZURACAST_*`, DNS+HTTPS, droits admin de la clé |
| Station créée mais **silencieuse** | aucune playlist / aucune musique | étapes 4-5-6 ; *Restart Broadcasting* |
| `streamUrl` → 404 | mount pas encore prêt | attendre que le backend démarre ; vérifier le mount dans le profil de station |
| Now-playing **vide** | AutoDJ pas démarré | activer une playlist + redémarrer la diffusion |
| Titre ne s'affiche pas sur le site | `nowPlayingUrl` non câblé / mauvais shortName | vérifier le champ sur le tenant ; tester l'URL `/api/nowplaying/<shortName>` |
| DJ live ne prend pas l'antenne | mauvais port/mount/identifiants | revérifier Streamer Account + port source dans le profil |

---

## 11. Exploitation & coûts (rappel)

- **Bande passante = le poste de coût.** Toujours un hébergeur **à plat** (Hetzner/OVH), **jamais**
  d'hyperscaler facturé à l'egress (100 auditeurs 24/7 ≈ 25 To/mois ≈ ~5 € vs ~2 250 $ sur AWS).
- **Capacité :** 64+ stations par instance ; surveille CPU (le transcodage tourne 24/7) — passe à un
  CPU dédié supérieur quand tu empiles les stations.
- **Mises à jour :** `cd /var/azuracast && ./docker.sh update` (ou Watchtower).
- **Sauvegardes :** AzuraCast → Administration → Backups (planifie-les).
- **Facturation :** flux géré = **+250-500 $ one-time** (mise en route) **+30 $/mois** (hébergement) —
  voir [_private/OFFRE-DETAILLEE.md](_private/OFFRE-DETAILLEE.md) §4.

> 💡 Rappel : un client qui a **déjà** un flux (ex. Hits Dance sur AsuraHosting) **n'a pas besoin de
> tout ça** — on pose juste son `streamUrl` / `nowPlayingUrl` existants sur le tenant. AzuraCast =
> uniquement pour les clients **sans** flux (et c'est facturable).
