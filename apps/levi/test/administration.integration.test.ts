import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { execFileSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { createPostgresDatabase } from "@t00ls-dev/db/postgres";
import { createApp } from "../src/app.js";
import { createAuth, type Database } from "../src/auth.js";
import { requireGlobalAdministrator } from "../src/admin-access.js";
import {
  changeGlobalAdministrator,
  listGlobalAdministrators,
} from "../src/administrators.js";
import {
  featureAvailable,
  listFeatureFlags,
  updateFeatureFlag,
} from "../src/feature-flags.js";
import {
  bootstrapAdministrator,
  readBootstrapInput,
} from "../tools/bootstrap-admin-operation.js";
import {
  applicationDatabaseUrl,
  localTestDatabaseUrl,
} from "./runtime-acl-fixture.js";
import { RequestError } from "../src/contracts.js";

const observerUrl = process.env.LEVI_DATABASE_URL;
assert.ok(observerUrl && process.env.LEVI_LOCAL_DATABASE === "1");
localTestDatabaseUrl(observerUrl, "levi_test");
const runtimeUrl = applicationDatabaseUrl(observerUrl);
const observer = await createPostgresDatabase(observerUrl);
const runtime = await createPostgresDatabase(runtimeUrl);
const bootstrapUrl = new URL(observerUrl);
bootstrapUrl.username = "levi_dev_bootstrap";
bootstrapUrl.password = "synthetic-runtime-acls-only";
const restricted = !!process.env.LEVI_TEST_RUNTIME_DATABASE_URL;
if (!restricted) {
  await observer.client.query(
    "CREATE ROLE levi_dev_bootstrap LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD 'synthetic-runtime-acls-only'",
  );
  await observer.client.query(
    "GRANT CONNECT ON DATABASE levi_test TO levi_dev_bootstrap",
  );
  await observer.client.query(
    await readFile("ops/administracao-bootstrap-acls.sql", "utf8"),
  );
}
const bootstrap = await createPostgresDatabase(bootstrapUrl.toString());

// Reset exclusivo do cluster sintético: somente seu owner pode desligar o trigger.
async function resetAdministrativeFixtures() {
  await observer.client.query(
    "ALTER TABLE admin_bootstrap DISABLE TRIGGER admin_bootstrap_permanent",
  );
  try {
    await observer.client.query(
      "TRUNCATE feature_flag_organizations, feature_flags, global_administrators, admin_bootstrap",
    );
  } finally {
    await observer.client.query(
      "ALTER TABLE admin_bootstrap ENABLE TRIGGER admin_bootstrap_permanent",
    );
  }
}
beforeEach(resetAdministrativeFixtures);
after(async () => {
  await resetAdministrativeFixtures();
  await Promise.all([runtime.client.end(), bootstrap.client.end()]);
  if (!restricted) {
    await observer.client.query("DROP OWNED BY levi_dev_bootstrap");
    await observer.client.query("DROP ROLE levi_dev_bootstrap");
  }
  await observer.client.end();
});

const origin = "http://localhost:3000";
const secret = "synthetic-administrative-secret-with-32-characters";
const messages: Array<{ to: string; text: string }> = [];
const options = {
  databaseUrl: runtimeUrl,
  baseURL: origin,
  secret,
  email: {
    send: async (message: { to: string; text: string }) => {
      messages.push(message);
    },
  },
};
const app = createApp(options);
async function send(path: string, body?: object, cookie = "") {
  return app.request(
    new Request(new URL(path, origin), {
      method: body ? "POST" : "GET",
      headers: { origin, cookie, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  );
}
function link(email: string) {
  const url = messages
    .findLast((message) => message.to === email)
    ?.text.match(/https?:\/\/\S+/)?.[0];
  assert.ok(url);
  return new URL(url);
}
async function account(email = `${randomUUID()}@example.test`) {
  assert.equal((await send("/api/onboarding/email", { email })).status, 200);
  const url = link(email);
  const response = await send(url.pathname + url.search);
  assert.equal(response.status, 302);
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  assert.equal(
    (await send("/api/onboarding/password-email", {}, cookie)).status,
    200,
  );
  const token = link(email).pathname.split("/").at(-1);
  assert.ok(token);
  assert.equal(
    (
      await send(
        "/api/onboarding/password",
        { token, newPassword: "synthetic-administrative-password" },
        cookie,
      )
    ).status,
    200,
  );
  const { data: identity } = await createAuth(runtime, options).resolveSession(
    new Headers({ cookie }),
  );
  assert.ok(identity);
  return {
    email,
    cookie,
    identity,
    userId: identity.user.id,
    sessionId: identity.session.id,
  };
}
type Account = Awaited<ReturnType<typeof account>>;
function confirmation(candidate: Account) {
  return readBootstrapInput({
    ADMIN_EMAIL: candidate.email,
    LEVI_ADMIN_USER_ID: candidate.userId,
    LEVI_ADMIN_SESSION_ID: candidate.sessionId,
    LEVI_ADMIN_OPERATION_ID: randomUUID(),
    LEVI_ADMIN_IDENTITY_CONFIRMATION: `IDENTIDADE-CONFERIDA:${candidate.userId}`,
  });
}
async function boot(candidate: Account) {
  return bootstrapAdministrator({
    database: bootstrap,
    confirmation: confirmation(candidate),
  });
}
function change(
  actor: Account,
  target: Account,
  enabled: boolean,
  expectedVersion: number,
  database = runtime,
) {
  return changeGlobalAdministrator({
    database,
    identity: actor.identity,
    userId: target.userId,
    enabled,
    expectedVersion,
    operationId: randomUUID(),
  });
}
function denied(status = 404, code?: string) {
  return (error: unknown) =>
    error instanceof RequestError &&
    error.status === status &&
    (!code || error.code === code);
}
async function otherConnections<T>(
  run: (a: Database, b: Database) => Promise<T>,
) {
  const a = await createPostgresDatabase(runtimeUrl);
  const b = await createPostgresDatabase(runtimeUrl);
  try {
    return await run(a, b);
  } finally {
    await Promise.all([a.client.end(), b.client.end()]);
  }
}
async function rejectAudit() {
  await observer.client
    .query(`CREATE FUNCTION reject_admin_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'synthetic-audit-failure'; END; $$;
    CREATE TRIGGER reject_admin_test_audit BEFORE INSERT ON audit_events FOR EACH ROW
    WHEN (NEW.action LIKE 'admin.%' OR NEW.action LIKE 'feature_flag.%') EXECUTE FUNCTION reject_admin_test_audit()`);
}
async function restoreAudit() {
  await observer.client.query(
    "DROP TRIGGER reject_admin_test_audit ON audit_events; DROP FUNCTION reject_admin_test_audit()",
  );
}

// Contas verificadas pelo fluxo real Better Auth, sem criar identidades pelo runner.
const owner = await account();
const second = await account();
const third = await account();
const fourth = await account();

test("bootstrap: identidade inválida, ambiguidade, senha e sessão inadequadas não concedem", async () => {
  const base = confirmation(owner);
  for (const candidate of [
    { ...base, userId: second.userId },
    { ...base, sessionId: second.sessionId },
    { ...base, email: second.email },
  ])
    await assert.rejects(
      bootstrapAdministrator({ database: bootstrap, confirmation: candidate }),
      denied(),
    );
  for (const [mutate, restore] of [
    [
      'UPDATE "user" SET email_verified=false WHERE id=$1',
      'UPDATE "user" SET email_verified=true WHERE id=$1',
    ],
    [
      "UPDATE account SET password='' WHERE user_id=$1",
      "UPDATE account SET password='synthetic-fixture-restored' WHERE user_id=$1",
    ],
  ]) {
    await observer.client.query(mutate!, [owner.userId]);
    try {
      await assert.rejects(boot(owner), denied());
    } finally {
      await observer.client.query(restore!, [owner.userId]);
    }
  }
  for (const [assignment, status] of [
    ["created_at=now()-interval '11 minutes'", 403],
    ["expires_at=now()-interval '1 second'", 404],
    ["created_at=now()+interval '1 day'", 404],
    ["created_at='infinity'", 404],
    ["expires_at='infinity'", 404],
  ] as const) {
    await observer.client.query(
      `UPDATE session SET ${assignment} WHERE id=$1`,
      [owner.sessionId],
    );
    try {
      await assert.rejects(boot(owner), denied(status));
    } finally {
      await observer.client.query(
        "UPDATE session SET created_at=now(),expires_at=now()+interval '1 day' WHERE id=$1",
        [owner.sessionId],
      );
    }
  }
  await observer.client.query(
    "INSERT INTO \"user\"(name,email,email_verified) VALUES('Colisão sintética',$1,true)",
    [owner.email.toUpperCase()],
  );
  try {
    await assert.rejects(boot(owner), denied());
  } finally {
    await observer.client.query('DELETE FROM "user" WHERE email=$1', [
      owner.email.toUpperCase(),
    ]);
  }
  assert.equal(
    (
      await observer.client.query(
        "SELECT count(*)::int AS n FROM global_administrators",
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await observer.client.query(
        "SELECT count(*)::int AS n FROM admin_bootstrap",
      )
    ).rows[0].n,
    0,
  );
});

test("bootstrap concorrente é único, auditado e nunca restaura acesso pelo e-mail", async () => {
  const other = await createPostgresDatabase(bootstrapUrl.toString());
  try {
    const results = await Promise.all([
      bootstrapAdministrator({
        database: bootstrap,
        confirmation: confirmation(owner),
      }),
      bootstrapAdministrator({
        database: other,
        confirmation: confirmation(second),
      }),
    ]);
    assert.deepEqual(results.map((r) => r.kind).sort(), [
      "already-completed",
      "completed",
    ]);
    const receipt = (
      await observer.client.query("SELECT * FROM admin_bootstrap")
    ).rows[0];
    assert.ok(receipt);
    const event = await observer.client.query(
      "SELECT actor,target,tenant,metadata FROM audit_events WHERE request_id=$1",
      [receipt.operation_id],
    );
    assert.equal(event.rowCount, 1);
    assert.deepEqual(event.rows[0], {
      actor: receipt.bootstrapped_user_id,
      target: receipt.bootstrapped_user_id,
      tenant: null,
      metadata: {},
    });
    await observer.client.query(
      "UPDATE global_administrators SET revoked_at=now(),version=version+1",
    );
    assert.equal((await boot(owner)).kind, "already-completed");
    assert.equal((await boot(second)).kind, "already-completed");
    await assert.rejects(
      requireGlobalAdministrator(runtime, owner.identity),
      denied(),
    );
    await assert.rejects(
      requireGlobalAdministrator(runtime, second.identity),
      denied(),
    );
    assert.equal(
      (
        await observer.client.query(
          "SELECT count(*)::int AS n FROM global_administrators WHERE revoked_at IS NULL",
        )
      ).rows[0].n,
      0,
    );
    for (const sql of [
      "UPDATE admin_bootstrap SET operation_id=operation_id",
      "DELETE FROM admin_bootstrap",
      "TRUNCATE admin_bootstrap",
    ])
      await assert.rejects(observer.client.query(sql), { code: "42501" });
  } finally {
    await other.client.end();
  }
});

test("autoridade atual por UUID, recência, concessões versionadas e revogação", async () => {
  await boot(owner);
  assert.equal(
    await requireGlobalAdministrator(runtime, owner.identity),
    owner.userId,
  );
  await assert.rejects(requireGlobalAdministrator(runtime, null), denied());
  await assert.rejects(
    requireGlobalAdministrator(runtime, second.identity),
    denied(),
  );
  await assert.rejects(
    change(owner, owner, false, 1),
    denied(409, "ULTIMO_ADMINISTRADOR"),
  );
  await assert.rejects(change(second, third, true, 0), denied());
  const granted = await change(owner, second, true, 0);
  assert.equal(granted?.version, 1);
  assert.equal((await change(owner, second, true, 1))?.version, 1);
  await assert.rejects(change(owner, second, true, 0), denied(409));
  await assert.rejects(
    change(owner, owner, false, 1),
    denied(409, "AUTORREVOGACAO_NEGADA"),
  );
  await observer.client.query(
    "UPDATE session SET created_at=now()-interval '11 minutes',updated_at=now() WHERE id=$1",
    [owner.sessionId],
  );
  try {
    assert.equal(
      await requireGlobalAdministrator(runtime, owner.identity),
      owner.userId,
    );
    await assert.rejects(
      change(owner, third, true, 0),
      denied(403, "REAUTENTICACAO_NECESSARIA"),
    );
  } finally {
    await observer.client.query(
      "UPDATE session SET created_at=now() WHERE id=$1",
      [owner.sessionId],
    );
  }
  assert.equal((await change(owner, second, false, 1))?.version, 2);
  await assert.rejects(
    requireGlobalAdministrator(runtime, second.identity),
    denied(),
  );
  assert.equal((await change(owner, second, false, 2))?.version, 2);
  assert.equal((await boot(second)).kind, "already-completed");
  assert.equal((await change(owner, second, true, 2))?.version, 3);
  const listed = await listGlobalAdministrators({
    database: runtime,
    identity: owner.identity,
  });
  assert.equal(listed.length, 2);
  await observer.client.query('UPDATE "user" SET email=$2 WHERE id=$1', [
    second.userId,
    `${randomUUID()}@example.test`,
  ]);
  try {
    assert.equal(
      await requireGlobalAdministrator(runtime, second.identity),
      second.userId,
    );
  } finally {
    await observer.client.query('UPDATE "user" SET email=$2 WHERE id=$1', [
      second.userId,
      second.email,
    ]);
  }
});

test("concorrência real: duas concessões têm uma versão vencedora; revogações preservam um admin", async () => {
  await boot(owner);
  await otherConnections(async (a, b) => {
    const grants = await Promise.allSettled([
      change(owner, second, true, 0, a),
      change(owner, second, true, 0, b),
    ]);
    assert.equal(grants.filter((r) => r.status === "fulfilled").length, 1);
    const revoked = await Promise.allSettled([
      change(owner, second, false, 1, a),
      change(second, owner, false, 1, b),
    ]);
    assert.equal(revoked.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      (
        await observer.client.query(
          "SELECT count(*)::int AS n FROM global_administrators WHERE revoked_at IS NULL",
        )
      ).rows[0].n,
      1,
    );
  });
});

async function waitBlocked(pid: number) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (
      (
        await observer.client.query(
          "SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted",
          [pid],
        )
      ).rowCount
    )
      return;
    await setTimeout(10);
  }
  assert.fail("A operação não aguardou o lock esperado.");
}

test("revogação de sessão/concessão enquanto mutation aguarda o mutex é revalidada", async () => {
  await boot(owner);
  await change(owner, second, true, 0);
  await otherConnections(async (a, b) => {
    for (const kind of ["session", "grant"] as const) {
      const pid = Number(
        (await a.client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid,
      );
      await b.client.query("BEGIN");
      await b.client.query("SELECT pg_advisory_xact_lock(715463,2)");
      const outcome = assert.rejects(
        change(second, third, true, 0, a),
        denied(),
      );
      try {
        await waitBlocked(pid);
        if (kind === "session")
          await observer.client.query(
            "UPDATE session SET expires_at=now()-interval '1 second' WHERE id=$1",
            [second.sessionId],
          );
        else
          await observer.client.query(
            "UPDATE global_administrators SET revoked_at=now() WHERE user_id=$1",
            [second.userId],
          );
      } finally {
        await b.client.query("COMMIT");
      }
      await outcome;
      await observer.client.query(
        "UPDATE session SET expires_at=now()+interval '1 day' WHERE id=$1",
        [second.sessionId],
      );
    }
  });
  assert.equal(
    (
      await observer.client.query(
        "SELECT 1 FROM global_administrators WHERE user_id=$1",
        [third.userId],
      )
    ).rowCount,
    0,
  );
});

test("flags: catálogo fechado, seleção validada, all inclui tenant futuro e versões conflitam", async () => {
  await boot(owner);
  const orgs = (
    await observer.client.query(
      "INSERT INTO tenants(name) VALUES('Flag A'),('Flag B') RETURNING id",
    )
  ).rows.map((r) => String(r.id));
  const [orgA, orgB] = orgs;
  assert.ok(orgA && orgB);
  assert.equal(
    await featureAvailable({
      database: runtime,
      key: "unknown",
      organizationId: orgA,
    }),
    false,
  );
  assert.equal(
    await featureAvailable({
      database: runtime,
      key: "members",
      organizationId: orgA,
    }),
    false,
  );
  const update = (
    policy: unknown,
    expectedVersion: number,
    database = runtime,
  ) =>
    updateFeatureFlag({
      database,
      identity: owner.identity,
      key: "members",
      policy,
      expectedVersion,
      operationId: randomUUID(),
    });
  await assert.rejects(
    update({ kind: "selected", organizationIds: [randomUUID()] }, 0),
    denied(400),
  );
  const selected = await update(
    { kind: "selected", organizationIds: [orgA] },
    0,
  );
  assert.equal(selected.version, 1);
  assert.equal(
    await featureAvailable({
      database: runtime,
      key: "members",
      organizationId: orgA,
    }),
    true,
  );
  assert.equal(
    await featureAvailable({
      database: runtime,
      key: "members",
      organizationId: orgB,
    }),
    false,
  );
  const future = String(
    (
      await observer.client.query(
        "INSERT INTO tenants(name) VALUES('Flag futura') RETURNING id",
      )
    ).rows[0].id,
  );
  assert.equal(
    await featureAvailable({
      database: runtime,
      key: "members",
      organizationId: future,
    }),
    false,
  );
  await assert.rejects(update({ kind: "all" }, 0), denied(409));
  await otherConnections(async (a, b) => {
    const results = await Promise.allSettled([
      update({ kind: "all" }, 1, a),
      update({ kind: "disabled" }, 1, b),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  });
  const all = await update({ kind: "all" }, 2);
  assert.equal(
    await featureAvailable({
      database: runtime,
      key: "members",
      organizationId: future,
    }),
    true,
  );
  assert.equal(
    await featureAvailable({
      database: runtime,
      key: "members",
      organizationId: randomUUID(),
    }),
    false,
  );
  const disabled = await update({ kind: "disabled" }, all.version);
  assert.equal(
    await featureAvailable({
      database: runtime,
      key: "members",
      organizationId: orgA,
    }),
    false,
  );
  const listed = await listFeatureFlags({
    database: runtime,
    identity: owner.identity,
  });
  assert.equal(listed[0]?.version, disabled.version);
  assert.deepEqual(listed[0]?.organizationIds, []);
  assert.equal(
    (
      await observer.client.query(
        "SELECT count(*)::int AS n FROM feature_flag_organizations",
      )
    ).rows[0].n,
    0,
  );
  await assert.rejects(
    updateFeatureFlag({
      database: runtime,
      identity: second.identity,
      key: "members",
      policy: { kind: "all" },
      expectedVersion: disabled.version,
      operationId: randomUUID(),
    }),
    denied(),
  );
});

test("auditoria e persistência: rollback conjunto e negação diante de banco indisponível", async () => {
  await rejectAudit();
  try {
    await assert.rejects(boot(owner));
    assert.equal(
      (
        await observer.client.query(
          "SELECT count(*)::int AS n FROM admin_bootstrap",
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await observer.client.query(
          "SELECT count(*)::int AS n FROM global_administrators",
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await restoreAudit();
  }
  await boot(owner);
  const org = String(
    (
      await observer.client.query(
        "INSERT INTO tenants(name) VALUES('Flag rollback') RETURNING id",
      )
    ).rows[0].id,
  );
  const selected = await updateFeatureFlag({
    database: runtime,
    identity: owner.identity,
    key: "members",
    policy: { kind: "selected", organizationIds: [org] },
    expectedVersion: 0,
    operationId: randomUUID(),
  });
  await rejectAudit();
  try {
    await assert.rejects(change(owner, fourth, true, 0));
    await assert.rejects(
      updateFeatureFlag({
        database: runtime,
        identity: owner.identity,
        key: "members",
        policy: { kind: "disabled" },
        expectedVersion: 1,
        operationId: randomUUID(),
      }),
    );
    assert.equal(
      (
        await observer.client.query(
          "SELECT 1 FROM global_administrators WHERE user_id=$1",
          [fourth.userId],
        )
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await observer.client.query(
          "SELECT version FROM feature_flags WHERE id=$1",
          [selected.id],
        )
      ).rows[0].version,
      1,
    );
    assert.equal(
      await featureAvailable({
        database: runtime,
        key: "members",
        organizationId: org,
      }),
      true,
    );
  } finally {
    await restoreAudit();
  }
  await observer.client.query(
    "ALTER TABLE global_administrators RENAME TO unavailable_global_administrators",
  );
  try {
    await assert.rejects(
      requireGlobalAdministrator(runtime, owner.identity),
      denied(),
    );
  } finally {
    await observer.client.query(
      "ALTER TABLE unavailable_global_administrators RENAME TO global_administrators",
    );
  }
  await observer.client.query(
    "ALTER TABLE feature_flags RENAME TO unavailable_feature_flags",
  );
  try {
    await assert.rejects(
      featureAvailable({
        database: runtime,
        key: "members",
        organizationId: org,
      }),
    );
  } finally {
    await observer.client.query(
      "ALTER TABLE unavailable_feature_flags RENAME TO feature_flags",
    );
  }
});

test("escopo da auditoria preserva eventos organizacionais e append-only", async () => {
  const insert = (action: string, tenant: string | null) =>
    observer.client.query(
      "INSERT INTO audit_events(actor,action,target,tenant,timestamp,metadata,result) VALUES($1,$2,$3,$4,now(),'{}','success')",
      [owner.userId, action, owner.userId, tenant],
    );
  const tenant = String(
    (
      await observer.client.query(
        "INSERT INTO tenants(name) VALUES('Audit sintético') RETURNING id",
      )
    ).rows[0].id,
  );
  await insert("member.created", tenant);
  await insert("admin.granted", null);
  for (const action of [
    "member.created",
    "unknown",
    "feature_flag.organization_added",
  ])
    await assert.rejects(insert(action, null), { code: "23514" });
  await assert.rejects(insert("admin.granted", tenant), { code: "23514" });
  for (const sql of [
    "UPDATE audit_events SET result=result WHERE false",
    "DELETE FROM audit_events WHERE false",
  ])
    await assert.rejects(observer.client.query(sql));
});

test("runner externo no cluster sintético: preflight, confirmação, consumo único e saída sanitizada", async () => {
  const input = confirmation(owner);
  const env = {
    ...process.env,
    NODE_ENV: "test",
    LEVI_LOCAL_DATABASE: "1",
    ADMIN_EMAIL: owner.email,
    LEVI_ADMIN_USER_ID: input.userId,
    LEVI_ADMIN_SESSION_ID: input.sessionId,
    LEVI_ADMIN_OPERATION_ID: input.operationId,
    LEVI_ADMIN_IDENTITY_CONFIRMATION: `IDENTIDADE-CONFERIDA:${input.userId}`,
    LEVI_ADMIN_DATABASE_URL: bootstrapUrl.toString(),
    LEVI_ADMIN_DATABASE_HOST: bootstrapUrl.hostname,
    LEVI_ADMIN_DATABASE_NAME: "levi_test",
    LEVI_ADMIN_TARGET_CONFIRMATION: "BOOTSTRAP:127.0.0.1/levi_test",
  };
  const run = () =>
    execFileSync(
      process.execPath,
      ["--import", "tsx", "tools/bootstrap-admin.ts"],
      { env, encoding: "utf8" },
    );
  assert.ok(run().includes('"resultado":"completed"'));
  const output = run();
  assert.ok(output.includes('"resultado":"already-completed"'));
  for (const privateValue of [
    owner.email,
    owner.sessionId,
    bootstrapUrl.password,
    bootstrapUrl.toString(),
  ])
    assert.ok(!output.includes(privateValue));
});

test("ACL bootstrap separa privilégios; runtime restrita não altera recibo, chaves ou auditoria", async () => {
  await boot(owner);
  for (const statement of [
    "UPDATE global_administrators SET revoked_at=now()",
    "DELETE FROM global_administrators",
    "UPDATE admin_bootstrap SET id=id",
    "DELETE FROM admin_bootstrap",
    "TRUNCATE admin_bootstrap",
    'UPDATE "user" SET email=email',
    'UPDATE "user" SET email_verified=true',
    "UPDATE account SET password=password",
    "INSERT INTO tenants(name) VALUES('forbidden')",
    "SELECT * FROM feature_flags",
    "SELECT * FROM audit_events",
    "CREATE TABLE forbidden_admin_fixture(id int)",
    "ALTER TABLE admin_bootstrap DISABLE TRIGGER admin_bootstrap_permanent",
  ])
    await assert.rejects(bootstrap.client.query(statement), { code: "42501" });
  if (restricted) {
    for (const statement of [
      "SELECT * FROM admin_bootstrap",
      "DELETE FROM admin_bootstrap",
      "TRUNCATE admin_bootstrap",
      "UPDATE audit_events SET result=result",
      "DELETE FROM audit_events",
      "TRUNCATE audit_events",
      "DELETE FROM global_administrators",
      "UPDATE global_administrators SET user_id=user_id",
      "DELETE FROM feature_flags",
      "UPDATE feature_flags SET key=key",
      "UPDATE feature_flags SET id=id",
    ])
      await assert.rejects(runtime.client.query(statement), { code: "42501" });
    assert.equal((await change(owner, second, true, 0))?.version, 1);
  }
});

test("conta recriada com o e-mail inicial não herda UUID ou concessão", async () => {
  await boot(owner);
  await change(owner, second, true, 0);
  await change(second, owner, false, 1);
  await observer.client.query('UPDATE "user" SET email=$2 WHERE id=$1', [
    owner.userId,
    `${randomUUID()}@example.test`,
  ]);
  let recreated: Account | undefined;
  try {
    recreated = await account(owner.email);
    assert.notEqual(recreated.userId, owner.userId);
    await assert.rejects(
      requireGlobalAdministrator(runtime, recreated.identity),
      denied(),
    );
    assert.equal((await boot(recreated)).kind, "already-completed");
    assert.equal(
      (
        await observer.client.query(
          "SELECT 1 FROM global_administrators WHERE user_id=$1",
          [recreated.userId],
        )
      ).rowCount,
      0,
    );
  } finally {
    if (recreated)
      await observer.client.query('DELETE FROM "user" WHERE id=$1', [
        recreated.userId,
      ]);
    await observer.client.query('UPDATE "user" SET email=$2 WHERE id=$1', [
      owner.userId,
      owner.email,
    ]);
  }
});

test("membership organizacional não concede autoridade global; alvo não pronto não recebe concessão", async () => {
  await boot(owner);
  const tenant = String(
    (
      await observer.client.query(
        "INSERT INTO tenants(name) VALUES('Admin somente organizacional') RETURNING id",
      )
    ).rows[0].id,
  );
  await observer.client.query(
    "INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",
    [tenant, second.userId],
  );
  await assert.rejects(
    requireGlobalAdministrator(runtime, second.identity),
    denied(),
  );
  await observer.client.query(
    'UPDATE "user" SET email_verified=false WHERE id=$1',
    [second.userId],
  );
  try {
    await assert.rejects(change(owner, second, true, 0), denied());
    // Concessão ativa sem identidade elegível não conta como substituta do último admin.
    await observer.client.query(
      "INSERT INTO global_administrators(user_id,granted_by) VALUES($1,$2)",
      [second.userId, owner.userId],
    );
    await assert.rejects(
      change(owner, owner, false, 1),
      denied(409, "ULTIMO_ADMINISTRADOR"),
    );
  } finally {
    await observer.client.query(
      'UPDATE "user" SET email_verified=true WHERE id=$1',
      [second.userId],
    );
  }
});

test("ACLs administrativas exatas por coluna, sem grant option e sem ampliar as legadas", async () => {
  const globalColumns = [
    "user_id",
    "granted_at",
    "granted_by",
    "revoked_at",
    "version",
  ];
  const flagColumns = [
    "id",
    "key",
    "policy",
    "version",
    "updated_at",
    "updated_by",
  ];
  const receiptColumns = [
    "id",
    "bootstrapped_user_id",
    "completed_at",
    "operation_id",
  ];
  const bootstrapGroups: [string, string, string[]][] = [
    ["user", "SELECT", ["id", "email", "email_verified"]],
    ["user", "UPDATE", ["updated_at"]],
    [
      "account",
      "SELECT",
      ["id", "user_id", "provider_id", "account_id", "password"],
    ],
    ["account", "UPDATE", ["updated_at"]],
    ["session", "SELECT", ["id", "user_id", "created_at", "expires_at"]],
    ["session", "UPDATE", ["updated_at"]],
    ["global_administrators", "SELECT", ["user_id"]],
    ["global_administrators", "INSERT", globalColumns],
    ["admin_bootstrap", "SELECT", receiptColumns],
    ["admin_bootstrap", "INSERT", receiptColumns],
    [
      "audit_events",
      "INSERT",
      [
        "id",
        "actor",
        "action",
        "target",
        "tenant",
        "timestamp",
        "metadata",
        "request_id",
        "result",
      ],
    ],
  ];
  const runtimeGroups: [string, string, string[]][] = [
    ["global_administrators", "SELECT", globalColumns],
    ["global_administrators", "INSERT", globalColumns],
    [
      "global_administrators",
      "UPDATE",
      ["granted_at", "granted_by", "revoked_at", "version"],
    ],
    ["feature_flags", "SELECT", flagColumns],
    ["feature_flags", "INSERT", flagColumns],
    [
      "feature_flags",
      "UPDATE",
      ["policy", "version", "updated_at", "updated_by"],
    ],
    [
      "feature_flag_organizations",
      "SELECT",
      ["feature_flag_id", "organization_id"],
    ],
    [
      "feature_flag_organizations",
      "INSERT",
      ["feature_flag_id", "organization_id"],
    ],
  ];
  const roles = restricted
    ? ["levi_dev_bootstrap", "levi_dev_runtime"]
    : ["levi_dev_bootstrap"];
  for (const role of roles) {
    const groups =
      role === "levi_dev_bootstrap" ? bootstrapGroups : runtimeGroups;
    const { rows } = await observer.client.query<{
      table: string;
      column: string;
      privilege: string;
      grantable: boolean;
    }>(
      `
      SELECT c.relname AS table, a.attname AS column, x.privilege_type AS privilege, x.is_grantable AS grantable
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid CROSS JOIN LATERAL aclexplode(a.attacl) x
      WHERE c.relnamespace='public'::regnamespace AND a.attnum>0 AND x.grantee=$1::text::regrole
      AND ($1 = 'levi_dev_bootstrap' OR c.relname IN ('global_administrators','feature_flags','feature_flag_organizations','admin_bootstrap'))`,
      [role],
    );
    assert.deepEqual(
      rows.map((r) => `${r.table}.${r.column}:${r.privilege}`).sort(),
      groups
        .flatMap(([table, privilege, columns]) =>
          columns.map((column) => `${table}.${column}:${privilege}`),
        )
        .sort(),
    );
    assert.ok(rows.every((row) => !row.grantable));
    const tableAcl = await observer.client.query<{
      table: string;
      privilege: string;
    }>(
      `
      SELECT c.relname AS table,x.privilege_type AS privilege FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x
      WHERE c.relnamespace='public'::regnamespace AND x.grantee=$1::text::regrole
      AND ($1 = 'levi_dev_bootstrap' OR c.relname IN ('global_administrators','feature_flags','feature_flag_organizations','admin_bootstrap'))`,
      [role],
    );
    assert.deepEqual(
      tableAcl.rows,
      role === "levi_dev_bootstrap"
        ? []
        : [{ table: "feature_flag_organizations", privilege: "DELETE" }],
    );
  }
});

test("upgrade 0000–0004 para schema administrativo preserva dados e não ativa funcionalidades", async () => {
  const directory = await mkdtemp(join(tmpdir(), "levi-admin-upgrade-"));
  const url = new URL(observerUrl);
  url.pathname = "/levi_admin_upgrade_test";
  await observer.client.query("CREATE DATABASE levi_admin_upgrade_test");
  const old = await createPostgresDatabase(url.toString());
  try {
    await cp("migrations", directory, { recursive: true });
    const journal: unknown = JSON.parse(
      await readFile(join(directory, "meta/_journal.json"), "utf8"),
    );
    assert.ok(
      journal &&
        typeof journal === "object" &&
        "entries" in journal &&
        Array.isArray(journal.entries),
    );
    await writeFile(
      join(directory, "meta/_journal.json"),
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, 5) }),
    );
    await migrate(old.db, { migrationsFolder: directory });
    const userId = String(
      (
        await old.client.query(
          "INSERT INTO \"user\"(name,email,email_verified) VALUES('Conta preservada','upgrade@example.test',true) RETURNING id",
        )
      ).rows[0].id,
    );
    const tenant = String(
      (
        await old.client.query(
          "INSERT INTO tenants(name) VALUES('Tenant preservado') RETURNING id",
        )
      ).rows[0].id,
    );
    const church = String(
      (
        await old.client.query(
          "INSERT INTO churches(tenant_id,name) VALUES($1,'Igreja preservada') RETURNING id",
          [tenant],
        )
      ).rows[0].id,
    );
    const member = String(
      (
        await old.client.query(
          "INSERT INTO members(tenant_id,church_id,name,status) VALUES($1,$2,'Ficha preservada','Ativo') RETURNING id",
          [tenant, church],
        )
      ).rows[0].id,
    );
    await old.client.query(
      "INSERT INTO audit_events(actor,action,target,tenant,timestamp,metadata,result) VALUES($1,'member.created',$2,$3,now(),'{}','success')",
      [userId, member, tenant],
    );
    async function preservedRows() {
      const result = [];
      for (const table of [
        "user",
        "tenants",
        "churches",
        "members",
        "audit_events",
      ])
        result.push((await old.client.query(`SELECT * FROM "${table}"`)).rows);
      return result;
    }
    const before = await preservedRows();
    await migrate(old.db, { migrationsFolder: "migrations" });
    await migrate(old.db, { migrationsFolder: "migrations" });
    assert.deepEqual(await preservedRows(), before);
    for (const table of [
      "global_administrators",
      "admin_bootstrap",
      "feature_flags",
      "feature_flag_organizations",
    ])
      assert.equal(
        (await old.client.query(`SELECT count(*)::int AS n FROM ${table}`))
          .rows[0].n,
        0,
      );
  } finally {
    await old.client.end();
    await observer.client.query("DROP DATABASE levi_admin_upgrade_test");
    await rm(directory, { recursive: true, force: true });
  }
});

// O lock é PostgreSQL real; somente a passagem do tempo é acelerada no teste.
async function denyAfterAuditWait(input: {
  context: import("node:test").TestContext;
  database: Database;
  operation: () => Promise<unknown>;
  advanceTo: number;
  status: number;
}) {
  const pid = Number(
    (await input.database.client.query("SELECT pg_backend_pid() AS pid"))
      .rows[0].pid,
  );
  await observer.client.query("BEGIN");
  await observer.client.query("LOCK TABLE audit_events IN SHARE MODE");
  const outcome = input.operation().then(
    () => ({ kind: "accepted" }) as const,
    (error: unknown) => ({ kind: "denied", error }) as const,
  );
  try {
    try {
      await waitBlocked(pid);
      input.context.mock.method(Date, "now", () => input.advanceTo);
    } finally {
      await observer.client.query("COMMIT");
    }
    const result = await outcome;
    assert.equal(
      result.kind,
      "denied",
      "A sessão deixou de satisfazer o contrato durante a espera por auditoria.",
    );
    if (result.kind === "denied") assert.ok(denied(input.status)(result.error));
  } finally {
    await outcome;
    input.context.mock.restoreAll();
  }
}

test("concessão: recência vencida após autorização e antes do commit desfaz estado e auditoria", async (t) => {
  await boot(owner);
  const operationId = randomUUID();
  await denyAfterAuditWait({
    context: t,
    database: runtime,
    advanceTo: Date.now() + 11 * 60_000,
    status: 403,
    operation: () =>
      changeGlobalAdministrator({
        database: runtime,
        identity: owner.identity,
        userId: second.userId,
        enabled: true,
        expectedVersion: 0,
        operationId,
      }),
  });
  assert.equal(
    (
      await observer.client.query(
        "SELECT 1 FROM global_administrators WHERE user_id=$1",
        [second.userId],
      )
    ).rowCount,
    0,
  );
  assert.equal(
    (
      await observer.client.query(
        "SELECT 1 FROM audit_events WHERE request_id=$1",
        [operationId],
      )
    ).rowCount,
    0,
  );
});

test("flag: sessão expirada após autorização e antes do commit desfaz política e auditoria", async (t) => {
  await boot(owner);
  const operationId = randomUUID();
  const { rows } = await observer.client.query<{ expires_at: Date }>(
    "SELECT expires_at FROM session WHERE id=$1",
    [owner.sessionId],
  );
  assert.ok(rows[0]);
  await denyAfterAuditWait({
    context: t,
    database: runtime,
    advanceTo: rows[0].expires_at.getTime() + 1,
    status: 404,
    operation: () =>
      updateFeatureFlag({
        database: runtime,
        identity: owner.identity,
        key: "members",
        policy: { kind: "all" },
        expectedVersion: 0,
        operationId,
      }),
  });
  assert.equal(
    (await observer.client.query("SELECT 1 FROM feature_flags")).rowCount,
    0,
  );
  assert.equal(
    (
      await observer.client.query(
        "SELECT 1 FROM audit_events WHERE request_id=$1",
        [operationId],
      )
    ).rowCount,
    0,
  );
});

test("bootstrap: recência vencida durante a auditoria não consome recibo nem concede acesso", async (t) => {
  const confirmed = confirmation(owner);
  await denyAfterAuditWait({
    context: t,
    database: bootstrap,
    advanceTo: Date.now() + 11 * 60_000,
    status: 403,
    operation: () =>
      bootstrapAdministrator({ database: bootstrap, confirmation: confirmed }),
  });
  assert.equal(
    (await observer.client.query("SELECT 1 FROM admin_bootstrap")).rowCount,
    0,
  );
  assert.equal(
    (await observer.client.query("SELECT 1 FROM global_administrators"))
      .rowCount,
    0,
  );
  assert.equal(
    (
      await observer.client.query(
        "SELECT 1 FROM audit_events WHERE request_id=$1",
        [confirmed.operationId],
      )
    ).rowCount,
    0,
  );
});
