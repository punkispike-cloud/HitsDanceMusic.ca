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

---

## 6. Sécurité par client

- `JWT_SECRET` **unique** par client (jamais partagé).
- Rotation des secrets si exposition.
- Chaque client a son superadmin ; lui faire changer son mot de passe à la livraison.
- ⚖️ **Attestation de licences** archivée dans le registre avant exploitation.

---

## Commandes utiles (mémo)

```bash
node scripts/new-client.mjs <slug> "Nom"      # créer un client
BRAND=<slug> node scripts/build-all.mjs       # bâtir son site
node scripts/verify-deploy.mjs <api-url>      # vérifier un déploiement
node scripts/status.mjs                       # statut de tout le parc
node scripts/update-clients.mjs               # propager une mise à jour
```
