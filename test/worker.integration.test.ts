import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { createPostgresDatabase } from "@t00ls-dev/db/postgres";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import {
  workerHarness,
  workerOrigin,
  password,
  cookieFrom,
} from "./worker-harness.js";
import { resourceProbe } from "./worker-resources.js";

const databaseUrl = process.env.LEVI_DATABASE_URL;
if (!databaseUrl || process.env.LEVI_LOCAL_DATABASE !== "1")
  throw new Error("Use npm run test:worker.");
const harness = await workerHarness(databaseUrl);
const { mf, send, email, link, sent } = harness;
const observer = await createPostgresDatabase(databaseUrl);
after(async () => {
  await mf.dispose();
  await observer.client.end();
});
const body = {
  organizationName: "Organização sintética Worker",
  churchName: "Igreja sintética Worker",
};

async function verified() {
  const address = email();
  assert.equal(
    (await send("/api/onboarding/email", { email: address })).status,
    200,
  );
  const url = link(address);
  assert.equal(url.origin, workerOrigin);
  url.searchParams.set("callbackURL", "https://untrusted.example");
  const response = await send(url.pathname + url.search);
  assert.equal(response.status, 302);
  assert.ok(
    new URL(response.headers.get("location")!, workerOrigin).pathname ===
      "/onboarding",
  );
  assert.ok(
    response.headers
      .getSetCookie()
      .some(
        (value) =>
          value.includes("HttpOnly") &&
          value.includes("Secure") &&
          value.includes("SameSite=Lax"),
      ),
  );
  const cookie = cookieFrom(response);
  const id = (
    await observer.client.query<{ id: string }>(
      'SELECT id FROM "user" WHERE email=$1',
      [address],
    )
  ).rows[0]!.id;
  return { email: address, cookie, id };
}
async function resetToken(account: { email: string; cookie: string }) {
  assert.equal(
    (await send("/api/onboarding/password-email", {}, account.cookie)).status,
    200,
  );
  const url = link(account.email);
  const callback = await send(url.pathname + url.search);
  assert.equal(callback.status, 302);
  const destination = new URL(callback.headers.get("location")!, workerOrigin);
  assert.ok(
    destination.origin === workerOrigin &&
      destination.pathname === "/onboarding",
  );
  const token = destination.searchParams.get("token");
  assert.ok(token);
  return token;
}
async function ready() {
  const account = await verified();
  const token = await resetToken(account);
  assert.equal(
    (
      await send(
        "/api/onboarding/password",
        { token, newPassword: password },
        account.cookie,
      )
    ).status,
    200,
  );
  return account;
}
async function provisioned() {
  const account = await ready();
  const key = randomUUID();
  const response = await send("/api/organizations", body, account.cookie, {
    "Idempotency-Key": key,
  });
  assert.equal(response.status, 201);
  const result = (await response.json()) as {
    organizationId: string;
    churchId: string;
  };
  return { ...account, ...result, key };
}

test("workerd: Static Assets reais, SPA, API e headers de segurança", async () => {
  const metafile = JSON.parse(
    await readFile(".local/worker-metafile.json", "utf8"),
  ) as { inputs: Record<string, unknown> };
  const inputs = Object.keys(metafile.inputs);
  assert.ok(inputs.some((path) => path.includes("pg-cloudflare")));
  assert.ok(inputs.some((path) => path.includes("password.node")));
  assert.ok(
    !inputs.some((path) =>
      /(?:src\/(?:local|web)\.ts|tools\/|@hono\/node-server)/.test(path),
    ),
  );
  for (const path of [
    "/",
    "/onboarding",
    "/entrar",
    "/organizacoes",
    "/igrejas",
  ]) {
    const response = await send(path);
    assert.equal(response.status, 200);
    assert.ok(
      response.headers
        .get("content-security-policy")
        ?.includes("frame-ancestors 'none'"),
    );
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const html = await response.text();
    assert.ok(html.includes('<html lang="pt-BR">'));
    const asset = html.match(/src="(\/assets\/[^\"]+\.js)"/)?.[1];
    assert.ok(asset);
    const result = await send(asset);
    assert.equal(result.status, 200);
    assert.ok(result.headers.has("content-security-policy"));
    await result.arrayBuffer();
  }
  for (const path of [
    "/api",
    "/api/unknown",
    "/unknown",
    "/assets/missing.js",
  ]) {
    const response = await send(path, undefined, "", {
      "Sec-Fetch-Mode": "navigate",
    });
    assert.equal(response.status, 404);
    if (path.startsWith("/api"))
      assert.ok(
        response.headers.get("content-type")?.includes("application/json"),
      );
    await response.arrayBuffer();
  }
});

