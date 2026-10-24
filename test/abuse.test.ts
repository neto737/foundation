import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import type { FoundationSession } from "@t00ls-dev/auth";
import { createAbuseProtection } from "../src/abuse.js";
import { authRequest, type Database } from "../src/auth.js";

// Identidades de servidor sintéticas. Autenticidade/revogação têm prova na integração.
const identity = (id: string, session = "session-a") =>
  ({ user: { id }, session: { id: session } }) as FoundationSession;
function fixture() {
  let timestamp = 1_800_000_000_000;
  let current: FoundationSession | null = null;
  let statements = 0;
  let cleanups = 0;
  let resolutions = 0;
  const counts = new Map<string, number>();
  const client = {
    async query(sql: string, params: unknown[]) {
      statements++;
      if (sql.includes("WITH expired")) cleanups++;
      const key = String(params[0]);
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return { rows: [{ count }] };
    },
  } as unknown as Pick<Database["client"], "query">;
  const protection = createAbuseProtection(
    client,
    "synthetic-secret",
    () => timestamp,
  );
  const app = new Hono();
  app.use("*", protection.beforeSession);
  app.use("*", (c, next) => {
    resolutions++;
    return protection.middleware(current)(c, next);
  });
  app.all("*", () => Response.json({ ok: true }));
  return {
    counts,
    protection,
    get statements() {
      return statements;
    },
    get cleanups() {
      return cleanups;
    },
    get resolutions() {
      return resolutions;
    },
    setIdentity(value: FoundationSession | null) {
      current = value;
    },
    advance(ms: number) {
      timestamp += ms;
    },
    send(
      path = "/api/onboarding",
      method = "GET",
      ip = "192.0.2.1",
      extra: Record<string, string> = {},
    ) {
      return app.request(path, {
        method,
        headers: { "cf-connecting-ip": ip, ...extra },
      });
    },
  };
}

