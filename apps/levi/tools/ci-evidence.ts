import assert from "node:assert/strict";
import { DeployDiagnostics } from "./deploy-diagnostics.js";
import type { DeployCheck } from "./deploy-diagnostics.js";

const repository = "t00ls-dev/foundation";

interface GitHubRepository {
  full_name?: string;
}

interface GitHubRun {
  id?: number;
  workflow_id?: number;
  path?: string;
  run_attempt?: number;
  repository?: GitHubRepository;
  head_repository?: GitHubRepository;
  event?: string;
  head_branch?: string;
  head_sha?: string;
  status?: string;
  conclusion?: string | null;
}

interface GitHubWorkflow {
  id?: number;
  path?: string;
  state?: string;
}

interface GitHubRef {
  object?: { sha?: string };
}

interface GitHubRuns {
  workflow_runs?: GitHubRun[];
}

interface GitHubJob extends GitHubRun {
  name?: string;
  run_id?: number;
}

interface GitHubJobs {
  total_count?: number;
  jobs?: GitHubJob[];
}

export function validateCIRun(
  run: GitHubRun,
  sha: string,
  workflowId: number,
): void {
  assert.equal(run.workflow_id, workflowId);
  assert.equal(run.path, ".github/workflows/ci.yml");
  assert.equal(run.repository?.full_name, repository);
  assert.equal(run.head_repository?.full_name, repository);
  assert.equal(run.event, "push");
  assert.equal(run.head_branch, "master");
  assert.equal(run.head_sha, sha);
  assert.equal(run.status, "completed");
  assert.equal(run.conclusion, "success");
  assert.ok(
    typeof run.id === "number" && Number.isSafeInteger(run.id) && run.id > 0,
  );
  assert.ok(
    typeof run.run_attempt === "number" &&
      Number.isSafeInteger(run.run_attempt) &&
      run.run_attempt > 0,
  );
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
  async function github(check: DeployCheck, path: string): Promise<unknown> {
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
    const body: unknown = await response.json();
    return body;
  }
  const main = (await github("main-read", "git/ref/heads/master")) as GitHubRef;
  diagnostics.inspect("main-sha");
  assert.equal(main.object?.sha, sha);
  const workflow = (await github(
    "ci-workflow-read",
    "actions/workflows/ci.yml",
  )) as GitHubWorkflow;
  diagnostics.inspect("ci-workflow");
  assert.equal(workflow.path, ".github/workflows/ci.yml");
  assert.equal(workflow.state, "active");
  const workflowId = workflow.id;
  assert.ok(typeof workflowId === "number" && Number.isSafeInteger(workflowId));
  const runsPath = `actions/workflows/${workflowId}/runs?event=push&branch=master&head_sha=${sha}&per_page=10`;
  const runs = (await github("ci-runs-read", runsPath)) as GitHubRuns;
  diagnostics.inspect("ci-runs", "resposta inesperada");
  const workflowRuns = runs.workflow_runs;
  assert.ok(Array.isArray(workflowRuns) && workflowRuns.length > 0);
  const runId = workflowRuns[0]?.id;
  diagnostics.inspect("ci-run-id");
  assert.ok(
    typeof runId === "number" && Number.isSafeInteger(runId) && runId > 0,
  );
  const run = (await github(
    "ci-run-read",
    `actions/runs/${runId}`,
  )) as GitHubRun;
  diagnostics.inspect("ci-run");
  validateCIRun(run, sha, workflowId);
  assert.equal(run.id, runId);
  const runAttempt = run.run_attempt;
  assert.ok(
    typeof runAttempt === "number" &&
      Number.isSafeInteger(runAttempt) &&
      runAttempt > 0,
  );
  diagnostics.inspect("ci-attempt");
  const jobs = (await github(
    "ci-jobs-read",
    `actions/runs/${runId}/attempts/${runAttempt}/jobs?per_page=100`,
  )) as GitHubJobs;
  diagnostics.inspect("ci-jobs-shape", "resposta inesperada");
  const jobEntries = jobs.jobs;
  assert.ok(Array.isArray(jobEntries));
  assert.equal(jobs.total_count, jobEntries.length);
  const checks = jobEntries.filter((job) => job.name === "checks");
  diagnostics.inspect("ci-job");
  assert.equal(checks.length, 1);
  const check = checks[0];
  assert.ok(check);
  assert.equal(check.status, "completed");
  assert.equal(check.run_id, run.id);
  assert.equal(check.run_attempt, runAttempt);
  assert.equal(check.conclusion, "success");
  assert.equal(check.head_sha, sha);
  // Mesmo padrão do validador raiz: não reutiliza tentativa/run substituídos
  // enquanto a evidência era consultada, nem um SHA que deixou de ser master.
  const current = (await github(
    "ci-run-read",
    `actions/runs/${runId}`,
  )) as GitHubRun;
  diagnostics.inspect("ci-attempt");
  validateCIRun(current, sha, workflowId);
  assert.equal(current.id, runId);
  assert.equal(current.run_attempt, runAttempt);
  const latest = (await github("ci-runs-read", runsPath)) as GitHubRuns;
  diagnostics.inspect("ci-runs");
  const latestRuns = latest.workflow_runs;
  assert.ok(Array.isArray(latestRuns));
  assert.equal(latestRuns[0]?.id, runId);
  const master = (await github(
    "main-read",
    "git/ref/heads/master",
  )) as GitHubRef;
  diagnostics.inspect("main-sha");
  assert.equal(master.object?.sha, sha);
  return { sha, runId, attempt: runAttempt };
}
