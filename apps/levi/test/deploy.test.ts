import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import {
  classifyDeployError,
  DeployDiagnostics,
} from "../tools/deploy-diagnostics.js";
import {
  deploySettings,
  verifyHyperdrive,
  verifyWorkerBindings,
  deploymentConfig,
} from "../tools/deploy-config.js";

const valid: NodeJS.ProcessEnv = {
  GITHUB_ACTIONS: "true",
  GITHUB_REPOSITORY: "t00ls-dev/foundation",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REF: "refs/heads/master",
  LEVI_DEV_READY: "true",
  LEVI_DEPLOY_SHA: "a".repeat(40),
  GITHUB_SHA: "a".repeat(40),
  GITHUB_TOKEN: "synthetic-only",
  CLOUDFLARE_ACCOUNT_ID: "b".repeat(32),
  CLOUDFLARE_ZONE_ID: "d".repeat(32),
  CLOUDFLARE_API_TOKEN: "synthetic-only",
  LEVI_HYPERDRIVE_ID: "c".repeat(32),
  LEVI_DEV_DATABASE_HOST: "ep-synthetic-only.us-east-2.aws.neon.tech",
  LEVI_DEV_DATABASE_NAME: "levi_dev",
  LEVI_EMAIL_FROM: "Levi <levi@example.test>",
  LEVI_AUTH_SECRET: "synthetic-only-secret-with-more-than-32-characters",
  RESEND_API_KEY: "synthetic-only",
};
const versionId = "11111111-1111-4111-8111-111111111111";
const previousVersionId = "33333333-3333-4333-8333-333333333333";
const baseBindings = [
  { type: "hyperdrive", name: "HYPERDRIVE", id: valid.LEVI_HYPERDRIVE_ID },
  { type: "assets", name: "ASSETS" },
  { type: "secret_text", name: "LEVI_AUTH_SECRET" },
  { type: "secret_text", name: "RESEND_API_KEY" },
  {
    type: "plain_text",
    name: "LEVI_PUBLIC_ORIGIN",
    text: "https://levi.t00ls.dev",
  },
  { type: "plain_text", name: "LEVI_EMAIL_FROM", text: valid.LEVI_EMAIL_FROM },
];
const hyperdrive = {
  id: valid.LEVI_HYPERDRIVE_ID,
  name: "levi-dev",
  caching: { disabled: true },
  mtls: {
    sslmode: "verify-full",
    ca_certificate_id: "22222222-2222-4222-8222-222222222222",
  },
  origin: {
    port: 5432,
    host: valid.LEVI_DEV_DATABASE_HOST,
    database: "levi_dev",
    user: "levi_dev_runtime",
    scheme: "postgres",
  },
};

test("deploy exige execução confiável manual da master e configuração completa, sem credenciais de migrations", () => {
  assert.equal(deploySettings(valid).sha, valid.GITHUB_SHA);
  for (const changes of [
    { GITHUB_ACTIONS: "false" },
    { GITHUB_REPOSITORY: "t00ls-dev/levi" },
    { GITHUB_EVENT_NAME: "workflow_run" },
    { GITHUB_EVENT_NAME: "push" },
    { GITHUB_REF: "refs/heads/main" },
    { GITHUB_REPOSITORY: "other/levi" },
    { GITHUB_EVENT_NAME: "pull_request" },
    { GITHUB_REF: "refs/heads/feature" },
    { LEVI_DEV_READY: "false" },
    { GITHUB_SHA: "b".repeat(40) },
    { LEVI_DEPLOY_SHA: "not-a-sha" },
    { CLOUDFLARE_API_TOKEN: "" },
    { CLOUDFLARE_ZONE_ID: "" },
    { LEVI_HYPERDRIVE_ID: "0".repeat(32) },
    { LEVI_DEV_DATABASE_NAME: "foundation" },
    {
      LEVI_DEV_DATABASE_HOST:
        "ep-synthetic-only-pooler.us-east-2.aws.neon.tech",
    },
    { LEVI_EMAIL_FROM: "" },
  ])
    assert.throws(() => deploySettings({ ...valid, ...changes }));
});

