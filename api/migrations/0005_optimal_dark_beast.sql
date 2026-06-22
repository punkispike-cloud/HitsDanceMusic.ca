CREATE TABLE IF NOT EXISTS "track_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artist" text DEFAULT '' NOT NULL,
	"title" text NOT NULL,
	"played_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "track_history_played_at_idx" ON "track_history" USING btree ("played_at");