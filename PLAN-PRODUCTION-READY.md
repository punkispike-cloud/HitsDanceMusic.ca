# Plan de mise en production — En Ondes

> Issu de l'audit du 2026-08-21 (74/100, lançable avec réserves). Objectif :
> passer les deux angles morts opérationnels en systèmes qui préviennent, et
> couvrir le seul parcours dont dépend le produit.
>
> **Principe directeur** : ne rien ajouter qui doive être *pensé* en cas
> d'incident. Tout ce qui protège doit être vérifié par une commande, et cette
> commande doit tourner toute seule.

## Lecture rapide

| Lot | Ce que ça corrige | Bloquant ? | État |
|---|---|---|---|
| **A** | La panne d'antenne est invisible | 🔴 oui | code ✅ · **variables + drill : toi** |
| **B** | Le parcours auditeur n'est pas testé | 🟠 plafonne à 84 | ✅ fait |
| **C** | Reprise après incident non rejouée | 🟠 | garde + runbook ✅ · **drill : toi** |
| **D** | Durcissements 2ᵉ client | 🟢 non | D2 ✅ résolu · D1/D3 en attente |

Branche `fix/observabilite-armee`, 3 commits. Tout ce qui ne demandait ni compte
tiers ni accès production est fait ; ce qui reste est listé en fin de document.

---

## Lot A — Rendre une panne impossible à manquer 🔴

### Le défaut exact

`monitor.ts` fonctionne : toutes les 2 minutes il teste chaque radio active,
distingue `down` (flux injoignable) de `silent` (titre inchangé > 30 min), écrit
`radios.health_status` et débounce les transitions. `MONITOR_ENABLED` vaut
`"true"` par défaut, donc **c'est actif en production dès maintenant**.

Puis, [monitor.ts:43](api/src/services/monitor.ts#L43) :

```ts
if (!isResendConfigured()) return; // pas de canal courriel → l'état reste suivi, sans envoi
```

`RESEND_API_KEY` étant absent de la prod, chaque alerte s'arrête là. La chaîne de
détection est complète et se termine dans le vide. Même conséquence pour les
invitations d'équipe et les réinitialisations de mot de passe : `sendEmail`
renvoie `false` et l'appelant n'a aucun moyen de le savoir.

Second angle mort : `SENTRY_DSN` absent, donc aucune exception de production
n'est capturée. Le code est branché dès le boot ([index.ts:44](api/src/index.ts#L44)).

### A1 — Resend (⚠️ pas « deux minutes ») — ⏳ à toi

`EMAIL_FROM` vaut par défaut `no-reply@hitsdancemusic.ca`. Resend **refuse
d'expédier depuis un domaine non vérifié** : il faut poser les enregistrements
DNS (SPF, DKIM, et `MAIL FROM`) chez le registraire de `hitsdancemusic.ca`, puis
attendre la propagation. C'est la seule tâche du plan qui a un délai externe —
donc **à démarrer en premier**, même si le reste attend.

1. Créer le domaine dans Resend, poser les DNS, attendre le ✅.
2. `railway variables --service api --set RESEND_API_KEY=re_...`
3. Vérifier `EMAIL_FROM` : doit correspondre au domaine vérifié.

Vérification : déclencher une invitation d'équipe réelle depuis la console admin
et constater la réception. Pas de « la variable est posée » comme preuve.

### A2 — Sentry — ⏳ à toi

Deux DSN distincts, deux services :

1. `railway variables --service api --set SENTRY_DSN=https://...`
2. `railway variables --service admin --set NEXT_PUBLIC_SENTRY_DSN=https://...`
   — **rebuild obligatoire** : Next inline la variable au build, la poser sans
   redéployer ne fait rien.

Vérification : `POST /v1/admin/health/sentry-test` existe déjà pour ça
([health-admin.ts](api/src/routes/health-admin.ts)). Il renvoie
`{ sentry: true }` si le DSN est posé ; l'événement doit apparaître dans le
dashboard sous ~1 min. Réservé aux rôles `it`/`superadmin`/`owner`.

### A3 — Code : que l'absence de canal ne puisse plus passer inaperçue — ✅ fait

C'est la partie « créer ce qui manque ». Aujourd'hui, une configuration
d'observabilité vide est **silencieuse** — c'est exactement ce qui a permis à
l'angle mort d'exister. Trois changements, tous petits :

**a) `/health` dit ce qui est armé.** Aujourd'hui il ne rend que `{ ok, db }`.
Il devient :

```json
{ "ok": true, "db": true, "service": "hitradio-api",
  "monitor": true, "alerts": false, "sentry": false }
```

`alerts: false` avec `monitor: true` est la signature exacte du défaut :
« je surveille, mais je ne peux prévenir personne ». Lisible par un humain, par
`verify-deploy.mjs`, et par n'importe quelle sonde externe.

