---
name: flux-radio
description: >-
  Diagnostiquer un problème de flux audio sur une radio En Ondes : mises en
  tampon, coupures, silence à l'antenne (dead-air), auditeurs qui n'arrivent pas
  à se connecter, now-playing figé ou absent. Utiliser dès qu'un symptôme
  d'écoute est signalé, AVANT de toucher au code du player.
metadata:
  origin: projet
---

# Diagnostic du flux radio

## La règle qui prime sur tout le reste

**Mesurer avant de corriger.** Un « ça coupe » a deux causes possibles et un seul
outil les sépare : `scripts/check-stream.mjs`. Il décode les en-têtes de trames
MP3 pour comparer l'audio réellement livré au temps qui passe, au lieu de compter
des octets.

```bash
node scripts/check-stream.mjs                       # flux de la marque courante
node scripts/check-stream.mjs <url> [secondes] [n]  # n connexions successives
```

Le verdict tient dans un chiffre, le **ratio** :

| Ratio | Ce que ça veut dire | Où est le problème |
|---|---|---|
| **< 1,0** | Le serveur livre moins d'audio que de temps écoulé. Le tampon du navigateur se vide : **la coupure est arithmétiquement inévitable.** | **Chez l'hébergeur du flux.** Aucun correctif côté client ne peut la rattraper — ne pas perdre de temps dans `js/player.js` |
| **≈ 1,0 ou plus** | Le serveur tient le temps réel | Réseau de l'auditeur, ou logique de reconnexion du player |

Regarder aussi :
- **TTFB** — c'est le silence subi à chaque reconnexion.
- **Écart entre connexions** : un grand écart min/max signale un serveur
  **surchargé** (la qualité dépend de la socket obtenue), pas un mauvais réglage
  de débit.
- **Burst-on-connect** : un serveur sain envoie une rafale à la connexion, d'où
  un ratio nettement > 1 sur les premières secondes. C'est cette avance qui
  absorbe les hoquets réseau. Son absence est un mauvais signe.

## Précédent établi — ne pas le re-diagnostiquer

L'instabilité historique de Hits Dance a été **mesurée, pas supposée** : le
serveur AsuraHosting sous-livrait d'environ 10 %. Deux conséquences :

1. Le volet client (reconnexion sur `stalled`) **a été corrigé**. Si le symptôme
   revient avec un ratio ≥ 1, chercher ailleurs — pas là.
2. Un ratio < 1 récurrent est un **problème commercial** (changer d'offre ou
   d'hébergeur), pas un bug à corriger dans le dépôt. Le dire clairement plutôt
   que de proposer un contournement client qui ne peut pas fonctionner.

## Dead-air et santé côté serveur

`api/src/services/monitor.ts` surveille en continu et écrit `radios.health_status` :

- `down` — le fetch du flux échoue.
- `silent` — aucun changement de titre depuis `STREAM_SILENCE_MIN` (défaut 30 min)
  ⇒ dead-air suspecté.
- L'alerte courriel ne part que sur **transition** vers un état problématique, et
  seulement si Resend est configuré. Débounce : `ALERT_DEBOUNCE_MIN`.

Pièges d'interprétation :
- Le silence ne se déduit **que** du now-playing (via `track_history`). Si le
  poller n'est pas encore passé, l'absence de dernier titre ne conclut PAS au
  silence.
- `MONITOR_ENABLED=false` désactive tout : vérifier avant de conclure « rien n'a
  alerté ».

## Now-playing absent ou figé

Le now-playing passe par le proxy nginx `/np`, paramétré par marque
(`stream.host` + `stream.nowPlayingProxy` dans `brand/<slug>.json`). Points à
contrôler dans l'ordre :

1. `brand/<slug>.json` pointe-t-il sur le bon hôte ? (`CHANGEME` = jamais branché)
2. Le proxy a un cache de 5 s effectif — l'en-tête `X-Cache-Status` le prouve.
   Un now-playing figé plus longtemps ne vient donc pas du cache.
3. En contenu mixte : un flux `http://` sur une page `https://` est bloqué par le
   navigateur. Toujours utiliser l'URL sécurisée du mount.

## Ordre de diagnostic

Attaquer par la couche la plus haute qui échoue — la cause y est presque toujours.

1. **Le flux répond-il ?** `check-stream.mjs`. Ratio < 1 ⇒ hébergeur, on s'arrête là.
2. **Le now-playing bouge-t-il ?** Sinon : proxy `/np`, puis source du flux.
3. **`health_status` dit quoi ?** Croiser avec ce que le monitor a vu.
4. **Le symptôme est-il propre à un auditeur ?** Réseau local, extension,
   navigateur — reproduire ailleurs avant d'accuser le serveur.

## Ce qu'il ne faut PAS faire

- Modifier `js/player.js` avant d'avoir un ratio ≥ 1. Le frontend Hits Dance est
  **gelé** ; toute retouche exige une justification mesurée (voir `degel-css`).
- Conclure à une panne serveur sur un seul test : lancer plusieurs connexions
  (`n`) et regarder la dispersion.
