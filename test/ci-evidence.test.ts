import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requireSuccessfulCI, validateCIRun } from "../tools/ci-evidence.js";
import { DeployDiagnostics } from "../tools/deploy-diagnostics.js";

const sha = "a".repeat(40);
const run = {
  id: 101,
  workflow_id: 202,
  run_attempt: 2,
  repository: { full_name: "t00ls-dev/levi" },
  head_repository: { full_name: "t00ls-dev/levi" },
  event: "push",
  head_branch: "main",
  head_sha: sha,
  status: "completed",
  conclusion: "success",
};
const env: NodeJS.ProcessEnv = {
  GITHUB_ACTIONS: "true",
  GITHUB_REPOSITORY: "t00ls-dev/levi",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REF: "refs/heads/main",
  GITHUB_SHA: sha,
  LEVI_DEPLOY_SHA: sha,
  GITHUB_TOKEN: "synthetic-only",
};
function api(changes: Record<string, unknown> = {}): typeof fetch {
  return async (url, options) => {
    assert.equal(
      new Headers(options?.headers).get("Authorization"),
      "Bearer synthetic-only",
    );
    assert.equal(options?.redirect, "error");
    const path = String(url).replace(
      "https://api.github.com/repos/t00ls-dev/levi/",
      "",
    );
    const responses: Record<string, unknown> = {
      "git/ref/heads/main": { object: { sha } },
      "actions/workflows/ci.yml": {
        id: 202,
        path: ".github/workflows/ci.yml",
        state: "active",
      },
      [`actions/workflows/202/runs?event=push&branch=main&head_sha=${sha}&per_page=10`]:
        { workflow_runs: [run] },
      "actions/runs/101": run,
      "actions/runs/101/attempts/2/jobs?per_page=100": {
        total_count: 1,
        jobs: [
          {
            name: "checks",
            status: "completed",
            conclusion: "success",
            head_sha: sha,
          },
        ],
      },
      ...changes,
    };
    assert.ok(path in responses);
    return Response.json(responses[path]);
  };
}

test("CI: aceita somente push canônico na main, SHA exato e tentativa atual concluída", () => {
  validateCIRun(run, sha, 202);
  for (const changes of [
    { workflow_id: 203 },
    { repository: { full_name: "other/levi" } },
    { head_repository: { full_name: "fork/levi" } },
    { event: "pull_request" },
    { event: "workflow_dispatch" },
    { head_branch: "feature" },
    { head_sha: "b".repeat(40) },
    { status: "in_progress" },
    { conclusion: "failure" },
    { conclusion: "skipped" },
    { run_attempt: 0 },
  ])
    assert.throws(() => validateCIRun({ ...run, ...changes }, sha, 202));
});

test("CI: recuperação manual exige CI aprovada do SHA atual e job checks efetivamente aprovado", async () => {
  assert.deepEqual(await requireSuccessfulCI(env, api()), {
    sha,
    runId: 101,
    attempt: 2,
  });
  for (const changes of [
    { "git/ref/heads/main": { object: { sha: "b".repeat(40) } } },
    {
      "actions/workflows/ci.yml": {
        id: 202,
        path: "other.yml",
        state: "active",
      },
    },
    { "actions/runs/101": { ...run, conclusion: "failure" } },
    {
      "actions/runs/101/attempts/2/jobs?per_page=100": {
        total_count: 0,
        jobs: [],
      },
    },
    {
      "actions/runs/101/attempts/2/jobs?per_page=100": {
        total_count: 1,
        jobs: [
          {
            name: "checks",
            status: "completed",
            conclusion: "skipped",
            head_sha: sha,
          },
        ],
      },
    },
    {
      "actions/runs/101/attempts/2/jobs?per_page=100": {
        total_count: 1,
        jobs: [
          {
            name: "checks",
            status: "completed",
            conclusion: "success",
            head_sha: "b".repeat(40),
          },
        ],
      },
    },
  ])
    await assert.rejects(requireSuccessfulCI(env, api(changes)));
  await assert.rejects(
    requireSuccessfulCI(env, async () => new Response(null, { status: 403 })),
  );
  await assert.rejects(
    requireSuccessfulCI({ ...env, GITHUB_EVENT_NAME: "pull_request" }, api()),
  );
});

test("CI: workflow_run recusa evento antigo quando houve nova tentativa", async () => {
  const directory = await mkdtemp(join(tmpdir(), "levi-ci-"));
  const file = join(directory, "event.json");
  const automatic = {
    ...env,
    GITHUB_EVENT_NAME: "workflow_run",
    GITHUB_EVENT_PATH: file,
  };
  try {
    await writeFile(
      file,
      JSON.stringify({ workflow_run: { id: 101, run_attempt: 2 } }),
    );
    assert.equal((await requireSuccessfulCI(automatic, api())).sha, sha);
    await writeFile(
      file,
      JSON.stringify({ workflow_run: { id: 101, run_attempt: 1 } }),
    );
    await assert.rejects(requireSuccessfulCI(automatic, api()));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("workflows públicos: CI sem secrets, deploy guardado, checkout confiável e migrations separadas", async () => {
  const ci = await readFile(".github/workflows/ci.yml", "utf8");
  const deploy = await readFile(".github/workflows/deploy-dev.yml", "utf8");
  assert.ok(ci.includes("pull_request:") && ci.includes("push:"));
  assert.ok(!ci.includes("secrets.") && !ci.includes("pull_request_target"));
  assert.ok(
    deploy.includes("workflow_run:") && deploy.includes("workflow_dispatch:"),
  );
  assert.ok(deploy.includes("vars.LEVI_DEV_DEPLOY_ENABLED == 'true'"));
  assert.ok(deploy.includes("github.event.workflow_run.event == 'push'"));
  assert.ok(
    deploy.includes(
      "github.event.workflow_run.head_repository.full_name == 't00ls-dev/levi'",
    ),
  );
  assert.ok(deploy.includes("ref: ${{ github.sha }}"));
  assert.ok(deploy.includes("persist-credentials: false"));
  for (const file of [ci, deploy]) {
    assert.ok(!file.includes("db:migrate") && !file.includes("migrate-dev.ts"));
    assert.ok(
      !file.includes("contents: write") &&
        !file.includes("pull_request_target"),
    );
  }
});

test("CI: diagnóstico identifica HTTP, JSON inválido e job reprovado sem expor respostas", async () => {
  for (const [request, check, category, status] of [
    [
      async () => new Response("private-response", { status: 403 }),
      "consulta da main remota",
      "falha HTTP",
      "403",
    ],
    [
      async () => new Response("private-invalid-json"),
      "consulta da main remota",
      "resposta inesperada",
      "200",
    ],
    [
      api({
        "actions/runs/101/attempts/2/jobs?per_page=100": {
          total_count: 1,
          jobs: [
            {
              name: "checks",
              status: "completed",
              conclusion: "failure",
              head_sha: sha,
            },
          ],
        },
      }),
      "job checks aprovado no SHA",
      "divergência de configuração",
      "200",
    ],
  ] as const) {
    const diagnostics = new DeployDiagnostics();
    diagnostics.phase = "ci";
    await assert.rejects(
      requireSuccessfulCI(env, request, diagnostics),
      (error) => {
        const message = diagnostics.message(error);
        assert.ok(
          message.includes(
            `etapa: CI aprovada do SHA atual; verificação: ${check}; categoria: ${category}; status HTTP: ${status}`,
          ),
        );
        assert.ok(
          !message.includes("private-") && !message.includes("synthetic-only"),
        );
        return true;
      },
    );
  }
});
