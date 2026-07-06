CREATE TABLE IF NOT EXISTS "track_plays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"track_id" uuid NOT NULL,
	"listener_id" uuid,
	"played_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "track_plays" ADD CONSTRAINT "track_plays_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "track_plays" ADD CONSTRAINT "track_plays_listener_id_listeners_id_fk" FOREIGN KEY ("listener_id") REFERENCES "public"."listeners"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "track_plays_track_idx" ON "track_plays" USING btree ("track_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "track_plays_played_idx" ON "track_plays" USING btree ("played_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "track_plays_listener_idx" ON "track_plays" USING btree ("listener_id");