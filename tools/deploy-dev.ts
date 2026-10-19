import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import ts from "typescript";
import {
  deploySettings,
  verifyAccess,
  verifyHyperdrive,
  deploymentConfig,
  deployOrigin,
  deployWorker,
} from "./deploy-config.js";

// Nenhuma migration, criação de banco/Access/Hyperdrive ou alteração de plano.
let phase = "configuração";
let directory: string | undefined;
try {
  const env = process.env;
  const settings = deploySettings(env);
  async function currentMain() {
    const response = await fetch(
      "https://api.github.com/repos/t00ls-dev/levi/git/ref/heads/main",
      {
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
        },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      },
    );
    assert.ok(response.ok);
    assert.equal(
      ((await response.json()) as { object?: { sha?: string } }).object?.sha,
      settings.sha,
    );
    assert.equal(
      execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      settings.sha,
    );
    assert.equal(
      execFileSync(
        "git",
        ["status", "--porcelain", "--untracked-files=normal"],
        { encoding: "utf8" },
      ).trim(),
      "",
    );
  }
  await currentMain();
  const account = `/accounts/${settings.account}`;
  async function cloudflare(path: string, missing = false): Promise<any> {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4${path}`,
      {
        headers: { Authorization: `Bearer ${env.CLOUDFLARE_READ_TOKEN}` },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (missing && response.status === 404) return null;
    assert.ok(response.ok);
    const body = (await response.json()) as {
      success: boolean;
      result: unknown;
    };
    assert.equal(body.success, true);
    return body.result;
  }
  async function list(path: string): Promise<Record<string, any>[]> {
    const entries: Record<string, any>[] = [];
    for (let page = 1; page <= 10; page++) {
      const result = await cloudflare(`${path}?page=${page}&per_page=100`);
      assert.ok(Array.isArray(result));
      entries.push(...result);
      if (result.length < 100) return entries;
    }
    throw new Error();
  }
  phase = "proteções remotas";
  async function protections() {
    verifyHyperdrive(
      await cloudflare(`${account}/hyperdrive/configs/${settings.hyperdrive}`),
      env,
    );
    verifyAccess(
      await cloudflare(`${account}/access/apps/${settings.access}`),
      await list(`${account}/access/apps/${settings.access}/policies`),
      settings.addresses,
      await list(`${account}/access/apps`),
    );
    const alternate = await cloudflare(
      `${account}/workers/scripts/${deployWorker}/subdomain`,
      true,
    );
    if (alternate) {
      assert.equal(alternate.enabled, false);
      assert.equal(alternate.previews_enabled, false);
    }
    const domains = await list(`${account}/workers/domains`);
    for (const domain of domains) {
      if (domain.hostname === new URL(deployOrigin).hostname)
        assert.equal(domain.service, deployWorker);
      if (domain.service === deployWorker)
        assert.equal(domain.hostname, new URL(deployOrigin).hostname);
    }
    // Sem rotas legadas alternativas na zona de publicação.
    const zones = domains
      .filter((domain) => domain.service === deployWorker)
      .map((domain) => domain.zone_id);
    const zoneId = env.CLOUDFLARE_ZONE_ID;
    assert.match(zoneId ?? "", /^[a-f0-9]{32}$/);
    const zone = await cloudflare(`/zones/${zoneId}`);
    assert.equal(zone.name, "t00ls.dev");
    assert.equal(zone.account?.id, settings.account);
    assert.ok(zones.every((id) => id === zoneId));
    const routes = await list(`/zones/${zoneId}/workers/routes`);
    assert.ok(routes.every((route) => route.script !== deployWorker));
  }
  await protections();
  phase = "preparação do bundle";
  const parsed = ts.parseConfigFileTextToJson(
    "wrangler.jsonc",
    await readFile("wrangler.jsonc", "utf8"),
  );
  assert.ok(!parsed.error);
  const config = deploymentConfig(parsed.config, settings.hyperdrive);
  config.vars.LEVI_EMAIL_FROM = env.LEVI_EMAIL_FROM;
  await mkdir(".local", { recursive: true });
  directory = await mkdtemp(resolve(".local/deploy-"));
  const configPath = join(directory, "wrangler.json");
  const secretsPath = join(directory, "secrets.json");
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  await writeFile(
    secretsPath,
    JSON.stringify({
      LEVI_AUTH_SECRET: env.LEVI_AUTH_SECRET,
      RESEND_API_KEY: env.RESEND_API_KEY,
      LEVI_DEV_EMAIL_ALLOWLIST: env.LEVI_DEV_EMAIL_ALLOWLIST,
    }),
    { mode: 0o600 },
  );
  await currentMain();
  phase = "publicação Wrangler";
  // A saída bruta pode conter configuração privada: nunca é impressa ou anexada.
  const result = spawnSync(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "deploy",
      "--config",
      configPath,
      "--secrets-file",
      secretsPath,
      "--tag",
      settings.sha,
      "--strict",
    ],
    {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      env: {
        PATH: env.PATH,
        HOME: env.HOME,
        CI: "true",
        WRANGLER_SEND_METRICS: "false",
        WRANGLER_WRITE_LOGS: "false",
        WRANGLER_LOG_SANITIZE: "true",
        CLOUDFLARE_ACCOUNT_ID: settings.account,
        CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN,
      },
    },
  );
  assert.equal(result.status, 0);
  phase = "verificação após publicação";
  await protections();
  const deployments = await cloudflare(
    `${account}/workers/scripts/${deployWorker}/deployments`,
  );
  const versions = deployments.deployments?.[0]?.versions;
  assert.ok(
    Array.isArray(versions) &&
      versions.length === 1 &&
      versions[0].percentage === 100,
  );
  const version = await cloudflare(
    `${account}/workers/scripts/${deployWorker}/versions/${versions[0].version_id}`,
  );
  assert.equal(version.annotations?.["workers/tag"], settings.sha);
  for (const path of ["/", "/api/onboarding"]) {
    const response = await fetch(`${deployOrigin}${path}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(response.status, 302);
    const target = new URL(response.headers.get("location") ?? "");
    assert.equal(target.protocol, "https:");
    assert.ok(target.hostname.endsWith(".cloudflareaccess.com"));
    await response.body?.cancel();
  }
  console.info(
    `Versão ${settings.sha} publicada; versão ativa e bloqueio anônimo conferidos. Fluxo autenticado e CPU Free ainda exigem validação remota com testador autorizado.`,
  );
} catch {
  console.error(
    `Deploy DEV não confirmado na etapa: ${phase}. Nenhuma repetição ou contratação automática. Confira o estado remoto antes de tentar novamente.`,
  );
  process.exitCode = 1;
} finally {
  if (directory) {
    try {
      await rm(directory, { recursive: true, force: true });
    } catch {
      console.error(
        "Limpeza privada incompleta. Não publique artifacts deste runner.",
      );
      process.exitCode = 1;
    }
  }
}
