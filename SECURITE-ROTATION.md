# 🔐 Runbook — Rotation des secrets & sauvegardes (prod)

> **Quand** : maintenant pour Hits Dance (secrets Postgres + `JWT_SECRET` exposés
> dans un chat → à traiter comme **compromis**). Puis **à chaque client** dont un
> secret aurait fuité. Ce runbook est **réutilisable** : remplace « Hits Dance /
> `patient-endurance` » par le client visé.
>
> **Durée** : ~30–45 min. **Impact prod** : quasi nul si l'ordre est respecté.

---

## ⛔ Règle d'or — ne jamais coller un secret dans un chat

La fuite d'origine vient d'un secret **collé dans une conversation**. On ne la répète pas :

- Génère **tous** les secrets **en local** (commandes ci-dessous), copie-les
  **directement** dans Railway. Ne les colle nulle part d'autre (ni chat, ni Claude,
  ni note non chiffrée, ni commit).
- Un secret qui transite par un canal lisible = secret **brûlé** → à reroter.

### Générer un secret en local

| OS / outil | Commande |
|---|---|
| macOS / Linux | `openssl rand -base64 48` |
| Node (partout) | `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"` |
| Windows PowerShell | `[Convert]::ToBase64String((1..48 \| %{ Get-Random -Max 256 }))` |

Pour un **mot de passe admin** lisible mais fort (≥ 20 car.) :
`node -e "console.log(require('crypto').randomBytes(16).toString('base64url'))"`

---

## Ordre d'exécution (du moins risqué au plus sensible)

> On fait **un backup d'abord** (filet de sécurité), puis le secret le moins
> impactant (JWT), puis Postgres, puis le mot de passe admin.

### 0. Filet — backup AVANT de toucher quoi que ce soit

1. Railway → projet **Postgres** → onglet **Backups** → **prendre un snapshot manuel** maintenant.
2. (Doublon hors-Railway, recommandé) dump local :
   ```bash
   # DATABASE_PUBLIC_URL = l'URL publique du service Postgres (onglet Variables)
   pg_dump "$DATABASE_PUBLIC_URL" -Fc -f hitsdance-$(date +%Y%m%d).dump
   ```
   > Garde ce `.dump` hors du repo (il contient les données). Ne jamais le committer.

### 1. `JWT_SECRET` (impact ~nul — commence par là)

**Pourquoi sûr** : les refresh tokens sont des chaînes **opaques en DB** (pas des
JWT). Roter le secret n'invalide que les **access tokens** (durée 15 min) →
le navigateur admin se **ré-authentifie tout seul** via `/auth/refresh`. Au pire :
une page à recharger. **Aucune reconnexion forcée.**

1. Génère un nouveau secret (≥ 32 car., voir ci-dessus).
2. Railway → service **api** (`patient-endurance`) → **Variables** → remplace `JWT_SECRET` → **Deploy**.
3. L'api refuse de booter si le secret fait < 32 car. (fail-fast voulu, `api/src/env.ts`).
4. **Vérifie** : recharge l'admin → tu restes connecté (ou reconnexion en 1 clic).

### 2. Mot de passe Postgres

> ⚠️ **Piège Railway** : changer la variable `POSTGRES_PASSWORD` d'un Postgres
> **déjà initialisé** ne change **PAS** le vrai mot de passe de la base
> (Postgres ne lit cette variable qu'à la **première** création). Il faut faire les
> **deux** : `ALTER USER` en SQL **et** mettre la variable à jour.

1. Génère le nouveau mot de passe en local.
2. Change-le **dans la base** (via l'onglet *Data*/*Query* du Postgres Railway, ou `psql "$DATABASE_PUBLIC_URL"`) :
   ```sql
   ALTER USER postgres WITH PASSWORD '<nouveau-mdp>';
   ```
3. Mets la variable **`POSTGRES_PASSWORD`** (et `PGPASSWORD` si présente) du service
   Postgres à la **même** valeur, pour que la référence `DATABASE_URL` reste cohérente.
4. **Bonne nouvelle** : l'api utilise `DATABASE_URL = ${{Postgres.DATABASE_URL}}`
   (variable de **référence**) → elle se **reconstruit et redéploie automatiquement**
   avec le nouveau mot de passe. Rien à changer côté api.
5. **Vérifie** : `node scripts/verify-deploy.mjs https://patient-endurance-production-21c8.up.railway.app`
   doit repasser 🟢 (`/health` + DB OK).

> **Rollback** : si l'api ne se reconnecte pas, remets l'ancien mdp via `ALTER USER`
> (tu l'as encore tant que tu n'as pas fermé l'onglet) ; en dernier recours, restaure
> le snapshot de l'étape 0.

### 3. Mot de passe admin (renforcer `Carlogix`)

> Le mot de passe admin **vit en DB** (hash bcrypt). Le **re-seed ne le change pas**
> (le seed est idempotent : il saute un utilisateur déjà présent). On le change donc
> via l'app, pas via une variable.

1. Connecte-toi à l'admin (`zucchini-charisma...`) avec l'actuel (`Carlogix`).
2. Page **`/compte`** → **changer le mot de passe** (saisis l'ancien + un nouveau ≥ 20 car.).
   - Effet : `POST /auth/change-password` **révoque tous les refresh tokens** → toutes
     les sessions se déconnectent → reconnecte-toi avec le nouveau. Normal et voulu.
3. **Mets aussi à jour la variable `SEED_ADMIN_PASSWORD`** du service api avec le
   nouveau mot de passe (sinon, si la DB est un jour recréée de zéro, le superadmin
   serait re-seedé avec l'ancien mot de passe faible).
   > Idéalement, garde `SEED_ADMIN_EMAIL` mais mets `SEED_ADMIN_PASSWORD` à une valeur
   > forte connue de toi seul.

---

## 4. Sauvegardes récurrentes + restauration testée

Un backup jamais restauré n'est pas un backup.

1. Railway → Postgres → **Backups** → activer les **snapshots automatiques** (quotidiens).
2. **Teste une restauration au moins une fois** :
   - soit restaurer un snapshot dans un **projet jetable**,
   - soit `pg_restore` du `.dump` (étape 0) vers une base locale,
   - puis lancer `node scripts/verify-deploy.mjs <url>` ou ouvrir l'admin.
3. **Note le temps de restauration** (RTO) — utile pour un SLA client.

---

## ✅ Checklist de clôture (à cocher quand fait)

- [ ] Snapshot Postgres pris **avant** rotation (+ dump local hors repo)
- [ ] `JWT_SECRET` roté (≥ 32 car., généré en local) — admin toujours accessible
- [ ] Mot de passe Postgres roté (`ALTER USER` **+** variable) — `verify-deploy` 🟢
- [ ] Mot de passe admin renforcé via `/compte` (≥ 20 car.)
- [ ] `SEED_ADMIN_PASSWORD` mis à jour côté api (cohérent avec le nouveau)
- [ ] Backups auto **activés** + **une restauration testée** (RTO noté)
- [ ] Aucun secret n'a transité par un chat / commit / note en clair

> Une fois tout coché : reporter ✅ dans `ROADMAP-AUTOLOGIX.md` (Phase 0 « Reste 🔒 »
> et Phase 3 « Sauvegardes ») et `ETAT-DU-PROJET.md` §6.

---

## Pourquoi c'est le prérequis #1

C'est de la **prod en ligne** : tant que des secrets potentiellement exposés y
traînent, on ne devrait **pas onboarder de client payant**. Cette rotation lève le
seul risque technique bloquant avant le démarrage commercial (cf. `ROADMAP-AUTOLOGIX.md`).
