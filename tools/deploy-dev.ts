import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import ts from "typescript";
import {
  deploySettings,
  verifyHyperdrive,
  deploymentConfig,
  deployOrigin,
  deployWorker,
} from "./deploy-config.js";
import { requireSuccessfulCI } from "./ci-evidence.js";
import { DeployDiagnostics } from "./deploy-diagnostics.js";
import type { DeployCheck } from "./deploy-diagnostics.js";

// Nenhuma migration, criação de banco/Hyperdrive ou alteração de plano.
const diagnostics = new DeployDiagnostics((message) => console.info(message));
let directory: string | undefined;
try {
  const env = process.env;
  const settings = diagnostics.verify("configuration", () =>
    deploySettings(env),
  );
  diagnostics.phase = "ci";
  const ci = await requireSuccessfulCI(env, fetch, diagnostics);
  async function currentMain() {
    const response = await diagnostics.request("main-read", () =>
      fetch("https://api.github.com/repos/t00ls-dev/levi/git/ref/heads/main", {
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
        },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      }),
    );
    diagnostics.httpOk(response);
    const main = (await response.json()) as { object?: { sha?: string } };
    diagnostics.inspect("main-sha");
    assert.equal(main.object?.sha, settings.sha);
    diagnostics.start("local-head", "falha de operação local");
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    diagnostics.start("local-head");
    assert.equal(head, settings.sha);
    diagnostics.start("local-clean", "falha de operação local");
    const clean = execFileSync(
      "git",
      ["status", "--porcelain", "--untracked-files=normal"],
      { encoding: "utf8" },
    ).trim();
    diagnostics.start("local-clean");
    assert.equal(clean, "");
  }
  await currentMain();
  const account = `/accounts/${settings.account}`;
  async function cloudflare(
    check: DeployCheck,
    path: string,
    missing = false,
  ): Promise<any> {
    const response = await diagnostics.request(check, () =>
      fetch(`https://api.cloudflare.com/client/v4${path}`, {
        headers: { Authorization: `Bearer ${env.CLOUDFLARE_READ_TOKEN}` },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      }),
    );
    if (missing && response.status === 404) return null;
    diagnostics.httpOk(response);
    const body = (await response.json()) as {
      success: boolean;
      result: unknown;
    };
    assert.equal(body.success, true);
    return body.result;
  }
  async function list(
    check: "domains-read" | "routes-read",
    shape: "domains-shape" | "routes-shape",
    path: string,
  ): Promise<Record<string, any>[]> {
    const entries: Record<string, any>[] = [];
    for (let page = 1; page <= 10; page++) {
      const result = await cloudflare(
        check,
        `${path}?page=${page}&per_page=100`,
      );
      diagnostics.inspect(shape, "resposta inesperada");
      assert.ok(Array.isArray(result));
      entries.push(...result);
      if (result.length < 100) return entries;
    }
    diagnostics.start("pagination-limit", "resposta inesperada");
    throw new Error();
  }
  diagnostics.phase = "protections";
  async function protections() {
    const hyperdrive = await cloudflare(
      "hyperdrive-read",
      `${account}/hyperdrive/configs/${settings.hyperdrive}`,
    );
    diagnostics.verify("hyperdrive", () => verifyHyperdrive(hyperdrive, env));
    const alternate = await cloudflare(
      "subdomain-read",
      `${account}/workers/scripts/${deployWorker}/subdomain`,
      true,
    );
    diagnostics.inspect("subdomain");
    if (alternate) {
      assert.equal(alternate.enabled, false);
      assert.equal(alternate.previews_enabled, false);
    }
    const domains = await list(
      "domains-read",
      "domains-shape",
      `${account}/workers/domains`,
    );
    diagnostics.inspect("domains");
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
    diagnostics.start("zone-id");
    assert.match(zoneId ?? "", /^[a-f0-9]{32}$/);
    const zone = await cloudflare("zone-read", `/zones/${zoneId}`);
    diagnostics.inspect("zone");
    assert.equal(zone.name, "t00ls.dev");
    assert.equal(zone.account?.id, settings.account);
    assert.ok(zones.every((id) => id === zoneId));
    const routes = await list(
      "routes-read",
      "routes-shape",
      `/zones/${zoneId}/workers/routes`,
    );
    diagnostics.inspect("routes");
    assert.ok(routes.every((route) => route.script !== deployWorker));
  }
  await protections();
  diagnostics.phase = "bundle";
  diagnostics.start("bundle-read", "falha de operação local");
  const baseConfig = await readFile("wrangler.jsonc", "utf8");
  diagnostics.start("bundle-parse", "resposta inesperada");
  const parsed = ts.parseConfigFileTextToJson("wrangler.jsonc", baseConfig);
  assert.ok(!parsed.error);
  const config = diagnostics.verify("bundle-config", () =>
    deploymentConfig(parsed.config, settings.hyperdrive),
  );
  config.vars.LEVI_EMAIL_FROM = env.LEVI_EMAIL_FROM;
  diagnostics.start("bundle-directory", "falha de operação local");
  await mkdir(".local", { recursive: true });
  directory = await mkdtemp(resolve(".local/deploy-"));
  const configPath = join(directory, "wrangler.json");
  const secretsPath = join(directory, "secrets.json");
  diagnostics.start("bundle-files", "falha de operação local");
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  await writeFile(
    secretsPath,
    JSON.stringify({
      LEVI_AUTH_SECRET: env.LEVI_AUTH_SECRET,
      RESEND_API_KEY: env.RESEND_API_KEY,
    }),
    { mode: 0o600 },
  );
  await currentMain();
  diagnostics.phase = "publish";
  const currentCI = await requireSuccessfulCI(env, fetch, diagnostics);
  diagnostics.start("ci-unchanged");
  assert.deepEqual(currentCI, ci);
  // A saída bruta pode conter configuração privada: nunca é impressa ou anexada.
  diagnostics.start("wrangler", "falha de operação local");
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
  if (result.status !== 0 && result.error) throw result.error;
  assert.equal(result.status, 0);
  diagnostics.phase = "published";
  await protections();
  const deployments = await cloudflare(
    "deployments-read",
    `${account}/workers/scripts/${deployWorker}/deployments`,
  );
  diagnostics.inspect("deployment-shape", "resposta inesperada");
  const versions = deployments.deployments?.[0]?.versions;
  assert.ok(Array.isArray(versions));
  diagnostics.inspect("deployment-traffic");
  assert.ok(versions.length === 1 && versions[0].percentage === 100);
  const version = await cloudflare(
    "version-read",
    `${account}/workers/scripts/${deployWorker}/versions/${versions[0].version_id}`,
  );
  diagnostics.inspect("version-tag");
  assert.equal(version.annotations?.["workers/tag"], settings.sha);
  for (const [path, requestCheck, responseCheck] of [
    ["/", "home-read", "home-response"],
    ["/api/onboarding", "onboarding-read", "onboarding-response"],
    ["/api/organizations", "organizations-read", "organizations-response"],
    ["/api/churches", "churches-read", "churches-response"],
  ] as const) {
    const response = await diagnostics.request(requestCheck, () =>
      fetch(`${deployOrigin}${path}`, {
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      }),
    );
    diagnostics.start(responseCheck, "resposta inesperada", response.status);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.ok(response.headers.get("content-security-policy"));
    if (path === "/") {
      diagnostics.httpStatus(response, 200);
      assert.ok(response.headers.get("content-type")?.includes("text/html"));
      await response.body?.cancel();
    } else if (path === "/api/onboarding") {
      diagnostics.httpStatus(response, 200);
      diagnostics.start(
        "onboarding-body",
        "resposta inesperada",
        response.status,
      );
      assert.deepEqual(await response.json(), { etapa: "email" });
    } else {
      diagnostics.httpStatus(response, 401);
      await response.body?.cancel();
    }
  }
  console.info(
    `Versão ${settings.sha} publicada; SHA ativo, acesso público e bloqueio de dados privados conferidos. E-mails, fluxo autenticado e CPU Free ainda exigem validação remota.`,
  );
} catch (error) {
  console.error(diagnostics.message(error));
  process.exitCode = 1;
} finally {
  if (directory) {
    try {
      await rm(directory, { recursive: true, force: true });
    } catch (error) {
      diagnostics.phase = "cleanup";
      diagnostics.start("cleanup", "falha de operação local");
      console.error(diagnostics.message(error));
      console.error(
        "Limpeza privada incompleta. Não publique artifacts deste runner.",
      );
      process.exitCode = 1;
    }
  }
}
