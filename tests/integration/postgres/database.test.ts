import { createPostgresDatabase } from "@t00ls-dev/db/postgres";
import {
  createPostgresInvitationRepository,
  createPostgresTenantRepository,
  createPostgresTenantSessionStore,
} from "@t00ls-dev/tenant/postgres";
import {
  acceptInvitation,
  createInvitation,
  resolveTenantContext,
  TenantAccessDeniedError,
} from "@t00ls-dev/tenant";
import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("PostgreSQL adapter", () => {
  let container: StartedTestContainer | undefined;

  beforeAll(async () => {
    container = await new GenericContainer("postgres:17-alpine")
      .withEnvironment({
        POSTGRES_DB: "foundation",
        POSTGRES_PASSWORD: "foundation",
        POSTGRES_USER: "foundation",
      })
      .withExposedPorts(5432)
      .withWaitStrategy(
        Wait.forLogMessage("database system is ready to accept connections", 2),
      )
      .start();
  }, 60_000);
  afterAll(async () => container?.stop(), 60_000);

  it("connects and executes SQL through the supported adapter", async () => {
    if (!container) throw new Error("PostgreSQL container was not started");
    const port = container.getMappedPort(5432);
    const { client } = createPostgresDatabase(
      `postgres://foundation:foundation@${container.getHost()}:${port}/foundation`,
    );
    const rows = await client<{ value: number }[]>`SELECT 1 AS value`;
    expect(rows[0]?.value).toBe(1);
    await client.end();
  });

  it("persists tenant context, switching and invitations", async () => {
    if (!container) throw new Error("PostgreSQL container was not started");
    const port = container.getMappedPort(5432);
    const { client } = createPostgresDatabase(
      `postgres://foundation:foundation@${container.getHost()}:${port}/foundation`,
    );
    await client.unsafe(POSTGRES_SCHEMA);
    await client`INSERT INTO tenants (id, name, created_at) VALUES ('tenant-a', 'A', NOW()), ('tenant-b', 'B', NOW())`;
    await client`INSERT INTO tenant_memberships (id, tenant_id, user_id, role, created_at) VALUES ('m1', 'tenant-a', 'user-1', 'owner', NOW()), ('m2', 'tenant-b', 'user-1', 'viewer', NOW())`;

    const tenants = createPostgresTenantRepository<"owner" | "viewer">(client);
    expect(await tenants.listMemberships("user-1")).toHaveLength(2);
    await expect(
      resolveTenantContext({
        activeTenantId: "tenant-a",
        repository: tenants,
        userId: "user-2",
      }),
    ).rejects.toBeInstanceOf(TenantAccessDeniedError);

    const sessions = createPostgresTenantSessionStore(client);
    await sessions.setActiveTenant("session-pg", "tenant-b");
    const active = await client<
      { active_tenant_id: string }[]
    >`SELECT active_tenant_id FROM tenant_sessions WHERE session_id = 'session-pg'`;
    expect(active[0]?.active_tenant_id).toBe("tenant-b");

    const invitations = createPostgresInvitationRepository<"member">(client);
    const audit = { record: () => Promise.resolve() };
    const { token } = await createInvitation({
      actorId: "user-1",
      audit,
      email: "new@example.com",
      expiresAt: new Date(Date.now() + 60_000),
      id: "invite-pg",
      repository: invitations,
      role: "member",
      tenantId: "tenant-a",
    });
    await acceptInvitation({
      audit,
      email: "new@example.com",
      repository: invitations,
      token,
      userId: "user-new",
    });
    const members = await client<
      { total: number }[]
    >`SELECT COUNT(*)::int AS total FROM tenant_memberships WHERE tenant_id = 'tenant-a' AND user_id = 'user-new'`;
    expect(members[0]?.total).toBe(1);
    await client.end();
  });
});

const POSTGRES_SCHEMA = `
CREATE TABLE tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL);
CREATE TABLE tenant_memberships (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), user_id TEXT NOT NULL, role TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL);
CREATE UNIQUE INDEX tenant_memberships_tenant_user_unique ON tenant_memberships(tenant_id, user_id);
CREATE TABLE tenant_invitations (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), email TEXT NOT NULL, role TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at TIMESTAMPTZ NOT NULL, accepted_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL);
CREATE TABLE tenant_sessions (session_id TEXT PRIMARY KEY, active_tenant_id TEXT REFERENCES tenants(id), updated_at TIMESTAMPTZ NOT NULL);
`;
