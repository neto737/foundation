import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { api, ApiError } from "../web/src/api.js";
import {
  takeLinkReturn,
  provisionKey,
  clearProvisionKey,
} from "../web/src/session.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
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
