import nodeProcess from "node:process";
import { createPostgresDatabase } from "@t00ls-dev/db/postgres";
import { getPostgresMigrationStatus } from "@t00ls-dev/db/postgres-migrations";
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
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const process = nodeProcess as NodeJS.Process;
const integrationRoot = fileURLToPath(new URL("..", import.meta.url));
const migrationsFolder = fileURLToPath(
  new URL("./migrations", import.meta.url),
);

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

  it("reports, applies, and seeds app-owned Drizzle migrations", async () => {
    if (!container) throw new Error("PostgreSQL container was not started");
    const port = container.getMappedPort(5432);
    const databaseUrl = `postgres://foundation:foundation@${container.getHost()}:${port}/foundation`;
    const { client } = createPostgresDatabase(databaseUrl);

    await expect(
      getPostgresMigrationStatus(client, migrationsFolder),
    ).resolves.toEqual({ applied: [], pending: ["0000_tenancy"] });

    await execFileAsync("pnpm", ["db:migrate"], {
      cwd: integrationRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });

    await expect(
      getPostgresMigrationStatus(client, migrationsFolder),
    ).resolves.toEqual({ applied: ["0000_tenancy"], pending: [] });
    await execFileAsync("pnpm", ["db:status"], {
      cwd: integrationRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    const beforeSeed = await client<
      { total: number }[]
    >`SELECT COUNT(*)::int AS total FROM tenants`;
    expect(beforeSeed[0]?.total).toBe(0);

    await execFileAsync("pnpm", ["db:seed"], {
      cwd: integrationRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    const afterSeed = await client<
      { total: number }[]
    >`SELECT COUNT(*)::int AS total FROM tenants WHERE id = 'example-tenant'`;
    expect(afterSeed[0]?.total).toBe(1);
    await client.end();
  });

  it("persists tenant context, switching and invitations", async () => {
    if (!container) throw new Error("PostgreSQL container was not started");
    const port = container.getMappedPort(5432);
    const admin = createPostgresDatabase(
      `postgres://foundation:foundation@${container.getHost()}:${port}/foundation`,
    ).client;
    await admin.unsafe("CREATE DATABASE foundation_tenant");
    await admin.end();
    const { client, db } = createPostgresDatabase(
      `postgres://foundation:foundation@${container.getHost()}:${port}/foundation_tenant`,
    );
    await migrate(db, { migrationsFolder });
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