test("workerd: inicialização em banco vazio não executa migrations", async () => {
  await observer.client.query("CREATE DATABASE levi_worker_empty");
  const url = new URL(databaseUrl!);
  url.pathname = "/levi_worker_empty";
  const empty = await createPostgresDatabase(url.toString());
  const runtime = await workerHarness(url.toString());
  try {
    assert.equal((await runtime.send("/api/onboarding")).status, 200);
    const tables = await empty.client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public'",
    );
    assert.equal(tables.rows[0]!.count, 0);
  } finally {
    await runtime.mf.dispose();
    await empty.client.end();
  }
});

test("workerd: dois e-mails, allowlist DEV, prontidão, cookies e callbacks nativos", async () => {
  const count = sent.length;
  assert.equal(
    (await send("/api/onboarding/email", { email: "not-allowed@example.test" }))
      .status,
    200,
  );
  assert.equal(sent.length, count);
  const account = await verified();
  assert.equal(
    (
      await send("/api/organizations", body, account.cookie, {
        "Idempotency-Key": randomUUID(),
      })
    ).status,
    403,
  );
  assert.equal(
    (await send("/api/auth/sign-up/email", { email: account.email, password }))
      .status,
    404,
  );
  const token = await resetToken(account);
  assert.equal(sent.filter((value) => value.to[0] === account.email).length, 2);
  assert.equal(
    (await send("/api/onboarding/password", { token, newPassword: password }))
      .status,
    401,
  );
  assert.equal(
    (
      await send(
        "/api/onboarding/password",
        { token, newPassword: password },
        account.cookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await send(
        "/api/onboarding/password",
        { token, newPassword: password },
        account.cookie,
      )
    ).status,
    400,
  );
  assert.deepEqual(
    await (await send("/api/onboarding", undefined, account.cookie)).json(),
    { etapa: "organizacao" },
  );
  assert.equal(
    (await send("/api/auth/sign-out", {}, account.cookie)).status,
    200,
  );
  const login = await send("/api/auth/sign-in/email", {
    email: account.email,
    password,
  });
  assert.equal(login.status, 200);
  assert.ok(cookieFrom(login));
  assert.equal(
    (await send("/api/organizations", undefined, account.cookie)).status,
    401,
  );
  assert.equal(
    (
      await send("/api/auth/sign-in/email", {
        email: account.email,
        password: "wrong",
      })
    ).status,
    401,
  );
});

test("workerd: provisionamento concorrente, UUID, isolamento, múltiplas igrejas e revogação", async () => {
  const first = await ready();
  const key = randomUUID();
  const results = await Promise.all(
    Array.from({ length: 4 }, () =>
      send("/api/organizations", body, first.cookie, {
        "Idempotency-Key": key,
      }),
    ),
  );
  assert.ok(results.every((response) => response.status === 201));
  const values = (await Promise.all(
    results.map((response) => response.json()),
  )) as Array<{ organizationId: string; churchId: string }>;
  assert.ok(
    values.every(
      (value) =>
        value.organizationId === values[0]!.organizationId &&
        value.churchId === values[0]!.churchId,
    ),
  );
  const tenantId = values[0]!.organizationId;
  assert.match(tenantId, /^[a-f0-9-]{36}$/);
  assert.equal(
    (
      await send("/api/organizations", body, first.cookie, {
        "Idempotency-Key": randomUUID(),
      })
    ).status,
    409,
  );
  const second = await provisioned();
  await observer.client.query(
    "INSERT INTO churches(tenant_id,name) VALUES($1,'Segunda igreja sintética')",
    [tenantId],
  );
  const listed = (await (
    await send("/api/churches", undefined, first.cookie)
  ).json()) as { organizationId: string; churches: unknown[] };
  assert.equal(listed.organizationId, tenantId);
  assert.equal(listed.churches.length, 2);
  assert.equal(
    (await send(`/api/churches/${second.churchId}`, undefined, first.cookie))
      .status,
    404,
  );
  assert.equal(
    (
      await send(
        "/api/tenant",
        { organizationId: second.organizationId },
        first.cookie,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await send("/api/tenant", { organizationId: tenantId }, first.cookie, {
        origin: "https://untrusted.example",
      })
    ).status,
    403,
  );
  const audit = await observer.client.query<{
    metadata: object;
    events: number;
  }>(
    "SELECT metadata, count(*) OVER()::int AS events FROM audit_events WHERE actor=$1",
    [first.id],
  );
  assert.equal(audit.rows[0]!.events, 1);
  assert.deepEqual(audit.rows[0]!.metadata, {});
  assert.ok(!JSON.stringify(audit.rows).includes(first.email));
  await observer.client.query(
    "UPDATE tenant_memberships SET role='unknown-role' WHERE tenant_id=$1 AND user_id=$2",
    [tenantId, first.id],
  );
  assert.equal(
    (await send("/api/churches", undefined, first.cookie)).status,
    403,
  );
  await observer.client.query(
    "DELETE FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2",
    [tenantId, first.id],
  );
  assert.equal(
    (await send("/api/churches", undefined, first.cookie)).status,
    403,
  );
  assert.equal(
    (
      await send("/api/organizations", body, first.cookie, {
        "Idempotency-Key": key,
      })
    ).status,
    403,
  );
});

for (const table of ["audit_events", "onboarding_provisions"])
  test(`workerd: rollback real após falha em ${table}, observado por outra conexão`, async () => {
    const account = await ready();
    const before = (
      await observer.client.query("SELECT count(*)::int AS count FROM tenants")
    ).rows[0].count;
    await observer.client.query(
      "CREATE FUNCTION worker_reject_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$",
    );
    await observer.client.query(
      `CREATE TRIGGER worker_reject_write BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION worker_reject_write()`,
    );
    const key = randomUUID();
    try {
      assert.equal(
        (
          await send("/api/organizations", body, account.cookie, {
            "Idempotency-Key": key,
          })
        ).status,
        503,
      );
      assert.equal(
        (
          await observer.client.query(
            "SELECT count(*)::int AS count FROM tenants",
          )
        ).rows[0].count,
        before,
      );
      for (const sql of [
        "SELECT user_id FROM onboarding_provisions WHERE user_id=$1",
        "SELECT user_id FROM tenant_memberships WHERE user_id=$1",
        "SELECT actor FROM audit_events WHERE actor=$1",
      ])
        assert.equal(
          (await observer.client.query(sql, [account.id])).rowCount,
          0,
        );
    } finally {
      await observer.client.query(
        `DROP TRIGGER worker_reject_write ON ${table}`,
      );
      await observer.client.query("DROP FUNCTION worker_reject_write()");
    }
    assert.equal(
      (
        await send("/api/organizations", body, account.cookie, {
          "Idempotency-Key": key,
        })
      ).status,
      201,
    );
  });

test("workerd: falha real de banco ou provider não vira autorização/envio confirmado", async () => {
  harness.provider(429);
  try {
    assert.equal(
      (await send("/api/onboarding/email", { email: email() })).status,
      500,
    );
  } finally {
    harness.provider(200);
  }
  const account = await provisioned();
  await observer.client.query(
    'ALTER TABLE "session" RENAME TO worker_session_unavailable',
  );
  try {
    const response = await send("/api/churches", undefined, account.cookie);
    assert.equal(response.status, 503);
    assert.equal(cookieFrom(response), "");
    assert.ok(!(await response.text()).includes(account.email));
  } finally {
    await observer.client.query(
      'ALTER TABLE worker_session_unavailable RENAME TO "session"',
    );
  }
});

test("workerd: CPU de processo, heap V8, RSS e latência da senha sem reduzir scrypt", async () => {
  const probe = await resourceProbe(mf);
  const rows = [];
  try {
    for (let index = 0; index < 3; index++) {
      const account = await verified();
      const token = await resetToken(account);
      rows.push(
        await probe.measure("definir-senha", () =>
          send(
            "/api/onboarding/password",
            { token, newPassword: password },
            account.cookie,
          ),
        ),
      );
      rows.push(
        await probe.measure("login", () =>
          send("/api/auth/sign-in/email", { email: account.email, password }),
        ),
      );
    }
    const concurrent = await Promise.all([ready(), ready()]);
    rows.push(
      await probe.measure("login-concorrente-2", async () => {
        const responses = await Promise.all(
          concurrent.map((account) =>
            send("/api/auth/sign-in/email", { email: account.email, password }),
          ),
        );
        for (const response of responses) {
          assert.equal(response.status, 200);
          await response.arrayBuffer();
        }
        return new Response(null, { status: 200 });
      }),
    );
    await mkdir(".local", { recursive: true });
    await writeFile(
      ".local/worker-metrics.json",
      JSON.stringify(
        {
          scope:
            "workerd local; CPU de processo, não CPU faturada Cloudflare; RSS inclui runtime/assets, heap não inclui toda memória nativa",
          samples: rows,
        },
        null,
        2,
      ),
    );
    console.info(JSON.stringify({ workerd_resources: rows }));
  } finally {
    probe.close();
  }
});