**b) Avertissement bruyant au démarrage.** `env.ts` refuse déjà de démarrer sur
un `JWT_SECRET` faible ou `ALLOWED_ORIGINS=*` en prod. Même posture, un cran plus
bas : si `NODE_ENV=production` et monitor actif sans Resend, un `console.error`
explicite au boot. **Avertissement, pas refus** — une radio qui diffuse ne doit
jamais s'arrêter pour un défaut de courriel.

**c) `pre-go-live.mjs` gagne un check #9 « observabilité ».** Le script vérifie
déjà 8 conditions avant de mettre un client en ondes (registre, marque,
paperasse, radio active, superadmin, abonnement, santé API, DNS). Il ne vérifie
pas qu'on saura si la radio tombe. Nouveau check, lu depuis `/health` :
`alerts` et `sentry` à `false` ⇒ **fail bloquant**, pas warn.

### A4 — Le drill dead-air — ⏳ à toi (procédure écrite : RUNBOOK § Vague 1.6)

Poser les variables ne prouve pas que l'alerte arrive. Sur staging, pointer
`now_playing_url` vers une URL morte, attendre un cycle de 2 min, constater :
`health_status = "down"` en base **et** le courriel reçu. Puis même exercice pour
`silent` avec `STREAM_SILENCE_MIN=1`.

**Un chemin d'alerte non rejoué est un chemin non fonctionnel.** C'est le seul
critère de sortie du lot A.

---

## Lot B — Tester le parcours qui porte le produit — ✅ fait

### Le défaut

Le smoke CI couvre deux choses : l'accueil charge sans erreur console, et
`/health` + `/v1/schedule` répondent. **Personne ne vérifie que presser lecture
démarre le son.** C'est ce qui plafonne la note à 84, et c'est le seul parcours
dont dépendent tous les autres.

### Le piège, et pourquoi il faut deux tests

Un test qui lance le vrai flux AsuraHosting testerait deux choses à la fois :
notre code, et la santé d'un hébergeur tiers déjà mesuré instable (il
sous-livre ~10 %). Un échec ne dirait pas lequel des deux a lâché — et un test
qui ne discrimine pas devient un test qu'on ignore.

D'où deux tests distincts, à statuts différents :

