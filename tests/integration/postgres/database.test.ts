import nodeProcess from "node:process";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createPostgresDatabase } from "@t00ls-dev/db/postgres";
import { getPostgresMigrationStatus } from "@t00ls-dev/db/postgres-migrations";
import { createAuditEvent } from "@t00ls-dev/audit";
import { createPostgresAuditStore } from "@t00ls-dev/audit/postgres";
import { createFoundationAuth } from "@t00ls-dev/auth";
import {
  createPostgresInvitationRepository,
  createPostgresTenantRepository,
  createPostgresTenantSessionStore,
} from "@t00ls-dev/tenant/postgres";
import { tenants } from "@t00ls-dev/tenant/schema/postgres";
import {
  acceptInvitation,
  createInvitation,
  InvalidInvitationError,
  resolveTenantContext,
  TenantAccessDeniedError,
  type InvitationAudit,
} from "@t00ls-dev/tenant";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import type { Client } from "pg";
import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from "testcontainers";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { authSchema } from "./auth-schema.js";

const execFileAsync = promisify(execFile);
const integrationRoot = fileURLToPath(new URL("..", import.meta.url));
const migrationsFolder = fileURLToPath(
  new URL("./migrations", import.meta.url),
);
const noopAudit: InvitationAudit = { record: () => Promise.resolve() };

// Workers Types declares process as any. Validate this Node-only boundary.
function inheritedEnvironment(): Record<string, string> {
  const runtime: unknown = nodeProcess;
  if (
    typeof runtime !== "object" ||
    runtime === null ||
    !("env" in runtime) ||
    typeof runtime.env !== "object" ||
    runtime.env === null
  ) {
    throw new Error("Node environment is unavailable");
  }
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(runtime.env)) {
    if (typeof value === "string") environment[key] = value;
  }
  return environment;
}

function invitationAudit(client: Client, actor?: string): InvitationAudit {
  const store = createPostgresAuditStore(client);
  return {
    record: (event) =>
      store.append(
        createAuditEvent({
          actor: actor ?? event.actorId,
          action: event.action,
          target: event.targetId,
          tenant: event.tenantId,
          timestamp: new Date(),
          metadata: { source: "test" },
          requestId: null,
          result: "success",
        }),
      ),
  };
}

