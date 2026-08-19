-- Exactitude des statistiques : deux agrégats qui manquaient à la page Stats.
--
-- 1) `analytics_track_listen` : écoute réelle PAR TITRE, ventilée par jour.
--    Jusqu'ici « écoute moy. » et « skip » des top titres étaient UNE valeur
--    radio recopiée sur chaque ligne (aucune liaison titre↔écoute en base), et
--    fausse même comme métrique radio (cumuls à vie filtrés par last_at).
--    L'attribution se fait CÔTÉ SERVEUR à l'ingestion du beacon `listen` : l'API
--    connaît le titre en cours via le poller now-playing (track_history), donc
--    aucun changement du front public (gelé) n'est nécessaire.
--
-- 2) `analytics_hourly` : temps d'écoute / temps actif par (jour, heure locale).
--    Le graphique « Activité par heure » reposait sur first_seen (l'heure de la
--    PREMIÈRE visite de chaque visiteur, une fois pour toutes) — pas de
--    l'activité. Ici chaque beacon crédite l'heure où il arrive.
--
-- Les deux tables démarrent vides : les métriques correspondantes s'affichent
-- « — » tant que la collecte n'a pas produit de données (pas de reprise
-- d'historique possible — l'information n'a jamais été enregistrée).

CREATE TABLE IF NOT EXISTS "analytics_track_listen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"radio_id" uuid,
	"day" date NOT NULL,
	"artist" text DEFAULT '' NOT NULL,
	"title" text NOT NULL,
	"client_id" text NOT NULL,
	"listen_sec" integer DEFAULT 0 NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "analytics_track_listen" ADD CONSTRAINT "analytics_track_listen_radio_id_radios_id_fk" FOREIGN KEY ("radio_id") REFERENCES "public"."radios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "analytics_track_listen_key_idx" ON "analytics_track_listen" USING btree ("radio_id","day","artist","title","client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_track_listen_day_idx" ON "analytics_track_listen" USING btree ("radio_id","day");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "analytics_hourly" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"radio_id" uuid,
	"day" date NOT NULL,
	"hour" integer NOT NULL,
	"listen_sec" integer DEFAULT 0 NOT NULL,
	"active_sec" integer DEFAULT 0 NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "analytics_hourly" ADD CONSTRAINT "analytics_hourly_radio_id_radios_id_fk" FOREIGN KEY ("radio_id") REFERENCES "public"."radios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "analytics_hourly_key_idx" ON "analytics_hourly" USING btree ("radio_id","day","hour");--> statement-breakpoint

-- Isolation multi-tenant : même traitement que les autres tables porteuses de
-- radio_id (cf. 0022 pour la policy, 0025 pour FORCE + le rôle applicatif).
ALTER TABLE "analytics_track_listen" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "analytics_track_listen" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "analytics_track_listen";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "analytics_track_listen"
  USING (
    coalesce(current_setting('app.radio_id', true), '') = ''
    OR radio_id::text = current_setting('app.radio_id', true)
  )
  WITH CHECK (
    coalesce(current_setting('app.radio_id', true), '') = ''
    OR radio_id::text = current_setting('app.radio_id', true)
  );
--> statement-breakpoint
ALTER TABLE "analytics_hourly" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "analytics_hourly" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "analytics_hourly";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "analytics_hourly"
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
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "analytics_track_listen" TO enondes_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "analytics_hourly" TO enondes_app';
  END IF;
END $$;
