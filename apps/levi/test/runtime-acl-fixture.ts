import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { createPostgresDatabase } from "@t00ls-dev/db/postgres";

// Exclusivo do container recém-criado por tools/test-integration.ts.
export function localTestDatabaseUrl(input: string, role: string) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("URL inválida para o PostgreSQL descartável.");
  }
  // pg aceita host/user/port em query params, sobrepondo a autoridade da URL.
  // Os alvos gerados pelo harness nunca precisam desses parâmetros.
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.hostname !== "127.0.0.1" ||
    url.pathname !== "/levi_test" ||
    url.username !== role ||
    !url.port ||
    url.search !== "" ||
    url.hash !== ""
  )
    throw new Error("Use somente a conexão gerada pelo harness descartável.");
  return url;
}

export function applicationDatabaseUrl(observerUrl: string) {
  assert.equal(process.env.LEVI_LOCAL_DATABASE, "1");
  const observer = localTestDatabaseUrl(observerUrl, "levi_test");
  const runtimeUrl = process.env.LEVI_TEST_RUNTIME_DATABASE_URL;
  if (!runtimeUrl) return observerUrl;
  const runtime = localTestDatabaseUrl(runtimeUrl, "levi_dev_runtime");
  assert.equal(runtime.port, observer.port);
  return runtimeUrl;
}

export const memberGrants = [
  `GRANT SELECT (id, tenant_id, church_id, name, status, birth_date, phone, email,
    joined_on, address, baptism_date, church_role, created_at),
    INSERT (id, tenant_id, church_id, name, status, birth_date, phone, email,
    joined_on, address, baptism_date, church_role, created_at)
    ON TABLE public.members TO levi_dev_runtime`,
  `GRANT INSERT (id, tenant_id, member_id, actor_id, church_name, initial_status, created_at)
    ON TABLE public.member_history TO levi_dev_runtime`,
  `GRANT SELECT (tenant_id, actor_id, request_key, request_hash, member_id),
    INSERT (tenant_id, actor_id, request_key, request_hash, member_id)
    ON TABLE public.member_creation_requests TO levi_dev_runtime`,
  `GRANT UPDATE (created_at) ON TABLE public.churches TO levi_dev_runtime`,
  `GRANT UPDATE (created_at) ON TABLE public.tenant_memberships TO levi_dev_runtime`,
];

export const legacyRuntimeGrants = [
  ["abuse_counters", "SELECT, INSERT, UPDATE, DELETE"],
  ["account", "SELECT, INSERT, UPDATE, DELETE"],
  ["session", "SELECT, INSERT, UPDATE, DELETE"],
  ["audit_events", "INSERT"],
  ["churches", "SELECT, INSERT"],
  ["onboarding_provisions", "SELECT, INSERT"],
  ["tenant_memberships", "SELECT, INSERT"],
  ["tenant_sessions", "SELECT, INSERT, UPDATE"],
  ["tenants", "SELECT, INSERT"],
  ["user", "SELECT, INSERT, UPDATE"],
  ["verification", "SELECT, INSERT, DELETE"],
] as const;

export async function prepareRuntimeRoles(observerUrl: string) {
  assert.equal(process.env.NODE_ENV, "test");
  const url = localTestDatabaseUrl(observerUrl, "levi_test");
  const observer = await createPostgresDatabase(observerUrl);
  try {
    for (const role of [
      "levi_dev_migrator",
      "levi_dev_runtime",
      "levi_dev_bootstrap",
    ])
      await observer.client.query(
        `CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
         NOREPLICATION NOBYPASSRLS PASSWORD 'synthetic-runtime-acls-only'`,
      );
    await observer.client.query(
      "ALTER DATABASE levi_test OWNER TO levi_dev_migrator",
    );
    await observer.client.query("REVOKE ALL ON DATABASE levi_test FROM PUBLIC");
    await observer.client.query(
      "GRANT CONNECT ON DATABASE levi_test TO levi_dev_runtime",
    );
    await observer.client.query(
      "ALTER SCHEMA public OWNER TO levi_dev_migrator",
    );
    await observer.client.query("REVOKE ALL ON SCHEMA public FROM PUBLIC");
    await observer.client.query(
      "GRANT USAGE ON SCHEMA public TO levi_dev_runtime",
    );
    // O DEV não concede EXECUTE público às funções criadas pela migradora.
    await observer.client.query(
      "ALTER DEFAULT PRIVILEGES FOR ROLE levi_dev_migrator REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC",
    );
  } finally {
    await observer.client.end();
  }
  url.username = "levi_dev_migrator";
  url.password = "synthetic-runtime-acls-only";
  const migratorUrl = url.toString();
  url.username = "levi_dev_runtime";
  return { migratorUrl, runtimeUrl: url.toString() };
}

export async function applyRuntimeGrants(migratorUrl: string) {
  assert.equal(process.env.NODE_ENV, "test");
  localTestDatabaseUrl(migratorUrl, "levi_dev_migrator");
  const migrator = await createPostgresDatabase(migratorUrl);
  try {
    // Baseline legado registrado no preflight: sem ALL PRIVILEGES.
    for (const [table, privileges] of legacyRuntimeGrants)
      await migrator.client.query(
        `GRANT ${privileges} ON TABLE public."${table}" TO levi_dev_runtime`,
      );
    await migrator.client.query("BEGIN");
    try {
      for (const grant of memberGrants) await migrator.client.query(grant);
      await migrator.client.query(
        await readFile(
          new URL("../ops/interface-e-edicao-acls.sql", import.meta.url),
          "utf8",
        ),
      );
      await migrator.client.query(
        await readFile(
          new URL("../ops/administracao-runtime-acls.sql", import.meta.url),
          "utf8",
        ),
      );
      await migrator.client.query(
        "GRANT CONNECT ON DATABASE levi_test TO levi_dev_bootstrap",
      );
      await migrator.client.query(
        await readFile(
          new URL("../ops/administracao-bootstrap-acls.sql", import.meta.url),
          "utf8",
        ),
      );
      await migrator.client.query("COMMIT");
    } catch (error) {
      await migrator.client.query("ROLLBACK");
      throw error;
    }
  } finally {
    await migrator.client.end();
  }
}
