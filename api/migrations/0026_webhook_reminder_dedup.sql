-- Correctifs d'idempotence / dedup (audit bugs 2026-07-21).
--
-- 1) stripe_events : journal des événements Stripe déjà traités (idempotence webhook).
--    Une redelivery Stripe (même event.id) est ignorée. Table technique globale
--    (pas de radio_id → non soumise à RLS, comme refresh_tokens/rate_buckets).
-- 2) subscriptions.last_event_at : horodatage du dernier événement APPLIQUÉ, pour
--    ignorer un événement arrivé dans le désordre (Stripe ne garantit pas l'ordre).
-- 3) reminder_log : dedup des rappels d'émission PARTAGÉ entre instances (remplace
--    le Set en mémoire process qui dupliquait les push en multi-instance).

CREATE TABLE IF NOT EXISTS "stripe_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"event_created_at" timestamp with time zone,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "last_event_at" timestamp with time zone;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "reminder_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"radio_id" uuid,
	"slot_id" uuid NOT NULL,
	"reminder_date" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- Unicité (slot, jour) : garantit qu'UN seul rappel part par créneau et par date,
-- quel que soit le nombre d'instances. L'insert ON CONFLICT DO NOTHING sert de verrou.
CREATE UNIQUE INDEX IF NOT EXISTS "reminder_log_slot_date_idx" ON "reminder_log" USING btree ("slot_id", "reminder_date");
