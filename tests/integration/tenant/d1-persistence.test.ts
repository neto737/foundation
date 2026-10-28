import {
  createD1InvitationRepository,
  createD1TenantRepository,
  createD1TenantSessionStore,
} from "@t00ls-dev/tenant/d1";
import {
  acceptInvitation,
  createInvitation,
  resolveTenantContext,
  TenantAccessDeniedError,
} from "@t00ls-dev/tenant";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("D1 tenant persistence", () => {
  let miniflare: Miniflare;
  let database: D1Database;

  beforeAll(async () => {
    miniflare = new Miniflare(
      convertV4MiniflareOptions({
        d1Databases: ["DB"],
        modules: true,
        script: "export default { fetch() { return new Response('ok') } }",
      }),
    );
    database = await miniflare.getD1Database("DB");
    await database.exec(D1_SCHEMA);
    await database.batch([
      database
        .prepare("INSERT INTO tenants VALUES (?, ?, ?)")
        .bind("tenant-a", "A", Date.now()),
      database
        .prepare("INSERT INTO tenants VALUES (?, ?, ?)")
        .bind("tenant-b", "B", Date.now()),
      database
        .prepare("INSERT INTO tenant_memberships VALUES (?, ?, ?, ?, ?)")
        .bind("m1", "tenant-a", "user-1", "owner", Date.now()),
      database
        .prepare("INSERT INTO tenant_memberships VALUES (?, ?, ?, ?, ?)")
        .bind("m2", "tenant-b", "user-1", "viewer", Date.now()),
    ]);
  });
  afterAll(async () => miniflare.dispose());

  it("resolves memberships and refuses a tenant without membership", async () => {
    const repository = createD1TenantRepository<"owner" | "viewer">(database);
    expect(await repository.listMemberships("user-1")).toHaveLength(2);
    await expect(
      resolveTenantContext({
        activeTenantId: "tenant-b",
        repository,
        userId: "user-2",
      }),
    ).rejects.toBeInstanceOf(TenantAccessDeniedError);
  });

  it("persists active tenant only through the validated switching contract", async () => {
    const sessions = createD1TenantSessionStore(database);
    await sessions.setActiveTenant("session-1", "tenant-a");
    const row = await database
      .prepare(
        "SELECT active_tenant_id FROM tenant_sessions WHERE session_id = ?",
      )
      .bind("session-1")
      .first<{ active_tenant_id: string }>();
    expect(row?.active_tenant_id).toBe("tenant-a");
  });

  it("atomically consumes an invitation and creates one membership", async () => {
    const repository = createD1InvitationRepository<"member">(database);
    const audit = { record: () => Promise.resolve() };
    const { token } = await createInvitation({
      actorId: "user-1",
      audit,
      email: "new@example.com",
      expiresAt: new Date(Date.now() + 60_000),
      id: "invite-d1",
      repository,
      role: "member",
      tenantId: "tenant-a",
    });
    await acceptInvitation({
      audit,
      email: "new@example.com",
      repository,
      token,
      userId: "user-new",
    });
    await expect(
      acceptInvitation({
        audit,
        email: "new@example.com",
        repository,
        token,
        userId: "user-new",
      }),
    ).rejects.toThrow();
    const count = await database
      .prepare(
        "SELECT COUNT(*) AS total FROM tenant_memberships WHERE tenant_id = ? AND user_id = ?",
      )
      .bind("tenant-a", "user-new")
      .first<{ total: number }>();
    expect(count?.total).toBe(1);
  });
});

const D1_SCHEMA = `
CREATE TABLE tenants (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE tenant_memberships (id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL REFERENCES tenants(id), user_id TEXT NOT NULL, role TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE UNIQUE INDEX tenant_memberships_tenant_user_unique ON tenant_memberships(tenant_id, user_id);
CREATE TABLE tenant_invitations (id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL REFERENCES tenants(id), email TEXT NOT NULL, role TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, accepted_at INTEGER, created_at INTEGER NOT NULL);
CREATE TABLE tenant_sessions (session_id TEXT PRIMARY KEY NOT NULL, active_tenant_id TEXT REFERENCES tenants(id), updated_at INTEGER NOT NULL);
`;
