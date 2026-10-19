import assert from "node:assert/strict";
import { resolve } from "node:path";
import { workerOptions } from "../src/worker-config.js";

export const deployOrigin = "https://levi.t00ls.dev";
export const deployWorker = "levi-dev";

export function deploySettings(env: NodeJS.ProcessEnv) {
  assert.equal(env.GITHUB_ACTIONS, "true");
  assert.equal(env.GITHUB_REPOSITORY, "t00ls-dev/levi");
  assert.ok(
    ["workflow_dispatch", "workflow_run"].includes(env.GITHUB_EVENT_NAME ?? ""),
  );
  assert.equal(env.GITHUB_REF, "refs/heads/main");
  assert.equal(env.LEVI_DEV_READY, "true");
  const sha = env.LEVI_DEPLOY_SHA ?? "";
  assert.match(sha, /^[a-f0-9]{40}$/);
  assert.equal(sha, env.GITHUB_SHA);
  const account = env.CLOUDFLARE_ACCOUNT_ID ?? "";
  const hyperdrive = env.LEVI_HYPERDRIVE_ID ?? "";
  assert.match(account, /^[a-f0-9]{32}$/);
  assert.match(env.CLOUDFLARE_ZONE_ID ?? "", /^[a-f0-9]{32}$/);
  assert.match(hyperdrive, /^[a-f0-9]{32}$/);
  assert.notEqual(hyperdrive, "0".repeat(32));
  assert.match(
    env.LEVI_DEV_DATABASE_HOST ?? "",
    /^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/,
  );
  assert.ok(!env.LEVI_DEV_DATABASE_HOST!.split(".")[0]!.includes("-pooler"));
  assert.match(env.LEVI_DEV_DATABASE_NAME ?? "", /^levi_dev(?:_[a-z0-9_]+)?$/);
  for (const name of [
    "GITHUB_TOKEN",
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_READ_TOKEN",
  ])
    assert.ok(env[name]?.trim());
  // Reutiliza a validação real do runtime, sem enviar e-mail.
  workerOptions({
    ASSETS: { fetch: async () => new Response() },
    HYPERDRIVE: { connectionString: "validation-only" },
    LEVI_PUBLIC_ORIGIN: deployOrigin,
    LEVI_AUTH_SECRET: env.LEVI_AUTH_SECRET ?? "",
    RESEND_API_KEY: env.RESEND_API_KEY ?? "",
    LEVI_EMAIL_FROM: env.LEVI_EMAIL_FROM ?? "",
  });
  return { sha, account, hyperdrive };
}

export function verifyHyperdrive(
  config: Record<string, any>,
  env: NodeJS.ProcessEnv,
) {
  assert.equal(config.id, env.LEVI_HYPERDRIVE_ID);
  assert.equal(config.name, deployWorker);
  assert.equal(config.caching?.disabled, true);
  assert.equal(config.origin?.host, env.LEVI_DEV_DATABASE_HOST);
  assert.equal(config.origin?.database, env.LEVI_DEV_DATABASE_NAME);
  assert.equal(config.origin?.user, "levi_dev_runtime");
  assert.ok(["postgres", "postgresql"].includes(config.origin?.scheme));
}

export function deploymentConfig(
  base: Record<string, any>,
  hyperdrive: string,
) {
  assert.equal(base.name, deployWorker);
  assert.equal(base.workers_dev, false);
  assert.equal(base.preview_urls, false);
  assert.deepEqual(base.routes, []);
  assert.equal(base.hyperdrive.length, 1);
  assert.equal(base.hyperdrive[0].binding, "HYPERDRIVE");
  assert.equal(base.observability.enabled, false);
  assert.equal(base.observability.logs.enabled, false);
  assert.equal(base.observability.logs.invocation_logs, false);
  assert.equal(base.observability.traces.enabled, false);
  return {
    ...base,
    $schema: undefined,
    workers_dev: false,
    preview_urls: false,
    observability: base.observability,
    main: resolve(base.main),
    assets: { ...base.assets, directory: resolve(base.assets.directory) },
    hyperdrive: [{ binding: "HYPERDRIVE", id: hyperdrive }],
    routes: [{ pattern: new URL(deployOrigin).hostname, custom_domain: true }],
    vars: { ...base.vars, LEVI_PUBLIC_ORIGIN: deployOrigin },
  };
}
