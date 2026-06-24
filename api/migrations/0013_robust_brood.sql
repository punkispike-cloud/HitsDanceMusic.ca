CREATE TABLE IF NOT EXISTS "report_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"radio_id" uuid NOT NULL,
	"period" text NOT NULL,
	"recipients" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "track_likes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"radio_id" uuid,
	"track_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "radios" ADD COLUMN "health_status" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "radios" ADD COLUMN "last_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "radios" ADD COLUMN "last_alert_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "radios" ADD COLUMN "last_alert_kind" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "report_log" ADD CONSTRAINT "report_log_radio_id_radios_id_fk" FOREIGN KEY ("radio_id") REFERENCES "public"."radios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "track_likes" ADD CONSTRAINT "track_likes_radio_id_radios_id_fk" FOREIGN KEY ("radio_id") REFERENCES "public"."radios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "track_likes" ADD CONSTRAINT "track_likes_track_id_track_history_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."track_history"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "report_log_uniq_idx" ON "report_log" USING btree ("radio_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "track_likes_uniq_idx" ON "track_likes" USING btree ("track_id","client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "track_likes_radio_idx" ON "track_likes" USING btree ("radio_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "track_likes_track_idx" ON "track_likes" USING btree ("track_id");