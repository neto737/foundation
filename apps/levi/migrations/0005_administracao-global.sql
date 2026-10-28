CREATE TABLE "admin_bootstrap" (
	"id" integer PRIMARY KEY NOT NULL,
	"bootstrapped_user_id" uuid NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"operation_id" uuid NOT NULL,
	CONSTRAINT "admin_bootstrap_singleton" CHECK ("admin_bootstrap"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "feature_flag_organizations" (
	"feature_flag_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	CONSTRAINT "feature_flag_organizations_feature_flag_id_organization_id_pk" PRIMARY KEY("feature_flag_id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"policy" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	CONSTRAINT "feature_flags_key_unique" UNIQUE("key"),
	CONSTRAINT "feature_key_known" CHECK ("feature_flags"."key" IN ('members')),
	CONSTRAINT "feature_policy_known" CHECK ("feature_flags"."policy" IN ('all', 'selected', 'disabled')),
	CONSTRAINT "feature_version_positive" CHECK ("feature_flags"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "global_administrators" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by" uuid,
	"revoked_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "global_administrator_version_positive" CHECK ("global_administrators"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "audit_events" ALTER COLUMN "tenant" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "feature_flag_organizations" ADD CONSTRAINT "feature_flag_organizations_feature_flag_id_feature_flags_id_fk" FOREIGN KEY ("feature_flag_id") REFERENCES "public"."feature_flags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flag_organizations" ADD CONSTRAINT "feature_flag_organizations_organization_id_tenants_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_administrators" ADD CONSTRAINT "global_administrators_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_global_scope" CHECK (("audit_events"."tenant" IS NULL) = ("audit_events"."action" IN (
        'admin.bootstrapped', 'admin.granted', 'admin.revoked',
        'feature_flag.all', 'feature_flag.selected', 'feature_flag.disabled'
      )));