CREATE TABLE IF NOT EXISTS "analytics_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"ip" text,
	"ip_country" text,
	"user_agent" text,
	"device" text,
	"browser" text,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"active_sec" integer DEFAULT 0 NOT NULL,
	"listen_sec" integer DEFAULT 0 NOT NULL,
	"page_views" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "analytics_show_listen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"show_title" text NOT NULL,
	"client_id" text NOT NULL,
	"listen_sec" integer DEFAULT 0 NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "analytics_sessions_client_idx" ON "analytics_sessions" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_sessions_last_seen_idx" ON "analytics_sessions" USING btree ("last_seen");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "analytics_show_listen_pair_idx" ON "analytics_show_listen" USING btree ("show_title","client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_show_listen_show_idx" ON "analytics_show_listen" USING btree ("show_title");