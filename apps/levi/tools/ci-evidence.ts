import assert from "node:assert/strict";
import { DeployDiagnostics } from "./deploy-diagnostics.js";
import type { DeployCheck } from "./deploy-diagnostics.js";

const repository = "t00ls-dev/foundation";
export function validateCIRun(
  run: Record<string, any>,
  sha: string,
  workflowId: number,
) {
  assert.equal(run.workflow_id, workflowId);
  assert.equal(run.path, ".github/workflows/ci.yml");
  assert.equal(run.repository?.full_name, repository);
  assert.equal(run.head_repository?.full_name, repository);
  assert.equal(run.event, "push");
  assert.equal(run.head_branch, "master");
  assert.equal(run.head_sha, sha);
  assert.equal(run.status, "completed");
  assert.equal(run.conclusion, "success");
  assert.ok(Number.isSafeInteger(run.id) && run.id > 0);
  assert.ok(Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0);
}

// Sem artifacts/código de PR: comprova o workflow canônico e a tentativa atual.
export async function requireSuccessfulCI(
  env: NodeJS.ProcessEnv,
  request: typeof fetch = fetch,
  diagnostics = new DeployDiagnostics(),
) {
  diagnostics.start("ci-context");
  assert.equal(env.GITHUB_ACTIONS, "true");
  assert.equal(env.GITHUB_REPOSITORY, repository);
  assert.equal(env.GITHUB_REF, "refs/heads/master");
  assert.equal(env.GITHUB_EVENT_NAME, "workflow_dispatch");
  const sha = env.LEVI_DEPLOY_SHA ?? "";
  assert.match(sha, /^[a-f0-9]{40}$/);
  assert.equal(sha, env.GITHUB_SHA);
  assert.ok(env.GITHUB_TOKEN);
  async function github(check: DeployCheck, path: string): Promise<any> {
    const response = await diagnostics.request(check, () =>
      request(`https://api.github.com/repos/${repository}/${path}`, {
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
        },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      }),
    );
    diagnostics.httpOk(response);
    return response.json();
  }
  const main = await github("main-read", "git/ref/heads/master");
  diagnostics.inspect("main-sha");
  assert.equal(main.object?.sha, sha);
  const workflow = await github("ci-workflow-read", "actions/workflows/ci.yml");
  diagnostics.inspect("ci-workflow");
  assert.equal(workflow.path, ".github/workflows/ci.yml");
  assert.equal(workflow.state, "active");
  assert.ok(Number.isSafeInteger(workflow.id));
  const runsPath = `actions/workflows/${workflow.id}/runs?event=push&branch=master&head_sha=${sha}&per_page=10`;
  const runs = await github("ci-runs-read", runsPath);
  diagnostics.inspect("ci-runs", "resposta inesperada");
  assert.ok(Array.isArray(runs.workflow_runs) && runs.workflow_runs.length > 0);
  const runId = runs.workflow_runs[0].id;
  diagnostics.inspect("ci-run-id");
  assert.ok(Number.isSafeInteger(runId) && runId > 0);
  const run = await github("ci-run-read", `actions/runs/${runId}`);
  diagnostics.inspect("ci-run");
  validateCIRun(run, sha, workflow.id);
  assert.equal(run.id, runId);
  diagnostics.inspect("ci-attempt");
  const jobs = await github(
    "ci-jobs-read",
    `actions/runs/${runId}/attempts/${run.run_attempt}/jobs?per_page=100`,
  );
  diagnostics.inspect("ci-jobs-shape", "resposta inesperada");
  assert.ok(Array.isArray(jobs.jobs) && jobs.total_count === jobs.jobs.length);
  const checks = jobs.jobs.filter(
    (job: Record<string, any>) => job.name === "checks",
  );
  diagnostics.inspect("ci-job");
  assert.equal(checks.length, 1);
  assert.equal(checks[0].status, "completed");
  assert.equal(checks[0].run_id, run.id);
  assert.equal(checks[0].run_attempt, run.run_attempt);
  assert.equal(checks[0].conclusion, "success");
  assert.equal(checks[0].head_sha, sha);
  // Mesmo padrão do validador raiz: não reutiliza tentativa/run substituídos
  // enquanto a evidência era consultada, nem um SHA que deixou de ser master.
  const current = await github("ci-run-read", `actions/runs/${runId}`);
  diagnostics.inspect("ci-attempt");
  validateCIRun(current, sha, workflow.id);
  assert.equal(current.id, runId);
  assert.equal(current.run_attempt, run.run_attempt);
  const latest = await github("ci-runs-read", runsPath);
  diagnostics.inspect("ci-runs");
  assert.ok(Array.isArray(latest.workflow_runs));
  assert.equal(latest.workflow_runs[0]?.id, runId);
  const master = await github("main-read", "git/ref/heads/master");
  diagnostics.inspect("main-sha");
  assert.equal(master.object?.sha, sha);
  return { sha, runId, attempt: run.run_attempt as number };
}
