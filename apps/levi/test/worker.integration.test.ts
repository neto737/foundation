import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createHmac, randomUUID } from "node:crypto";
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

test("workerd: leitura contextual usa sessão real, não bloqueia outra conta no NAT e permite logout", async () => {
  const first = await ready();
  const second = await ready();
  const ip = { "cf-connecting-ip": "192.0.2.249" };
  const digest = createHmac(
    "sha256",
    "synthetic-only-secret-with-more-than-32-characters",
  )
    .update(`user:${first.id}`)
    .digest("hex");
  const start = Math.floor(Date.now() / 60_000) * 60_000;
  const keys = [start, start + 60_000].map(
    (window) => `v2:read:${digest}:${window}`,
  );
  for (let i = 0; i < keys.length; i++)
    await observer.client.query(
      "INSERT INTO abuse_counters(key,count,expires_at) VALUES($1,300,$2) ON CONFLICT(key) DO UPDATE SET count=300",
      [keys[i], new Date(start + (i + 1) * 60_000)],
    );
  try {
    const blocked = await send(
      "/api/organizations",
      undefined,
      first.cookie,
      ip,
    );
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
    assert.equal(blocked.headers.get("ratelimit-limit"), "300");
    assert.equal(blocked.headers.get("cache-control"), "private, no-store");
    assert.equal(blocked.headers.get("referrer-policy"), "no-referrer");
    const allowed = await send(
      "/api/organizations",
      undefined,
      second.cookie,
      ip,
    );
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("ratelimit-limit"), "300");
    assert.equal(
      (await send("/api/auth/sign-out", {}, first.cookie, ip)).status,
      200,
    );
    const revoked = await send("/api/organizations", undefined, first.cookie, {
      ...ip,
      "x-user-id": second.id,
    });
    assert.equal(revoked.status, 401);
    assert.equal(revoked.headers.get("ratelimit-limit"), "60");
  } finally {
    await observer.client.query(
      "DELETE FROM abuse_counters WHERE key=ANY($1::text[])",
      [keys],
    );
  }
});

for (const failDelete of [false, true])
  test(`workerd: logout direto renovável ${failDelete ? "não confirma falha" : "limpa cookies e revoga"}`, async () => {
    const account = await provisioned();
    await observer.client.query(
      "UPDATE session SET updated_at=now()-interval '2 days', expires_at=now()+interval '1 day' WHERE user_id=$1",
      [account.id],
    );
    if (failDelete)
      await observer.client.query(`
      CREATE FUNCTION worker_reject_logout_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'falha sintética de logout'; END; $$;
      CREATE TRIGGER worker_reject_logout_delete BEFORE DELETE ON session
      FOR EACH ROW EXECUTE FUNCTION worker_reject_logout_delete()`);
    try {
      const response = await send("/api/auth/sign-out", {}, account.cookie);
      assert.equal(response.status, failDelete ? 503 : 200);
      assert.equal(response.headers.get("ratelimit-limit"), "30");
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal(response.headers.get("referrer-policy"), "no-referrer");
      const cookieHeaders = response.headers.getSetCookie();
      if (failDelete) assert.equal(cookieHeaders.length, 0);
      else {
        for (const name of ["session_token", "session_data", "dont_remember"])
          assert.ok(
            cookieHeaders.some((value) =>
              value.startsWith(`__Secure-better-auth.${name}=;`),
            ),
            `Limpar ${name}`,
          );
        assert.ok(
          cookieHeaders.every(
            (value) =>
              /^[^=]+=;/.test(value) &&
              /(?:^|;\s*)Max-Age=0(?:;|$)/i.test(value),
          ),
          "Nenhum cookie positivo de renovação no logout",
        );
      }
      assert.equal(
        (
          await observer.client.query(
            "SELECT id FROM session WHERE user_id=$1",
            [account.id],
          )
        ).rowCount,
        failDelete ? 1 : 0,
      );
      if (!failDelete) {
        assert.equal(
          (
            await observer.client.query(
              "SELECT session_id FROM tenant_sessions WHERE active_tenant_id=$1",
              [account.organizationId],
            )
          ).rowCount,
          0,
        );
        assert.equal(
          (await send("/api/organizations", undefined, account.cookie)).status,
          401,
        );
      }
    } finally {
      if (failDelete)
        await observer.client.query(
          "DROP TRIGGER worker_reject_logout_delete ON session; DROP FUNCTION worker_reject_logout_delete()",
        );
    }
  });

