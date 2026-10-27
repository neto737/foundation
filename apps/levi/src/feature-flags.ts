import type { FoundationSession } from "@t00ls-dev/auth";
import { asc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "./auth.js";
import { withGlobalAdministrator } from "./admin-access.js";
import { appendAdministrativeAudit } from "./admin-audit.js";
import { RequestError, requireUuid } from "./contracts.js";
import {
  featureFlags,
  featureFlagOrganizations,
  tenants,
} from "./data/schema.js";
import {
  knownFeature,
  invalidAdministrativeInput,
  readExpectedVersion,
  readFeaturePolicy,
} from "./feature-contracts.js";

type AdministratorInput = {
  database: Database;
  identity: FoundationSession | null;
  adminEmail?: string | undefined;
};

export async function listFeatureFlags(input: AdministratorInput) {
  return withGlobalAdministrator(
    { ...input, mutation: false, recent: false },
    async (tx) => {
      const flags = await tx
        .select()
        .from(featureFlags)
        .orderBy(asc(featureFlags.key))
        .for("share");
      const organizations = await tx.select().from(featureFlagOrganizations);
      return flags.map((flag) => ({
        ...flag,
        organizationIds: organizations
          .filter((row) => row.featureFlagId === flag.id)
          .map((row) => row.organizationId)
          .sort(),
      }));
    },
  );
}

export async function updateFeatureFlag(
  input: AdministratorInput & {
    key: string;
    policy: unknown;
    expectedVersion: number;
    operationId: string;
  },
) {
  return withGlobalAdministrator(
    { ...input, mutation: true, recent: false },
    async (tx, actor) => {
      if (!knownFeature(input.key)) invalidAdministrativeInput();
      const key = input.key;
      const policy = readFeaturePolicy(input.policy);
      const expectedVersion = readExpectedVersion(input.expectedVersion);
      const operationId = requireUuid(input.operationId).toLowerCase();
      const [previous] = await tx
        .select()
        .from(featureFlags)
        .where(eq(featureFlags.key, key))
        .for("update");
      if ((previous?.version ?? 0) !== expectedVersion)
        throw new RequestError(
          409,
          "VERSAO_DIVERGENTE",
          "A funcionalidade foi alterada. Consulte o estado atual.",
        );
      const selected: string[] =
        policy.kind === "selected" ? policy.organizationIds : [];
      if (selected.length) {
        const found = await tx
          .select({ id: tenants.id })
          .from(tenants)
          .where(inArray(tenants.id, selected));
        if (found.length !== selected.length) invalidAdministrativeInput();
      }
      const oldIds = previous
        ? (
            await tx
              .select({ id: featureFlagOrganizations.organizationId })
              .from(featureFlagOrganizations)
              .where(eq(featureFlagOrganizations.featureFlagId, previous.id))
          )
            .map((row) => row.id)
            .sort()
        : [];
      if (
        previous?.policy === policy.kind &&
        JSON.stringify(oldIds) === JSON.stringify(selected)
      )
        return { ...previous, organizationIds: oldIds };
      const values = {
        policy: policy.kind,
        version: expectedVersion + 1,
        updatedAt: new Date(),
        updatedBy: actor,
      };
      const [changed] = previous
        ? await tx
            .update(featureFlags)
            .set(values)
            .where(eq(featureFlags.id, previous.id))
            .returning()
        : await tx
            .insert(featureFlags)
            .values({ key, ...values })
            .returning();
      if (!changed) throw new Error("Política não confirmada.");
      await tx
        .delete(featureFlagOrganizations)
        .where(eq(featureFlagOrganizations.featureFlagId, changed.id));
      if (selected.length)
        await tx.insert(featureFlagOrganizations).values(
          selected.map((organizationId) => ({
            featureFlagId: changed.id,
            organizationId,
          })),
        );
      await appendAdministrativeAudit(tx, {
        actor,
        target: changed.id,
        operationId,
        tenant: null,
        action: `feature_flag.${policy.kind}`,
      });
      for (const id of oldIds.filter((id) => !selected.includes(id)))
        await appendAdministrativeAudit(tx, {
          actor,
          target: changed.id,
          operationId,
          tenant: id,
          action: "feature_flag.organization_removed",
        });
      for (const id of selected.filter((id) => !oldIds.includes(id)))
        await appendAdministrativeAudit(tx, {
          actor,
          target: changed.id,
          operationId,
          tenant: id,
          action: "feature_flag.organization_added",
        });
      return { ...changed, organizationIds: selected };
    },
  );
}

/** Somente disponibilidade. O chamador ainda deve validar sessão, membership e recurso do tenant. */
export async function featureAvailable(input: {
  database: Database;
  key: string;
  organizationId: string;
}): Promise<boolean> {
  if (!knownFeature(input.key)) return false;
  const organizationId = requireUuid(input.organizationId).toLowerCase();
  // Um único snapshot: política e seleção nunca vêm de versões diferentes.
  const [row] = await input.database.db
    .select({
      policy: featureFlags.policy,
      selected: sql<boolean>`EXISTS (
    SELECT 1 FROM feature_flag_organizations
    WHERE feature_flag_id = ${featureFlags.id} AND organization_id = ${organizationId}::uuid
  )`,
    })
    .from(featureFlags)
    .innerJoin(tenants, eq(tenants.id, organizationId))
    .where(eq(featureFlags.key, input.key));
  if (!row) return false;
  switch (row.policy) {
    case "all":
      return true;
    case "selected":
      return row.selected;
    case "disabled":
      return false;
    default: {
      const exhaustive: never = row.policy;
      throw new Error(`Política persistida inválida: ${typeof exhaustive}.`);
    }
  }
}
