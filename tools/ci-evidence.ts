import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const repository = "t00ls-dev/levi";
export function validateCIRun(
  run: Record<string, any>,
  sha: string,
  workflowId: number,
) {
  assert.equal(run.workflow_id, workflowId);
  assert.equal(run.repository?.full_name, repository);
  assert.equal(run.head_repository?.full_name, repository);
  assert.equal(run.event, "push");
  assert.equal(run.head_branch, "main");
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
) {
  assert.equal(env.GITHUB_ACTIONS, "true");
  assert.equal(env.GITHUB_REPOSITORY, repository);
  assert.equal(env.GITHUB_REF, "refs/heads/main");
  assert.ok(
    ["workflow_dispatch", "workflow_run"].includes(env.GITHUB_EVENT_NAME ?? ""),
  );
  const sha = env.LEVI_DEPLOY_SHA ?? "";
  assert.match(sha, /^[a-f0-9]{40}$/);
  assert.equal(sha, env.GITHUB_SHA);
  assert.ok(env.GITHUB_TOKEN);
  async function github(path: string): Promise<any> {
    const response = await request(
      `https://api.github.com/repos/${repository}/${path}`,
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
    return response.json();
  }
  assert.equal((await github("git/ref/heads/main")).object?.sha, sha);
  const workflow = await github("actions/workflows/ci.yml");
  assert.equal(workflow.path, ".github/workflows/ci.yml");
  assert.equal(workflow.state, "active");
  assert.ok(Number.isSafeInteger(workflow.id));
  let runId: number;
  let triggeringAttempt: number | undefined;
  if (env.GITHUB_EVENT_NAME === "workflow_run") {
    const event = JSON.parse(
      await readFile(env.GITHUB_EVENT_PATH ?? "", "utf8"),
    );
    runId = event.workflow_run?.id;
    triggeringAttempt = event.workflow_run?.run_attempt;
    assert.ok(Number.isSafeInteger(triggeringAttempt));
  } else {
    const runs = await github(
      `actions/workflows/${workflow.id}/runs?event=push&branch=main&head_sha=${sha}&per_page=10`,
    );
    assert.ok(
      Array.isArray(runs.workflow_runs) && runs.workflow_runs.length > 0,
    );
    runId = runs.workflow_runs[0].id;
  }
  assert.ok(Number.isSafeInteger(runId) && runId > 0);
  const run = await github(`actions/runs/${runId}`);
  validateCIRun(run, sha, workflow.id);
  if (triggeringAttempt !== undefined)
    assert.equal(run.run_attempt, triggeringAttempt);
  const jobs = await github(
    `actions/runs/${runId}/attempts/${run.run_attempt}/jobs?per_page=100`,
  );
  assert.ok(Array.isArray(jobs.jobs) && jobs.total_count === jobs.jobs.length);
  const checks = jobs.jobs.filter(
    (job: Record<string, any>) => job.name === "checks",
  );
  assert.equal(checks.length, 1);
  assert.equal(checks[0].status, "completed");
  assert.equal(checks[0].conclusion, "success");
  assert.equal(checks[0].head_sha, sha);
  return { sha, runId, attempt: run.run_attempt as number };
}
