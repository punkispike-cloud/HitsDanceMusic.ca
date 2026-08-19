-- Reset de mot de passe auditeur : jeton à usage unique (haché), miroir de
-- auth_tokens (staff) sur la table listeners. Pas de purpose : les auditeurs
-- n'ont pas de flux d'invitation. Table sans radio_id → hors RLS (cf. 0022).
CREATE TABLE IF NOT EXISTS "listener_auth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listener_id" uuid NOT NULL REFERENCES "public"."listeners"("id") ON DELETE cascade ON UPDATE no action,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "listener_auth_tokens_hash_idx" ON "listener_auth_tokens" ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listener_auth_tokens_listener_idx" ON "listener_auth_tokens" ("listener_id");