test("workerd: HEAD usa leitura de GET, preserva corpo vazio e não contorna quota", async () => {
  const account = await ready();
  const digest = createHmac(
    "sha256",
    "synthetic-only-secret-with-more-than-32-characters",
  )
    .update(`user:${account.id}`)
    .digest("hex");
  const start = Math.floor(Date.now() / 60_000) * 60_000;
  const keys = [start, start + 60_000].map(
    (window) => `v2:read:${digest}:${window}`,
  );
  const ip = { "cf-connecting-ip": "192.0.2.214" };
  const head = (cookie: string) =>
    mf.dispatchFetch(`${workerOrigin}/api/organizations`, {
      method: "HEAD",
      headers: { origin: workerOrigin, cookie, ...ip },
    });
  try {
    const allowed = await head(account.cookie);
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("ratelimit-limit"), "300");
    assert.equal(allowed.headers.get("ratelimit-remaining"), "299");
    assert.equal(await allowed.text(), "");
    for (let i = 0; i < keys.length; i++)
      await observer.client.query(
        "INSERT INTO abuse_counters(key,count,expires_at) VALUES($1,300,$2) ON CONFLICT(key) DO UPDATE SET count=300",
        [keys[i], new Date(start + (i + 1) * 60_000)],
      );
    for (const response of [
      await send("/api/organizations", undefined, account.cookie, ip),
      await head(account.cookie),
    ]) {
      assert.equal(response.status, 429);
      assert.equal(response.headers.get("ratelimit-limit"), "300");
      assert.ok(Number(response.headers.get("retry-after")) > 0);
    }
    const anonymous = await head("");
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.headers.get("ratelimit-limit"), "60");
    assert.equal(await anonymous.text(), "");
  } finally {
    await observer.client.query(
      "DELETE FROM abuse_counters WHERE key=ANY($1::text[])",
      [keys],
    );
  }
});

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
    assert.equal((await runtime.send("/api/onboarding")).status, 503);
    const tables = await empty.client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public'",
    );
    assert.equal(tables.rows[0]!.count, 0);
  } finally {
    await runtime.mf.dispose();
    await empty.client.end();
  }
});

