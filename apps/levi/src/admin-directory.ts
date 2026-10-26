import type { FoundationSession } from "@t00ls-dev/auth";
import { asc, eq, gt, sql } from "drizzle-orm";
import type { Database } from "./auth.js";
import { withGlobalAdministrator } from "./admin-access.js";
import { globalAdministrators, tenants, user } from "./data/schema.js";
import { invalidAdministrativeInput } from "./feature-contracts.js";
import { requireUuid } from "./contracts.js";

type Input = { database: Database; identity: FoundationSession | null };

export function administrativeDirectory(
  input: Input & { kind: "administrators" | "organizations"; after?: string },
) {
  return withGlobalAdministrator(
    { ...input, mutation: false, recent: false },
    async (tx) => {
      const after = input.after ? requireUuid(input.after).toLowerCase() : null;
      if (input.kind === "organizations")
        return tx
          .select({ id: tenants.id, name: tenants.name })
          .from(tenants)
          .where(after ? gt(tenants.id, after) : undefined)
          .orderBy(asc(tenants.id))
          .limit(100);
      return tx
        .select({
          userId: globalAdministrators.userId,
          name: user.name,
          email: user.email,
          version: globalAdministrators.version,
          revokedAt: globalAdministrators.revokedAt,
        })
        .from(globalAdministrators)
        .innerJoin(user, eq(user.id, globalAdministrators.userId))
        .where(after ? gt(globalAdministrators.userId, after) : undefined)
        .orderBy(asc(globalAdministrators.userId))
        .limit(100);
    },
  );
}

export function findAdministrativeAccount(input: Input & { email: string }) {
  return withGlobalAdministrator(
    { ...input, mutation: false, recent: false },
    async (tx) => {
      const email = input.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
        invalidAdministrativeInput();
      const rows = await tx
        .select({
          userId: user.id,
          name: user.name,
          email: user.email,
          eligible: sql<boolean>`${user.emailVerified} AND EXISTS (
          SELECT 1 FROM account WHERE account.user_id = ${user.id}
          AND provider_id = 'credential' AND account_id = ${user.id}::text
          AND password IS NOT NULL AND password <> '')`,
          version: sql<number>`coalesce(${globalAdministrators.version}, 0)`,
          active: sql<boolean>`${globalAdministrators.userId} IS NOT NULL AND ${globalAdministrators.revokedAt} IS NULL`,
        })
        .from(user)
        .leftJoin(
          globalAdministrators,
          eq(user.id, globalAdministrators.userId),
        )
        .where(sql`lower(btrim(${user.email})) = ${email}`)
        .limit(2);
      // Identidade ambígua nunca vira alvo de concessão.
      return rows.length === 1 ? rows[0] : null;
    },
  );
}
