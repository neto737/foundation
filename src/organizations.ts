import { createHash } from "node:crypto";
import { createAuditEvent } from "@t00ls-dev/audit";
import { createPostgresAuditStore } from "@t00ls-dev/audit/postgres";
import { createAccessControl } from "@t00ls-dev/access";
import {
  resolveTenantContext,
  switchTenant,
  TenantAccessDeniedError,
  TenantContextRequiredError,
} from "@t00ls-dev/tenant";
import {
  createPostgresTenantRepository,
  createPostgresTenantSessionStore,
} from "@t00ls-dev/tenant/postgres";
import type { FoundationSession } from "@t00ls-dev/auth";
import { and, eq, gt, inArray } from "drizzle-orm";
import type { Database } from "./auth.js";
import { hasPassword } from "./auth.js";
import { RequestError } from "./contracts.js";
import {
  churches,
  onboardingProvisions,
  tenantMemberships,
  tenants,
  tenantSessions,
  user,
  session,
} from "./data/schema.js";

const access = createAccessControl({ admin: ["churches:read"] as const });
function assertAdministrator(role: string): asserts role is "admin" {
  if (role !== "admin" || !access.can(role, "churches:read")) {
    throw new RequestError(
      403,
      "ACESSO_NEGADO",
      "O vínculo administrativo não permite esta operação.",
    );
  }
}

export async function organizationContext(
  database: Database,
  identity: FoundationSession,
) {
  const rows = await database.db
    .select()
    .from(tenantSessions)
    .where(eq(tenantSessions.sessionId, identity.session.id));
  try {
    const context = await resolveTenantContext({
      activeTenantId: rows[0]?.activeTenantId ?? null,
      userId: identity.user.id,
      repository: createPostgresTenantRepository<string>(database.client),
    });
    assertAdministrator(context.role);
    return context;
  } catch (error) {
    if (
      error instanceof TenantAccessDeniedError ||
      error instanceof TenantContextRequiredError
    ) {
      throw new RequestError(
        403,
        "CONTEXTO_NECESSARIO",
        "Selecione uma organização com vínculo administrativo atual.",
      );
    }
    throw error;
  }
}

export async function selectOrganization(
  database: Database,
  identity: FoundationSession,
  tenantId: string,
) {
  const repository = createPostgresTenantRepository<string>(database.client);
  const membership = await repository.findMembership(
    identity.user.id,
    tenantId,
  );
  if (!membership)
    throw new RequestError(
      403,
      "ACESSO_NEGADO",
      "Você não administra esta organização.",
    );
  assertAdministrator(membership.role);
  // A validação também ocorre no helper público antes de gravar a sessão.
  const context = await switchTenant({
    repository: {
      findMembership: async (userId, selectedTenantId) => {
        const current = await repository.findMembership(
          userId,
          selectedTenantId,
        );
        if (current) assertAdministrator(current.role);
        return current;
      },
    },
    sessionId: identity.session.id,
    sessions: createPostgresTenantSessionStore(database.client),
    tenantId,
    userId: identity.user.id,
  });
  return { organizationId: context.tenantId };
}

export async function listOrganizations(
  database: Database,
  identity: FoundationSession,
) {
  const memberships = await createPostgresTenantRepository<string>(
    database.client,
  ).listMemberships(identity.user.id);
  const ids = memberships
    .filter((membership) => membership.role === "admin")
    .map((membership) => membership.tenantId);
  if (!ids.length) return [];
  return database.db
    .select({ id: tenants.id, nome: tenants.name })
    .from(tenants)
    .where(inArray(tenants.id, ids))
    .orderBy(tenants.id);
}

