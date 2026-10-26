import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { api, ApiError } from "../web/src/api.js";
import {
  takeLinkReturn,
  provisionKey,
  clearProvisionKey,
} from "../web/src/session.js";

const originalFetch = globalThis.fetch;
afterEach(async () => {
  globalThis.fetch = async () => Response.json({ ok: true });
  await api.logout(); // Limpa a espera transitória ao encerrar a identidade.
  globalThis.fetch = originalFetch;
});

test("retorno remove token, erro e fragmento da URL sem persistir dados sensíveis", () => {
  const replaced: unknown[][] = [];
  const result = takeLinkReturn(
    {
      href: "http://localhost/onboarding?token=synthetic-reset&error=INVALID_TOKEN#error",
      pathname: "/onboarding",
    },
    {
      replaceState: (...args) => {
        replaced.push(args);
      },
    },
  );
  assert.deepEqual(result, { token: "synthetic-reset", invalid: true });
  assert.deepEqual(replaced, [[null, "", "/onboarding"]]);
});

test("idempotência persiste somente a chave opaca e permite recuperação após refresh", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const key = provisionKey(storage, () => "synthetic-request-key");
  assert.equal(
    provisionKey(storage, () => "never-used-value"),
    key,
  );
  assert.deepEqual([...values], [["levi.onboarding.request", key]]);
  clearProvisionKey(storage);
  assert.equal(values.size, 0);
});

test("storage indisponível não exige persistir sessão ou credenciais", () => {
  assert.equal(
    provisionKey(undefined, () => "synthetic-request-key"),
    "synthetic-request-key",
  );
});

test("cliente usa caminhos relativos, cookies de mesma origem e contrato idempotente", async () => {
  const calls: Array<{ path: string; init: RequestInit | undefined }> = [];
  globalThis.fetch = async (path, init) => {
    calls.push({ path: String(path), init });
    return Response.json({
      organizationId: "11111111-1111-4111-8111-111111111111",
      churchId: "22222222-2222-4222-8222-222222222222",
    });
  };
  await api.provision(
    { organizationName: "Organização", churchName: "Igreja" },
    "synthetic-request-key",
  );
  assert.equal(calls[0]?.path, "/api/organizations");
  assert.equal(calls[0]?.init?.credentials, "same-origin");
  assert.equal(
    new Headers(calls[0]?.init?.headers).get("Idempotency-Key"),
    "synthetic-request-key",
  );
  assert.equal(
    calls[0]?.init?.body,
    JSON.stringify({ organizationName: "Organização", churchName: "Igreja" }),
  );
});

for (const status of [401, 403, 409, 503])
  test(`cliente preserva status ${status} para recuperação sem tratar como sucesso`, async () => {
    globalThis.fetch = async () =>
      Response.json(
        { erro: "SINTETICO", mensagem: "Solicitação não concluída." },
        { status },
      );
    await assert.rejects(
      api.stage(),
      (error: unknown) => error instanceof ApiError && error.status === status,
    );
  });

test("erro de rede não revela URL ou erro original", async () => {
  globalThis.fetch = async () => {
    throw new Error("sensitive-original-message");
  };
  await assert.rejects(
    api.stage(),
    (error: unknown) =>
      error instanceof ApiError &&
      error.status === 0 &&
      !error.message.includes("sensitive-original-message"),
  );
});

test("contratos inesperados não abrem uma etapa ou organização", async () => {
  globalThis.fetch = async () =>
    Response.json({
      etapa: "unknown-stage",
      organizations: [{ id: "client-id", nome: "Nome" }],
    });
  await assert.rejects(
    api.stage(),
    (error: unknown) => error instanceof ApiError && error.status === 502,
  );
  await assert.rejects(
    api.organizations(),
    (error: unknown) => error instanceof ApiError && error.status === 502,
  );
});

test("listagem de igrejas exige o identificador do contexto consultado", async () => {
  const organizationId = "11111111-1111-4111-8111-111111111111";
  globalThis.fetch = async () =>
    Response.json({ organizationId, churches: [] });
  assert.deepEqual(await api.churches(), { organizationId, churches: [] });
  globalThis.fetch = async () => Response.json({ churches: [] });
  await assert.rejects(
    api.churches(),
    (error: unknown) => error instanceof ApiError && error.status === 502,
  );
});

for (const [headers, seconds] of [
  [{ "Retry-After": "5" }, 5],
  [{ "X-Retry-After": "7" }, 7],
  [{ "Retry-After": "Mon, 18 Jan 2027 08:00:09 GMT" }, 9],
  [{ "Retry-After": "invalid", "X-Retry-After": "8" }, 8],
  [{ "Retry-After": "0" }, 1],
  [{ "Retry-After": "-1" }, 60],
  [{}, 60],
] as const) {
  test(`429 interpreta espera ${JSON.stringify(headers)} e não repete a leitura bloqueada`, async (t) => {
    let now = Date.parse("2027-01-18T08:00:00Z");
    t.mock.method(Date, "now", () => now);
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return calls === 1
        ? new Response("untrusted provider body", { status: 429, headers })
        : Response.json({ etapa: "email" });
    };
    await assert.rejects(api.stage(), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 429);
      assert.equal(error.code, "LIMITE_DE_SOLICITACOES");
      assert.equal(error.retryAt, now + seconds * 1_000);
      assert.ok(
        error.message.includes(
          `${seconds} ${seconds === 1 ? "segundo" : "segundos"}`,
        ),
      );
      assert.ok(!error.message.includes("untrusted"));
      return true;
    });
    await assert.rejects(
      api.stage(),
      (error: unknown) => error instanceof ApiError && error.status === 429,
    );
    assert.equal(calls, 1);
    now += seconds * 1_000;
    assert.equal(await api.stage(), "email");
    assert.equal(calls, 2);
  });
}