test("Hyperdrive exige cache desabilitado, recurso e role exclusivos e alvo DEV esperado", () => {
  verifyHyperdrive(hyperdrive, valid);
  for (const changes of [
    { id: "d".repeat(32) },
    { name: "foundation" },
    { caching: { disabled: false } },
    { caching: {} },
    { mtls: { sslmode: "require" } },
    { mtls: { sslmode: "verify-full" } },
    { origin: { ...hyperdrive.origin, port: 6432 } },
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
  assert.deepEqual(result.secrets.required, [
    "LEVI_AUTH_SECRET",
    "RESEND_API_KEY",
  ]);
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
  assert.ok(output.includes("verificação: contexto e configuração DEV"));
  assert.ok(output.includes("categoria: divergência de configuração"));
  assert.ok(!output.includes(valid.LEVI_AUTH_SECRET!));
  assert.ok(!output.includes("AssertionError"));
});

// Executa o script real com todas as fronteiras de I/O substituídas: nenhum
// subprocesso, arquivo privado ou request real pode ser criado pelo harness.
async function simulatedDeploy(
  options: {
    env?: NodeJS.ProcessEnv;
    respond?: (url: string, published: boolean) => Response | undefined;
    cleanupError?: Error;
    failProgress?: boolean;
    failReport?: boolean;
    ciEvidence?: (call: number) => {
      sha: string;
      runId: number;
      attempt: number;
    };
  } = {},
) {
  const source = await readFile("tools/deploy-dev.ts", "utf8");
  const baseConfig = await readFile("wrangler.jsonc", "utf8");
  const output: string[] = [];
  const requests: string[] = [];
  const writes: { path: string; mode: number }[] = [];
  let writtenVars: unknown;
  let uploads = 0;
  let ciCalls = 0;
  let cleanups = 0;
  const fakeProcess = {
    env: {
      ...valid,
      ...options.env,
    },
    execPath: process.execPath,
    exitCode: 0,
  };
  const headers = {
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'self'",
    "cache-control": "private, no-store",
  };
  const cloudflare = (result: unknown) =>
    Response.json({ success: true, result });
  const request = async (input: string, init: RequestInit) => {
    requests.push(input);
    if (new URL(input).hostname === "api.cloudflare.com")
      assert.equal(
        new Headers(init.headers).get("Authorization"),
        `Bearer ${valid.CLOUDFLARE_API_TOKEN}`,
      );
    const override = options.respond?.(input, uploads > 0);
    if (override) return override;
    const url = new URL(input);
    if (url.hostname === "api.github.com")
      return Response.json({ object: { sha: valid.GITHUB_SHA } });
    if (url.pathname.includes("/hyperdrive/configs/"))
      return cloudflare(hyperdrive);
    if (url.pathname.endsWith("/subdomain"))
      return cloudflare({ enabled: false, previews_enabled: false });
    if (url.pathname.endsWith("/workers/domains"))
      return cloudflare([
        {
          hostname: "levi.t00ls.dev",
          service: "levi-dev",
          zone_id: valid.CLOUDFLARE_ZONE_ID,
          enabled: true,
          previews_enabled: false,
        },
      ]);
    if (url.pathname.endsWith("/workers/routes")) return cloudflare([]);
    if (url.pathname.includes("/zones/"))
      return cloudflare({
        name: "t00ls.dev",
        account: { id: valid.CLOUDFLARE_ACCOUNT_ID },
      });
    if (url.pathname.endsWith("/deployments"))
      return cloudflare({
        deployments: [
          {
            versions: [
              {
                version_id: uploads ? versionId : previousVersionId,
                percentage: 100,
              },
            ],
          },
        ],
      });
    if (url.pathname.includes("/versions/"))
      return cloudflare({
        annotations: {
          "workers/tag": uploads ? valid.GITHUB_SHA : "e".repeat(40),
        },
        resources: {
          bindings: baseBindings,
        },
      });
    if (url.pathname.endsWith("/versions"))
      return cloudflare({
        items: [{ id: uploads ? versionId : previousVersionId }],
      });
    if (url.hostname === "levi.t00ls.dev") {
      if (url.pathname === "/")
        return new Response("<html></html>", {
          headers: { ...headers, "content-type": "text/html" },
        });
      if (url.pathname === "/api/onboarding")
        return Response.json({ etapa: "email" }, { headers });
      if (url.pathname === "/api/members")
        return new Response(null, {
          status: 401,
          headers,
        });
      if (["/admin", "/api/admin/session"].includes(url.pathname))
        return new Response(null, { status: 404, headers });
      if (["/api/organizations", "/api/churches"].includes(url.pathname))
        return new Response(null, { status: 401, headers });
    }
    throw new Error("Request não previsto no harness");
  };
  const modules: Record<string, unknown> = {
    // Literais do VM e JSON do Response pertencem a realms distintos. Igualar
    // apenas seus protótipos no harness mantém o deepEqual estrutural do script.
    "node:assert/strict": new Proxy(assert, {
      get(target, key, receiver) {
        if (key === "deepEqual")
          return (actual: unknown, expected: unknown) =>
            assert.deepEqual(
              JSON.parse(JSON.stringify(actual)),
              JSON.parse(JSON.stringify(expected)),
            );
        return Reflect.get(target, key, receiver);
      },
    }),
    "node:path": { join, resolve },
    "node:child_process": {
      execFileSync: (_cmd: string, args: string[]) =>
        args[0] === "rev-parse" ? valid.GITHUB_SHA : "",
      spawnSync: (
        _command: string,
        args: string[],
        settings: { env: NodeJS.ProcessEnv },
      ) => {
        assert.equal(
          settings.env.CLOUDFLARE_API_TOKEN,
          valid.CLOUDFLARE_API_TOKEN,
        );
        assert.equal("CLOUDFLARE_READ_TOKEN" in settings.env, false);
        assert.ok(!args.includes("--secrets-file"));
        assert.equal(settings.env.LEVI_AUTH_SECRET, undefined);
        assert.equal(settings.env.RESEND_API_KEY, undefined);
        uploads++;
        return { status: 0 };
      },
    },
    "node:fs/promises": {
      readFile: async () => baseConfig,
      mkdir: async () => {},
      mkdtemp: async () => ".local/deploy-synthetic-only",
      writeFile: async (
        path: string,
        contents: string,
        settings: { mode: number },
      ) => {
        assert.ok(!contents.includes(valid.LEVI_AUTH_SECRET!));
        assert.ok(!contents.includes(valid.RESEND_API_KEY!));
        writes.push({ path, mode: settings.mode });
        if (path.endsWith("wrangler.json"))
          writtenVars = JSON.parse(contents).vars;
      },
      rm: async () => {
        cleanups++;
        if (options.cleanupError) throw options.cleanupError;
      },
    },
    typescript: ts,
    "./deploy-config.js": {
      deploySettings,
      verifyHyperdrive,
      verifyWorkerBindings,
      deploymentConfig,
      deployOrigin: "https://levi.t00ls.dev",
      deployWorker: "levi-dev",
    },
    "./deploy-diagnostics.js": { DeployDiagnostics },
    "./ci-evidence.js": {
      requireSuccessfulCI: async () => {
        ciCalls++;
        return (
          options.ciEvidence?.(ciCalls) ?? {
            sha: valid.GITHUB_SHA,
            runId: 1,
            attempt: 1,
          }
        );
      },
    },
  };
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2023,
      esModuleInterop: true,
    },
  });
  await runInNewContext(`(async () => { ${compiled.outputText} })()`, {
    require: (name: string) => {
      assert.ok(name in modules);
      return modules[name];
    },
    exports: {},
    process: fakeProcess,
    fetch: request,
    URL,
    AbortSignal,
    console: {
      info: (message: string) => {
        if (options.failProgress && message.startsWith("Deploy DEV:"))
          throw new Error(sensitive);
        output.push(message);
      },
      error: (message: string) => {
        if (options.failReport) throw new Error(sensitive);
        output.push(message);
      },
    },
  });
  return {
    output: output.join("\n"),
    requests,
    uploads,
    cleanups,
    writes,
    writtenVars,
    ciCalls,
    exitCode: fakeProcess.exitCode,
  };
}

