-- Durcissement RLS (soft rollout, étape 2) + rôle applicatif non-propriétaire.
--
-- Complément de 0022/0023/0024 (qui posent ENABLE RLS + policies sur 21 tables
-- tenant). Ici on ajoute FORCE ROW LEVEL SECURITY : le propriétaire des tables
-- devient aussi soumis aux policies (défense en profondeur). SÉCURITAIRE : la
-- policy `tenant_isolation` laisse tout visible tant que `app.radio_id` est vide
-- (coalesce(...,'')='') → le propriétaire qui migre/seede sans poser la GUC voit
-- toujours tout (zéro rupture pour migrate/seed/jobs cross-radio).
--
-- On crée aussi un rôle applicatif `enondes_app` (LOGIN, NOBYPASSRLS) + GRANT sur
-- le schéma et toutes les tables. L'activation consiste (ops) à :
--   1. ALTER ROLE enondes_app WITH PASSWORD '<fort>';
--   2. pointer DATABASE_URL du service api sur ce rôle;
--   3. poser `app.radio_id` par requête côté API (wrapper withTenantGuc /
--      withCrossRadio de src/db/tenant-guc.ts) — sans cela, le rôle voit toutes
--      les radios (GUC vide = tout visible), comme aujourd'hui.
-- Aucune rupture tant que la GUC n'est pas posée : cette migration ne fait qu'activer
-- FORCE et préparer les privilèges. L'isolation réelle s'active au runtime (cf.
-- MULTITENANT-DEPLOIEMENT.md §5 et api/scripts/test-rls.mjs pour la valider).

DO $$
DECLARE
  t TEXT;
  tenant_tables TEXT[] := ARRAY[
    'artists','users','shows','schedule_slots','episodes','mixes','tracks',
    'upload_intents','analytics_sessions','analytics_show_listen','track_history',
    'track_likes','song_requests','polls','poll_votes','push_subscriptions',
    'audit_log','report_log','media_assets','ad_rotations','subscriptions'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- Rôle applicatif (non-superuser, ne bypass pas RLS). Idempotent.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'enondes_app') THEN
    CREATE ROLE enondes_app LOGIN NOBYPASSRLS;
  END IF;
END $$;

-- Privilèges : accès au schéma + CRUD sur toutes les tables (y compris `radios`,
-- racine tenant sans RLS → l'app peut résoudre la radio courante). Les séquences
-- sont couvertes au cas où (les PK sont uuid, mais par sûreté).
GRANT USAGE ON SCHEMA public TO enondes_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO enondes_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO enondes_app;

-- Les futures tables créées par une migration doivent aussi être accessibles au
-- rôle applicatif (sinon chaque migration nécessite un GRANT manuel).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO enondes_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO enondes_app;
