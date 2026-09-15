import type { InvitationRepository, TenantInvitation } from "./invitation.js";
import type {
  Membership,
  TenantRepository,
  TenantSessionStore,
} from "./index.js";

interface MembershipRow {
  id: string;
  tenant_id: string;
  user_id: string;
  role: string;
}
interface InvitationRow {
  id: string;
  tenant_id: string;
  email: string;
  role: string;
  token_hash: string;
  expires_at: number;
  accepted_at: number | null;
}

export function createD1TenantRepository<TRole extends string>(
  database: D1Database,
): TenantRepository<TRole> & {
  listMemberships(userId: string): Promise<Membership<TRole>[]>;
} {
  return {
    async findMembership(userId, tenantId) {
      const row = await database
        .prepare(
          "SELECT id, tenant_id, user_id, role FROM tenant_memberships WHERE user_id = ? AND tenant_id = ?",
        )
        .bind(userId, tenantId)
        .first<MembershipRow>();
      return row ? mapMembership<TRole>(row) : null;
    },
    async listMemberships(userId) {
      const result = await database
        .prepare(
          "SELECT id, tenant_id, user_id, role FROM tenant_memberships WHERE user_id = ? ORDER BY created_at",
        )
        .bind(userId)
        .all<MembershipRow>();
      return result.results.map(mapMembership<TRole>);
    },
  };
}

export function createD1TenantSessionStore(
  database: D1Database,
): TenantSessionStore {
  return {
    async setActiveTenant(sessionId, tenantId) {
      await database
        .prepare(
          "INSERT INTO tenant_sessions (session_id, active_tenant_id, updated_at) VALUES (?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET active_tenant_id = excluded.active_tenant_id, updated_at = excluded.updated_at",
        )
        .bind(sessionId, tenantId, Date.now())
        .run();
    },
  };
}

export function createD1InvitationRepository<TRole extends string>(
  database: D1Database,
): InvitationRepository<TRole> {
  return {
    async create(invitation) {
      await database
        .prepare(
          "INSERT INTO tenant_invitations (id, tenant_id, email, role, token_hash, expires_at, accepted_at, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)",
        )
        .bind(
          invitation.id,
          invitation.tenantId,
          invitation.email,
          invitation.role,
          invitation.tokenHash,
          invitation.expiresAt.getTime(),
          Date.now(),
        )
        .run();
    },
    async consume(input) {
      const row = await database
        .prepare(
          "SELECT id, tenant_id, email, role, token_hash, expires_at, accepted_at FROM tenant_invitations WHERE email = ? AND token_hash = ? AND accepted_at IS NULL AND expires_at > ?",
        )
        .bind(input.email, input.tokenHash, input.now.getTime())
        .first<InvitationRow>();
      if (!row) return null;
      const membershipId = crypto.randomUUID();
      const [accepted] = await database.batch([
        database
          .prepare(
            "UPDATE tenant_invitations SET accepted_at = ? WHERE id = ? AND accepted_at IS NULL",
          )
          .bind(input.now.getTime(), row.id),
        database
          .prepare(
            "INSERT INTO tenant_memberships (id, tenant_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(tenant_id, user_id) DO NOTHING",
          )
          .bind(
            membershipId,
            row.tenant_id,
            input.userId,
            row.role,
            input.now.getTime(),
          ),
      ]);
      if (!accepted || accepted.meta.changes !== 1) return null;
      return mapInvitation<TRole>({ ...row, accepted_at: input.now.getTime() });
    },
  };
}

function mapMembership<TRole extends string>(
  row: MembershipRow,
): Membership<TRole> {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    role: row.role as TRole,
  };
}

function mapInvitation<TRole extends string>(
  row: InvitationRow,
): TenantInvitation<TRole> {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    email: row.email,
    role: row.role as TRole,
    tokenHash: row.token_hash,
    expiresAt: new Date(row.expires_at),
    acceptedAt: row.accepted_at === null ? null : new Date(row.accepted_at),
  };
}
