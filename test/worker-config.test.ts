import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { workerOptions, type WorkerEnv } from "../src/worker-config.js";
import { devMigrationTarget } from "../tools/dev-migration-config.js";
import { createApp } from "../src/app.js";
import worker from "../src/worker.js";

const env: WorkerEnv = {
  ASSETS: { fetch: async () => new Response("synthetic") },
  HYPERDRIVE: { connectionString: "postgresql://synthetic-only" },
  LEVI_PUBLIC_ORIGIN: "https://levi.t00ls.dev",
  LEVI_AUTH_SECRET: "synthetic-only-secret-with-more-than-32-characters",
  RESEND_API_KEY: "synthetic-only-not-a-real-key",
  LEVI_EMAIL_FROM: "Levi <levi@example.test>",
};
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("política final de headers preserva no-referrer também no runtime Node", async () => {
  const app = createApp(workerOptions(env));
  const response = await app.request("https://levi.t00ls.dev/unknown");
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.ok(response.headers.has("content-security-policy"));
});

test("Worker sem secrets/configuração completa responde 503 sanitizado, sem tentar a API", async () => {
  const response = await worker.fetch(new Request("https://levi.t00ls.dev/"), {
    ...env,
    RESEND_API_KEY: "",
  });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.ok(!(await response.text()).includes(env.LEVI_AUTH_SECRET));
});

test("DEV compõe somente origem HTTPS fixa e callbacks seguros", () => {
  assert.equal(workerOptions(env).membersEnabled, undefined);
  assert.equal(workerOptions(env).baseURL, "https://levi.t00ls.dev");
  assert.equal(workerOptions(env).onboardingReturnPath, "/onboarding");
  for (const changes of [
    { LEVI_PUBLIC_ORIGIN: "http://levi.t00ls.dev" },
    { LEVI_PUBLIC_ORIGIN: "https://levi.t00ls.dev/path" },
    { LEVI_AUTH_SECRET: "" },
    { RESEND_API_KEY: "" },
    { LEVI_EMAIL_FROM: "" },
  ])
    assert.throws(() => workerOptions({ ...env, ...changes }));
});

test("adapter Resend publicado aceita destinatários públicos sem allowlist", async () => {
  const messages: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.resend.com/emails");
    messages.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Response.json({ id: "synthetic" });
  };
  const { email } = workerOptions(env);
  await email.send({
    to: "other@example.test",
    subject: "synthetic",
    text: "synthetic",
  });
  assert.equal(messages.length, 1);
  await email.send({
    to: "TESTER@example.test",
    subject: "synthetic",
    text: "synthetic",
  });
  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.from, env.LEVI_EMAIL_FROM);
});

test("rejeição do provider não é declarada como envio confirmado", async () => {
  globalThis.fetch = async () => Response.json({}, { status: 429 });
  await assert.rejects(
    workerOptions(env).email.send({
      to: "tester@example.test",
      subject: "synthetic",
      text: "synthetic",
    }),
  );
});

test("guarda de migrations aceita somente alvo Neon DEV direto e explícito, sem conectar", () => {
  const host = "ep-synthetic-only.us-east-2.aws.neon.tech";
  const valid: NodeJS.ProcessEnv = {
    LEVI_DEV_DATABASE_URL: `postgresql://levi_dev_migrator:synthetic-only@${host}/levi_dev?sslmode=verify-full`,
    LEVI_DEV_DATABASE_HOST: host,
    LEVI_DEV_DATABASE_NAME: "levi_dev",
    LEVI_DEV_MIGRATION_CONFIRMATION: `APLICAR:${host}/levi_dev`,
  };
  assert.equal(devMigrationTarget(valid), valid.LEVI_DEV_DATABASE_URL);
  for (const changes of [
    { LEVI_DEV_MIGRATION_CONFIRMATION: "" },
    { LEVI_DEV_DATABASE_HOST: "ep-another.us-east-2.aws.neon.tech" },
    { LEVI_DEV_DATABASE_NAME: "levi_prod" },
    {
      LEVI_DEV_DATABASE_URL: valid.LEVI_DEV_DATABASE_URL!.replace(
        "verify-full",
        "require",
      ),
    },
    {
      LEVI_DEV_DATABASE_URL: valid.LEVI_DEV_DATABASE_URL!.replace(
        "levi_dev_migrator",
        "owner",
      ),
    },
    { LEVI_DEV_DATABASE_URL: valid.LEVI_DEV_DATABASE_URL! + "&options=unsafe" },
    {
      LEVI_DEV_DATABASE_URL: valid.LEVI_DEV_DATABASE_URL!.replace(
        host,
        "127.0.0.1",
      ),
    },
    {
      LEVI_DEV_DATABASE_URL: valid.LEVI_DEV_DATABASE_URL!.replace(
        "ep-synthetic-only.",
        "ep-synthetic-only-pooler.",
      ),
    },
  ])
    assert.throws(
      () => devMigrationTarget({ ...valid, ...changes }),
      /Migração DEV recusada/,
    );
  assert.throws(() => devMigrationTarget({}));
});