describe("PostgreSQL adapter", () => {
  let container: StartedTestContainer | undefined;
  const clients = new Set<Client>();

  function url(name = "foundation") {
    if (!container) throw new Error("PostgreSQL container was not started");
    return `postgres://foundation:foundation@${container.getHost()}:${container.getMappedPort(5432)}/${name}`;
  }
  async function database(name = "foundation") {
    const result = await createPostgresDatabase(url(name));
    clients.add(result.client);
    return result;
  }
  async function tenant(client: Client, id: string) {
    await client.query(
      "INSERT INTO tenants (id, name, created_at) VALUES ($1, $1, NOW())",
      [id],
    );
  }
  async function invitation(
    client: Client,
    id: string,
    tenantId: string,
    expiresAt = new Date(Date.now() + 60_000),
  ) {
    return createInvitation({
      actorId: "owner",
      audit: noopAudit,
      email: "new@example.com",
      expiresAt,
      id,
      repository: createPostgresInvitationRepository<"member">(client),
      role: "member",
      tenantId,
    });
  }

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
    const { client, db } = await database();
    await migrate(db, { migrationsFolder });
    await client.query(
      await readFile(
        new URL(
          "../../../packages/audit/migrations/postgres/0001_audit.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await client.query(
      await readFile(new URL("./auth-fixture.sql", import.meta.url), "utf8"),
    );
  }, 60_000);
  afterEach(async () => {
    await Promise.all([...clients].map((client) => client.end()));
    clients.clear();
  });
  afterAll(async () => {
    try {
      await Promise.all([...clients].map((client) => client.end()));
    } finally {
      await container?.stop();
    }
  }, 60_000);

  it("shares an explicitly connected client with Drizzle and round-trips data types", async () => {
    const { client, db } = await database();
    expect(db.$client).toBe(client);
    const value = "tenant'; DROP TABLE tenants; --";
    const createdAt = new Date("2026-10-17T12:30:45.123+03:00");
    await db.insert(tenants).values({ id: value, name: "Types", createdAt });
    expect(
      await db.select().from(tenants).where(eq(tenants.id, value)),
    ).toEqual([{ id: value, name: "Types", createdAt }]);
    const result = await client.query<{
      created_at: Date;
      big: string;
      metadata: unknown;
      nullable: null;
    }>(
      "SELECT created_at, 9007199254740993::bigint AS big, $2::jsonb AS metadata, NULL AS nullable FROM tenants WHERE id = $1",
      [value, JSON.stringify({ flags: [true, null], nested: { count: 2 } })],
    );
    expect(result.rows).toEqual([
      {
        created_at: createdAt,
        big: "9007199254740993",
        metadata: { flags: [true, null], nested: { count: 2 } },
        nullable: null,
      },
    ]);
  });

  it("closes connections and recovers from connection setup failures", async () => {
    await expect(
      createPostgresDatabase(url("missing_database")),
    ).rejects.toMatchObject({ code: "3D000" });
    const { client } = await database();
    const { rows } = await client.query<{ pid: number }>(
      "SELECT pg_backend_pid() AS pid",
    );
    const pid = rows[0]?.pid;
    expect(pid).toBeTypeOf("number");
    await client.end();
    clients.delete(client);
    const { client: observer } = await database();
    await expect
      .poll(
        async () =>
          (
            await observer.query(
              "SELECT 1 FROM pg_stat_activity WHERE pid = $1",
              [pid],
            )
          ).rowCount,
      )
      .toBe(0);
  });

  it("reports, applies twice, and seeds app-owned Drizzle migrations with pg", async () => {
    const { client: admin } = await database();
    await admin.query("CREATE DATABASE foundation_migrations");
    const { client } = await database("foundation_migrations");
    await expect(
      getPostgresMigrationStatus(client, migrationsFolder),
    ).resolves.toEqual({ applied: [], pending: ["0000_tenancy"] });
    for (let attempt = 0; attempt < 2; attempt++) {
      const migration = await execFileAsync("pnpm", ["db:migrate"], {
        cwd: integrationRoot,
        env: {
          ...inheritedEnvironment(),
          DATABASE_URL: url("foundation_migrations"),
        },
      });
      expect(migration.stdout).toContain("Using 'pg' driver");
    }
    await expect(
      getPostgresMigrationStatus(client, migrationsFolder),
    ).resolves.toEqual({ applied: ["0000_tenancy"], pending: [] });
    expect(
      (await client.query("SELECT * FROM drizzle.__drizzle_migrations"))
        .rowCount,
    ).toBe(1);
    await execFileAsync("pnpm", ["db:status"], {
      cwd: integrationRoot,
      env: {
        ...inheritedEnvironment(),
        DATABASE_URL: url("foundation_migrations"),
      },
    });
    expect((await client.query("SELECT * FROM tenants")).rowCount).toBe(0);
    for (let attempt = 0; attempt < 2; attempt++) {
      await execFileAsync("pnpm", ["db:seed"], {
        cwd: integrationRoot,
        env: {
          ...inheritedEnvironment(),
          DATABASE_URL: url("foundation_migrations"),
        },
      });
    }
    expect(
      (await client.query("SELECT * FROM tenants WHERE id = 'example-tenant'"))
        .rowCount,
    ).toBe(1);
  });

  it("preserves tenant isolation, switching, invitation validation and standalone acceptance", async () => {
    const { client } = await database();
    await tenant(client, "tenant-a");
    await tenant(client, "tenant-b");
    await client.query(
      "INSERT INTO tenant_memberships (id, tenant_id, user_id, role, created_at) VALUES ('m1', 'tenant-a', 'user-1', 'owner', NOW()), ('m2', 'tenant-b', 'user-2', 'viewer', NOW())",
    );
    const repository = createPostgresTenantRepository<"owner" | "viewer">(
      client,
    );
    expect(await repository.listMemberships("user-1")).toHaveLength(1);
    await expect(
      resolveTenantContext({
        activeTenantId: "tenant-a",
        repository,
        userId: "user-2",
      }),
    ).rejects.toBeInstanceOf(TenantAccessDeniedError);
    const sessions = createPostgresTenantSessionStore(client);
    await sessions.setActiveTenant("session-pg", "tenant-a");
    await sessions.setActiveTenant("session-pg", "tenant-b");
    expect(
      (
        await client.query(
          "SELECT active_tenant_id FROM tenant_sessions WHERE session_id = 'session-pg'",
        )
      ).rows,
    ).toEqual([{ active_tenant_id: "tenant-b" }]);
    const { token } = await invitation(client, "invite-standalone", "tenant-a");
    const invitations = createPostgresInvitationRepository<"member">(client);
    const input = {
      audit: noopAudit,
      repository: invitations,
      token,
      userId: "user-new",
      email: "new@example.com",
    };
    await expect(
      acceptInvitation({ ...input, email: "wrong@example.com" }),
    ).rejects.toBeInstanceOf(InvalidInvitationError);
    await expect(
      acceptInvitation({ ...input, token: "wrong" }),
    ).rejects.toBeInstanceOf(InvalidInvitationError);
    const accepted = await acceptInvitation(input);
    expect(accepted.expiresAt).toBeInstanceOf(Date);
    expect(accepted.acceptedAt).toBeInstanceOf(Date);
    await expect(acceptInvitation(input)).rejects.toBeInstanceOf(
      InvalidInvitationError,
    );
    expect(
      await repository.findMembership("user-new", "tenant-a"),
    ).toMatchObject({ role: "member" });
    expect(await repository.findMembership("user-new", "tenant-b")).toBeNull();
    const expired = await invitation(
      client,
      "invite-expired",
      "tenant-a",
      new Date(0),
    );
    await expect(
      acceptInvitation({ ...input, token: expired.token }),
    ).rejects.toBeInstanceOf(InvalidInvitationError);
    // A preexisting membership keeps its role and is not duplicated.
    const existing = await invitation(client, "invite-existing", "tenant-a");
    await acceptInvitation({
      ...input,
      token: existing.token,
      userId: "user-1",
    });
    expect(await repository.findMembership("user-1", "tenant-a")).toMatchObject(
      { role: "owner" },
    );
    expect(await repository.listMemberships("user-1")).toHaveLength(1);
  });

  it("consumes a standalone invitation only once across concurrent connections", async () => {
    const { client } = await database();
    const { client: second } = await database();
    await tenant(client, "tenant-race");
    const { token } = await invitation(client, "invite-race", "tenant-race");
    const results = await Promise.allSettled(
      [client, second].map((connection, index) =>
        acceptInvitation({
          audit: noopAudit,
          email: "new@example.com",
          repository: createPostgresInvitationRepository(connection),
          token,
          userId: `race-${index}`,
        }),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(InvalidInvitationError);
    expect(
      (
        await client.query(
          "SELECT * FROM tenant_memberships WHERE tenant_id = 'tenant-race'",
        )
      ).rowCount,
    ).toBe(1);
  });

  it("keeps a standalone invitation unconsumed if membership insertion fails", async () => {
    const { client } = await database();
    await tenant(client, "tenant-statement-failure");
    const { token } = await invitation(
      client,
      "invite-statement-failure",
      "tenant-statement-failure",
    );
    // A synthetic constraint only in this disposable database forces a failure
    // after the consuming UPDATE, without changing any versioned schema.
    await client.query(
      "ALTER TABLE tenant_memberships ADD CONSTRAINT test_reject_member CHECK (user_id <> 'reject-membership')",
    );
    try {
      await expect(
        acceptInvitation({
          audit: noopAudit,
          email: "new@example.com",
          repository: createPostgresInvitationRepository(client),
          token,
          userId: "reject-membership",
        }),
      ).rejects.toMatchObject({ code: "23514" });
      expect(
        (
          await client.query(
            "SELECT accepted_at FROM tenant_invitations WHERE id = 'invite-statement-failure'",
          )
        ).rows,
      ).toEqual([{ accepted_at: null }]);
      expect(
        (
          await client.query(
            "SELECT * FROM tenant_memberships WHERE tenant_id = 'tenant-statement-failure'",
          )
        ).rowCount,
      ).toBe(0);
    } finally {
      await client.query(
        "ALTER TABLE tenant_memberships DROP CONSTRAINT test_reject_member",
      );
    }
  });

  it("commits domain, invitation and audit on the same client and rejects audit mutations", async () => {
    const { client, db } = await database();
    await db.transaction(async (tx) => {
      await tx
        .insert(tenants)
        .values({ id: "tenant-atomic", name: "Atomic", createdAt: new Date() });
      const audit = invitationAudit(client);
      const repository = createPostgresInvitationRepository<"member">(client);
      const { token } = await createInvitation({
        actorId: "owner",
        audit,
        email: "new@example.com",
        expiresAt: new Date(Date.now() + 60_000),
        id: "invite-atomic",
        repository,
        role: "member",
        tenantId: "tenant-atomic",
      });
      await acceptInvitation({
        audit,
        email: "new@example.com",
        repository,
        token,
        userId: "atomic-user",
      });
    });
    const { client: observer } = await database();
    expect(
      (
        await observer.query(
          "SELECT * FROM tenant_memberships WHERE tenant_id = 'tenant-atomic'",
        )
      ).rowCount,
    ).toBe(1);
    const { rows } = await observer.query<{
      timestamp: Date;
      metadata: unknown;
      request_id: null;
    }>(
      "SELECT timestamp, metadata, request_id FROM audit_events WHERE target = 'invite-atomic'",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.timestamp).toBeInstanceOf(Date);
    expect(rows[0]?.metadata).toEqual({ source: "test" });
    expect(rows[0]?.request_id).toBeNull();
    await expect(
      observer.query(
        "UPDATE audit_events SET result = 'changed' WHERE target = 'invite-atomic'",
      ),
    ).rejects.toThrow("append-only");
    await expect(
      observer.query("DELETE FROM audit_events WHERE target = 'invite-atomic'"),
    ).rejects.toThrow("append-only");
  });

  it("rolls back domain and invitation consumption on a real audit insert failure", async () => {
    const { client, db } = await database();
    await tenant(client, "tenant-rollback");
    const { token } = await invitation(
      client,
      "invite-rollback",
      "tenant-rollback",
    );
    await expect(
      db.transaction(async (tx) => {
        await tx
          .update(tenants)
          .set({ name: "must roll back" })
          .where(eq(tenants.id, "tenant-rollback"));
        await acceptInvitation({
          // PostgreSQL text rejects a NUL byte: a database failure, not a mock.
          audit: invitationAudit(client, "invalid\0actor"),
          email: "new@example.com",
          repository: createPostgresInvitationRepository(client),
          token,
          userId: "rollback-user",
        });
      }),
    ).rejects.toMatchObject({ code: "22021" });
    const { client: observer } = await database();
    expect(
      (
        await observer.query(
          "SELECT name FROM tenants WHERE id = 'tenant-rollback'",
        )
      ).rows,
    ).toEqual([{ name: "tenant-rollback" }]);
    expect(
      (
        await observer.query(
          "SELECT accepted_at FROM tenant_invitations WHERE id = 'invite-rollback'",
        )
      ).rows,
    ).toEqual([{ accepted_at: null }]);
    expect(
      (
        await observer.query(
          "SELECT * FROM tenant_memberships WHERE tenant_id = 'tenant-rollback'",
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await observer.query(
          "SELECT * FROM audit_events WHERE target = 'invite-rollback'",
        )
      ).rowCount,
    ).toBe(0);
    // The connection remains usable after rollback and the invitation can be retried.
    await db.transaction(async () =>
      acceptInvitation({
        audit: invitationAudit(client),
        email: "new@example.com",
        repository: createPostgresInvitationRepository(client),
        token,
        userId: "rollback-user",
      }),
    );
  });

  it("rolls back invitation creation and audit when a subsequent domain write fails", async () => {
    const { client, db } = await database();
    await tenant(client, "tenant-late-failure");
    await expect(
      db.transaction(async (tx) => {
        await createInvitation({
          actorId: "owner",
          audit: invitationAudit(client),
          email: "new@example.com",
          expiresAt: new Date(Date.now() + 60_000),
          id: "invite-late-failure",
          repository: createPostgresInvitationRepository(client),
          role: "member",
          tenantId: "tenant-late-failure",
        });
        await tx.insert(tenants).values({
          id: "tenant-late-failure",
          name: "duplicate",
          createdAt: new Date(),
        });
      }),
    ).rejects.toThrow();
    const { client: observer } = await database();
    expect(
      (
        await observer.query(
          "SELECT * FROM tenant_invitations WHERE id = 'invite-late-failure'",
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await observer.query(
          "SELECT * FROM audit_events WHERE target = 'invite-late-failure'",
        )
      ).rowCount,
    ).toBe(0);
  });

  it("integrates Foundation Better Auth with PostgreSQL using its unchanged text ID defaults", async () => {
    const { client, db } = await database();
    const sent: string[] = [];
    const origin = "http://localhost:3000";
    const auth = createFoundationAuth({
      baseURL: origin,
      secret: "synthetic-test-secret-at-least-32-characters",
      database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
      email: {
        send: ({ text }) => {
          sent.push(text);
          return Promise.resolve();
        },
      },
    });
    function request(path: string, body?: object, cookie = "") {
      return auth.handler(
        new Request(`${origin}/api/auth${path}`, {
          method: body ? "POST" : "GET",
          headers: {
            "Content-Type": "application/json",
            "Origin": origin,
            "Cookie": cookie,
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
      );
    }
    function emailUrl() {
      const text = sent.at(-1);
      if (!text) throw new Error("Expected a captured email");
      return new URL(text);
    }
    const credentials = {
      email: "pg-auth@example.com",
      password: "correct-horse-battery-staple",
    };
    expect(
      (
        await request("/sign-up/email", {
          ...credentials,
          name: "PostgreSQL test",
        })
      ).status,
    ).toBe(200);
    expect((await request("/sign-in/email", credentials)).status).toBe(403);
    expect([200, 302]).toContain(
      (await auth.handler(new Request(emailUrl()))).status,
    );
    const login = await request("/sign-in/email", credentials);
    expect(login.status).toBe(200);
    const cookie = login.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    expect(cookie).toContain("session_token=");
    expect(login.headers.getSetCookie().join(";")).toContain("HttpOnly");
    const resolved = await auth.resolveSession(new Headers({ cookie }));
    expect(resolved.data?.user.email).toBe(credentials.email);
    expect(resolved.data?.session.expiresAt).toBeInstanceOf(Date);
    expect((await request("/sign-out", {}, cookie)).status).toBe(200);
    expect(
      (await auth.resolveSession(new Headers({ cookie }))).data,
    ).toBeNull();
    expect(
      (
        await request("/request-password-reset", {
          email: credentials.email,
          redirectTo: `${origin}/reset`,
        })
      ).status,
    ).toBe(200);
    const token = emailUrl().pathname.split("/").at(-1);
    expect(
      (
        await request("/reset-password", {
          token,
          newPassword: "replacement-password-for-test",
        })
      ).status,
    ).toBe(200);
    expect((await request("/sign-in/email", credentials)).status).toBe(401);
    expect(
      (
        await request("/sign-in/email", {
          ...credentials,
          password: "replacement-password-for-test",
        })
      ).status,
    ).toBe(200);
    expect(
      (await request("/sign-in/magic-link", { email: credentials.email }))
        .status,
    ).toBe(200);
    const magic = await auth.handler(new Request(emailUrl()));
    expect([200, 302]).toContain(magic.status);
    expect(magic.headers.getSetCookie().join(";")).toContain("session_token=");
    expect(
      (
        await client.query<{ created_at: Date }>(
          'SELECT created_at FROM "user" WHERE email = $1',
          [credentials.email],
        )
      ).rows[0]?.created_at,
    ).toBeInstanceOf(Date);
  });

  it("runs pg, Drizzle and audit in separate local workerd invocations", async () => {
    const bundle = await build({
      entryPoints: [fileURLToPath(new URL("./worker.ts", import.meta.url))],
      bundle: true,
      write: false,
      format: "esm",
      platform: "node",
      target: "es2022",
      conditions: ["workerd"],
      external: ["pg-native", "cloudflare:*"],
      banner: {
        js: 'import { createRequire } from "node:module"; const require = createRequire("/");',
      },
    });
    const script = bundle.outputFiles[0]?.text;
    if (!script) throw new Error("Worker bundle was not generated");
    const miniflare = new Miniflare({
      // Exercise the same compatibility date as Links, supported by installed workerd.
      modules: true,
      script,
      compatibilityDate: "2025-09-01",
      compatibilityFlags: ["nodejs_compat"],
      hyperdrives: { HYPERDRIVE: url() },
    });
    try {
      for (let invocation = 0; invocation < 2; invocation++) {
        const response = await miniflare.dispatchFetch(
          "http://localhost/probe",
        );
        expect(
          response.status,
          response.status === 200 ? "" : await response.text(),
        ).toBe(200);
        const body: unknown = await response.json();
        expect(body).toHaveProperty("id");
        expect(body).toHaveProperty("value", "worker'parameter");
        expect(body).toHaveProperty("pid");
      }
      const rollback = await miniflare.dispatchFetch(
        "http://localhost/rollback",
      );
      expect(rollback.status).toBe(200);
      expect(await rollback.json()).toEqual({ rolledBack: true });
      const { client } = await database();
      expect(
        (
          await client.query(
            "SELECT * FROM audit_events WHERE action = 'worker.probe'",
          )
        ).rowCount,
      ).toBe(2);
      expect(
        (
          await client.query(
            "SELECT * FROM tenants WHERE id = 'worker-rollback'",
          )
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await client.query(
            "SELECT * FROM audit_events WHERE target = 'worker-rollback'",
          )
        ).rowCount,
      ).toBe(0);
    } finally {
      await miniflare.dispose();
    }
  });
});