export async function provisionOrganization(
  database: Database,
  identity: FoundationSession,
  input: {
    organizationName: string;
    churchName: string;
    requestKey: string;
  },
) {
  const hash = createHash("sha256")
    .update(JSON.stringify([input.organizationName, input.churchName]))
    .digest("hex");
  return database.db.transaction(async (tx) => {
    // Serializa somente o primeiro onboarding desta conta, entre conexões reais.
    // Não limita memberships, igrejas ou futuros fluxos de criação de organização.
    const locked = await tx
      .select({ verified: user.emailVerified })
      .from(user)
      .where(eq(user.id, identity.user.id))
      .for("update");
    if (!locked[0]?.verified || !(await hasPassword(tx, identity.user.id))) {
      throw new RequestError(
        403,
        "CONTA_NAO_PRONTA",
        "Conclua a verificação e a definição de senha.",
      );
    }
    // Após aguardar o lock, uma sessão revogada não pode provisionar.
    // A autenticação do cookie continua exclusivamente no Foundation.
    const currentSession = await tx
      .select({ id: session.id })
      .from(session)
      .where(
        and(
          eq(session.id, identity.session.id),
          eq(session.userId, identity.user.id),
          gt(session.expiresAt, new Date()),
        ),
      )
      .for("share");
    if (!currentSession.length)
      throw new RequestError(
        401,
        "SESSAO_NECESSARIA",
        "Entre na sua conta para continuar.",
      );
    const receipts = await tx
      .select()
      .from(onboardingProvisions)
      .where(eq(onboardingProvisions.userId, identity.user.id));
    const previous = receipts[0];
    if (previous) {
      if (
        previous.requestKey !== input.requestKey ||
        previous.requestHash !== hash
      ) {
        throw new RequestError(
          409,
          "ONBOARDING_JA_PROVISIONADO",
          "Este onboarding já foi provisionado. Selecione a organização existente.",
        );
      }
      // Replay nunca recria vínculo revogado nem permite role desconhecida.
      await selectOrganization(database, identity, previous.tenantId);
      return { organizationId: previous.tenantId, churchId: previous.churchId };
    }
    const [organization] = await tx
      .insert(tenants)
      .values({ name: input.organizationName })
      .returning({ id: tenants.id });
    if (!organization) throw new Error("Provisionamento não confirmado.");
    const [church] = await tx
      .insert(churches)
      .values({ tenantId: organization.id, name: input.churchName })
      .returning({ id: churches.id });
    if (!church) throw new Error("Provisionamento não confirmado.");
    await tx.insert(tenantMemberships).values({
      tenantId: organization.id,
      userId: identity.user.id,
      role: "admin",
    });
    await createPostgresTenantSessionStore(database.client).setActiveTenant(
      identity.session.id,
      organization.id,
    );
    await createPostgresAuditStore(database.client).append(
      createAuditEvent({
        actor: identity.user.id,
        action: "organization.provisioned",
        target: organization.id,
        tenant: organization.id,
        timestamp: new Date(),
        metadata: {},
        requestId: null,
        result: "success",
      }),
    );
    await tx.insert(onboardingProvisions).values({
      userId: identity.user.id,
      tenantId: organization.id,
      churchId: church.id,
      requestKey: input.requestKey,
      requestHash: hash,
    });
    return { organizationId: organization.id, churchId: church.id };
  });
}

export async function listChurches(
  database: Database,
  identity: FoundationSession,
) {
  const context = await organizationContext(database, identity);
  return database.db
    .select({ id: churches.id, nome: churches.name })
    .from(churches)
    .where(eq(churches.tenantId, context.tenantId))
    .orderBy(churches.id);
}

export async function findChurch(
  database: Database,
  identity: FoundationSession,
  id: string,
) {
  const context = await organizationContext(database, identity);
  const rows = await database.db
    .select({ id: churches.id, nome: churches.name })
    .from(churches)
    .where(and(eq(churches.tenantId, context.tenantId), eq(churches.id, id)));
  if (!rows[0])
    throw new RequestError(404, "NAO_ENCONTRADO", "Igreja não encontrada.");
  return rows[0];
}
