ALTER TYPE "public"."upload_kind" ADD VALUE 'track';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"radio_id" uuid,
	"artist" text NOT NULL,
	"title" text NOT NULL,
	"genre" text,
	"bpm" double precision,
	"duration_sec" integer,
	"audio_url" text,
	"audio_key" text,
	"size_bytes" bigint,
	"source" text,
	"license" text,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tracks" ADD CONSTRAINT "tracks_radio_id_radios_id_fk" FOREIGN KEY ("radio_id") REFERENCES "public"."radios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tracks_radio_idx" ON "tracks" USING btree ("radio_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tracks_status_idx" ON "tracks" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tracks_artist_idx" ON "tracks" USING btree ("artist");