import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { approvedCi, validateDeployEvent } from "./ci-evidence.mjs";
import { authenticatedJson, repository, shaPattern } from "./release-core.mjs";
import {
  hash,
  inspectState,
  recover,
  requireExpanded,
  runPhase,
  validateDeployment,
  validatePlan,
  verifyCurrentSchema,
} from "./migration-core.mjs";

const app = "examples/links";
const folder = `${app}/migrations`;
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
export const operationsSchema = `CREATE TABLE IF NOT EXISTS foundation_migration_operations (
 id TEXT PRIMARY KEY, migration TEXT NOT NULL, transition_id TEXT NOT NULL,
 phase TEXT NOT NULL, hash TEXT NOT NULL, sha TEXT NOT NULL,
 started_at TEXT NOT NULL, finished_at TEXT, state TEXT NOT NULL,
 run_id TEXT NOT NULL, run_attempt TEXT NOT NULL, actor TEXT NOT NULL,
 evidence TEXT, recovery TEXT);
 CREATE UNIQUE INDEX IF NOT EXISTS foundation_migration_guard
 ON foundation_migration_operations((1)) WHERE state IN ('running', 'dirty');`;

export function migrationPlan() {
  const sql = new Map(
    readdirSync(folder)
      .filter((p) => p.endsWith(".sql"))
      .sort()
      .map((name) => [name, readFileSync(`${folder}/${name}`, "utf8")]),
  );
  const policy = JSON.parse(readFileSync(`${folder}/policy.json`, "utf8"));
  const plan = validatePlan(
    policy,
    sql,
    JSON.parse(readFileSync(`${folder}/meta/_journal.json`, "utf8")),
  );
  const inputs = [
    `${app}/wrangler.jsonc`,
    ...git("ls-files", "--", folder).split("\n"),
  ];
  // policy.json is also included before its first commit, for local validation.
  if (!inputs.includes(`${folder}/policy.json`))
    inputs.push(`${folder}/policy.json`);
  for (const path of inputs)
    assert(lstatSync(path).isFile(), "Migration inputs must be regular files");
  plan.digest = hash(
    JSON.stringify({
      plan,
      inputs: inputs.sort().map((path) => [path, hash(readFileSync(path))]),
    }),
  );
  const config = ts.parseConfigFileTextToJson(
    `${app}/wrangler.jsonc`,
    readFileSync(`${app}/wrangler.jsonc`, "utf8"),
  );
  assert(!config.error);
  const target = config.config.env.dev;
  const database = target.d1_databases.find((d) => d.binding === "DB");
  assert(
    database?.database_id &&
      database.migrations_dir === "migrations" &&
      !database.migrations_table &&
      !database.migrations_pattern,
  );
  return { ...plan, sql, target: { worker: target.name, database } };
}

export function queryRows(output) {
  assert(
    output?.success === true && Array.isArray(output.result),
    "D1 API failed",
  );
  assert(
    output.result.length > 0 &&
      output.result.every(
        (r) => r.success === true && Array.isArray(r.results),
      ),
    "Incomplete D1 result",
  );
  return output.result.flatMap((r) => r.results);
}

export class MissingDevSecretsError extends Error {
  constructor(missing) {
    super("Required DEV secret bindings were not resolved");
    this.missing = missing;
  }
}

export function validateDevBindings(phase, plan, env = process.env, applied) {
  assert(
    ["expand", "backfill", "contract", "verify", "recover"].includes(phase),
  );
  const required = [
    ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID"],
    [
      phase === "verify"
        ? "CLOUDFLARE_D1_READ_TOKEN"
        : "CLOUDFLARE_D1_MIGRATION_TOKEN",
      "CLOUDFLARE_API_TOKEN",
    ],
  ];
  if (
    applied &&
    ["backfill", "contract"].includes(phase) &&
    plan.operations.some(
      (op) => op.phase === phase && !applied.includes(op.file),
    )
  ) {
    required.push(
      ["CLOUDFLARE_WORKER_READ_TOKEN", "CLOUDFLARE_WORKER_READ_TOKEN"],
      ["DEV_HEALTH_URL", "DEV_HEALTH_URL"],
    );
  }
  const missing = required
    .filter(
      ([, binding]) => typeof env[binding] !== "string" || !env[binding].trim(),
    )
    .map(([name]) => name);
  if (missing.length) throw new MissingDevSecretsError(missing);
}

