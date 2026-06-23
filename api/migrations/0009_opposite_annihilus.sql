DROP INDEX IF EXISTS "analytics_sessions_client_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "analytics_show_listen_pair_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "artists_slug_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "episodes_slug_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "mixes_slug_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "push_subscriptions_endpoint_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "shows_slug_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "analytics_sessions_client_idx" ON "analytics_sessions" USING btree ("radio_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "analytics_show_listen_pair_idx" ON "analytics_show_listen" USING btree ("radio_id","show_title","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "artists_slug_idx" ON "artists" USING btree ("radio_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "episodes_slug_idx" ON "episodes" USING btree ("radio_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mixes_slug_idx" ON "mixes" USING btree ("radio_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_endpoint_idx" ON "push_subscriptions" USING btree ("radio_id","endpoint");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shows_slug_idx" ON "shows" USING btree ("radio_id","slug");