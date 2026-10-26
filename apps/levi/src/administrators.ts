import type { FoundationSession } from "@t00ls-dev/auth";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import type { Database } from "./auth.js";
import { lockReadyUser, withGlobalAdministrator } from "./admin-access.js";
import { appendAdministrativeAudit } from "./admin-audit.js";
import { RequestError, requireUuid } from "./contracts.js";
import { globalAdministrators, user } from "./data/schema.js";
import {
  invalidAdministrativeInput,
  readExpectedVersion,
} from "./feature-contracts.js";

type AdministratorInput = {
  database: Database;
  identity: FoundationSession | null;
};

export async function listGlobalAdministrators(
  input: AdministratorInput & { afterUserId?: string; limit?: number },
) {
  return withGlobalAdministrator(
    { ...input, mutation: false, recent: false },
    async (tx) => {
      const limit = input.limit ?? 50;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
        invalidAdministrativeInput();
      const after = input.afterUserId
        ? requireUuid(input.afterUserId).toLowerCase()
        : null;
      return tx
        .select()
        .from(globalAdministrators)
        .where(after ? gt(globalAdministrators.userId, after) : undefined)
        .orderBy(asc(globalAdministrators.userId))
        .limit(limit);
    },
  );
}

export async function changeGlobalAdministrator(
  input: AdministratorInput & {
    userId: string;
    enabled: boolean;
    expectedVersion: number;
    operationId: string;
  },
) {
  return withGlobalAdministrator(
    { ...input, mutation: true, recent: true },
    async (tx, actor) => {
      const userId = requireUuid(input.userId).toLowerCase();
      const operationId = requireUuid(input.operationId).toLowerCase();
      const expectedVersion = readExpectedVersion(input.expectedVersion);
      if (typeof input.enabled !== "boolean") invalidAdministrativeInput();
      const [previous] = await tx
        .select()
        .from(globalAdministrators)
        .where(eq(globalAdministrators.userId, userId));
      if ((previous?.version ?? 0) !== expectedVersion)
        throw new RequestError(
          409,
          "VERSAO_DIVERGENTE",
          "A concessão foi alterada. Consulte o estado atual.",
        );
      if (input.enabled) await lockReadyUser(tx, userId);
      else {
        const [remaining] = await tx
          .select({ userId: globalAdministrators.userId })
          .from(globalAdministrators)
          .innerJoin(user, eq(user.id, globalAdministrators.userId))
          .where(
            and(
              isNull(globalAdministrators.revokedAt),
              sql`${globalAdministrators.userId} <> ${userId}`,
              eq(user.emailVerified, true),
              sql`EXISTS (
            SELECT 1 FROM account WHERE account.user_id = ${user.id}
            AND account.provider_id = 'credential' AND account.account_id = ${user.id}::text
            AND account.password IS NOT NULL AND account.password <> ''
          )`,
            ),
          )
          .limit(1);
        if (!remaining)
          throw new RequestError(
            409,
            "ULTIMO_ADMINISTRADOR",
            "Mantenha pelo menos um administrador elegível.",
          );
        if (userId === actor)
          throw new RequestError(
            409,
            "AUTORREVOGACAO_NEGADA",
            "Outro administrador deve revogar esta concessão.",
          );
      }
      if (
        (!previous && !input.enabled) ||
        (previous && (previous.revokedAt === null) === input.enabled)
      )
        return previous ?? null;
      const values = input.enabled
        ? {
            grantedAt: new Date(),
            grantedBy: actor,
            revokedAt: null,
            version: expectedVersion + 1,
          }
        : { revokedAt: new Date(), version: expectedVersion + 1 };
      const [changed] = previous
        ? await tx
            .update(globalAdministrators)
            .set(values)
            .where(eq(globalAdministrators.userId, userId))
            .returning()
        : await tx
            .insert(globalAdministrators)
            .values({ userId, ...values })
            .returning();
      if (!changed) throw new Error("Concessão não confirmada.");
      await appendAdministrativeAudit(tx, {
        actor,
        target: userId,
        operationId,
        tenant: null,
        action: input.enabled ? "admin.granted" : "admin.revoked",
      });
      return changed;
    },
  );
}
