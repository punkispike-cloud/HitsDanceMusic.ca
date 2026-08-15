-- Ventilation quotidienne de l'audience + anti-double-comptage du temps.
--
-- 1) `analytics_daily` : une ligne par (radio, jour, visiteur). analytics_sessions
--    est un CUMUL DE VIE par visiteur ; en grouper les totaux par `first_seen`
--    (ce que faisait /timeseries) attribuait à un seul jour — celui de la
--    première visite — tout ce que la personne a écouté depuis. Un auditeur
--    fidèle depuis mars n'apparaissait donc jamais sur les jours récents.
--
-- 2) `analytics_sessions.last_active_at` / `last_listen_at` : horodatage du
--    dernier beacon ayant crédité du temps, par nature de temps. Permet de
--    plafonner chaque incrément au temps réellement écoulé — deux fenêtres
--    ouvertes en parallèle partagent le même client_id et comptaient sinon le
--    temps en double.
--
-- ⚠ Ce fichier a été généré par drizzle-kit puis TAILLÉ À LA MAIN : le snapshot
-- de drizzle avait dérivé (media_assets, ad_rotations, subscriptions,
-- stripe_events, reminder_log sont créées par 0023/0024/0026, écrites à la main
-- sans mettre à jour le snapshot). La génération voulait donc les recréer, avec
-- des CREATE TYPE non gardés qui auraient fait échouer le déploiement. Seul le
-- nouveau est conservé ici ; le snapshot 0027, lui, est complet et remet la
-- génération future d'aplomb.

CREATE TABLE IF NOT EXISTS "analytics_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"radio_id" uuid,
	"day" date NOT NULL,
	"client_id" text NOT NULL,
	"active_sec" integer DEFAULT 0 NOT NULL,
	"listen_sec" integer DEFAULT 0 NOT NULL,
	"page_views" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "analytics_daily" ADD CONSTRAINT "analytics_daily_radio_id_radios_id_fk" FOREIGN KEY ("radio_id") REFERENCES "public"."radios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "analytics_daily_day_client_idx" ON "analytics_daily" USING btree ("radio_id","day","client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_daily_day_idx" ON "analytics_daily" USING btree ("radio_id","day");--> statement-breakpoint

ALTER TABLE "analytics_sessions" ADD COLUMN IF NOT EXISTS "last_active_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "analytics_sessions" ADD COLUMN IF NOT EXISTS "last_listen_at" timestamp with time zone;--> statement-breakpoint

-- Isolation multi-tenant : même traitement que les autres tables porteuses de
-- radio_id (cf. 0022 pour la policy, 0025 pour FORCE + le rôle applicatif).
ALTER TABLE "analytics_daily" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "analytics_daily" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "analytics_daily";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "analytics_daily"
  USING (
    coalesce(current_setting('app.radio_id', true), '') = ''
    OR radio_id::text = current_setting('app.radio_id', true)
  )
  WITH CHECK (
    coalesce(current_setting('app.radio_id', true), '') = ''
    OR radio_id::text = current_setting('app.radio_id', true)
  );
--> statement-breakpoint

-- Le rôle applicatif est couvert par ALTER DEFAULT PRIVILEGES (0025), mais on
-- redonne le GRANT explicitement au cas où la table serait créée par un autre
-- rôle que celui qui a posé les privilèges par défaut. Idempotent.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'enondes_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "analytics_daily" TO enondes_app';
  END IF;
END $$;
--> statement-breakpoint

-- Reprise de l'historique : on rejoue chaque session sur son jour de PREMIÈRE
-- visite. C'est exactement ce que le graphique affichait jusqu'ici — donc rien
-- ne change visuellement pour le passé — mais ces lignes restent une
-- APPROXIMATION (le temps d'écoute d'un visiteur fidèle y est concentré sur son
-- premier jour). Seules les données produites à partir de cette migration sont
-- ventilées au bon jour ; l'historique se corrige de lui-même en glissant.
INSERT INTO "analytics_daily" ("radio_id", "day", "client_id", "active_sec", "listen_sec", "page_views")
SELECT s.radio_id,
       (s.first_seen AT TIME ZONE 'America/Toronto')::date,
       s.client_id,
       s.active_sec,
       s.listen_sec,
       s.page_views
FROM "analytics_sessions" s
WHERE s.radio_id IS NOT NULL
ON CONFLICT ("radio_id", "day", "client_id") DO NOTHING;
