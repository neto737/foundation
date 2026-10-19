import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import ts from "typescript";
import {
  deploySettings,
  verifyAccess,
  verifyHyperdrive,
  deploymentConfig,
} from "../tools/deploy-config.js";

const valid: NodeJS.ProcessEnv = {
  GITHUB_ACTIONS: "true",
  GITHUB_REPOSITORY: "t00ls-dev/levi",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REF: "refs/heads/main",
  LEVI_DEV_READY: "true",
  LEVI_DEPLOY_SHA: "a".repeat(40),
  GITHUB_SHA: "a".repeat(40),
  GITHUB_TOKEN: "synthetic-only",
  CLOUDFLARE_ACCOUNT_ID: "b".repeat(32),
  CLOUDFLARE_ZONE_ID: "d".repeat(32),
  CLOUDFLARE_API_TOKEN: "synthetic-only",
  CLOUDFLARE_READ_TOKEN: "synthetic-only",
  LEVI_HYPERDRIVE_ID: "c".repeat(32),
  LEVI_ACCESS_APP_ID: "12345678-1234-1234-1234-123456789abc",
  LEVI_DEV_DATABASE_HOST: "ep-synthetic-only.us-east-2.aws.neon.tech",
  LEVI_DEV_DATABASE_NAME: "levi_dev",
  LEVI_EMAIL_FROM: "Levi <levi@example.test>",
  LEVI_AUTH_SECRET: "synthetic-only-secret-with-more-than-32-characters",
  RESEND_API_KEY: "synthetic-only",
  LEVI_DEV_EMAIL_ALLOWLIST: '["tester@example.test"]',
};
const app = { type: "self_hosted", domain: "levi.t00ls.dev" };
const policy = {
  decision: "allow",
  include: [{ email: { email: "tester@example.test" } }],
};
const hyperdrive = {
  id: valid.LEVI_HYPERDRIVE_ID,
  name: "levi-dev",
  caching: { disabled: true },
  origin: {
    host: valid.LEVI_DEV_DATABASE_HOST,
    database: "levi_dev",
    user: "levi_dev_runtime",
    scheme: "postgres",
  },
};

test("deploy exige execução explícita da main e configuração completa, sem credenciais de migrations", () => {
  assert.equal(deploySettings(valid).sha, valid.GITHUB_SHA);
  for (const changes of [
    { GITHUB_ACTIONS: "false" },
    { GITHUB_REPOSITORY: "other/levi" },
    { GITHUB_EVENT_NAME: "pull_request" },
    { GITHUB_REF: "refs/heads/feature" },
    { LEVI_DEV_READY: "false" },
    { GITHUB_SHA: "b".repeat(40) },
    { LEVI_DEPLOY_SHA: "not-a-sha" },
    { CLOUDFLARE_API_TOKEN: "" },
    { CLOUDFLARE_ZONE_ID: "" },
    { CLOUDFLARE_READ_TOKEN: "" },
    { LEVI_HYPERDRIVE_ID: "0".repeat(32) },
    { LEVI_ACCESS_APP_ID: "" },
    { LEVI_DEV_DATABASE_NAME: "foundation" },
    {
      LEVI_DEV_DATABASE_HOST:
        "ep-synthetic-only-pooler.us-east-2.aws.neon.tech",
    },
    { LEVI_DEV_EMAIL_ALLOWLIST: '["*@example.test"]' },
    { LEVI_AUTH_SECRET: "" },
    { RESEND_API_KEY: "" },
  ])
    assert.throws(() => deploySettings({ ...valid, ...changes }));
});

