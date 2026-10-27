import type { FoundationSession } from "@t00ls-dev/auth";
import { asc, gt } from "drizzle-orm";
import type { Database } from "./auth.js";
import { withGlobalAdministrator } from "./admin-access.js";
import { tenants } from "./data/schema.js";
import { requireUuid } from "./contracts.js";

export function administrativeDirectory(input: {
  database: Database;
  identity: FoundationSession | null;
  adminEmail?: string | undefined;
  after?: string;
}) {
  return withGlobalAdministrator(
    { ...input, mutation: false, recent: false },
    async (tx) => {
      const after = input.after ? requireUuid(input.after).toLowerCase() : null;
      return tx
        .select({ id: tenants.id, name: tenants.name })
        .from(tenants)
        .where(after ? gt(tenants.id, after) : undefined)
        .orderBy(asc(tenants.id))
        .limit(100);
    },
  );
}
