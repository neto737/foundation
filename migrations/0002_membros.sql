CREATE TABLE "member_creation_requests" (
	"tenant_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"request_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"member_id" uuid NOT NULL,
	CONSTRAINT "member_creation_requests_tenant_id_actor_id_request_key_pk" PRIMARY KEY("tenant_id","actor_id","request_key")
);
--> statement-breakpoint
CREATE TABLE "member_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"church_name" text NOT NULL,
	"initial_status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_history_initial_unique" UNIQUE("tenant_id","member_id"),
	CONSTRAINT "member_history_status_valid" CHECK ("member_history"."initial_status" IN ('Ativo', 'Inativo'))
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"church_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"birth_date" date,
	"phone" text,
	"email" text,
	"joined_on" date,
	"address" text,
	"baptism_date" date,
	"church_role" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "member_name_valid" CHECK (length(trim("members"."name")) BETWEEN 1 AND 160),
	CONSTRAINT "member_status_valid" CHECK ("members"."status" IN ('Ativo', 'Inativo'))
);
--> statement-breakpoint
ALTER TABLE "member_creation_requests" ADD CONSTRAINT "member_request_same_tenant" FOREIGN KEY ("tenant_id","member_id") REFERENCES "public"."members"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_history" ADD CONSTRAINT "member_history_same_tenant" FOREIGN KEY ("tenant_id","member_id") REFERENCES "public"."members"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "member_church_same_tenant" FOREIGN KEY ("tenant_id","church_id") REFERENCES "public"."churches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "members_tenant_order_idx" ON "members" USING btree ("tenant_id","name","id");--> statement-breakpoint
CREATE INDEX "members_tenant_church_idx" ON "members" USING btree ("tenant_id","church_id");