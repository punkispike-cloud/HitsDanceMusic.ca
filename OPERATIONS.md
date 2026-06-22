# 🛠️ Opérations Autologix — gérer le parc de radios

> La **bible de l'opérateur**. Comment gérer tous les clients d'un seul endroit :
> registre, statut, mises à jour, monitoring, sauvegardes, sécurité. Le but :
> **plus de clients sans plus de chaos.**

---

## 1. Le registre des clients

`brand/clients.json` = **la source de vérité** de ton parc (slug, domaines, branche,
projet Railway, palier, **attestation licences**, date de mise en service).

> 🔒 **Confidentialité** : ce fichier liste tes clients. Si un client obtient un accès
> au dépôt, déplace-le hors du repo (gitignore) et garde-le sur ta machine.

À tenir à jour : **ajouter chaque nouveau client** ici à la fin de l'onboarding
(voir `ONBOARDING-CLIENT.md`, dernière case de la checklist).

---

## 2. Statut quotidien — « tout est en ligne ? »

🧰 `node scripts/status.mjs`

Ping le `/health` de chaque client actif → tableau **🟢 UP / 🔴 DOWN**, état DB,
temps de réponse, et rappel des **licences non attestées**. À lancer chaque matin
(ou via un cron). Sort en code 1 si un client est DOWN (utilisable en alerte).

---

## 2b. Centre de contrôle — le cockpit visuel

🧰 `node scripts/console.mjs` → ouvre **`http://127.0.0.1:4477`**

La version **visuelle** de `status.mjs` : un tableau de bord web où tu vois tout ton
parc d'un coup d'œil et **gères chaque radio depuis le même endroit**.

- **KPIs** : nb de radios · en ligne / hors ligne · licences à confirmer · (revenu
  mensuel **seulement** si un montant `billing.mrr` est renseigné dans `clients.json`).
- **Tableau du parc** : état (santé live), DB, latence, palier, licences, mise en
  service, et **actions** par radio (ouvrir le *site*, l'*admin*, les *stats*, copier
  la commande `verify-deploy`).
- **Cycle de vie** : `active` (pingée), `provisioning` (déployée pas encore), `paused`.
- **Panneau onboarding** : les 5 étapes/commandes pour monter une nouvelle radio.

> 🔒 **Local uniquement** : le serveur n'écoute que sur `127.0.0.1`, ne fait aucune
> écriture et n'expose aucun secret (le registre ne contient que des domaines publics).
> Port custom : `node scripts/console.mjs --port 5000`. (Un portail déployé — consultable
> du téléphone — = ajouter auth + hébergement, étape ultérieure.)

---

## 3. Mises à jour mutualisées — corriger 1 fois, livrer à tous

Le code est **partagé** ; chaque client a sa **branche** + son **projet Railway**.
Pour propager un correctif :

1. Corriger sur `main`, vérifier la **CI verte**.
2. 🧰 `node scripts/update-clients.mjs` → imprime les commandes exactes par client
   (`git merge main` → `BRAND=<slug> build-all` → `push` → `verify-deploy`).
3. Lancer ces commandes par client.
4. 🧰 `node scripts/status.mjs` → confirmer tout le parc 🟢.

> Hits Dance = baseline `main` → à jour dès le push sur `main`.

---

## 4. Monitoring des erreurs

- **Sentry par projet** : poser `SENTRY_DSN` sur l'`api` de chaque client (DSN
  distinct par client → erreurs isolées). Déjà branché côté code (gated).
- Le `/health` (statut) couvre le « up/down » ; Sentry couvre le « pourquoi ça casse ».

---

## 5. Sauvegardes & restauration

- **Activer les backups Postgres** de chaque projet Railway.
- 🔑 **Tester une restauration au moins une fois** (un backup jamais restauré n'est
  pas un backup). Documenter le temps de restauration.
- Rétention analytics (Loi 25) : purge auto à `ANALYTICS_RETENTION_DAYS` (défaut 180 j).
- 📓 Procédure pas-à-pas : **`SECURITE-ROTATION.md` §4**.

---

## 6. Sécurité par client

- `JWT_SECRET` **unique** par client (jamais partagé).
- Rotation des secrets si exposition → **runbook ordonné : `SECURITE-ROTATION.md`**
  (générer en local, jamais coller un secret dans un chat).
- Chaque client a son superadmin ; lui faire changer son mot de passe à la livraison.
- ⚖️ **Attestation de licences** archivée dans le registre avant exploitation.

---

## Commandes utiles (mémo)

```bash
node scripts/new-client.mjs <slug> "Nom"      # créer un client
BRAND=<slug> node scripts/build-all.mjs       # bâtir son site
node scripts/verify-deploy.mjs <api-url>      # vérifier un déploiement
node scripts/status.mjs                       # statut du parc (CLI)
node scripts/console.mjs                      # centre de contrôle (cockpit web local)
node scripts/update-clients.mjs               # propager une mise à jour
```
