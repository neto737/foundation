import type { Sql } from "postgres";
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
  expires_at: Date;
  accepted_at: Date | null;
}

export function createPostgresTenantRepository<TRole extends string>(
  database: Sql,
): TenantRepository<TRole> & {
  listMemberships(userId: string): Promise<Membership<TRole>[]>;
} {
  return {
    async findMembership(userId, tenantId) {
      const rows = await database<
        MembershipRow[]
      >`SELECT id, tenant_id, user_id, role FROM tenant_memberships WHERE user_id = ${userId} AND tenant_id = ${tenantId}`;
      return rows[0] ? mapMembership<TRole>(rows[0]) : null;
    },
    async listMemberships(userId) {
      const rows = await database<
        MembershipRow[]
      >`SELECT id, tenant_id, user_id, role FROM tenant_memberships WHERE user_id = ${userId} ORDER BY created_at`;
      return rows.map(mapMembership<TRole>);
    },
  };
}

export function createPostgresTenantSessionStore(
  database: Sql,
): TenantSessionStore {
  return {
    async setActiveTenant(sessionId, tenantId) {
      await database`INSERT INTO tenant_sessions (session_id, active_tenant_id, updated_at) VALUES (${sessionId}, ${tenantId}, NOW()) ON CONFLICT (session_id) DO UPDATE SET active_tenant_id = excluded.active_tenant_id, updated_at = excluded.updated_at`;
    },
  };
}

export function createPostgresInvitationRepository<TRole extends string>(
  database: Sql,
): InvitationRepository<TRole> {
  return {
    async create(invitation) {
      const expiresAt = invitation.expiresAt.toISOString();
      await database`INSERT INTO tenant_invitations (id, tenant_id, email, role, token_hash, expires_at, accepted_at, created_at) VALUES (${invitation.id}, ${invitation.tenantId}, ${invitation.email}, ${invitation.role}, ${invitation.tokenHash}, ${expiresAt}::timestamptz, NULL, NOW())`;
    },
    async consume(input) {
      return database.begin(async (transaction) => {
        const now = input.now.toISOString();
        const rows = await transaction<
          InvitationRow[]
        >`SELECT id, tenant_id, email, role, token_hash, expires_at, accepted_at FROM tenant_invitations WHERE email = ${input.email} AND token_hash = ${input.tokenHash} AND accepted_at IS NULL AND expires_at > ${now}::timestamptz FOR UPDATE`;
        const row = rows[0];
        if (!row) return null;
        await transaction`UPDATE tenant_invitations SET accepted_at = ${now}::timestamptz WHERE id = ${row.id}`;
        await transaction`INSERT INTO tenant_memberships (id, tenant_id, user_id, role, created_at) VALUES (${crypto.randomUUID()}, ${row.tenant_id}, ${input.userId}, ${row.role}, ${now}::timestamptz) ON CONFLICT (tenant_id, user_id) DO NOTHING`;
        return mapInvitation<TRole>({ ...row, accepted_at: input.now });
      });
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
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
  };
}