async function cloudflare(path, token, body) {
  assert(
    token && process.env.CLOUDFLARE_ACCOUNT_ID,
    "Scoped Cloudflare credentials required",
  );
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/${path}`,
    {
      method: body ? "POST" : "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(60_000),
    },
  );
  assert(response.ok, "Cloudflare request failed");
  const value = await response.json();
  assert.equal(value.success, true, "Cloudflare operation failed");
  return value;
}

export function withMigrationFile(plan, op, execute) {
  const temp = mkdtempSync(join(tmpdir(), "foundation-migration-"));
  try {
    mkdirSync(join(temp, "sql"));
    writeFileSync(join(temp, "sql", op.file), plan.sql.get(op.file));
    const config = join(temp, "wrangler.json");
    writeFileSync(
      config,
      JSON.stringify({
        name: plan.target.worker,
        d1_databases: [{ ...plan.target.database, migrations_dir: "sql" }],
      }),
    );
    return execute(config);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

export function d1Driver(plan, token = process.env.CLOUDFLARE_API_TOKEN) {
  const query = async (sql, params = []) =>
    queryRows(
      await cloudflare(
        `d1/database/${plan.target.database.database_id}/query`,
        token,
        { sql, params },
      ),
    );
  return {
    query,
    async initialize() {
      await query(operationsSchema);
    },
    async state() {
      const tables = await query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('d1_migrations', 'foundation_migration_operations')",
      );
      const has = (name) => tables.some((r) => r.name === name);
      return {
        applied: has("d1_migrations")
          ? (await query("SELECT name FROM d1_migrations ORDER BY id")).map(
              (r) => r.name,
            )
          : [],
        attempts: has("foundation_migration_operations")
          ? await query(
              "SELECT * FROM foundation_migration_operations ORDER BY started_at",
            )
          : [],
      };
    },
    async start(entry, context) {
      await query(
        "INSERT INTO foundation_migration_operations (id,migration,transition_id,phase,hash,sha,started_at,state,run_id,run_attempt,actor,evidence) VALUES (?,?,?,?,?,?,?,'running',?,?,?,?)",
        [
          entry.id,
          entry.migration,
          entry.transition,
          entry.phase,
          entry.hash,
          entry.sha,
          entry.startedAt,
          String(context.runId),
          String(context.attempt),
          context.actor,
          JSON.stringify(entry.evidence ?? null),
        ],
      );
    },
    async finish(id, state) {
      await query(
        "UPDATE foundation_migration_operations SET state=?, finished_at=? WHERE id=? AND state IN ('running','dirty')",
        [state, new Date().toISOString(), id],
      );
      const rows = await query(
        "SELECT state FROM foundation_migration_operations WHERE id=?",
        [id],
      );
      assert(
        rows.length === 1 && rows[0].state === state,
        "Operation outcome was not persisted",
      );
    },
    async recordRecovery(id, spec, correctionHash, context) {
      await query(
        "UPDATE foundation_migration_operations SET recovery=json_insert(COALESCE(recovery,'[]'),'$[#]',json(?)) WHERE id=? AND state IN ('running','dirty')",
        [
          JSON.stringify({
            ...spec,
            correctionHash,
            ...context,
            recordedAt: new Date().toISOString(),
          }),
          id,
        ],
      );
    },
    async reconcileJournal(name) {
      await query("INSERT INTO d1_migrations (name) VALUES (?)", [name]);
    },
    async apply(op) {
      // Wrangler still owns execution and d1_migrations. Expose exactly ONE file
      // to it; never let a pre-deploy apply discover a CONTRACT in the app folder.
      withMigrationFile(plan, op, (config) => {
        execFileSync(
          "pnpm",
          [
            "exec",
            "wrangler",
            "d1",
            "migrations",
            "apply",
            "DB",
            "--remote",
            "--config",
            config,
          ],
          {
            cwd: app,
            stdio: ["ignore", "pipe", "pipe"],
            env: {
              ...process.env,
              CLOUDFLARE_API_TOKEN: token,
              CI: "true",
              WRANGLER_SEND_METRICS: "false",
            },
            maxBuffer: 4 * 1024 * 1024,
          },
        );
      });
    },
  };
}

export function validateContext(context) {
  assert.equal(context.repository, repository);
  assert(shaPattern.test(context.sha));
  assert.equal(
    context.head,
    context.sha,
    "Checkout differs from authorized SHA",
  );
  assert.equal(
    context.master,
    context.sha,
    "Obsolete execution: master advanced",
  );
  if (context.recovery) {
    assert.equal(context.workflow, "Recovery DEV");
    assert.equal(context.event, "workflow_dispatch");
    assert.equal(context.ref, "refs/heads/master");
    assert.equal(context.confirmation, "RECONCILE_DEV_D1");
  } else {
    assert.equal(context.workflow, "Deploy DEV");
    assert(["workflow_run", "workflow_dispatch"].includes(context.event));
    if (context.event === "workflow_dispatch")
      assert.equal(context.ref, "refs/heads/master");
  }
}

async function authorizedContext(phase) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const sha = process.env.EXPECTED_SHA;
  if (process.env.GITHUB_EVENT_NAME === "workflow_run") {
    const origin = validateDeployEvent(event);
    assert.equal(origin.head_sha, sha);
    await approvedCi(sha, { origin });
  } else assert.equal(event.inputs?.execution_sha, sha);
  const masterUrl = `https://api.github.com/repos/${repository}/git/ref/heads/master`;
  const master = await authenticatedJson(masterUrl, process.env.GITHUB_TOKEN);
  validateContext({
    repository: process.env.GITHUB_REPOSITORY,
    workflow: process.env.GITHUB_WORKFLOW,
    event: process.env.GITHUB_EVENT_NAME,
    ref: process.env.GITHUB_REF,
    confirmation: event.inputs?.confirmation,
    recovery: phase === "recover",
    sha,
    head: git("rev-parse", "HEAD"),
    master: master.object.sha,
  });
  assert.equal(
    git("status", "--porcelain", "--untracked-files=normal"),
    "",
    "Tracked execution workspace changed",
  );
  await approvedCi(sha);
  assert.equal(
    (await authenticatedJson(masterUrl, process.env.GITHUB_TOKEN)).object.sha,
    sha,
  );
}