test("workerd: onboarding público, dois e-mails, prontidão, cookies e callbacks nativos", async () => {
  const count = sent.length;
  assert.equal(
    (await send("/api/onboarding/email", { email: "not-allowed@example.test" }))
      .status,
    200,
  );
  assert.equal(sent.length, count + 1);
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
    // Reserva duas das cinco tentativas para conflito e vínculo revogado abaixo.
    Array.from({ length: 3 }, () =>
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

test("workerd público: limite persiste entre invocações, ignora X-Forwarded-For e mantém erro em português", async () => {
  const ip = "198.51.100.240";
  const responses = [];
  for (let index = 0; index < 6; index++) {
    responses.push(
      await send("/api/onboarding/email", { email: email() }, "", {
        "cf-connecting-ip": ip,
        "x-forwarded-for": `203.0.113.${index}`,
      }),
    );
  }
  assert.deepEqual(
    responses.map((response) => response.status),
    [200, 200, 200, 200, 200, 429],
  );
  const denied = responses.at(-1)!;
  assert.ok(Number(denied.headers.get("retry-after")) > 0);
  assert.equal((await denied.json()).erro, "LIMITE_DE_SOLICITACOES");
  const counters = await observer.client.query(
    "SELECT key FROM abuse_counters",
  );
  assert.ok(!JSON.stringify(counters.rows).includes(ip));
  await observer.client.query(
    "ALTER TABLE abuse_counters RENAME TO worker_abuse_unavailable",
  );
  try {
    const count = sent.length;
    assert.equal(
      (await send("/api/onboarding/email", { email: email() })).status,
      503,
    );
    assert.equal(sent.length, count);
  } finally {
    await observer.client.query(
      "ALTER TABLE worker_abuse_unavailable RENAME TO abuse_counters",
    );
  }
});

test("workerd público: recuperação de senha compartilha limite de e-mails; login limita tentativas sem enumerar contas", async () => {
  const account = await verified();
  const headers = { "cf-connecting-ip": "198.51.100.241" };
  const before = sent.filter(
    (message) => message.to[0] === account.email,
  ).length;
  for (let i = 0; i < 5; i++)
    assert.equal(
      (
        await send(
          "/api/onboarding/password-email",
          {},
          account.cookie,
          headers,
        )
      ).status,
      200,
    );
  assert.equal(
    sent.filter((message) => message.to[0] === account.email).length - before,
    2,
  );
  assert.equal(
    (await send("/api/onboarding/password-email", {}, account.cookie, headers))
      .status,
    429,
  );
  assert.equal(
    (await send("/api/onboarding/email", { email: email() }, "", headers))
      .status,
    429,
  );
  const loginHeaders = { "cf-connecting-ip": "198.51.100.242" };
  const bodies = [];
  let reset: string | null = null;
  let attempts = 0;
  let limited = false;
  // Janela fixa pode virar durante scrypt. Conta pelo reset real, não pelo relógio do teste.
  for (let i = 0; i < 22; i++) {
    const response = await send(
      "/api/auth/sign-in/email",
      { email: i % 2 ? account.email : email(), password: "synthetic-wrong" },
      "",
      loginHeaders,
    );
    const currentReset = response.headers.get("ratelimit-reset");
    assert.ok(currentReset);
    attempts = currentReset === reset ? attempts + 1 : 1;
    reset = currentReset;
    if (attempts > 10) {
      assert.equal(response.status, 429);
      limited = true;
      break;
    }
    assert.equal(response.status, 401);
    bodies.push(await response.text());
  }
  assert.ok(limited);
  assert.equal(new Set(bodies).size, 1);
});

test("workerd: gestão de membros permanece desabilitada mesmo com administrador pronto", async () => {
  const account = await provisioned();
  const context = await send("/api/context", undefined, account.cookie);
  assert.equal((await context.json()).membersEnabled, false);
  for (const path of [
    "/api/members",
    `/api/members/${crypto.randomUUID()}`,
    `/api/members/requests/${crypto.randomUUID()}`,
  ])
    assert.equal((await send(path, undefined, account.cookie)).status, 404);
  const response = await send(
    "/api/members",
    { name: "Pessoa sintética", status: "Ativo", churchId: account.churchId },
    account.cookie,
    { "Idempotency-Key": crypto.randomUUID() },
  );
  assert.equal(response.status, 404);
  assert.equal(
    (
      await observer.client.query(
        "SELECT count(*)::int AS count FROM members WHERE tenant_id=$1",
        [account.organizationId],
      )
    ).rows[0].count,
    0,
  );
});

test("workerd: schema anterior preserva onboarding e igrejas sem habilitar membros ou aplicar migration", async () => {
  await observer.client.query("CREATE DATABASE levi_worker_previous");
  const url = new URL(databaseUrl!);
  url.pathname = "/levi_worker_previous";
  const previous = await createPostgresDatabase(url.toString());
  let runtime: Awaited<ReturnType<typeof workerHarness>> | undefined;
  try {
    // Somente as migrations anteriores, no mesmo container sintético do harness.
    for (const path of [
      "migrations/0000_onboarding.sql",
      "migrations/0001_abuse-limits.sql",
    ])
      await previous.client.query(await readFile(path, "utf8"));
    runtime = await workerHarness(url.toString());
    const address = runtime.email();
    assert.equal(
      (await runtime.send("/api/onboarding/email", { email: address })).status,
      200,
    );
    const magic = runtime.link(address);
    const verified = await runtime.send(magic.pathname + magic.search);
    assert.equal(verified.status, 302);
    const cookie = cookieFrom(verified);
    assert.equal(
      (await runtime.send("/api/onboarding/password-email", {}, cookie)).status,
      200,
    );
    const reset = runtime.link(address);
    const callback = await runtime.send(reset.pathname + reset.search);
    assert.equal(callback.status, 302);
    const token = new URL(
      callback.headers.get("location")!,
      workerOrigin,
    ).searchParams.get("token");
    assert.ok(token);
    assert.equal(
      (
        await runtime.send(
          "/api/onboarding/password",
          { token, newPassword: password },
          cookie,
        )
      ).status,
      200,
    );
    const provision = await runtime.send("/api/organizations", body, cookie, {
      "Idempotency-Key": randomUUID(),
    });
    assert.equal(provision.status, 201);
    const { organizationId, churchId } = (await provision.json()) as {
      organizationId: string;
      churchId: string;
    };
    const context = await runtime.send("/api/context", undefined, cookie);
    assert.deepEqual(await context.json(), {
      organizationId,
      role: "admin",
      membersEnabled: false,
    });
    assert.equal(
      (await runtime.send("/api/churches", undefined, cookie)).status,
      200,
    );
    for (const path of [
      "/api/members",
      `/api/members/${randomUUID()}`,
      `/api/members/requests/${randomUUID()}`,
    ])
      assert.equal((await runtime.send(path, undefined, cookie)).status, 404);
    assert.equal(
      (
        await runtime.send(
          "/api/members",
          { name: "Pessoa sintética", churchId, status: "Ativo" },
          cookie,
          { "Idempotency-Key": randomUUID() },
        )
      ).status,
      404,
    );
    const html = await runtime.send("/membros");
    assert.equal(html.status, 200);
    assert.ok(!(await html.text()).includes(address));
    assert.equal(
      (await runtime.send("/api/auth/sign-out", {}, cookie)).status,
      200,
    );
    const login = await runtime.send("/api/auth/sign-in/email", {
      email: address,
      password,
    });
    assert.equal(login.status, 200);
    const loginCookie = cookieFrom(login);
    assert.equal(
      (await runtime.send("/api/tenant", { organizationId }, loginCookie))
        .status,
      200,
    );
    const churches = await runtime.send(
      "/api/churches",
      undefined,
      loginCookie,
    );
    assert.deepEqual(await churches.json(), {
      organizationId,
      churches: [
        {
          id: churchId,
          nome: body.churchName,
          address: null,
          phone: null,
          email: null,
        },
      ],
    });
    // Configuração malformada ou recorte de outra organização não toca as tabelas pendentes.
    for (const membersDevOrganizations of [
      "",
      organizationId + ",invalid",
      randomUUID(),
    ]) {
      const restricted = await workerHarness(url.toString(), {
        membersDevOrganizations,
      });
      try {
        const response = await restricted.send(
          "/api/context",
          undefined,
          loginCookie,
        );
        assert.equal(response.status, 200);
        assert.equal((await response.json()).membersEnabled, false);
        for (const path of [
          "/api/members",
          `/api/members/${randomUUID()}`,
          `/api/members/requests/${randomUUID()}`,
        ])
          assert.equal(
            (await restricted.send(path, undefined, loginCookie)).status,
            404,
          );
        assert.equal(
          (
            await restricted.send(
              "/api/members",
              { name: "Pessoa sintética", churchId, status: "Ativo" },
              loginCookie,
              { "Idempotency-Key": randomUUID() },
            )
          ).status,
          404,
        );
      } finally {
        await restricted.mf.dispose();
      }
    }
    const tables = await previous.client.query(
      "SELECT to_regclass('members') members, to_regclass('member_history') history, to_regclass('member_creation_requests') receipts",
    );
    assert.deepEqual(tables.rows[0], {
      members: null,
      history: null,
      receipts: null,
    });
  } finally {
    await runtime?.mf.dispose();
    await previous.client.end();
  }
});

test("workerd: recorte DEV usa tenant administrativo atual em capacidade, cadastro, consultas e recibos", async () => {
  const allowed = await provisioned();
  const denied = await provisioned();
  const runtime = await workerHarness(databaseUrl!, {
    membersDevOrganizations: allowed.organizationId,
  });
  const routes = [
    "/api/members",
    `/api/members/${randomUUID()}`,
    `/api/members/requests/${randomUUID()}`,
  ];
  const input = {
    name: "Pessoa sintética do recorte",
    churchId: allowed.churchId,
    status: "Ativo",
  };
  const key = randomUUID();
  const headers = { "Idempotency-Key": key };
  try {
    for (const path of ["/api/context", ...routes])
      assert.equal((await runtime.send(path)).status, 401);
    assert.equal(
      (await runtime.send("/api/members", input, "", headers)).status,
      401,
    );
    for (const [account, enabled] of [
      [allowed, true],
      [denied, false],
    ] as const) {
      const context = await runtime.send(
        "/api/context",
        undefined,
        account.cookie,
      );
      assert.equal(context.status, 200);
      assert.deepEqual(await context.json(), {
        organizationId: account.organizationId,
        role: "admin",
        membersEnabled: enabled,
      });
      assert.equal(
        (await runtime.send("/api/churches", undefined, account.cookie)).status,
        200,
      );
    }
    const created = await runtime.send(
      "/api/members",
      input,
      allowed.cookie,
      headers,
    );
    assert.equal(created.status, 201);
    const result = (await created.json()) as {
      organizationId: string;
      memberId: string;
    };
    assert.equal(result.organizationId, allowed.organizationId);
    const replay = await runtime.send(
      "/api/members",
      input,
      allowed.cookie,
      headers,
    );
    assert.equal(replay.status, 201);
    assert.deepEqual(await replay.json(), result);
    const receipt = await runtime.send(
      `/api/members/requests/${key}`,
      undefined,
      allowed.cookie,
    );
    assert.equal(receipt.status, 200);
    assert.deepEqual(await receipt.json(), result);
    const list = await runtime.send(
      "/api/members?name=recorte&status=Ativo&pageSize=1",
      undefined,
      allowed.cookie,
    );
    assert.equal(list.status, 200);
    assert.deepEqual(
      (await list.json()).members.map((member: { id: string }) => member.id),
      [result.memberId],
    );
    const detail = await runtime.send(
      `/api/members/${result.memberId}`,
      undefined,
      allowed.cookie,
    );
    assert.equal(detail.status, 200);
    assert.equal((await detail.json()).member.name, input.name);
    assert.equal(
      (
        await runtime.send(
          "/api/members",
          { ...input, churchId: denied.churchId },
          allowed.cookie,
          { "Idempotency-Key": randomUUID() },
        )
      ).status,
      404,
    );
    const allRoutes = [
      ...routes,
      `/api/members/${result.memberId}`,
      `/api/members/requests/${key}`,
    ];
    const forged = {
      "x-organization-id": allowed.organizationId,
      LEVI_MEMBERS_DEV_ORGANIZATIONS: allowed.organizationId,
      "x-members-enabled": "true",
    };
    for (const path of allRoutes) {
      const response = await runtime.send(
        path,
        undefined,
        denied.cookie,
        forged,
      );
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), {
        erro: "NAO_ENCONTRADO",
        mensagem: "Recurso não encontrado.",
      });
    }
    assert.equal(
      (
        await runtime.send(
          `/api/members?organizationId=${allowed.organizationId}&membersEnabled=true`,
          undefined,
          denied.cookie,
          forged,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await runtime.send(
          "/api/members",
          {
            ...input,
            organizationId: allowed.organizationId,
            membersEnabled: true,
          },
          denied.cookie,
          { ...forged, ...headers },
        )
      ).status,
      404,
    );
    // Mesmo usuário pode ter vínculo legítimo nas duas organizações: a sessão ativa decide.
    await observer.client.query(
      "INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",
      [denied.organizationId, allowed.id],
    );
    assert.equal(
      (
        await runtime.send(
          "/api/tenant",
          { organizationId: denied.organizationId },
          allowed.cookie,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await (
          await runtime.send("/api/context", undefined, allowed.cookie)
        ).json()
      ).membersEnabled,
      false,
    );
    for (const path of allRoutes)
      assert.equal(
        (await runtime.send(path, undefined, allowed.cookie)).status,
        404,
      );
    assert.equal(
      (await runtime.send("/api/members", input, allowed.cookie, headers))
        .status,
      404,
    );
    assert.equal(
      (
        await runtime.send(
          "/api/tenant",
          { organizationId: allowed.organizationId },
          allowed.cookie,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await (
          await runtime.send("/api/context", undefined, allowed.cookie)
        ).json()
      ).membersEnabled,
      true,
    );
    // Uma URL de requisição alternativa também não pode aproveitar o binding DEV.
    assert.equal(
      (
        await (
          await runtime.send(
            "https://other.example.test/api/context",
            undefined,
            allowed.cookie,
          )
        ).json()
      ).membersEnabled,
      false,
    );
    for (const path of allRoutes)
      assert.equal(
        (
          await runtime.send(
            `https://other.example.test${path}`,
            undefined,
            allowed.cookie,
          )
        ).status,
        404,
      );
    for (const revoke of [
      "UPDATE tenant_memberships SET role='unknown-role' WHERE tenant_id=$1 AND user_id=$2",
      "DELETE FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2",
    ]) {
      await observer.client.query(revoke, [allowed.organizationId, allowed.id]);
      for (const path of ["/api/context", ...allRoutes])
        assert.equal(
          (await runtime.send(path, undefined, allowed.cookie)).status,
          403,
        );
      assert.equal(
        (await runtime.send("/api/members", input, allowed.cookie, headers))
          .status,
        403,
      );
    }
    const counts = await observer.client.query(
      "SELECT tenant_id, count(*)::int n FROM members WHERE tenant_id IN ($1,$2) GROUP BY tenant_id",
      [allowed.organizationId, denied.organizationId],
    );
    assert.deepEqual(counts.rows, [
      { tenant_id: allowed.organizationId, n: 1 },
    ]);
  } finally {
    await runtime.mf.dispose();
  }
});

test("workerd: origem configurada fora de DEV recusa recorte válido sem afetar igrejas", async () => {
  const account = await provisioned();
  const runtime = await workerHarness(databaseUrl!, {
    membersDevOrganizations: account.organizationId,
    publicOrigin: "https://other.example.test",
  });
  try {
    const context = await runtime.send(
      "/api/context",
      undefined,
      account.cookie,
    );
    assert.equal(context.status, 200);
    assert.equal((await context.json()).membersEnabled, false);
    assert.equal(
      (await runtime.send("/api/churches", undefined, account.cookie)).status,
      200,
    );
    for (const path of [
      "/api/members",
      `/api/members/${randomUUID()}`,
      `/api/members/requests/${randomUUID()}`,
    ])
      assert.equal(
        (await runtime.send(path, undefined, account.cookie)).status,
        404,
      );
    assert.equal(
      (
        await runtime.send(
          "/api/members",
          {
            name: "Pessoa sintética",
            churchId: account.churchId,
            status: "Ativo",
          },
          account.cookie,
          { "Idempotency-Key": randomUUID() },
        )
      ).status,
      404,
    );
  } finally {
    await runtime.mf.dispose();
  }
});