test("espera de leitura permite seleção e logout, sem retry de autenticação/envio/escrita", async () => {
  const calls: string[] = [];
  globalThis.fetch = async (path) => {
    const url = String(path);
    calls.push(url);
    return url === "/api/tenant" || url === "/api/auth/sign-out"
      ? Response.json({ ok: true })
      : Response.json({}, { status: 429, headers: { "Retry-After": "20" } });
  };
  await assert.rejects(api.stage());
  await api.select("11111111-1111-4111-8111-111111111111");
  for (const task of [
    () => api.email("synthetic@example.test"),
    () => api.login("synthetic@example.test", "synthetic-password"),
    () =>
      api.provision(
        { organizationName: "Sintética", churchName: "Sintética" },
        "synthetic-request-key",
      ),
  ]) {
    await assert.rejects(task());
    await assert.rejects(task());
  }
  assert.deepEqual(calls, [
    "/api/onboarding",
    "/api/tenant",
    "/api/onboarding/email",
    "/api/auth/sign-in/email",
    "/api/organizations",
  ]);
  await api.logout();
  assert.equal(calls.at(-1), "/api/auth/sign-out");
});

test("login confirmado encerra espera anônima sem mascarar a nova consulta autenticada", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return calls === 1
      ? Response.json({}, { status: 429, headers: { "Retry-After": "60" } })
      : Response.json({ etapa: "concluido", ok: true });
  };
  await assert.rejects(api.stage());
  await api.login("synthetic@example.test", "synthetic-password");
  assert.equal(await api.stage(), "concluido");
  assert.equal(calls, 3);
});

test("429 atrasado anterior ao login não instala espera na identidade nova", async () => {
  let finish!: (response: Response) => void;
  let first = true;
  globalThis.fetch = async () => {
    if (first) {
      first = false;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    }
    return Response.json({ etapa: "concluido", ok: true });
  };
  const pending = api.stage();
  const rejection = assert.rejects(
    pending,
    (error: unknown) => error instanceof ApiError && error.status === 429,
  );
  await api.login("synthetic@example.test", "synthetic-password");
  finish(Response.json({}, { status: 429, headers: { "Retry-After": "60" } }));
  await rejection;
  assert.equal(await api.stage(), "concluido");
});

test("cliente administrativo valida catálogo e não aceita políticas ou identidades inesperadas", async () => {
  const { adminApi } = await import("../web/src/admin-api.js");
  const signal = new AbortController().signal;
  for (const features of [
    [{ key: "arbitrary", policy: "all", version: 1, organizationIds: [] }],
    [{ key: "members", policy: "selected", version: 1, organizationIds: [] }],
    [
      {
        key: "members",
        policy: "disabled",
        version: 1,
        organizationIds: ["11111111-1111-4111-8111-111111111111"],
      },
    ],
    [{ key: "members", policy: "all", version: -1, organizationIds: [] }],
  ]) {
    globalThis.fetch = async () => Response.json({ features });
    await assert.rejects(
      adminApi.features(signal),
      (error: unknown) => error instanceof ApiError && error.status === 502,
    );
  }
  globalThis.fetch = async () =>
    Response.json({ userId: "email@example.test", sessionId: "browser-value" });
  await assert.rejects(
    adminApi.session(signal),
    (error: unknown) => error instanceof ApiError && error.status === 502,
  );
});

test("cliente administrativo usa corpo de busca e mantém versões, confirmação e erros de recência", async () => {
  const { adminApi } = await import("../web/src/admin-api.js");
  const signal = new AbortController().signal;
  const calls: Array<{ path: string; init: RequestInit | undefined }> = [];
  globalThis.fetch = async (path, init) => {
    calls.push({ path: String(path), init });
    return Response.json({ account: null });
  };
  assert.equal(await adminApi.find("synthetic@example.test", signal), null);
  assert.equal(calls[0]?.path, "/api/admin/accounts/find");
  assert.equal(
    calls[0]?.init?.body,
    JSON.stringify({ email: "synthetic@example.test" }),
  );
  await adminApi.update(
    { key: "members", policy: "all", version: 3, organizationIds: [] },
    signal,
  );
  assert.equal(calls[1]?.init?.method, "PUT");
  assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)), {
    expectedVersion: 3,
    policy: { kind: "all" },
    confirmAll: true,
  });
  globalThis.fetch = async () =>
    Response.json(
      { erro: "REAUTENTICACAO_NECESSARIA", mensagem: "Entre novamente." },
      { status: 403 },
    );
  await assert.rejects(
    adminApi.change(
      { userId: "11111111-1111-4111-8111-111111111111", version: 1 },
      true,
      signal,
    ),
    (error: unknown) =>
      error instanceof ApiError && error.code === "REAUTENTICACAO_NECESSARIA",
  );
});
