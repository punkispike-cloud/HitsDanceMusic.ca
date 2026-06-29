CREATE TABLE IF NOT EXISTS "rate_buckets" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rate_buckets_expires_idx" ON "rate_buckets" USING btree ("expires_at");