async function deploymentEvidence(plan, expectedDeployment) {
  const sha = process.env.EXPECTED_SHA;
  const root = `https://api.github.com/repos/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  const run = await authenticatedJson(root, process.env.GITHUB_TOKEN);
  assert.equal(run.run_attempt, Number(process.env.GITHUB_RUN_ATTEMPT));
  assert.equal(run.path, ".github/workflows/deploy-dev.yml");
  const jobs = [];
  for (let page = 1; ; page++) {
    const value = await authenticatedJson(
      `${root}/attempts/${run.run_attempt}/jobs?per_page=100&page=${page}`,
      process.env.GITHUB_TOKEN,
    );
    assert(Array.isArray(value.jobs));
    jobs.push(...value.jobs);
    if (value.jobs.length < 100) break;
  }
  const candidates = jobs.filter((j) => j.name === "deploy");
  assert.equal(candidates.length, 1);
  const token = process.env.CLOUDFLARE_WORKER_READ_TOKEN;
  const prefix = `workers/scripts/${plan.target.worker}`;
  const deployments = (await cloudflare(`${prefix}/deployments`, token)).result
    .deployments;
  assert(Array.isArray(deployments) && deployments.length);
  const deployment = deployments[0];
  assert(deployment.versions?.length === 1);
  const version = (
    await cloudflare(
      `${prefix}/versions/${deployment.versions[0].version_id}`,
      token,
    )
  ).result;
  const health = new URL(process.env.DEV_HEALTH_URL);
  assert.equal(health.origin, "https://foundation.t00ls.dev");
  const response = await fetch(`${health.origin}/health`, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  assert(
    response.ok && (await response.json()).checks?.database === "ok",
    "Application not healthy",
  );
  return validateDeployment({
    deployment,
    version,
    healthSha: response.headers.get("X-Foundation-SHA"),
    job: candidates[0],
    sha,
    runId: process.env.GITHUB_RUN_ID,
    attempt: process.env.GITHUB_RUN_ATTEMPT,
    expectedDeployment,
  });
}

async function main(phase) {
  assert(
    ["plan", "expand", "backfill", "contract", "verify", "recover"].includes(
      phase,
    ),
  );
  const report = {
    format: 1,
    environment: "dev",
    phase,
    startedAt: new Date().toISOString(),
    result: "failed",
    operations: [],
  };
  try {
    const plan = migrationPlan();
    Object.assign(report, {
      schemaDigest: plan.digest,
      sha: git("rev-parse", "HEAD"),
      runId: process.env.GITHUB_RUN_ID,
      attempt: process.env.GITHUB_RUN_ATTEMPT,
      actor: process.env.GITHUB_ACTOR,
    });
    if (phase === "plan") {
      console.log(
        JSON.stringify(
          { digest: plan.digest, operations: plan.operations },
          null,
          2,
        ),
      );
      return;
    }
    await authorizedContext(phase);
    validateDevBindings(phase, plan);
    const driver = d1Driver(plan);
    if (phase === "verify") {
      const state = await driver.state();
      requireExpanded(plan, state);
      for (const op of plan.operations.filter((m) => m.phase === "expand")) {
        await verifyCurrentSchema(driver, plan, state, op);
      }
    } else {
      const state = inspectState(plan, await driver.state(), {
        allowDirty: phase === "recover",
      });
      validateDevBindings(phase, plan, process.env, state.applied);
      await driver.initialize();
      const options = {
        plan,
        driver,
        authorize: () => authorizedContext(phase),
        context: {
          sha: process.env.EXPECTED_SHA,
          runId: process.env.GITHUB_RUN_ID,
          attempt: process.env.GITHUB_RUN_ATTEMPT,
          actor: process.env.GITHUB_ACTOR,
        },
        report,
      };
      if (phase === "recover") {
        const event = JSON.parse(
          readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"),
        );
        assert(/^[a-z0-9-]+$/.test(event.inputs?.recovery));
        const spec = JSON.parse(
          readFileSync(
            `${app}/migration-recovery/${event.inputs.recovery}.json`,
            "utf8",
          ),
        );
        await recover({ ...options, spec });
      } else
        await runPhase({
          ...options,
          phase,
          deploymentEvidence: (id) => deploymentEvidence(plan, id),
        });
    }
    report.result = "succeeded";
  } catch (error) {
    if (error instanceof MissingDevSecretsError)
      report.missingSecrets = error.missing;
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    if (phase !== "plan") {
      console.log(JSON.stringify(report, null, 2));
      if (process.env.RUNNER_TEMP)
        writeFileSync(
          join(process.env.RUNNER_TEMP, `migration-${phase}.json`),
          `${JSON.stringify(report, null, 2)}\n`,
        );
      if (process.env.GITHUB_STEP_SUMMARY)
        appendFileSync(
          process.env.GITHUB_STEP_SUMMARY,
          `## Migration ${phase}\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`,
        );
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await main(process.argv[2]);
  } catch {
    console.error(
      "Migration operation failed closed. Inspect sanitized evidence and database status; no automatic retry.",
    );
    process.exitCode = 1;
  }
}
