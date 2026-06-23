# Déployer une instance de TEST multi-tenant (Railway) — pas à pas

> But : tester le CRM multi-tenant (console owner, provisionner une 2e radio,
> prouver l'isolation) **sur une instance NEUVE et jetable**, sans jamais toucher
> ta prod Hits Dance (projet `independent-perception`, qui continue de déployer
> `main`). L'instance de test déploie la **branche `feat/crm-multitenant`**.

---

## 0. Pré-requis (5 min)

- Générer 3 secrets forts (sur Windows, dans un terminal) :
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
  ```
  Lance-le **3 fois** → garde-les pour : `JWT_SECRET`, `SEED_ADMIN_PASSWORD`, `SEED_OWNER_PASSWORD`.
  (Ne les colle nulle part d'autre que Railway.)

---

## 1. Nouveau projet Railway « en-ondes-test »

1. railway.app → **New Project** → nomme-le `en-ondes-test`.
2. **+ New → Database → PostgreSQL** (crée la base).

---

## 2. Service `api` (sur la branche)

1. **+ New → GitHub Repo → HitsDanceMusic.ca**.
2. **Settings → Source** :
   - **Root Directory** = `api`
   - **Branch** = `feat/crm-multitenant`  ← *crucial : la branche, pas main*
3. **Variables** (onglet Variables → Raw Editor, colle ceci en remplaçant les `<…>`) :
   ```
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   JWT_SECRET=<secret #1>
   NODE_ENV=production
   SEED_BRAND=hitsdance
   SEED_RADIO_NAME=Radio Démo (test)
   SEED_ADMIN_EMAIL=admin@demo.test
   SEED_ADMIN_PASSWORD=<secret #2>
   SEED_OWNER_EMAIL=toi@enondes.ca
   SEED_OWNER_PASSWORD=<secret #3>
   ```
   - `SEED_ADMIN_*` = l'**admin de la radio démo** (rôle superadmin).
   - `SEED_OWNER_*` = **TON accès propriétaire** (rôle owner, cross-radio) — c'est lui qui voit le Parc.
   - `ALLOWED_ORIGINS` : on l'ajoutera à l'étape 4 (une fois le domaine admin connu).
4. **Deploy**. Au pré-deploy, l'api applique les migrations **0001→0009** puis le seed :
   crée la radio `hitsdance` (« Radio Démo »), l'admin, **et ton owner**.
5. **Settings → Networking → Generate Domain** → note l'URL (ex. `https://api-xxxx.up.railway.app`).
6. Vérifie : `https://<api>/health` → `{ "ok": true, "db": true }`.

---

## 3. Service `admin`

1. **+ New → GitHub Repo → HitsDanceMusic.ca**.
2. **Root Directory** = `admin` · **Branch** = `feat/crm-multitenant`.
3. **Variables** :
   ```
   NEXT_PUBLIC_API_URL=https://<api de l'étape 2>
   ```
4. **Deploy** → **Generate Domain** → note l'URL admin (ex. `https://admin-xxxx.up.railway.app`).

---

## 4. Câbler les origines (CORS)

Retourne au service `api` → Variables → ajoute :
```
ALLOWED_ORIGINS=https://<domaine admin de l'étape 3>
```
→ **Redeploy** l'api.

---

## 5. ✅ Tester l'isolation multi-tenant (le moment de vérité)

Ouvre l'admin (`https://<admin>`).

**A. Accès owner**
1. Login avec `SEED_OWNER_EMAIL` / `<secret #3>`.
2. Tu vois un menu **« Parc (radios) »** (réservé à l'owner). Clique dessus.
3. Le Parc montre **1 radio** : « Radio Démo » + ses stats agrégées.

**B. Provisionner une 2e radio**
4. En bas du Parc → **Provisionner une nouvelle radio** : Nom = `Radio Test 2` → Créer.
5. Elle apparaît (statut « en montage »). Clique **« Administrer »** → l'admin bascule dessus (recharge).
6. Les pages Animateurs/Émissions/Grille sont **vides** (isolées de Radio Démo). ✅

**C. Preuve que le bug des slugs est corrigé**
7. Dans Radio Test 2 : crée un animateur, slug `dj-max`.
8. Sélecteur de radio (barre latérale) → repasse sur **Radio Démo** → crée AUSSI un animateur `dj-max`.
9. **Les deux réussissent** (avant le durcissement, la 2e plantait en 500). ✅ Isolation prouvée.

**D. Admin client cloisonné**
10. (Optionnel) Crée un superadmin via **Utilisateurs** dans Radio Test 2, déconnecte-toi, reconnecte-toi avec lui : il **ne voit que Radio Test 2**, pas de menu Parc, aucune donnée de Radio Démo. ✅

---

## 6. Brancher AzuraCast (optionnel, après l'install serveur)

Une fois ton serveur AzuraCast prêt (voir `INSTALL-AZURACAST.md`), ajoute au service `api` :
```
AZURACAST_BASE_URL=https://stream.enondes.ca
AZURACAST_API_KEY=<clé API AzuraCast>
```
→ Redeploy. Désormais, **« Provisionner une radio » crée aussi sa station de flux** automatiquement
(et câble `streamUrl` + `nowPlayingUrl` dans le tenant).

---

## 7. Nettoyage

Quand tu as fini de tester : **Project → Settings → Delete Project**. Rien n'a touché ta prod.

---

## Notes

- **Prod intacte** : `independent-perception` continue de déployer `main`. Cette instance de test est un projet séparé sur la branche.
- **Migrations sûres** : `0006→0009` sont additives ; le seed crée la radio + back-remplit `radio_id`. Comportement identique en mono-radio.
- **Secrets** : générés localement, posés UNIQUEMENT dans Railway. Jamais dans un chat ni dans le repo.
- **CLI Railway** (si tu préfères) : `railway link` → `railway service` → onglet Variables en UI reste le plus simple ; sinon `railway variables` pour lister/poser.
