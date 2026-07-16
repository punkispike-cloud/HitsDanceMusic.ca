-- Pubs / jingles : bibliothèque de médias + plan de rotation.
-- L'audio vit sur S3/R2 (comme tracks/episodes) ; la rotation est consommée par
-- AzuraCast (playlists/rotate) ou Liquidsoap — synchro via services/azuracast.ts.

CREATE TYPE "media_asset_kind" AS ENUM ('jingle', 'ad', 'intro', 'outro', 'bed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"radio_id" uuid REFERENCES "public"."radios"("id") ON DELETE cascade ON UPDATE no action,
	"kind" "media_asset_kind" DEFAULT 'jingle' NOT NULL,
	"name" text NOT NULL,
	"audio_url" text,
	"duration_sec" integer,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ad_rotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"radio_id" uuid REFERENCES "public"."radios"("id") ON DELETE cascade ON UPDATE no action,
	"asset_id" uuid REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action,
	"weight" integer DEFAULT 1 NOT NULL,
	"day_of_week" smallint DEFAULT '-1' NOT NULL,
	"start_min" smallint DEFAULT 0 NOT NULL,
	"end_min" smallint DEFAULT 1440 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_assets_radio_idx" ON "media_assets" USING btree ("radio_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ad_rotations_radio_idx" ON "ad_rotations" USING btree ("radio_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ad_rotations_asset_idx" ON "ad_rotations" USING btree ("asset_id");--> statement-breakpoint
ALTER TABLE "ad_rotations" ADD CONSTRAINT "ad_rotations_day_chk" CHECK ("day_of_week" BETWEEN -1 AND 6);--> statement-breakpoint
ALTER TABLE "ad_rotations" ADD CONSTRAINT "ad_rotations_range_chk" CHECK ("start_min" < "end_min" AND "end_min" <= 1440);--> statement-breakpoint
-- RLS sur les nouvelles tables tenant (cf. 0022_tenant_rls : soft rollout).
ALTER TABLE "media_assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "media_assets";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "media_assets"
	USING (coalesce(current_setting('app.radio_id', true), '') = '' OR radio_id::text = current_setting('app.radio_id', true))
	WITH CHECK (coalesce(current_setting('app.radio_id', true), '') = '' OR radio_id::text = current_setting('app.radio_id', true));--> statement-breakpoint
ALTER TABLE "ad_rotations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "ad_rotations";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "ad_rotations"
	USING (coalesce(current_setting('app.radio_id', true), '') = '' OR radio_id::text = current_setting('app.radio_id', true))
	WITH CHECK (coalesce(current_setting('app.radio_id', true), '') = '' OR radio_id::text = current_setting('app.radio_id', true));
