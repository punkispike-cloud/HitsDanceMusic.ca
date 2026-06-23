ALTER TABLE "analytics_sessions" ADD COLUMN "radio_id" uuid;--> statement-breakpoint
ALTER TABLE "analytics_show_listen" ADD COLUMN "radio_id" uuid;--> statement-breakpoint
ALTER TABLE "artists" ADD COLUMN "radio_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "radio_id" uuid;--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "radio_id" uuid;--> statement-breakpoint
ALTER TABLE "mixes" ADD COLUMN "radio_id" uuid;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "radio_id" uuid;--> statement-breakpoint
ALTER TABLE "schedule_slots" ADD COLUMN "radio_id" uuid;--> statement-breakpoint
ALTER TABLE "shows" ADD COLUMN "radio_id" uuid;--> statement-breakpoint
ALTER TABLE "track_history" ADD COLUMN "radio_id" uuid;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD COLUMN "radio_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "radio_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "analytics_sessions" ADD CONSTRAINT "analytics_sessions_radio_id_radios_id_fk" FOREIGN KEY ("radio_id") REFERENCES "public"."radios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "analytics_show_listen" ADD CONSTRAINT "analytics_show_listen_radio_id_radios_id_fk" FOREIGN KEY ("radio_id") REFERENCES "public"."radios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "artists" ADD CONSTRAINT "artists_radio_id_radios_id_fk" FOREIGN KEY ("radio_id") REFERENCES "public"."radios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_radio_id_radios_id_fk" FOREIGN KEY ("radio_id") REFERENCES "public"."radios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "episodes" ADD CONSTRAINT "episodes_radio_id_radios_id_fk" FOREIGN KEY ("radio_id") REFERENCES "public"."radios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mixes" ADD CONSTRAINT "mixes_radio_id_radios_id_fk" FOREIGN KEY ("radio_id") REFERENCES "public"."radios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_radio_id_radios_id_fk" FOREIGN KEY ("radio_id") REFERENCES "public"."radios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schedule_slots" ADD CONSTRAINT "schedule_slots_radio_id_radios_id_fk" FOREIGN KEY ("radio_id") REFERENCES "public"."radios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shows" ADD CONSTRAINT "shows_radio_id_radios_id_fk" FOREIGN KEY ("radio_id") REFERENCES "public"."radios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "track_history" ADD CONSTRAINT "track_history_radio_id_radios_id_fk" FOREIGN KEY ("radio_id") REFERENCES "public"."radios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_radio_id_radios_id_fk" FOREIGN KEY ("radio_id") REFERENCES "public"."radios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_radio_id_radios_id_fk" FOREIGN KEY ("radio_id") REFERENCES "public"."radios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_sessions_radio_idx" ON "analytics_sessions" USING btree ("radio_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_show_listen_radio_idx" ON "analytics_show_listen" USING btree ("radio_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artists_radio_idx" ON "artists" USING btree ("radio_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_radio_idx" ON "audit_log" USING btree ("radio_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "episodes_radio_idx" ON "episodes" USING btree ("radio_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mixes_radio_idx" ON "mixes" USING btree ("radio_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_subscriptions_radio_idx" ON "push_subscriptions" USING btree ("radio_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "schedule_radio_idx" ON "schedule_slots" USING btree ("radio_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shows_radio_idx" ON "shows" USING btree ("radio_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "track_history_radio_idx" ON "track_history" USING btree ("radio_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "upload_intents_radio_idx" ON "upload_intents" USING btree ("radio_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_radio_idx" ON "users" USING btree ("radio_id");