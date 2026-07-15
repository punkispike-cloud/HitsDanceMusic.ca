-- Facturation : miroir minimal de l'abonnement Stripe d'une radio.
-- Le webhook Stripe (lib `stripe` + secret de signature) met à jour le statut.
-- Gated par STRIPE_SECRET (aucune dépendance à la lib stripe n'est requise pour
-- appliquer cette migration ; le webhook est branché plus tard, cf. ROADMAP Phase 5).

CREATE TYPE "subscription_status" AS ENUM ('active', 'trialing', 'past_due', 'canceled', 'incomplete');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"radio_id" uuid REFERENCES "public"."radios"("id") ON DELETE cascade ON UPDATE no action,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"plan_tier" text NOT NULL,
	"status" "subscription_status" DEFAULT 'incomplete' NOT NULL,
	"current_period_end" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_radio_idx" ON "subscriptions" USING btree ("radio_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_stripe_customer_idx" ON "subscriptions" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_stripe_sub_idx" ON "subscriptions" USING btree ("stripe_subscription_id");--> statement-breakpoint
-- RLS sur la nouvelle table tenant (cf. 0022 : soft rollout).
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "subscriptions";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "subscriptions"
	USING (coalesce(current_setting('app.radio_id', true), '') = '' OR radio_id::text = current_setting('app.radio_id', true))
	WITH CHECK (coalesce(current_setting('app.radio_id', true), '') = '' OR radio_id::text = current_setting('app.radio_id', true));
