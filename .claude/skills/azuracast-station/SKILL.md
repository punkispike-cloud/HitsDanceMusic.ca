---
name: azuracast-station
description: >-
  Provisionner et exploiter une station AzuraCast derrière la marque En Ondes :
  création de station par radio cliente, synchronisation du plan de rotation,
  playlists/AutoDJ, mount points, relais, streamers en direct, enregistrements
  de replay. Utiliser pour toute question sur l'intégration AzuraCast ou sur
  l'exploitation d'une station (silence AutoDJ, mount injoignable, storage).
metadata:
  origin: projet
---

# AzuraCast — le moteur invisible

## Où ça en est vraiment

AzuraCast est **auto-hébergé derrière la marque En Ondes** : le site En Ondes
reste la face publique, AzuraCast est le moteur (Icecast + Liquidsoap). Le code
d'intégration vit dans `api/src/services/azuracast.ts`.

**Il est dormant.** `isAzuraCastConfigured()` exige `AZURACAST_BASE_URL` **et**
`AZURACAST_API_KEY`. Sans eux, le provisioning crée juste le tenant, sans
station, et le branchement du flux se fait à la main via `streamUrl` /
`nowPlayingUrl` dans `brand/<slug>.json`. Hits Dance tourne aujourd'hui sur
AsuraHosting, pas sur AzuraCast.

**Avertissement porté par le code lui-même** : les champs exacts de l'API
(`POST /api/admin/stations`, `POST /api/station/{short}/streamers`) varient selon
la version d'AzuraCast et **n'ont pas été validés contre un serveur réel**. Toute
affirmation sur la forme d'un payload est à vérifier sur le serveur en place, pas
à recopier avec assurance.

## Ce que l'intégration sait faire

| Fonction | Rôle |
|---|---|
| `isAzuraCastConfigured()` | Garde — tout le reste en dépend |
| `createStation(name, slug)` | Crée la station de diffusion (Icecast + AutoDJ Liquidsoap), renvoie `stationId`, `shortName`, `streamUrl`, `nowPlayingUrl` |
| `listRecordings(shortName)` | Replay / catch-up d'un direct. Gated par `AZURACAST_REPLAY_ENABLED=true` **en plus** de la config de base |
| `toAzuraTime()` / `toAzuraDays()` | Conversion horaire : minutes depuis minuit → HHMM ; jour local (0=dim) → jours ISO AzuraCast (1=lun..7=dim) |
| Sync des rotations | Pousse les rotations actives d'une radio vers ses playlists AzuraCast |

Authentification : en-tête `X-API-Key`, timeout 15 s. Le now-playing public est à
`/api/nowplaying/{shortName}` et ne demande pas d'authentification.

⚠️ Les conversions de temps sont un nid à bugs : AzuraCast compte les jours de
**1 = lundi à 7 = dimanche**, le code applicatif de 0 = dimanche à 6 = samedi.
Toujours passer par `toAzuraDays()`, jamais convertir à la main.

## Modèle mental — quatre couches par station

1. **AutoDJ (Liquidsoap)** — construit la programmation quand aucun DJ n'est en
   direct. Lit les playlists, applique le crossfade, pousse vers le backend.
2. **Backend (Icecast/SHOUTcast)** — reçoit le flux de Liquidsoap et le publie
   sur des mount points.
3. **Mount points / relais** — un mount par débit/format ; les relais consomment
   un mount du serveur principal pour répartir la charge d'auditeurs.
4. **Storage** — où vivent les fichiers (local, S3, SFTP). Storage mal monté =
   playlists vides.

## Playbook de diagnostic

Descendre dans cet ordre : la cause est presque toujours dans la couche la plus
haute qui échoue.

1. **L'AutoDJ joue-t-il ?** Station en « Broadcasting », au moins une playlist
   active avec des fichiers valides. Playlist vide ou chemins cassés = silence.
2. **Liquidsoap tourne-t-il ?** Lire son log. Fautifs habituels : fichier
   corrompu, format non supporté, échec de connexion au backend. **Redémarrer la
   station après tout changement de config Liquidsoap ou de playlist** — sinon
   la modification ne prend pas effet.
3. **Le backend accepte-t-il la connexion ?** Icecast actif, et surtout **source
   password concordant**. Si Liquidsoap n'arrive pas à s'authentifier, aucun
   mount n'est publié.
4. **Le mount existe-t-il et répond-il ?** Tester son URL directement. `404` =
   mount mal nommé ; répond mais sans audio = la source n'y est pas connectée.
5. **Le storage est-il accessible ?** Playlists vides ou fichiers muets ⇒
   vérifier le montage puis relancer un **rescan** de la médiathèque.

Si le problème est un **volume d'auditeurs** et non une panne : évaluer relais et
débit avant de toucher au serveur.

HTTPS : AzuraCast intègre Let's Encrypt. Un flux en `http://` sur une page en
`https://` est bloqué par le navigateur (contenu mixte) — servir l'URL sécurisée
du mount.

## Articulation avec le reste du projet

- Mesurer le flux livré : `scripts/check-stream.mjs` et la skill `flux-radio`.
  Un ratio < 1 mesuré sur un mount AzuraCast pointe vers Liquidsoap ou le débit,
  pas vers le player.
- `api/src/services/monitor.ts` surveille indépendamment (`down` / `silent`) —
  c'est le filet qui alerte quand l'AutoDJ s'arrête.
- Brancher une station sur une marque : `stream.*` dans `brand/<slug>.json`, voir
  la skill `nouvelle-radio`.

Documentation officielle pour tout détail au-delà de ce qui est affirmable ici :
https://www.azuracast.com/docs/
