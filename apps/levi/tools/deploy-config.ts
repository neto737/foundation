import assert from "node:assert/strict";
import { resolve } from "node:path";

export const deployOrigin = "https://levi.t00ls.dev";
export const deployWorker = "levi-dev";
const emailFrom = "Levi <hi@levi.t00ls.dev>";
const previousEmailFrom = "Levi <noreply@levi.t00ls.dev>";

export function deploySettings(env: NodeJS.ProcessEnv) {
  assert.equal(env.GITHUB_ACTIONS, "true");
  assert.equal(env.GITHUB_REPOSITORY, "t00ls-dev/foundation");
  assert.equal(env.GITHUB_EVENT_NAME, "workflow_dispatch");
  assert.equal(env.GITHUB_REF, "refs/heads/master");
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
  for (const name of ["GITHUB_TOKEN", "CLOUDFLARE_API_TOKEN", "RESEND_API_KEY"])
    assert.ok(env[name]?.trim());
  // Sem fallback para AUTH_SECRET ou para o valor remoto previamente publicado.
  assert.ok((env.LEVI_AUTH_SECRET?.trim().length ?? 0) >= 32);
  assert.equal(env.LEVI_EMAIL_FROM, emailFrom);
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
  assert.equal(config.origin?.port, 5432);
  assert.equal(config.mtls?.sslmode, "verify-full");
  assert.match(
    config.mtls?.ca_certificate_id ?? "",
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,
  );
}

export function verifyWorkerBindings(
  version: Record<string, any>,
  env: NodeJS.ProcessEnv,
) {
  const bindings: unknown = version.resources?.bindings;
  assert.ok(Array.isArray(bindings));
  const hyperdrives = bindings.filter((b) => b.type === "hyperdrive");
  assert.equal(hyperdrives.length, 1);
  assert.equal(hyperdrives[0].name, "HYPERDRIVE");
  assert.equal(hyperdrives[0].id, env.LEVI_HYPERDRIVE_ID);
  for (const [name, type, text] of [
    ["ASSETS", "assets"],
    ["LEVI_AUTH_SECRET", "secret_text"],
    ["RESEND_API_KEY", "secret_text"],
    ["LEVI_PUBLIC_ORIGIN", "plain_text", deployOrigin],
    ["LEVI_EMAIL_FROM", "plain_text", env.LEVI_EMAIL_FROM],
  ]) {
    const matches: { type?: unknown; text?: unknown }[] = bindings.filter(
      (binding) => binding.name === name,
    );
    assert.equal(matches.length, 1);
    assert.ok(matches[0]);
    assert.equal(matches[0].type, type);
    if (type === "plain_text") assert.equal(matches[0].text, text);
  }
}

// Compatibilidade somente com a versão original comprovada para o primeiro corte.
// Uma versão futura/reenviada com noreply não recebe essa exceção.
export function verifyPreviousWorkerBindings(
  version: Parameters<typeof verifyWorkerBindings>[0],
  env: NodeJS.ProcessEnv,
  identity: { versionId: string; sha: string },
): "legacy" | "current" {
  const bindings: unknown = version.resources?.bindings;
  assert.ok(Array.isArray(bindings));
  const from: unknown = bindings.find(
    (binding) => binding?.name === "LEVI_EMAIL_FROM",
  )?.text;
  const legacy = from === previousEmailFrom;
  if (legacy) {
    assert.equal(identity.versionId, "526d47d8-39cc-46af-8ec5-1bf2bf3d7282");
    assert.equal(identity.sha, "b2c892e27e3a8988f0be554692ffea43d35fcd61");
    assert.equal(env.LEVI_EMAIL_FROM, emailFrom);
  }
  verifyWorkerBindings(
    version,
    legacy ? { ...env, LEVI_EMAIL_FROM: previousEmailFrom } : env,
  );
  return legacy ? "legacy" : "current";
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
    secrets: { required: ["LEVI_AUTH_SECRET", "RESEND_API_KEY"] },
    routes: [{ pattern: new URL(deployOrigin).hostname, custom_domain: true }],
    vars: {
      ...base.vars,
      LEVI_PUBLIC_ORIGIN: deployOrigin,
    },
  };
}
