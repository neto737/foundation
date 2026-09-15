export interface TenantContext<TRole extends string = string> {
  tenantId: string;
  userId: string;
  membershipId: string;
  role: TRole;
}

export interface Membership<TRole extends string = string> {
  id: string;
  tenantId: string;
  userId: string;
  role: TRole;
}

export interface TenantSessionStore {
  setActiveTenant(sessionId: string, tenantId: string): Promise<void>;
}

export interface TenantRepository<TRole extends string> {
  findMembership(
    userId: string,
    tenantId: string,
  ): Promise<Membership<TRole> | null>;
}

export async function resolveTenantContext<TRole extends string>(input: {
  activeTenantId: string | null;
  repository: TenantRepository<TRole>;
  userId: string;
}): Promise<TenantContext<TRole>> {
  if (!input.activeTenantId) throw new TenantContextRequiredError();
  const membership = await input.repository.findMembership(
    input.userId,
    input.activeTenantId,
  );
  if (!membership) throw new TenantAccessDeniedError(input.activeTenantId);
  return {
    membershipId: membership.id,
    role: membership.role,
    tenantId: membership.tenantId,
    userId: membership.userId,
  };
}

export async function switchTenant<TRole extends string>(input: {
  repository: TenantRepository<TRole>;
  sessionId: string;
  sessions: TenantSessionStore;
  tenantId: string;
  userId: string;
}): Promise<TenantContext<TRole>> {
  const context = await resolveTenantContext({
    activeTenantId: input.tenantId,
    repository: input.repository,
    userId: input.userId,
  });
  await input.sessions.setActiveTenant(input.sessionId, input.tenantId);
  return context;
}

export interface TenantOwnedRepository<TEntity> {
  findById(context: TenantContext, id: string): Promise<TEntity | null>;
}

export class TenantContextRequiredError extends Error {
  constructor() {
    super("A tenant context is required for tenant-owned data");
    this.name = "TenantContextRequiredError";
  }
}

export class TenantAccessDeniedError extends Error {
  constructor(tenantId: string) {
    super(`The user is not a member of tenant ${tenantId}`);
    this.name = "TenantAccessDeniedError";
  }
}

export * from "./invitation.js";
