import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const instant = (name: string) => timestamp(name, { withTimezone: true });

// Modelo público do Better Auth. IDs externos, tokens e valores não são UUIDs.
export const user = pgTable("user", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: instant("created_at").notNull().defaultNow(),
  updatedAt: instant("updated_at").notNull().defaultNow(),
});

export const session = pgTable(
  "session",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    expiresAt: instant("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: instant("created_at").notNull().defaultNow(),
    updatedAt: instant("updated_at").notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: instant("access_token_expires_at"),
    refreshTokenExpiresAt: instant("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: instant("created_at").notNull().defaultNow(),
    updatedAt: instant("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("account_provider_identity_unique").on(t.providerId, t.accountId),
    index("account_user_idx").on(t.userId),
  ],
);

export const verification = pgTable("verification", {
  id: uuid("id").defaultRandom().primaryKey(),
  identifier: text("identifier").notNull().unique(),
  value: text("value").notNull(),
  expiresAt: instant("expires_at").notNull(),
  createdAt: instant("created_at").defaultNow(),
  updatedAt: instant("updated_at").defaultNow(),
});

// Nomes físicos consumidos pelos adapters públicos do Foundation.
export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (t) => [check("tenant_name_nonempty", sql`length(trim(${t.name})) > 0`)],
);

export const tenantMemberships = pgTable(
  "tenant_memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("tenant_memberships_tenant_user_unique").on(t.tenantId, t.userId),
    index("tenant_memberships_user_idx").on(t.userId),
  ],
);

export const tenantSessions = pgTable("tenant_sessions", {
  sessionId: uuid("session_id")
    .primaryKey()
    .references(() => session.id, { onDelete: "cascade" }),
  activeTenantId: uuid("active_tenant_id").references(() => tenants.id, {
    onDelete: "set null",
  }),
  updatedAt: instant("updated_at").notNull().defaultNow(),
});

export const churches = pgTable(
  "churches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("churches_tenant_id_unique").on(t.tenantId, t.id),
    check("church_name_nonempty", sql`length(trim(${t.name})) > 0`),
  ],
);

// Recibo do primeiro onboarding, não limite de memberships ou plano comercial.
export const onboardingProvisions = pgTable(
  "onboarding_provisions",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => user.id),
    tenantId: uuid("tenant_id")
      .notNull()
      .unique()
      .references(() => tenants.id),
    churchId: uuid("church_id").notNull(),
    requestKey: text("request_key").notNull(),
    requestHash: text("request_hash").notNull(),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "onboarding_church_same_tenant",
      columns: [t.tenantId, t.churchId],
      foreignColumns: [churches.tenantId, churches.id],
    }),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actor: uuid("actor").notNull(),
    action: text("action").notNull(),
    target: uuid("target").notNull(),
    tenant: uuid("tenant")
      .notNull()
      .references(() => tenants.id),
    timestamp: instant("timestamp").notNull(),
    metadata: jsonb("metadata").notNull(),
    requestId: text("request_id"),
    result: text("result").notNull(),
  },
  (t) => [check("audit_metadata_minimal", sql`${t.metadata} = '{}'::jsonb`)],
);