test("readiness inválido bloqueia antes de CI, consultas, arquivos e upload", async () => {
  for (const value of [
    undefined,
    "",
    "false",
    "TRUE",
    "1",
    " true ",
    "invalid",
  ]) {
    const result = await simulatedDeploy({ env: { LEVI_DEV_READY: value } });
    assert.equal(result.exitCode, 1);
    assert.equal(result.uploads, 0);
    assert.equal(result.requests.length, 0);
    assert.equal(result.ciCalls, 0);
    assert.equal(result.writes.length, 0);
  }
});

test("token único ausente não usa token legado nem inicia operação privilegiada", async () => {
  const result = await simulatedDeploy({
    env: {
      CLOUDFLARE_API_TOKEN: undefined,
      CLOUDFLARE_READ_TOKEN: "legacy-must-not-be-used",
    },
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.ciCalls, 0);
  assert.equal(result.requests.length, 0);
  assert.equal(result.writes.length, 0);
  assert.equal(result.uploads, 0);
});

const sensitive =
  "postgres://user:private-password@private.invalid/db?token=private-token\nAuthorization: Bearer private-token\nCookie: session=private-cookie";

test("diagnóstico: sucesso conserva publicação única, checks, arquivos privados e limpeza", async () => {
  const result = await simulatedDeploy();
  assert.equal(result.exitCode, 0, result.output);
  assert.equal(result.uploads, 1);
  assert.equal(result.cleanups, 1);
  assert.equal(result.writes.length, 1);
  assert.ok(result.writes.every((file) => file.mode === 0o600));
  assert.ok(
    result.output.includes(
      "SHA ativo, acesso público e bloqueio de dados privados conferidos",
    ),
  );
  for (const path of [
    "/",
    "/admin",
    "/api/admin/session",
    "/api/onboarding",
    "/api/organizations",
    "/api/churches",
    "/api/members",
  ])
    assert.ok(result.requests.includes(`https://levi.t00ls.dev${path}`));
  assert.ok(!result.output.includes(valid.LEVI_AUTH_SECRET!));
});

test("diagnóstico: HTTP pós-upload identifica operação/status e interrompe sem retry", async () => {
  const result = await simulatedDeploy({
    respond: (url, published) =>
      published && url.endsWith("/deployments")
        ? new Response(sensitive, { status: 403 })
        : undefined,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.uploads, 1);
  assert.equal(result.cleanups, 1);
  assert.ok(
    result.output.includes(
      "etapa: verificação após publicação; verificação: consulta dos deployments do Worker; categoria: falha HTTP; status HTTP: 403",
    ),
  );
  assert.equal(
    result.requests.filter((url) => url.endsWith("/deployments")).length,
    3,
  );
  assert.ok(
    !result.requests.some((url) => url.startsWith("https://levi.t00ls.dev")),
  );
  assert.ok(!result.output.includes("private-"));
});

test("diagnóstico: HTTP anterior ao upload interrompe sem chamar o publicador", async () => {
  const result = await simulatedDeploy({
    respond: (url) =>
      url.includes("/hyperdrive/configs/")
        ? new Response(sensitive, { status: 503 })
        : undefined,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.uploads, 0);
  assert.ok(
    result.output.includes(
      "etapa: proteções remotas; verificação: consulta do Hyperdrive; categoria: falha HTTP; status HTTP: 503",
    ),
  );
  assert.ok(!result.output.includes("private-"));
});

test("diagnóstico: JSON inválido e envelope reprovado são respostas inesperadas sem corpo privado", async () => {
  for (const response of [
    new Response(sensitive),
    Response.json({ success: false, errors: [{ message: sensitive }] }),
  ]) {
    const result = await simulatedDeploy({
      respond: (url) => (url.endsWith("/deployments") ? response : undefined),
    });
    assert.equal(result.exitCode, 1);
    assert.ok(
      result.output.includes(
        "consulta dos deployments do Worker; categoria: resposta inesperada; status HTTP: 200",
      ),
    );
    assert.ok(!result.output.includes("private-"));
  }
});

test("diagnóstico: formato inválido e tráfego divergente mantêm HTTP sem aceitar deployment incompleto", async () => {
  for (const [resultBody, category, check] of [
    [
      { deployments: [] },
      "resposta inesperada",
      "estrutura das versões do deployment",
    ],
    [
      {
        deployments: [
          { versions: [{ version_id: versionId, percentage: 50 }] },
        ],
      },
      "divergência de configuração",
      "versão única com 100% do tráfego",
    ],
  ] as const) {
    const result = await simulatedDeploy({
      respond: (url) =>
        url.endsWith("/deployments")
          ? Response.json({ success: true, result: resultBody })
          : undefined,
    });
    assert.equal(result.exitCode, 1);
    assert.ok(
      result.output.includes(
        `verificação: ${check}; categoria: ${category}; status HTTP: 200`,
      ),
    );
    assert.ok(!result.requests.some((url) => url.includes("/versions/")));
  }
});

test("diagnóstico: divergências de proteção e tag localizam check sem imprimir valores recebidos", async () => {
  for (const [operation, expected] of [
    ["hyperdrive", "origem e cache do Hyperdrive"],
    ["tag", "tag da versão ativa igual ao SHA"],
  ]) {
    const result = await simulatedDeploy({
      respond: (url, published) => {
        if (
          operation === "hyperdrive" &&
          published &&
          url.includes("/hyperdrive/configs/")
        )
          return Response.json({
            success: true,
            result: { ...hyperdrive, caching: { disabled: false } },
          });
        if (operation === "tag" && published && url.includes("/versions/"))
          return Response.json({
            success: true,
            result: { annotations: { "workers/tag": sensitive } },
          });
        return undefined;
      },
    });
    assert.equal(result.exitCode, 1);
    assert.ok(
      result.output.includes(
        `etapa: verificação após publicação; verificação: ${expected}; categoria: divergência de configuração`,
      ),
    );
    assert.ok(!result.output.includes("private-"));
  }
});

test("diagnóstico: falha de rede preserva apenas código técnico conhecido", async () => {
  const result = await simulatedDeploy({
    respond: (url) => {
      if (url.endsWith("/deployments"))
        throw new Error(sensitive, {
          cause: { code: "ENOTFOUND", message: sensitive },
        });
      return undefined;
    },
  });
  assert.equal(result.exitCode, 1);
  assert.ok(
    result.output.includes(
      "categoria: erro de rede; status HTTP: indisponível; causa técnica: ENOTFOUND",
    ),
  );
  assert.ok(!result.output.includes("private-"));
  const diagnostics = new DeployDiagnostics();
  diagnostics.start("version-tag");
  assert.ok(
    !diagnostics
      .message({ code: sensitive, message: sensitive, stack: sensitive })
      .includes("private-"),
  );
});

test("diagnóstico: resposta pública divergente mantém 401 obrigatório e interrompe o smoke", async () => {
  const result = await simulatedDeploy({
    respond: (url) =>
      url === "https://levi.t00ls.dev/api/organizations"
        ? new Response(sensitive, {
            status: 200,
            headers: {
              "referrer-policy": "no-referrer",
              "content-security-policy": "default-src 'self'",
            },
          })
        : undefined,
  });
  assert.equal(result.exitCode, 1);
  assert.ok(
    result.output.includes(
      "bloqueio anônimo e cabeçalhos de organizações; categoria: falha HTTP; status HTTP: 200",
    ),
  );
  assert.ok(!result.requests.includes("https://levi.t00ls.dev/api/churches"));
  assert.ok(!result.output.includes("private-"));
});

test("diagnóstico: falha na limpeza preserva exit 1 e não expõe caminhos privados", async () => {
  const result = await simulatedDeploy({
    cleanupError: Object.assign(new Error(sensitive), { code: "EACCES" }),
  });
  assert.equal(result.exitCode, 1);
  assert.ok(
    result.output.includes(
      "etapa: limpeza privada; verificação: remoção dos arquivos privados temporários; categoria: falha de operação local",
    ),
  );
  assert.ok(result.output.includes("causa técnica: EACCES"));
  assert.ok(!result.output.includes("private-"));
});

test("diagnóstico alinhado ao Foundation: erros hostis não acionam getters, proxies ou coerção", () => {
  let touched = 0;
  const hostile = Object.create(
    null,
    Object.fromEntries(
      ["code", "cause", "name", "message", "stack", "toJSON"].map((key) => [
        key,
        {
          get() {
            touched++;
            throw new Error(sensitive);
          },
        },
      ]),
    ),
  );
  const proxy = new Proxy(
    {},
    {
      get() {
        touched++;
        throw new Error(sensitive);
      },
      getOwnPropertyDescriptor() {
        touched++;
        throw new Error(sensitive);
      },
      getPrototypeOf() {
        touched++;
        throw new Error(sensitive);
      },
    },
  );
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  const cycle: { cause?: unknown } = {};
  cycle.cause = cycle;
  for (const error of [
    hostile,
    proxy,
    revoked.proxy,
    cycle,
    { cause: proxy },
    Object.create({ code: "ENOENT" }),
    sensitive,
    null,
    7,
    { code: sensitive },
  ]) {
    assert.equal(classifyDeployError(error), "UNKNOWN");
    const diagnostics = new DeployDiagnostics();
    diagnostics.start("version-tag");
    assert.ok(!diagnostics.message(error).includes("private-"));
    assert.doesNotThrow(() =>
      diagnostics.report(error, () => {
        throw new Error(sensitive);
      }),
    );
  }
  assert.equal(touched, 0);
});

test("diagnóstico alinhado ao Foundation: causas são próprias, fechadas, limitadas e cíclicas-seguras", () => {
  assert.equal(
    classifyDeployError(
      new Error(sensitive, { cause: { cause: { code: "ECONNRESET" } } }),
    ),
    "ECONNRESET",
  );
  assert.equal(
    classifyDeployError({ name: "TimeoutError", message: sensitive }),
    "TIMEOUT",
  );
  let deep: unknown = { code: "ENOENT" };
  for (let i = 0; i < 9; i++) deep = { cause: deep };
  assert.equal(classifyDeployError(deep), "UNKNOWN");
});

test("diagnóstico alinhado ao Foundation: catálogos e status são validados também em runtime", () => {
  const output: string[] = [];
  const diagnostics = new DeployDiagnostics((message) => output.push(message));
  diagnostics.phase = sensitive as never;
  for (const status of [sensitive, -1, 99, 600, 200.5, NaN, Infinity]) {
    diagnostics.start(sensitive as never, sensitive as never, status as never);
    const message = diagnostics.message({ status: 403, statusCode: 401 });
    assert.ok(
      message.includes(
        "etapa: configuração; verificação: contexto e configuração DEV; categoria: divergência de configuração; status HTTP: indisponível",
      ),
    );
    assert.ok(!message.includes("private-"));
  }
  assert.ok(output.every((line) => !line.includes("private-")));
});

test("diagnóstico alinhado ao Foundation: HTTP vem somente da resposta atual, incluindo 401 esperado do Levi", async () => {
  const diagnostics = new DeployDiagnostics();
  await diagnostics.request(
    "deployments-read",
    async () => new Response(sensitive, { status: 503 }),
  );
  assert.ok(
    diagnostics
      .message({ status: 401, statusCode: 403 })
      .includes("categoria: falha HTTP; status HTTP: 503"),
  );
  diagnostics.inspect("deployment-shape", "resposta inesperada");
  assert.ok(diagnostics.message(null).includes("status HTTP: 503"));
  const original = { cause: { code: "ENOTFOUND" }, status: 502 };
  await assert.rejects(
    diagnostics.request("version-read", async () => {
      throw original;
    }),
    (error) => error === original,
  );
  assert.ok(
    diagnostics
      .message(original)
      .includes(
        "categoria: erro de rede; status HTTP: indisponível; causa técnica: ENOTFOUND",
      ),
  );
  await diagnostics.request(
    "organizations-read",
    async () => new Response(null, { status: 401 }),
    401,
  );
  assert.ok(
    diagnostics
      .message(null)
      .includes("categoria: resposta inesperada; status HTTP: 401"),
  );
  diagnostics.start("local-head", "falha de operação local");
  assert.ok(
    diagnostics
      .message({ code: "ENOENT", status: 200 })
      .includes("status HTTP: indisponível; causa técnica: ENOENT"),
  );
});

test("diagnóstico alinhado ao Foundation: falha e duplicação do diagnóstico não alteram operações", async () => {
  const diagnostics = new DeployDiagnostics(() => {
    throw new Error(sensitive);
  });
  assert.equal(
    diagnostics.verify("version-tag", () => 42),
    42,
  );
  const original = Object.assign(new Error(sensitive), { code: "ECONNRESET" });
  const output: string[] = [];
  diagnostics.report(original, (line) => output.push(line));
  diagnostics.report(original, (line) => output.push(line));
  assert.equal(output.length, 1);
  assert.ok(!output[0]!.includes("private-"));
  const other = new Error(sensitive);
  diagnostics.message = () => {
    throw new Error(sensitive);
  };
  assert.doesNotThrow(() =>
    diagnostics.report(other, () =>
      assert.fail("Sem saída do classificador reprovado"),
    ),
  );
  await assert.rejects(
    diagnostics.request("version-read", async () => {
      throw other;
    }),
    (error) => error === other,
  );
});

test("diagnóstico: logger de progresso reprovado não impede sucesso e logger de erro não impede exit 1", async () => {
  const success = await simulatedDeploy({ failProgress: true });
  assert.equal(success.exitCode, 0);
  assert.equal(success.uploads, 1);
  assert.ok(success.output.includes("SHA ativo"));
  for (const cleanup of [false, true]) {
    const failure = await simulatedDeploy({
      failReport: true,
      ...(cleanup
        ? { cleanupError: new Error(sensitive) }
        : {
            respond: (url: string, published: boolean) =>
              published && url.endsWith("/deployments")
                ? new Response(sensitive, { status: 403 })
                : undefined,
          }),
    });
    assert.equal(failure.exitCode, 1);
    assert.equal(failure.uploads, 1);
    assert.equal(failure.cleanups, 1);
    assert.ok(!failure.output.includes("private-"));
  }
});

test("diagnóstico: status público reprovado é HTTP mesmo se cabeçalhos faltarem", async () => {
  const failure = await simulatedDeploy({
    respond: (url) =>
      url === "https://levi.t00ls.dev/"
        ? new Response(sensitive, { status: 503 })
        : undefined,
  });
  assert.equal(failure.exitCode, 1);
  assert.ok(
    failure.output.includes(
      "status e cabeçalhos da página inicial; categoria: falha HTTP; status HTTP: 503",
    ),
  );
  assert.ok(!failure.output.includes("private-"));
});

test("deploy não configura recorte de membros e aceita binding legado sem compará-lo", async () => {
  const parsed = ts.parseConfigFileTextToJson(
    "wrangler.jsonc",
    await readFile("wrangler.jsonc", "utf8"),
  );
  const config = deploymentConfig(parsed.config, valid.LEVI_HYPERDRIVE_ID!);
  assert.equal("LEVI_MEMBERS_DEV_ORGANIZATIONS" in config.vars, false);
  const workflow = await readFile(
    "../../.github/workflows/deploy-levi-dev.yml",
    "utf8",
  );
  assert.ok(!workflow.includes("MEMBERS_DEV_ORGANIZATIONS"));
  for (const text of ["", "invalid", "8a61d0dd-ea54-4f23-9550-d8ca4b353b71"]) {
    const result = await simulatedDeploy({
      respond: (url) =>
        url.includes("/versions/")
          ? Response.json({
              success: true,
              result: {
                annotations: {
                  "workers/tag": url.includes(versionId)
                    ? valid.GITHUB_SHA
                    : "e".repeat(40),
                },
                resources: {
                  bindings: [
                    ...baseBindings,
                    {
                      type: "plain_text",
                      name: "LEVI_MEMBERS_DEV_ORGANIZATIONS",
                      text,
                    },
                  ],
                },
              },
            })
          : undefined,
    });
    assert.equal(result.exitCode, 0, result.output);
    assert.equal(result.uploads, 1);
    assert.deepEqual(result.writtenVars, {
      ...parsed.config.vars,
      LEVI_EMAIL_FROM: valid.LEVI_EMAIL_FROM,
    });
  }
});

test("versão ativa exige binding único e ID esperado", async () => {
  const binding = {
    type: "hyperdrive",
    name: "HYPERDRIVE",
    id: valid.LEVI_HYPERDRIVE_ID,
  };
  verifyWorkerBindings({ resources: { bindings: baseBindings } }, valid);
  for (const bindings of [
    [],
    [binding, binding],
    [{ ...binding, id: "d".repeat(32) }],
    [{ ...binding, name: "OTHER" }],
  ]) {
    assert.throws(() =>
      verifyWorkerBindings({ resources: { bindings } }, valid),
    );
    const result = await simulatedDeploy({
      respond: (url) =>
        url.includes("/versions/")
          ? Response.json({
              success: true,
              result: {
                annotations: { "workers/tag": valid.GITHUB_SHA },
                resources: { bindings },
              },
            })
          : undefined,
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.uploads, 0);
    assert.equal(result.writes.length, 0);
    assert.ok(
      result.output.includes("bindings, remetente e recorte da versão ativa"),
    );
    assert.ok(
      !result.requests.some((url) => url.startsWith("https://levi.t00ls.dev")),
    );
  }
});

test("smoke exige membros bloqueados e não registra corpo de resposta divergente", async () => {
  const result = await simulatedDeploy({
    respond: (url) =>
      url === "https://levi.t00ls.dev/api/members"
        ? new Response(sensitive)
        : undefined,
  });
  assert.equal(result.exitCode, 1);
  assert.ok(result.output.includes("recorte de membros e cabeçalhos"));
  assert.ok(!result.output.includes("private-"));
});

test("deploy não envia um SHA que ficou obsoleto durante a preparação", async () => {
  let reads = 0;
  const result = await simulatedDeploy({
    respond: (url) => {
      if (!url.startsWith("https://api.github.com/")) return undefined;
      reads++;
      return Response.json({
        object: { sha: reads === 1 ? valid.GITHUB_SHA : "f".repeat(40) },
      });
    },
  });
  assert.equal(reads, 2);
  assert.equal(result.exitCode, 1);
  assert.equal(result.uploads, 0);
  assert.equal(result.cleanups, 1);
});

test("deploy recusa CI substituída imediatamente antes do upload e limpa arquivos privados", async () => {
  for (const scenario of ["attempt", "run"] as const) {
    const result = await simulatedDeploy({
      ciEvidence: (call) => ({
        sha: valid.GITHUB_SHA!,
        runId: scenario === "run" && call === 2 ? 2 : 1,
        attempt: scenario === "attempt" && call === 2 ? 2 : 1,
      }),
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.uploads, 0);
    assert.equal(result.cleanups, 1);
    assert.ok(
      result.output.includes("evidência CI inalterada antes do upload"),
    );
  }
});

test("transferência recusa Worker/domínio ausente e 403 antes de arquivos ou upload", async () => {
  for (const [path, response] of [
    ["/subdomain", new Response(null, { status: 404 })],
    ["/workers/domains", Response.json({ success: true, result: [] })],
    ["/deployments", new Response(null, { status: 403 })],
    ["/versions", new Response(null, { status: 403 })],
  ] as const) {
    const result = await simulatedDeploy({
      respond: (url) =>
        new URL(url).pathname.endsWith(path) ? response : undefined,
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.writes.length, 0);
    assert.equal(result.uploads, 0);
    assert.equal(result.cleanups, 0);
  }
});

test("transferência preserva secrets remotos sem exigir nem encaminhar cópias GitHub", async () => {
  const result = await simulatedDeploy({
    env: {
      LEVI_AUTH_SECRET: undefined,
      RESEND_API_KEY: undefined,
    },
  });
  assert.equal(result.exitCode, 0, result.output);
  assert.equal(result.uploads, 1);
  assert.equal(result.writes.length, 1);
  assert.ok(result.writes[0]!.path.endsWith("wrangler.json"));
  assert.ok(result.output.includes(previousVersionId));
});

test("transferência bloqueia divergência de remetente e ausência de Assets/secrets", async () => {
  for (const bindings of [
    baseBindings.filter((b) => b.name !== "ASSETS"),
    baseBindings.filter((b) => b.name !== "LEVI_AUTH_SECRET"),
    baseBindings.filter((b) => b.name !== "RESEND_API_KEY"),
    baseBindings.map((b) =>
      b.name === "LEVI_EMAIL_FROM" ? { ...b, text: sensitive } : b,
    ),
    [...baseBindings, { type: "secret_text", name: "LEVI_AUTH_SECRET" }],
  ]) {
    const result = await simulatedDeploy({
      respond: (url) =>
        url.includes("/versions/")
          ? Response.json({
              success: true,
              result: {
                annotations: { "workers/tag": "e".repeat(40) },
                resources: { bindings },
              },
            })
          : undefined,
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.uploads, 0);
    assert.equal(result.writes.length, 0);
    assert.ok(!result.output.includes("private-"));
  }
});

test("transferência não herda secrets de versão enviada sem tráfego", async () => {
  const result = await simulatedDeploy({
    respond: (url) =>
      url.endsWith("/versions")
        ? Response.json({
            success: true,
            result: { items: [{ id: versionId }] },
          })
        : undefined,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.uploads, 0);
  assert.equal(result.writes.length, 0);
  assert.ok(
    result.output.includes("última versão enviada igual à versão ativa"),
  );
});

test("transferência interrompe se versão ativa mudar entre preflight e upload", async () => {
  let reads = 0;
  const result = await simulatedDeploy({
    respond: (url) => {
      if (url.endsWith("/deployments")) reads++;
      if (reads < 2) return undefined;
      if (url.endsWith("/deployments"))
        return Response.json({
          success: true,
          result: {
            deployments: [
              { versions: [{ version_id: versionId, percentage: 100 }] },
            ],
          },
        });
      if (url.endsWith("/versions"))
        return Response.json({
          success: true,
          result: { items: [{ id: versionId }] },
        });
      return undefined;
    },
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.uploads, 0);
  assert.equal(result.cleanups, 1);
  assert.ok(result.output.includes("versão ativa inalterada antes do upload"));
});

test("smokes administrativos exigem 404 e no-store sem expor respostas", async () => {
  for (const path of ["/admin", "/api/admin/session"]) {
    for (const status of [200, 404]) {
      const result = await simulatedDeploy({
        respond: (url) =>
          url === `https://levi.t00ls.dev${path}`
            ? new Response(sensitive, {
                status,
                headers: {
                  "referrer-policy": "no-referrer",
                  "content-security-policy": "default-src 'self'",
                },
              })
            : undefined,
      });
      assert.equal(result.exitCode, 1);
      assert.equal(result.uploads, 1);
      assert.ok(!result.output.includes("private-"));
    }
  }
});

test("domínio exige roteamento público ativo e previews fechados antes e depois do upload", async () => {
  for (const published of [false, true]) {
    for (const state of [
      { enabled: false, previews_enabled: true },
      { enabled: true, previews_enabled: true },
      { enabled: true },
      { previews_enabled: false },
      { enabled: "true", previews_enabled: false },
      { enabled: true, previews_enabled: "false" },
    ]) {
      const result = await simulatedDeploy({
        respond: (url, uploaded) =>
          uploaded === published &&
          new URL(url).pathname.endsWith("/workers/domains")
            ? Response.json({
                success: true,
                result: [
                  {
                    hostname: "levi.t00ls.dev",
                    service: "levi-dev",
                    zone_id: valid.CLOUDFLARE_ZONE_ID,
                    ...state,
                  },
                ],
              })
            : undefined,
      });
      assert.equal(result.exitCode, 1, JSON.stringify({ published, state }));
      assert.equal(result.uploads, published ? 1 : 0);
      assert.equal(result.writes.length, published ? 1 : 0);
      assert.equal(result.cleanups, published ? 1 : 0);
      assert.ok(result.output.includes("custom domains exclusivos do Levi"));
      assert.ok(
        !result.requests.some((url) =>
          url.startsWith("https://levi.t00ls.dev"),
        ),
      );
    }
  }
});
