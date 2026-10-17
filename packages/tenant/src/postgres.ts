import type { Client } from "pg";
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
  database: Pick<Client, "query">,
): TenantRepository<TRole> & {
  listMemberships(userId: string): Promise<Membership<TRole>[]>;
} {
  return {
    async findMembership(userId, tenantId) {
      const { rows } = await database.query<MembershipRow>(
        "SELECT id, tenant_id, user_id, role FROM tenant_memberships WHERE user_id = $1 AND tenant_id = $2",
        [userId, tenantId],
      );
      return rows[0] ? mapMembership<TRole>(rows[0]) : null;
    },
    async listMemberships(userId) {
      const { rows } = await database.query<MembershipRow>(
        "SELECT id, tenant_id, user_id, role FROM tenant_memberships WHERE user_id = $1 ORDER BY created_at",
        [userId],
      );
      return rows.map(mapMembership<TRole>);
    },
  };
}

export function createPostgresTenantSessionStore(
  database: Pick<Client, "query">,
): TenantSessionStore {
  return {
    async setActiveTenant(sessionId, tenantId) {
      await database.query(
        "INSERT INTO tenant_sessions (session_id, active_tenant_id, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (session_id) DO UPDATE SET active_tenant_id = excluded.active_tenant_id, updated_at = excluded.updated_at",
        [sessionId, tenantId],
      );
    },
  };
}

export function createPostgresInvitationRepository<TRole extends string>(
  database: Pick<Client, "query">,
): InvitationRepository<TRole> {
  return {
    async create(invitation) {
      const expiresAt = invitation.expiresAt.toISOString();
      await database.query(
        "INSERT INTO tenant_invitations (id, tenant_id, email, role, token_hash, expires_at, accepted_at, created_at) VALUES ($1, $2, $3, $4, $5, $6::timestamptz, NULL, NOW())",
        [
          invitation.id,
          invitation.tenantId,
          invitation.email,
          invitation.role,
          invitation.tokenHash,
          expiresAt,
        ],
      );
    },
    async consume(input) {
      // UPDATE locks the matching row and rechecks its predicate after waiting.
      // One statement is atomic standalone and never commits an outer transaction.
      const { rows } = await database.query<InvitationRow>(
        `WITH consumed AS (
          UPDATE tenant_invitations SET accepted_at = $3::timestamptz
          WHERE email = $1 AND token_hash = $2 AND accepted_at IS NULL AND expires_at > $3::timestamptz
          RETURNING id, tenant_id, email, role, token_hash, expires_at, accepted_at
        ), membership AS (
          INSERT INTO tenant_memberships (id, tenant_id, user_id, role, created_at)
          SELECT $4, tenant_id, $5, role, $3::timestamptz FROM consumed
          ON CONFLICT (tenant_id, user_id) DO NOTHING
        ) SELECT * FROM consumed`,
        [
          input.email,
          input.tokenHash,
          input.now.toISOString(),
          crypto.randomUUID(),
          input.userId,
        ],
      );
      return rows[0] ? mapInvitation<TRole>(rows[0]) : null;
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
