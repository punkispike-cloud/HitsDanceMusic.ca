CREATE TYPE "public"."content_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."slot_tag" AS ENUM('morning', 'hitlist', 'drive', 'limelight', 'night', 'special', 'audition');--> statement-breakpoint
CREATE TYPE "public"."upload_kind" AS ENUM('episode', 'mix', 'cover');--> statement-breakpoint
CREATE TYPE "public"."upload_status" AS ENUM('pending', 'completed', 'aborted');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('superadmin', 'animateur', 'lecteur');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "artists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"photo_url" text,
	"initials" text,
	"show_title" text,
	"schedule_text" text,
	"bio" text,
	"socials" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_published" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "episodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"show_id" uuid,
	"artist_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"audio_url" text,
	"audio_key" text,
	"duration_sec" integer,
	"size_bytes" bigint,
	"cover_url" text,
	"season" integer,
	"episode_number" integer,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"tags" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mixes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"artist_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"genre" text,
	"audio_url" text,
	"audio_key" text,
	"duration_sec" integer,
	"size_bytes" bigint,
	"cover_url" text,
	"tracklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"tags" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by" uuid,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "schedule_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day_of_week" smallint NOT NULL,
	"start_min" smallint NOT NULL,
	"end_min" smallint NOT NULL,
	"title" text NOT NULL,
	"host_label" text NOT NULL,
	"tag" "slot_tag" NOT NULL,
	"show_id" uuid,
	"artist_id" uuid,
	"is_live" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_day_chk" CHECK ("schedule_slots"."day_of_week" BETWEEN 0 AND 6),
	CONSTRAINT "schedule_range_chk" CHECK ("schedule_slots"."start_min" < "schedule_slots"."end_min" AND "schedule_slots"."end_min" <= 1440)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"tag" "slot_tag",
	"badge" text,
	"artist_id" uuid,
	"schedule_text" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_published" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "upload_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "upload_kind" NOT NULL,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"max_bytes" bigint NOT NULL,
	"status" "upload_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"role" "user_role" DEFAULT 'lecteur' NOT NULL,
	"artist_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "episodes" ADD CONSTRAINT "episodes_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "episodes" ADD CONSTRAINT "episodes_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mixes" ADD CONSTRAINT "mixes_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schedule_slots" ADD CONSTRAINT "schedule_slots_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schedule_slots" ADD CONSTRAINT "schedule_slots_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shows" ADD CONSTRAINT "shows_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "artists_slug_idx" ON "artists" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artists_sort_idx" ON "artists" USING btree ("sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "episodes_slug_idx" ON "episodes" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "episodes_artist_idx" ON "episodes" USING btree ("artist_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "episodes_show_idx" ON "episodes" USING btree ("show_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "episodes_status_published_idx" ON "episodes" USING btree ("status","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mixes_slug_idx" ON "mixes" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mixes_artist_idx" ON "mixes" USING btree ("artist_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mixes_status_idx" ON "mixes" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refresh_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "refresh_token_hash_idx" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refresh_expires_idx" ON "refresh_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "schedule_day_idx" ON "schedule_slots" USING btree ("day_of_week","start_min");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "schedule_show_idx" ON "schedule_slots" USING btree ("show_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "schedule_artist_idx" ON "schedule_slots" USING btree ("artist_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shows_slug_idx" ON "shows" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shows_artist_idx" ON "shows" USING btree ("artist_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shows_tag_idx" ON "shows" USING btree ("tag");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "upload_intents_user_idx" ON "upload_intents" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_artist_id_idx" ON "users" USING btree ("artist_id");