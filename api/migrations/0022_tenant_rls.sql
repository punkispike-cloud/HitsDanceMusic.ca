-- Isolement multi-tenant « soft rollout » : active RLS + une policy par table tenant.
--
-- SÉCURITAIRE (zéro rupture) : tant que la variable session `app.radio_id` n'est pas
-- posée, current_setting('app.radio_id', true) IS NULL → coalesce(...,'')='' → la
-- policy laisse TOUT visible (comportement actuel inchangé). Dès que le client pose
-- `SET LOCAL app.radio_id = '<uuid>'` par requête, l'isolation s'active
-- (radio_id = var). Les comptes cross-radio (owner/it) ne posent pas la variable
-- → voient toutes les radios.
--
-- Tables sans radio_id (radios, refresh_tokens, auth_tokens, rate_buckets, listeners,
-- listener_refresh_tokens, playlists, playlist_tracks, listener_favorites, track_plays)
-- NON soumises : catalogue/hub cross-radio + racine tenant + tables techniques globales.
--
-- RLS est ENABLE (pas FORCE) : le propriétaire des tables (rôle de migration/seed)
-- bypass RLS. L'isolation s'active pleinement une fois l'app connectée via un rôle
-- non-propriétaire (GRANT) + la variable posée par requête (à valider sur vraie base,
-- cf. MULTITENANT-DEPLOIEMENT.md). Cette migration pose les policies ; elle n'isole
-- rien tant que la variable n'est pas posée — donc elle ne peut rien casser.

DO $$
DECLARE
  t TEXT;
  tenant_tables TEXT[] := ARRAY[
    'artists','users','shows','schedule_slots','episodes','mixes','tracks',
    'upload_intents','analytics_sessions','analytics_show_listen','track_history',
    'track_likes','song_requests','polls','poll_votes','push_subscriptions',
    'audit_log','report_log'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format(
      $f$
        ALTER TABLE %I ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS tenant_isolation ON %I;
        CREATE POLICY tenant_isolation ON %I
          USING (
            coalesce(current_setting('app.radio_id', true), '') = ''
            OR radio_id::text = current_setting('app.radio_id', true)
          )
          WITH CHECK (
            coalesce(current_setting('app.radio_id', true), '') = ''
            OR radio_id::text = current_setting('app.radio_id', true)
          );
      $f$,
      t, t, t
    );
  END LOOP;
END $$;
