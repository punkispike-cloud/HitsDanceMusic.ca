CREATE TYPE "public"."radio_status" AS ENUM('active', 'provisioning', 'paused');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" "radio_status" DEFAULT 'provisioning' NOT NULL,
	"plan" text,
	"domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stream_url" text,
	"now_playing_url" text,
	"billing_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "radios_slug_idx" ON "radios" USING btree ("slug");