**B1 — Câblage du player, flux simulé, bloquant en CI.**
Intercepter la requête audio via `page.route()` et servir un court MP3 local.
Cliquer sur lecture (le clic Playwright *est* un geste utilisateur, donc les
politiques d'autoplay ne bloquent pas), puis assertion sur ce que le contrat
CSS↔JS garantit : `#player` porte `is-playing`, et surtout
`audio.currentTime > 0` après un délai — la seule preuve que le son avance
réellement. Ne dépend d'aucun tiers ⇒ **doit être vert, toujours**.

**B2 — Flux réel, non bloquant.**
Reprend `scripts/check-stream.mjs`, déjà écrit pour ça. En `continue-on-error`,
comme le job `smoke-staging` existant. Un rouge ici veut dire « appeler
l'hébergeur », pas « corriger le code ».

**Pièges connus à respecter** (issus de la stack dev locale) : ne jamais attendre
`networkidle` sur une page qui tient un SSE ouvert — il n'arrive jamais ; et
acquitter la bannière Loi 25 (`audience-ack`) dans l'initScript, sinon elle
décale la page.

### B3 — Parcours admin (optionnel, à décider) — ⏳ décision

Connexion → parc → modification d'une émission. Demande un compte de test
dédié en staging. À faire seulement si tu veux couvrir la console ; le lot B
sans B3 couvre déjà le risque principal.

---

## Lot C — Pouvoir revenir en arrière 🟠

### Le défaut

32 migrations vers l'avant, **zéro fichier de rollback**. La reprise existe
(PITR, sauvegarde quotidienne 7h17 UTC, `restore-drill.mjs`) mais elle est
*globale* : elle ramène toute la base à un instant, on ne peut pas annuler *une*
migration. Et l'incident du 17 août — restauration PITR à moitié appliquée, base
repartie vide — prouve que ce chemin n'est pas théorique.

### C1 — Empêcher la dette de se former — ✅ fait

**La lecture des 32 corrige le constat de l'audit : aucune ne détruit de
donnée.** Les seuls `DROP` sont dans `0009`, qui supprime sept index pour les
recréer portés sur `(radio_id, slug)` — un index se reconstruit, il ne se perd
pas. `0022`/`0025` (RLS) et `0031` (agrégat analytics), que je soupçonnais, sont
purement additives.

Écrire rétroactivement 32 fichiers `down` aurait donc été du travail mort : leur
annulation est un `DROP` évident, et un fichier jamais exécuté n'est pas un
rollback, c'est une intention. Le vrai risque n'est pas derrière nous mais
devant — la **première** migration destructive écrite un jour de pression.

D'où un garde plutôt qu'une archive : `api/scripts/check-migrations.mjs` refuse
en CI toute migration destructive sans son `api/migrations/down/`. Il démarre
vert et le reste tant que personne n'en écrit — un garde qui naît rouge est un
garde qu'on apprend à ignorer. `DROP INDEX`/`CONSTRAINT`/`POLICY`/`TRIGGER` sont
délibérément exclus : objets dérivés, reconstructibles.

### C2 — Rejouer le drill contre la prod actuelle — ⏳ à toi (accès prod)

`restore-drill.mjs` existe mais n'a pas tourné depuis la migration vers le
service `db`. Une sauvegarde jamais restaurée n'est pas une sauvegarde.
Restaurer le dernier dump dans une base jetable, compter les lignes des tables
critiques (`radios`, `users`, `track_history`, `subscriptions`), consigner la
date du drill.

### C3 — Rollback applicatif documenté — ✅ fait

Railway permet de redéployer une version antérieure. Trois lignes dans le
runbook : où cliquer, quel est le délai, et ce qui *ne* revient *pas* en arrière
(la base). Aujourd'hui ça n'existe nulle part et ça se découvrirait en pleine
panne.

---

## Lot D — Durcissements avant le 2ᵉ client 🟢

Aucun n'est bloquant en mono-tenant. Ils le deviennent le jour où deux clients
partagent la base.

**D1 — Bascule RLS runtime.** La garde statique tourne en CI
(`RLS_STRICT=1 npm run tenant:guard`) et interdit toute requête tenant sans
`radioId`. Le backstop *runtime* — `DATABASE_URL` sur le rôle `enondes_app`
plutôt que `postgres` — n'est pas activé. `verify-rls-cutover.mjs` et
`test-rls.mjs` sont déjà écrits. Séquence : `npm run test:rls` vert sur base
jetable, puis bascule staging, puis prod. **Avant le 2ᵉ client, sans discussion.**

**D2 — Le hub En Ondes ✅ résolu.** Mon inquiétude tombe : `RUNBOOK-PRODUCTION.md`
§ Vague 1.5 établit que le repo est branché sur GitHub depuis le 15-08 avec
`rootDirectory = enondes-site` (prod + staging). Une correction fusionnée
atteint bien le hub. Rien à faire.

**D3 — Stripe (décision produit, pas technique).** `STRIPE_SECRET` et
`STRIPE_WEBHOOK_SECRET` sont absents de la prod : la facturation n'existe pas
encore. Le code est bon — signature vérifiée avant parsing, table d'idempotence,
garde anti-désordre par `lastEventAt`. La question est : le 1er client est-il
facturé par la plateforme, ou hors-bande ? **À toi de trancher.** Si hors-bande,
ne pas poser les clés : du code de paiement à moitié configuré est pire
qu'éteint.

---

## Ce qui reste

Tout ce qui suit demande un compte tiers, un accès production, ou une décision —
rien qui puisse être écrit depuis le dépôt.

| # | Action | Pourquoi c'est toi |
|---|---|---|
| 1 | **Resend** : vérifier le domaine (SPF/DKIM), poser `RESEND_API_KEY` | délai DNS externe — à lancer en premier |
| 2 | **Sentry** : `SENTRY_DSN` (api) + `NEXT_PUBLIC_SENTRY_DSN` (admin, **rebuild**) | comptes tiers, secrets |
| 3 | **Drill dead-air** sur staging | accès prod ; procédure : RUNBOOK § Vague 1.6 |
| 4 | **Drill de restauration** (`npm run restore-drill`) | n'a pas tourné depuis la migration vers `db` |
| 5 | **D1 — bascule RLS runtime** | avant le 2ᵉ client ; `npm run test:rls` d'abord |

## Ce qui compte comme « fait »

| Lot | Critère de sortie | État |
|---|---|---|
| A | Un dead-air simulé produit un **courriel reçu**, et `/health` répond `alerts:true, sentry:true` | ⏳ |
| B | La suite échoue si on casse le bouton lecture | ✅ prouvé par sabotage |
| C | Le garde refuse une migration destructive nue | ✅ prouvé (5 tests) |
| C | Une base restaurée depuis le dernier dump, comptée, datée | ⏳ |
| D | `test:rls` vert et bascule staging tenue 48 h | ⏳ |

> Règle de test héritée de ce dépôt : **prouver qu'un test peut échouer avant de
> le garder.** Elle a été appliquée aux trois lots livrés. Le sabotage du lot B
> est le plus instructif : en retirant `await audio.play()`, `is-playing-radio`
> et l'`aria-label` sont **restés verts** — le player s'annonce « En direct »
> sans rien jouer. Seul `currentTime` a attrapé la panne. Un test bâti sur les
> classes CSS aurait donné une fausse assurance.

## Décisions qui t'appartiennent

1. **B3** — couvre-t-on la console admin en E2E, ou seulement le site auditeur ?
2. **D3** — facturation Stripe au 1er client, ou hors-bande ? Si hors-bande, ne
   pas poser les clés : du code de paiement à moitié configuré est pire
   qu'éteint.
