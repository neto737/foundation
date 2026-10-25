CREATE TABLE "abuse_counters" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "abuse_counters_expiry_idx" ON "abuse_counters" USING btree ("expires_at");