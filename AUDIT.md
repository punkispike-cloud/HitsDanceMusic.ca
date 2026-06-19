# Audit senior — Hits Dance Music (2e passe critique)

> Revue « chef de projet / tech lead jamais satisfait ». Sévérité :
> 🔴 critique · 🟠 important · 🟡 moyen · 🔵 dette technique.
> ✅ = corrigé dans cette passe.

Le système **fonctionne et est déployé** — c'est un vrai accomplissement. Mais
« ça marche » n'est pas « c'est solide ». Voici ce qui ne passerait pas une revue
exigeante.

---

## A. Sécurité

| # | Sév. | Constat | Action |
|---|---|---|---|
| A1 | 🔴 | **Secrets exposés** : le mot de passe Postgres et le `JWT_SECRET` ont transité en clair (chat). | **Roter les deux** (Railway → Postgres rotate credentials ; régénérer `JWT_SECRET`). À TON niveau. |
| A2 | 🔴 | **Mot de passe admin faible** (8 car.), pas de page « changer le mot de passe », pas de « mot de passe oublié ». Partage de mdp en clair pour onboarder. | Page change-password (endpoint déjà là) + politique de complexité. |
| A3 | 🟠 | **`POST /v1/track` public et non authentifié** → un bot peut injecter de fausses sessions/IP et polluer les stats. Rate-limit global seulement. | Signer/valider les beacons, ou détection d'anomalies. |
| A4 | 🟠 | **Loi 25 non respectée en pratique** : collecte d'IP sans mention de confidentialité, sans durée de conservation, sans mécanisme de suppression. | Mention légale + rétention + droit à l'effacement. |
| A5 | 🟠 | **Géo-IP fuite les IP des visiteurs vers un tiers** (`ipwho.is`), sans consentement ni fallback ni monitoring. | Auto-héberger une base GeoIP (MaxMind) ou retirer. |
| A6 | 🟡 | **`BUILTIN_ORIGINS` hardcode le domaine admin** dans `api/src/env.ts` (casse silencieuse si le domaine change). | Passer par une variable d'env propre. |

## B. Fiabilité & Ops

| # | Sév. | Constat | Action |
|---|---|---|---|
| B1 | 🔴 | **Aucun monitoring d'erreurs** : les erreurs prod finissent dans `console.log` → perdues. | Brancher Sentry (gratuit) sur api + admin. |
| B2 | 🔴 | **Pas de staging, déploiement direct en prod sur `main`**, sans review ni branch protection. Un commit cassé part en prod. | Env de preview Railway + protection de branche + PRs. |
| B3 | ✅ | ~~CI inexistante~~ → **GitHub Actions ajouté** (typecheck/test/build api+admin, hash SW, syntaxe JS). | Fait. |
| B4 | 🟠 | **Tests quasi inexistants** (1 seul). RBAC/auth promis dans le plan, jamais testés. | Tests d'intégration auth + RBAC + ingest. |
| B5 | ✅ | ~~Tables à croissance illimitée (refresh_tokens, upload_intents)~~ → **job de purge** (`services/maintenance.ts`). | Fait (analytics encore à traiter, voir C2). |
| B6 | 🟡 | **Pas de backup Postgres vérifié/documenté**. | Activer + tester une restauration. |

## C. Performance & scalabilité

| # | Sév. | Constat | Action |
|---|---|---|---|
| C1 | 🟠 | **Analytics = 2-3 écritures DB par beacon** (toutes les 20 s × chaque visiteur). Write-heavy, pas de batching → goulot à l'échelle. | Agréger en mémoire et flush par lots, ou file d'attente. |
| C2 | 🟠 | **`analytics_sessions` / `analytics_show_listen` sans rétention** → croissance infinie. | Rétention + agrégation quotidienne. |
| C3 | 🟡 | **Rate-limit + Set géo en mémoire** = incorrects avec >1 réplique (scaling horizontal cassé). | Redis si scaling. |
| C4 | 🟡 | **Aucune pagination** sur les listes admin (tout est renvoyé). | Pagination + recherche serveur. |
| C5 | 🟡 | **Lectures publiques sans cache** (chaque `/v1/schedule` frappe la DB) ; front en `cache:no-store` à chaque visite. | Cache HTTP court + SWR côté client. |

## D. Produit & expérience

| # | Sév. | Constat |
|---|---|---|
| D1 | 🟠 | **Le site ne permet toujours pas d'écouter les podcasts/mixes** — c'est pourtant le but de les téléverser. |
| D2 | 🟠 | **Onboarding animateur non sécurisé** : pas d'invitation par email, partage de mot de passe en clair. |
| D3 | 🟡 | **Pas de reset mot de passe, aucun email** (Resend prévu au plan, jamais branché). |
| D4 | 🟡 | **Analytics sans séries temporelles / filtres de dates / export** — juste des totaux. |
| D5 | 🟡 | **RSS podcasts** (différenciateur annoncé) jamais fait. |
| D6 | 🟡 | **Admin pensé desktop-first** — les tableaux débordent sur mobile. |
| D7 | 🟡 | **Pas d'audit log** des modifications admin (qui a changé quoi, quand). |

## E. Code & exactitude (corrections de cette passe)

| # | Sév. | Constat |
|---|---|---|
| E1 | ✅ | ~~Fiche animateur par matching de chaînes~~ → utilise la **vraie FK** `schedule_slots.artist_id` (`GET /v1/artists/:slug`). |
| E2 | ✅ | ~~Mapping carte→animateur par index (fragile)~~ → **`data-slug` + fetch détaillé**. |
| E3 | ✅ | ~~Fuite mémoire du Set géo~~ → **borné**. |
| E4 | 🟡 | `episodes`/`mixes` en `onDelete: cascade` : supprimer un animateur efface tout son contenu. Préférer un **soft-delete/archivage**. |
| E5 | 🟡 | Perte du champ « meta » libre des émissions (dérivé de l'artiste). |

---

## Verdict de chef de projet

**Ce qui est bon** : l'architecture est saine (séparation site/api/admin/db), la
sécurité applicative de base est correcte (JWT rotation, RBAC, bcrypt, CORS,
validation Zod), et la livraison fonctionne. Pour un MVP, c'est au-dessus de la
moyenne du marché (cf. l'audit concurrentiel initial).

**Ce qui m'empêche de signer** : c'est un **MVP, pas un système de production
durci**. Les trois manques rédhibitoires avant de monter en charge ou d'ouvrir à
une équipe :
1. **Observabilité** (B1) — on est aveugle en prod.
2. **Tests + process** (B2/B4) — on déploie sans filet en prod.
3. **Conformité Loi 25** (A4) — risque légal réel dès qu'un visiteur arrive.

## Top 5 priorités recommandées (dans l'ordre)
1. **Roter les secrets** (A1) — 10 min, à faire MAINTENANT.
2. **Sentry** sur api + admin (B1) — visibilité immédiate.
3. **Conformité Loi 25** (A4) — mention + rétention + purge analytics.
4. **Player podcasts/mixes public** (D1) — débloque la valeur des uploads.
5. **Tests auth/RBAC + branch protection** (B4/B2) — filet de sécurité.

> Cet audit est un document vivant : cocher (✅) au fur et à mesure.
