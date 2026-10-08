import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";
import {
  deploySummary,
  migrationSummary,
  writeDeploySummary,
} from "./deploy-summary.mjs";
import { migrationPlan } from "./migrations.mjs";

// Unmodified sanitized operation report from Deploy DEV #84 (artifact expand).
const fixture = () =>
  JSON.parse(
    readFileSync(
      new URL("./fixtures/deploy-summary/expand.json", import.meta.url),
      "utf8",
    ),
  );
const render = (report) => migrationSummary(report, { phase: report.phase });
const deploy = () => ({
  phase: "deploy",
  jobStatus: "success",
  sha: fixture().sha,
  runId: fixture().runId,
  attempt: "1",
  steps: {
    ci: { outcome: "success", outputs: { sha: fixture().sha } },
    schema: { outcome: "success" },
    publish: { outcome: "success" },
    health: { outcome: "success" },
  },
});

test("successful deploy uses final step outcomes and retains identity links", () => {
  const md = deploySummary(deploy());
  assert.match(md, /\| Deploy \| Succeeded \|/);
  assert.match(md, /\| Saúde SHA \/ D1 \| Succeeded \|/);
  assert.match(md, /37793245375\/attempts\/1/);
  assert.match(md, new RegExp(fixture().sha));
  assert(!md.includes("```json"));
  const validate = deploySummary({ ...deploy(), phase: "validate" });
  assert.match(validate, /## VALIDATE/);
  assert.match(validate, /Não avaliado neste job/);
});

test("executed migration is counted separately from already applied", () => {
  const report = fixture();
  report.operations[0] = {
    ...report.operations[0],
    result: "applied",
    id: "37793245375-1-0001_better_auth.sql",
    hash: "a".repeat(64),
    sha: report.sha,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
  };
  const before = JSON.stringify(report);
  const md = render(report);
  assert.match(md, /\| Executadas nesta operação \| 1 \|/);
  assert.match(md, /\| Já aplicadas \| 2 \|/);
  assert.match(md, /Migration 0001 \| Succeeded — executed/);
  assert.equal(JSON.stringify(report), before);
});

test("real already-applied evidence does not imply a new execution", () => {
  const md = render(fixture());
  assert.match(md, /\| Operação \| Already applied \|/);
  assert.match(md, /\| Executadas nesta operação \| 0 \|/);
  assert.match(md, /\| Já aplicadas \| 3 \|/);
  assert.match(md, /15\.5 s/);
});

test("empty backfill and contract reports mean no operations required", () => {
  for (const phase of ["backfill", "contract"]) {
    const report = { ...fixture(), phase, operations: [] };
    assert.match(render(report), /\| Operação \| No operations required \|/);
  }
});

test("ineligible contract is skipped even when the phase exit code is zero", () => {
  const report = {
    ...fixture(),
    phase: "contract",
    operations: [
      {
        migration: "0004_cleanup.sql",
        phase: "contract",
        result: "ineligible",
        reason: "dependencies-pending",
      },
    ],
  };
  const md = render(report);
  assert.match(md, /\| Operação \| Skipped — operations ineligible \|/);
  assert.match(md, /\| Ignoradas \/ inelegíveis \| 1 \|/);
  assert.match(md, /\| Executadas nesta operação \| 0 \|/);
});

test("operational failure and dirty uncertainty remain failures", () => {
  const report = fixture();
  report.result = "failed";
  report.operations[0].result = "dirty";
  assert.match(render(report), /\| Operação \| Failed \|/);
  assert.match(render(report), /Failed — dirty; effects uncertain/);
  const input = deploy();
  input.jobStatus = "failure";
  input.steps.publish.outcome = "failure";
  input.steps.health.outcome = "skipped";
  const md = deploySummary(input);
  assert.match(md, /\| Deploy \| Failed \|/);
  assert.match(md, /\| Saúde SHA \/ D1 \| Skipped \|/);
  assert.match(md, /SHA implantado \| Não comprovado/);
});

test("cancellation without a final JSON never claims migration success", () => {
  const md = migrationSummary(undefined, {
    phase: "expand",
    jobStatus: "cancelled",
  });
  assert.match(md, /\| Job até o resumo \| Cancelled \|/);
  assert.match(md, /\| Operação \| Unknown \/ interrupted \|/);
  const input = deploy();
  input.steps.health.outcome = "cancelled";
  input.jobStatus = "cancelled";
  assert.match(deploySummary(input), /\| Saúde SHA \/ D1 \| Cancelled \|/);
});

test("missing optional fields do not invent duration, release or identity", () => {
  const md = render({
    format: 1,
    environment: "dev",
    phase: "expand",
    result: "failed",
    operations: [],
  });
  assert(!md.includes("Duração"));
  assert(!md.includes("| SHA |"));
  assert(!md.includes("Run / tentativa"));
  assert(!md.includes("release"));
});

test("invalid or incomplete evidence has no fabricated counts", () => {
  for (const report of [
    null,
    {},
    [],
    { ...fixture(), operations: null },
    { ...fixture(), operations: [{ result: "applied" }] },
    { ...fixture(), phase: "contract" },
  ]) {
    const md = migrationSummary(report, {
      phase: "expand",
      jobStatus: "failure",
    });
    assert.match(md, /Evidência ausente, inválida ou incompleta/);
    assert(!md.includes("Executadas nesta operação"));
    assert.match(md, /Job até o resumo \| Failed/);
  }
});

test("secrets, SQL, unsafe links and injected Markdown never reach summaries", () => {
  const secret = "ghp_SECRET_TOKEN_DO_NOT_RENDER";
  const report = fixture();
  Object.assign(report, {
    actor: secret,
    error: secret,
    connectionString: `postgres://user:${secret}@db`,
    sha: secret,
    schemaDigest: secret,
    runId: secret,
    attempt: secret,
  });
  Object.assign(report.operations[0], {
    migration: `0001_${secret}.sql`,
    evidence: { url: `https://evil.test/${secret}`, token: secret },
    reason: secret,
    transition: `<img src=x>${secret}`,
    sql: secret,
  });
  const md = render(report);
  assert(!md.includes(secret));
  assert(!md.includes("<img"));
  assert(!md.includes("evil.test"));
  const input = deploy();
  input.steps.health.outcome = secret;
  input.steps.ci.outputs.sha = secret;
  input.steps.publish.outcome = "__proto__";
  input.sha = secret;
  assert(!deploySummary(input).includes(secret));
  assert(!deploySummary(input).includes("[object Object]"));
});

test("write and rendering failures emit safe warnings and preserve exit code", () => {
  const warnings = [];
  const before = process.exitCode;
  writeDeploySummary(() => "text", {
    path: "/nonexistent/private-token/summary",
    warn: (value) => warnings.push(value),
  });
  writeDeploySummary(
    () => {
      throw new Error("secret");
    },
    { path: "/unused", warn: (value) => warnings.push(value) },
  );
  assert.equal(warnings.length, 2);
  assert(
    warnings.every(
      (value) => !value.includes("private-token") && !value.includes("secret"),
    ),
  );
  assert.equal(process.exitCode, before);
});

test("CLI handles invalid JSON and filesystem failure without operational calls", () => {
  const temp = mkdtempSync(join(tmpdir(), "deploy-summary-test-"));
  try {
    writeFileSync(join(temp, "migration-expand.json"), "{invalid");
    const env = {
      ...process.env,
      RUNNER_TEMP: temp,
      SUMMARY_PHASE: "expand",
      SUMMARY_STATUS: "failure",
      GITHUB_STEP_SUMMARY: join(temp, "summary.md"),
    };
    execFileSync(process.execPath, [".github/scripts/deploy-summary.mjs"], {
      env,
    });
    assert.match(
      readFileSync(env.GITHUB_STEP_SUMMARY, "utf8"),
      /Evidência ausente/,
    );
    const result = spawnSync(
      process.execPath,
      [".github/scripts/deploy-summary.mjs"],
      { env: { ...env, GITHUB_STEP_SUMMARY: temp }, encoding: "utf8" },
    );
    assert.equal(result.status, 0);
    assert.match(result.stderr, /::warning::Deploy summary unavailable/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("recovery summaries do not fabricate correction SQL counts", () => {
  const report = {
    ...fixture(),
    phase: "recover",
    operations: [],
    recoveryResult: "already-reconciled",
  };
  assert.match(render(report), /Already reconciled/);
  assert(!render(report).includes("Executadas nesta operação"));
  report.recoveryResult = "reconciled";
  assert.match(render(report), /não há contagem de SQL/);
});

test("presentation preserves plan digest and workflow operational contracts", () => {
  const digest = migrationPlan().digest;
  render(fixture());
  assert.equal(migrationPlan().digest, digest);
  for (const name of ["deploy-dev", "migrate-dev"]) {
    const current = parse(
      readFileSync(`.github/workflows/${name}.yml`, "utf8"),
    );
    for (const job of Object.values(current.jobs)) {
      if (!job.steps) continue;
      const summaries = job.steps.filter(
        (step) => step.run === "node .github/scripts/deploy-summary.mjs",
      );
      assert.equal(summaries.length, 1);
      assert.equal(job.steps.at(-1), summaries[0]);
      assert.equal(summaries[0].if, "always()");
      assert.equal(summaries[0]["continue-on-error"], true);
      assert(!JSON.stringify(summaries[0]).includes("secrets."));
      assert(!summaries[0].uses);
    }
  }
});
