-- Éditorial « À la une » : cartes homepage + rail news (admin CRUD, GET /v1/featured).

DO $$ BEGIN
 CREATE TYPE "public"."featured_kind" AS ENUM('homepage', 'rail');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "featured_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"radio_id" uuid,
	"kind" "featured_kind" DEFAULT 'homepage' NOT NULL,
	"tag" text,
	"title" text NOT NULL,
	"meta" text,
	"body" text,
	"cover_url" text,
	"emoji" text,
	"link_url" text,
	"variant" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_published" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "featured_items" ADD CONSTRAINT "featured_items_radio_id_radios_id_fk" FOREIGN KEY ("radio_id") REFERENCES "public"."radios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "featured_items_radio_kind_idx" ON "featured_items" USING btree ("radio_id","kind","sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "featured_items_radio_idx" ON "featured_items" USING btree ("radio_id");--> statement-breakpoint
ALTER TABLE "featured_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "featured_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "featured_items";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "featured_items"
  USING (
    coalesce(current_setting('app.radio_id', true), '') = ''
    OR radio_id::text = current_setting('app.radio_id', true)
  )
  WITH CHECK (
    coalesce(current_setting('app.radio_id', true), '') = ''
    OR radio_id::text = current_setting('app.radio_id', true)
  );
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'enondes_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "featured_items" TO enondes_app';
  END IF;
END $$;
