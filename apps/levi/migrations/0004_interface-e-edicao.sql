CREATE TABLE "member_profile_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"previous_profile" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_profile_history_version_unique" UNIQUE("tenant_id","member_id","version")
);
--> statement-breakpoint
ALTER TABLE "churches" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "churches" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "churches" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "member_profile_history" ADD CONSTRAINT "member_profile_history_same_tenant" FOREIGN KEY ("tenant_id","member_id") REFERENCES "public"."members"("tenant_id","id") ON DELETE cascade ON UPDATE no action;