CREATE TYPE "public"."request_status" AS ENUM('new', 'read', 'queued', 'played', 'ignored');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "song_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"radio_id" uuid,
	"client_id" text NOT NULL,
	"artist" text DEFAULT '' NOT NULL,
	"title" text NOT NULL,
	"dedication" text,
	"requester_name" text,
	"show_id" uuid,
	"slot_id" uuid,
	"status" "request_status" DEFAULT 'new' NOT NULL,
	"handled_at" timestamp with time zone,
	"handled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "song_requests" ADD CONSTRAINT "song_requests_radio_id_radios_id_fk" FOREIGN KEY ("radio_id") REFERENCES "public"."radios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "song_requests" ADD CONSTRAINT "song_requests_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "song_requests" ADD CONSTRAINT "song_requests_slot_id_schedule_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."schedule_slots"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "song_requests" ADD CONSTRAINT "song_requests_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "song_requests_inbox_idx" ON "song_requests" USING btree ("radio_id","status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "song_requests_radio_idx" ON "song_requests" USING btree ("radio_id");