for (const [path, method, limit, windowMs] of [
  ["/api/organizations", "GET", 300, 60_000],
  ["/api/members", "POST", 60, 60_000],
  ["/api/tenant", "POST", 30, 60_000],
  ["/api/organizations", "POST", 5, 900_000],
  ["/api/onboarding/password", "POST", 5, 900_000],
  ["/api/auth/sign-out", "POST", 30, 60_000],
] as const) {
  test(`categoria ${method} ${path}: limite, janela e identidade compartilhada entre sessões/IPs`, async () => {
    const f = fixture();
    for (let i = 0; i < limit; i++) {
      f.setIdentity(identity("user-a", `session-${i % 2}`));
      const response = await f.send(path, method, `192.0.2.${1 + (i % 2)}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("ratelimit-limit"), String(limit));
    }
    const denied = await f.send(path, method);
    assert.equal(denied.status, 429);
    assert.equal(denied.headers.get("retry-after"), String(windowMs / 1_000));
    assert.equal((await denied.json()).erro, "LIMITE_DE_SOLICITACOES");
    f.setIdentity(identity("user-b"));
    assert.equal((await f.send(path, method)).status, 200);
    f.setIdentity(identity("user-a"));
    f.advance(windowMs - 1);
    assert.equal((await f.send(path, method)).status, 429);
    f.advance(1);
    assert.equal((await f.send(path, method)).status, 200);
  });
}

test("leitura, escrita, seleção, provisionamento, senha e logout são independentes", async () => {
  const f = fixture();
  f.setIdentity(identity("user-a"));
  for (let i = 0; i < 300; i++) assert.equal((await f.send()).status, 200);
  assert.equal((await f.send("/api/context")).status, 429);
  for (const path of [
    "/api/members",
    "/api/tenant",
    "/api/organizations",
    "/api/onboarding/password",
    "/api/auth/sign-out",
  ])
    assert.equal((await f.send(path, "POST")).status, 200);
  assert.equal(
    (await f.send("/api/members/synthetic-id", "PATCH")).status,
    200,
  );
});

test("vinte contas no mesmo IP navegam; leitura aceita custa dois statements", async () => {
  const f = fixture();
  for (let user = 0; user < 20; user++) {
    f.setIdentity(identity(`user-${user}`));
    for (let i = 0; i < 30; i++) assert.equal((await f.send()).status, 200);
  }
  assert.equal(f.statements, 1_200);
  assert.equal(f.cleanups, 600);
});

test("sem identidade validada, headers/cookie/tenant falsificados não concedem quota de usuário", async () => {
  const f = fixture();
  for (let i = 0; i < 60; i++)
    assert.equal(
      (
        await f.send("/api/organizations", "GET", "192.0.2.1", {
          cookie: `better-auth.session_token=fake-${i}`,
          "x-user-id": `fake-${i}`,
          "x-organization-id": `tenant-${i}`,
          "x-forwarded-for": `198.51.100.${i}`,
        })
      ).status,
      200,
    );
  assert.equal((await f.send()).status, 429);
  assert.equal(
    (await f.send("/api/auth/magic-link/verify?token=fake")).status,
    200,
  );
  for (let i = 1; i < 60; i++)
    assert.equal((await f.send("/api/auth/reset-password/fake")).status, 200);
  assert.equal(
    (await f.send("/api/auth/magic-link/verify?token=another")).status,
    429,
  );
  assert.equal(
    [...f.counts.keys()].some((key) => key.includes("v2:read")),
    false,
  );
  f.advance(60_000);
  assert.equal((await f.send()).status, 200);
});

test("guarda ampla nega antes de resolver sessão e permanece separada dos limites funcionais", async () => {
  const f = fixture();
  for (let i = 0; i < 1_200; i++) {
    f.setIdentity(identity(`user-${i}`));
    assert.equal((await f.send()).status, 200);
  }
  const blocked = await f.send();
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get("ratelimit-limit"), "1200");
  assert.equal(f.resolutions, 1_200);
  assert.equal(f.statements, 2_401);
});

test("pedidos de e-mail e login conservam quotas e buckets anteriores mesmo com sessão", async () => {
  const f = fixture();
  f.setIdentity(identity("user-a"));
  for (let i = 0; i < 5; i++)
    assert.equal(
      (
        await f.send(
          i % 2 ? "/api/onboarding/email" : "/api/onboarding/password-email",
          "POST",
        )
      ).status,
      200,
    );
  assert.equal((await f.send("/api/onboarding/email", "POST")).status, 429);
  for (let i = 0; i < 10; i++)
    assert.equal((await f.send("/api/auth/sign-in/email", "POST")).status, 200);
  assert.equal((await f.send("/api/auth/sign-in/email", "POST")).status, 429);
  assert.equal((await f.send()).status, 200);
  assert.ok([...f.counts.keys()].some((key) => key.startsWith("email:")));
  assert.ok([...f.counts.keys()].some((key) => key.startsWith("login:")));
});

test("429 nativo de auth é sanitizado, normaliza X-Retry-After e preserva cookies/headers", async () => {
  const result = await authRequest(
    {
      handler: async () =>
        new Response("private-upstream", {
          status: 429,
          headers: [
            ["X-Retry-After", "12"],
            ["Cache-Control", "private, no-store"],
            ["Set-Cookie", "synthetic-a=1; HttpOnly"],
            ["Set-Cookie", "synthetic-b=2; HttpOnly"],
          ],
        }),
      resolveSession: async () => {
        throw new Error("Não utilizado");
      },
    },
    {
      baseURL: "https://example.test",
      databaseUrl: "unused",
      secret: "synthetic-only",
      email: { send: async () => {} },
    },
    new Request("https://example.test/api/auth/sign-in/email"),
    "/sign-in/email",
    {},
  );
  assert.equal(result.status, 429);
  assert.equal(result.headers.get("retry-after"), "12");
  assert.equal(result.headers.get("x-retry-after"), "12");
  assert.equal(result.headers.getSetCookie().length, 2);
  assert.equal(result.headers.get("cache-control"), "private, no-store");
  assert.ok(!(await result.text()).includes("private-upstream"));
});