test("Access aceita somente testadores exatos e a aplicação que protege todo o hostname", () => {
  verifyAccess(app, [policy], ["TESTER@example.test"]);
  verifyAccess(
    {
      type: "self_hosted",
      destinations: [{ type: "public", uri: "levi.t00ls.dev" }],
    },
    [policy],
    ["tester@example.test"],
  );
  for (const changes of [
    { type: "saas" },
    { domain: "levi.t00ls.dev/onboarding" },
    { domain: "*.t00ls.dev" },
    { options_preflight_bypass: true },
    { destinations: [{ uri: "other.t00ls.dev" }] },
    {
      destinations: [
        {
          type: "public",
          uri: "levi.t00ls.dev",
          overrides: [{ path: "/api/*", public: true }],
        },
      ],
    },
  ])
    assert.throws(() =>
      verifyAccess({ ...app, ...changes }, [policy], ["tester@example.test"]),
    );
  assert.throws(() =>
    verifyAccess(
      { ...app, id: "expected" },
      [policy],
      ["tester@example.test"],
      [{ id: "other", domain: "levi.t00ls.dev/api/*" }],
    ),
  );
  assert.throws(() =>
    verifyAccess(
      { ...app, id: "expected" },
      [policy],
      ["tester@example.test"],
      [{ id: "other", destinations: [{ uri: "levi.t00ls.dev/api/*" }] }],
    ),
  );
  for (const policies of [
    [],
    [{ ...policy, decision: "bypass" }],
    [{ ...policy, decision: "non_identity" }],
    [{ ...policy, include: [{ everyone: {} }] }],
    [{ ...policy, include: [{ email_domain: { domain: "example.test" } }] }],
    [{ ...policy, include: [{ group: { id: "synthetic" } }] }],
    [{ ...policy, include: [{ email: { email: "other@example.test" } }] }],
    [
      policy,
      { ...policy, include: [{ email: { email: "other@example.test" } }] },
    ],
  ])
    assert.throws(() => verifyAccess(app, policies, ["tester@example.test"]));
});

test("Hyperdrive exige cache desabilitado, recurso e role exclusivos e alvo DEV esperado", () => {
  verifyHyperdrive(hyperdrive, valid);
  for (const changes of [
    { id: "d".repeat(32) },
    { name: "foundation" },
    { caching: { disabled: false } },
    { caching: {} },
    { origin: { ...hyperdrive.origin, host: "another.neon.tech" } },
    { origin: { ...hyperdrive.origin, database: "foundation" } },
    { origin: { ...hyperdrive.origin, user: "levi_dev_migrator" } },
  ])
    assert.throws(() => verifyHyperdrive({ ...hyperdrive, ...changes }, valid));
});

test("configuração temporária preserva logs fechados e não altera Wrangler local", async () => {
  const parsed = ts.parseConfigFileTextToJson(
    "wrangler.jsonc",
    await readFile("wrangler.jsonc", "utf8"),
  );
  assert.ok(!parsed.error);
  const original = JSON.stringify(parsed.config);
  const result = deploymentConfig(parsed.config, valid.LEVI_HYPERDRIVE_ID!);
  assert.equal(JSON.stringify(parsed.config), original);
  assert.deepEqual(parsed.config.routes, []);
  assert.deepEqual(result.routes, [
    { pattern: "levi.t00ls.dev", custom_domain: true },
  ]);
  assert.equal(result.workers_dev, false);
  assert.equal(result.preview_urls, false);
  assert.equal(result.hyperdrive[0]?.id, valid.LEVI_HYPERDRIVE_ID);
  assert.equal(result.observability.enabled, false);
  assert.equal(result.observability.logs.invocation_logs, false);
  assert.equal(result.observability.traces.enabled, false);
  assert.ok(!JSON.stringify(result).includes(valid.LEVI_AUTH_SECRET!));
  assert.throws(() =>
    deploymentConfig(
      { ...parsed.config, workers_dev: true },
      valid.LEVI_HYPERDRIVE_ID!,
    ),
  );
  assert.throws(() =>
    deploymentConfig(
      { ...parsed.config, preview_urls: true },
      valid.LEVI_HYPERDRIVE_ID!,
    ),
  );
  assert.throws(() =>
    deploymentConfig(
      {
        ...parsed.config,
        observability: {
          ...parsed.config.observability,
          logs: { enabled: false, invocation_logs: true },
        },
      },
      valid.LEVI_HYPERDRIVE_ID!,
    ),
  );
});

test("CLI sem contexto autorizado falha antes de qualquer rede e sanitiza valores privados", () => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "tools/deploy-dev.ts"],
    {
      encoding: "utf8",
      env: { PATH: process.env.PATH, LEVI_AUTH_SECRET: valid.LEVI_AUTH_SECRET },
    },
  );
  assert.equal(result.status, 1);
  const output = result.stdout + result.stderr;
  assert.ok(output.includes("etapa: configuração"));
  assert.ok(!output.includes(valid.LEVI_AUTH_SECRET!));
  assert.ok(!output.includes("AssertionError"));
});
