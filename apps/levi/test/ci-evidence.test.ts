import assert from "node:assert/strict";
import { test } from "node:test";
import { requireSuccessfulCI, validateCIRun } from "../tools/ci-evidence.js";
import { DeployDiagnostics } from "../tools/deploy-diagnostics.js";

const sha = "a".repeat(40);
const run = {
  id: 101,
  workflow_id: 202,
  path: ".github/workflows/ci.yml",
  run_attempt: 2,
  repository: { full_name: "t00ls-dev/foundation" },
  head_repository: { full_name: "t00ls-dev/foundation" },
  event: "push",
  head_branch: "master",
  head_sha: sha,
  status: "completed",
  conclusion: "success",
};
const env: NodeJS.ProcessEnv = {
  GITHUB_ACTIONS: "true",
  GITHUB_REPOSITORY: "t00ls-dev/foundation",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REF: "refs/heads/master",
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
    const path = (url instanceof Request ? url.url : url.toString()).replace(
      "https://api.github.com/repos/t00ls-dev/foundation/",
      "",
    );
    const responses: Record<string, unknown> = {
      "git/ref/heads/master": { object: { sha } },
      "actions/workflows/ci.yml": {
        id: 202,
        path: ".github/workflows/ci.yml",
        state: "active",
      },
      [`actions/workflows/202/runs?event=push&branch=master&head_sha=${sha}&per_page=10`]:
        { workflow_runs: [run] },
      "actions/runs/101": run,
      "actions/runs/101/attempts/2/jobs?per_page=100": {
        total_count: 1,
        jobs: [
          {
            name: "checks",
            run_id: 101,
            run_attempt: 2,
            status: "completed",
            conclusion: "success",
            head_sha: sha,
          },
        ],
      },
      ...changes,
    };
    assert.ok(path in responses);
    return Promise.resolve(Response.json(responses[path]));
  };
}

void test("CI: aceita somente push canônico na master, SHA exato e tentativa atual concluída", () => {
  validateCIRun(run, sha, 202);
  for (const changes of [
    { workflow_id: 203 },
    { path: ".github/workflows/other.yml" },
    { repository: { full_name: "other/levi" } },
    { head_repository: { full_name: "fork/levi" } },
    { event: "pull_request" },
    { event: "workflow_dispatch" },
    { head_branch: "main" },
    { head_branch: "feature" },
    { head_sha: "b".repeat(40) },
    { status: "in_progress" },
    { conclusion: "failure" },
    { conclusion: "skipped" },
    { run_attempt: 0 },
  ])
    assert.throws(() => validateCIRun({ ...run, ...changes }, sha, 202));
});

void test("CI: contexto manual inválido é recusado antes de qualquer request", async () => {
  for (const changes of [
    { GITHUB_ACTIONS: "false" },
    { GITHUB_REPOSITORY: "t00ls-dev/levi" },
    { GITHUB_REPOSITORY: "fork/foundation" },
    { GITHUB_REF: "refs/heads/main" },
    { GITHUB_REF: "refs/pull/150/merge" },
    { GITHUB_EVENT_NAME: "workflow_run" },
    { GITHUB_EVENT_NAME: "pull_request" },
    { GITHUB_EVENT_NAME: "push" },
    { LEVI_DEPLOY_SHA: "" },
    { LEVI_DEPLOY_SHA: "invalid" },
    { LEVI_DEPLOY_SHA: "b".repeat(40) },
    { GITHUB_TOKEN: "" },
  ]) {
    let requests = 0;
    await assert.rejects(
      requireSuccessfulCI({ ...env, ...changes }, async () => {
        requests++;
        return Promise.resolve(Response.json({}));
      }),
    );
    assert.equal(requests, 0);
  }
});

void test("CI: falha fechada para checks ausente, duplicado, incompleto ou de outra tentativa", async () => {
  const check = {
    name: "checks",
    run_id: 101,
    run_attempt: 2,
    status: "completed",
    conclusion: "success",
    head_sha: sha,
  };
  const path = "actions/runs/101/attempts/2/jobs?per_page=100";
  for (const jobs of [
    [],
    [check, check],
    [{ ...check, name: "other" }],
    ...["failure", "cancelled", "skipped", "action_required", null].map(
      (conclusion) => [{ ...check, conclusion }],
    ),
    [{ ...check, status: "in_progress" }],
    [{ ...check, run_attempt: 1 }],
    [{ ...check, run_id: 100 }],
  ])
    await assert.rejects(
      requireSuccessfulCI(
        env,
        api({ [path]: { total_count: jobs.length, jobs } }),
      ),
    );
  await assert.rejects(
    requireSuccessfulCI(
      env,
      api({ [path]: { total_count: 101, jobs: [check] } }),
    ),
  );
});

void test("CI: recusa tentativa/run substituídos e master avançada durante a consulta", async () => {
  for (const scenario of ["attempt", "new-run", "master", "failure"] as const) {
    const counts = new Map<string, number>();
    const original = api();
    await assert.rejects(
      requireSuccessfulCI(env, async (url, options) => {
        const path = new URL(url instanceof Request ? url.url : url.toString())
          .pathname;
        const count = (counts.get(path) ?? 0) + 1;
        counts.set(path, count);
        if (count === 2) {
          if (path.endsWith("/actions/runs/101")) {
            if (scenario === "attempt")
              return Response.json({ ...run, run_attempt: 3 });
            if (scenario === "failure")
              return Response.json({ ...run, conclusion: "failure" });
          }
          if (scenario === "new-run" && path.endsWith("/workflows/202/runs"))
            return Response.json({ workflow_runs: [{ ...run, id: 102 }] });
          if (scenario === "master" && path.endsWith("/git/ref/heads/master"))
            return Response.json({ object: { sha: "b".repeat(40) } });
        }
        return original(url, options);
      }),
    );
  }
});

void test("CI: recuperação manual exige CI aprovada do SHA atual e job checks efetivamente aprovado", async () => {
  assert.deepEqual(await requireSuccessfulCI(env, api()), {
    sha,
    runId: 101,
    attempt: 2,
  });
  for (const changes of [
    { "git/ref/heads/master": { object: { sha: "b".repeat(40) } } },
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
            run_id: 101,
            run_attempt: 2,
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
            run_id: 101,
            run_attempt: 2,
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
    requireSuccessfulCI(env, async () =>
      Promise.resolve(new Response(null, { status: 403 })),
    ),
  );
  await assert.rejects(
    requireSuccessfulCI({ ...env, GITHUB_EVENT_NAME: "pull_request" }, api()),
  );
});

void test("CI: diagnóstico identifica HTTP, JSON inválido e job reprovado sem expor respostas", async () => {
  for (const [request, check, category, status] of [
    [
      async () =>
        Promise.resolve(new Response("private-response", { status: 403 })),
      "consulta da master remota",
      "falha HTTP",
      "403",
    ],
    [
      async () => Promise.resolve(new Response("private-invalid-json")),
      "consulta da master remota",
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
              run_id: 101,
              run_attempt: 2,
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

void test("CI: preserva a exceção original mesmo quando o diagnóstico recebe Proxy e o sink falha", async () => {
  let touched = 0;
  const original: unknown = new Proxy(
    {},
    {
      get() {
        touched++;
        throw new Error("private-diagnostic-error");
      },
    },
  );
  const diagnostics = new DeployDiagnostics(() => {
    throw new Error("private-logger-error");
  });
  diagnostics.phase = "ci";
  let caught: unknown;
  try {
    await requireSuccessfulCI(
      env,
      () =>
        new Promise<Response>(() => {
          throw original;
        }),
      diagnostics,
    );
  } catch (error) {
    caught = error;
    diagnostics.report(error, () => {
      throw new Error("private-logger-error");
    });
  }
  assert.equal(caught, original);
  assert.equal(touched, 0);
  assert.ok(diagnostics.message(caught).includes("categoria: erro de rede"));
  assert.ok(!diagnostics.message(caught).includes("private-"));
});
