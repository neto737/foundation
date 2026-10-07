import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { createRequire } from "node:module";
import { parse } from "yaml";
import ts from "typescript";
import {
  inspectState,
  recover,
  requireExpanded,
  runPhase,
  validateDeployment,
  validatePlan,
  validateProbe,
  validateSql,
} from "./migration-core.mjs";
import {
  migrationPlan,
  operationsSchema,
  queryRows,
  validateContext,
  withMigrationFile,
} from "./migrations.mjs";

const sha = "a".repeat(40);
const context = { sha, runId: "100", attempt: "1", actor: "maintainer" };
const probe = "SELECT COUNT(*) AS remaining FROM items WHERE new_value IS NULL";
const fixture = () =>
  validatePlan(
    {
      format: 1,
      environments: { dev: { contractDelaySeconds: 0 } },
      operations: [
        {
          file: "0001_expand.sql",
          phase: "expand",
          transition: "test",
          dependsOn: [],
          verify:
            "SELECT 1-COUNT(*) AS remaining FROM sqlite_master WHERE name='items'",
        },
        {
          file: "0002_backfill.sql",
          phase: "backfill",
          transition: "test",
          dependsOn: ["0001_expand.sql"],
          verify: probe,
        },
        {
          file: "0003_contract.sql",
          phase: "contract",
          transition: "test",
          dependsOn: ["0001_expand.sql", "0002_backfill.sql"],
          verify:
            "SELECT COUNT(*) AS remaining FROM pragma_table_info('items') WHERE name='old_value'",
        },
      ],
    },
    new Map([
      [
        "0001_expand.sql",
        "CREATE TABLE items (id INTEGER PRIMARY KEY, old_value TEXT, new_value TEXT);",
      ],
      [
        "0002_backfill.sql",
        "UPDATE items SET new_value=old_value WHERE new_value IS NULL;",
      ],
      ["0003_contract.sql", "ALTER TABLE items DROP COLUMN old_value;"],
    ]),
    {
      entries: ["0001_expand", "0002_backfill", "0003_contract"].map((tag) => ({
        tag,
      })),
    },
  );

function memory(plan) {
  const state = { applied: [], attempts: [] };
  const driver = {
    state: async () => structuredClone(state),
    query: async () => [{ remaining: 0 }],
    start: async (entry) => {
      assert(
        !state.attempts.some((a) => ["running", "dirty"].includes(a.state)),
      );
      state.attempts.push({
        id: entry.id,
        migration: entry.migration,
        hash: entry.hash,
        phase: entry.phase,
        transition_id: entry.transition,
        state: "running",
      });
    },
    apply: async (op) => {
      state.applied.push(op.file);
    },
    finish: async (id, status) => {
      state.attempts.find((a) => a.id === id).state = status;
    },
    recordRecovery: async () => {},
    reconcileJournal: async (name) => {
      state.applied.push(name);
    },
  };
  const options = {
    plan,
    driver,
    context,
    authorize: async () => {},
    deploymentEvidence: async () => ({
      deploymentId: "dep",
      completedAt: "2026-01-01T00:00:00Z",
    }),
  };
  return { state, driver, options };
}

test("metadata covers journal/SQL exactly and enforces phase and transition dependencies", () => {
  const plan = fixture();
  assert.equal(plan.operations.length, 3);
  const real = migrationPlan();
  assert.match(real.digest, /^[a-f0-9]{64}$/);
  assert(real.operations.every((op) => op.phase === "expand"));
  const policy = JSON.parse(
    readFileSync("examples/links/migrations/policy.json", "utf8"),
  );
  const files = new Map(real.sql);
  const journal = JSON.parse(
    readFileSync("examples/links/migrations/meta/_journal.json", "utf8"),
  );
  for (const mutate of [
    (p) => {
      p.operations[0].phase = "unknown";
    },
    (p) => {
      p.operations.pop();
    },
    (p) => {
      p.operations[0].dependsOn = [p.operations[1].file];
    },
    (p) => {
      p.operations[1].phase = "contract";
      p.operations[1].dependsOn = [];
    },
    (p) => {
      p.environments.dev.contractDelaySeconds = -1;
    },
  ]) {
    const copy = structuredClone(policy);
    mutate(copy);
    assert.throws(() => validatePlan(copy, files, journal));
  }
});

test("EXPAND fails closed on destructive/opaque SQL including comment/statement tricks", () => {
  for (const sql of [
    "DROP TABLE user;",
    "ALTER TABLE user RENAME TO old_user",
    "ALTER TABLE user DROP COLUMN name",
    "CREATE TABLE new_user AS SELECT * FROM user",
    "CREATE TABLE x (id INTEGER); /* comment */ DROP TABLE user",
    "DELETE FROM user",
    "PRAGMA foreign_keys=off",
    "ALTER TABLE user ADD x TEXT NOT NULL",
    "ALTER TABLE user ADD x TEXT DEFAULT NULL NOT NULL",
    "CREATE UNIQUE INDEX dangerous ON user(email)",
    "VACUUM",
    "CREATE TRIGGER t AFTER INSERT ON user BEGIN DELETE FROM user; END",
    "CREATE TABLE x (id INTEGER); /* unfinished",
  ])
    assert.throws(() => validateSql(sql, "expand"), sql);
  validateSql(
    "CREATE TABLE `new` (id TEXT, note TEXT DEFAULT 'DROP TABLE user;'); CREATE UNIQUE INDEX new_id ON `new` (id);",
    "expand",
  );
  validateSql(
    "ALTER TABLE `user` ADD `flag` INTEGER DEFAULT false NOT NULL;",
    "expand",
  );
  assert.throws(() => validateProbe("SELECT 0 AS remaining"));
  assert.throws(() =>
    validateProbe("SELECT COUNT(*) FROM user; DELETE FROM user"),
  );
});

test("only required EXPAND blocks deploy; no pending migration and deferred CONTRACT do not", async () => {
  const plan = fixture();
  const { state, options } = memory(plan);
  assert.throws(() => requireExpanded(plan, state));
  await runPhase({ ...options, phase: "expand" });
  requireExpanded(plan, state);
  await runPhase({
    ...options,
    phase: "expand",
    driver: {
      ...options.driver,
      apply: () => {
        throw Error("must not reapply");
      },
    },
  });
  assert.deepEqual(state.applied, ["0001_expand.sql"]);
  const report = await runPhase({ ...options, phase: "contract" });
  assert.equal(report.operations[0].result, "ineligible");
});

test("complete lifecycle, idempotent journal reconciliation and optional backfill", async () => {
  const { state, options } = memory(fixture());
  for (const phase of ["expand", "backfill", "contract"])
    await runPhase({ ...options, phase });
  assert.deepEqual(
    state.applied,
    options.plan.operations.map((op) => op.file),
  );
  for (const phase of ["expand", "backfill", "contract"])
    await runPhase({
      ...options,
      phase,
      driver: {
        ...options.driver,
        apply: () => {
          throw Error("reapplied");
        },
      },
    });
  const noBackfill = structuredClone(options.plan);
  noBackfill.operations = noBackfill.operations.filter(
    (m) => m.phase !== "backfill",
  );
  noBackfill.operations[1].dependsOn = ["0001_expand.sql"];
  const no = memory(noBackfill);
  await runPhase({ ...no.options, phase: "expand" });
  await runPhase({ ...no.options, phase: "contract" });
  assert.equal(no.state.applied.length, 2);
});

test("CONTRACT fails closed without healthy current deploy, respects additional window without waiting", async () => {
  const { state, options } = memory(fixture());
  await runPhase({ ...options, phase: "expand" });
  await runPhase({ ...options, phase: "backfill" });
  let report = await runPhase({
    ...options,
    phase: "contract",
    deploymentEvidence: async () => {
      throw Error("rollback");
    },
  });
  assert.equal(report.operations[0].result, "ineligible");
  options.plan.contractDelaySeconds = 60;
  report = await runPhase({
    ...options,
    phase: "contract",
    now: () => new Date("2026-01-01T00:00:10Z"),
  });
  assert.equal(report.operations[0].result, "ineligible");
  assert.equal(state.applied.length, 2);
});

test("failed/uncertain mutation stays dirty and blocks retry, deploy and CONTRACT even with applied journal", async () => {
  for (const applied of [false, true]) {
    const { state, driver, options } = memory(fixture());
    driver.apply = async (op) => {
      if (applied) state.applied.push(op.file);
      throw Error("lost response");
    };
    await assert.rejects(runPhase({ ...options, phase: "expand" }), /Dirty/);
    assert.equal(state.attempts[0].state, "dirty");
    assert.throws(() => requireExpanded(options.plan, state));
    for (const phase of ["expand", "contract"])
      await assert.rejects(runPhase({ ...options, phase }));
  }
});

test("backfill validation failure blocks CONTRACT and a changed deploy after durable intent becomes dirty", async () => {
  let { state, driver, options } = memory(fixture());
  await runPhase({ ...options, phase: "expand" });
  driver.query = async (sql) => [{ remaining: sql === probe ? 1 : 0 }];
  await assert.rejects(runPhase({ ...options, phase: "backfill" }));
  assert.equal(state.applied.length, 2);
  assert.equal(state.attempts[1].state, "dirty");
  await assert.rejects(runPhase({ ...options, phase: "contract" }));
  ({ state, driver, options } = memory(fixture()));
  await runPhase({ ...options, phase: "expand" });
  let n = 0;
  await assert.rejects(
    runPhase({
      ...options,
      phase: "backfill",
      deploymentEvidence: async () => {
        if (++n > 1) throw Error("new deploy");
        return { deploymentId: "dep" };
      },
    }),
  );
  assert.equal(state.attempts[1].state, "dirty");
});

test("a proven CONTRACT can supersede old schema probes without breaking future deploy/retry", async () => {
  const plan = fixture();
  plan.operations[0].supersededBy = "0003_contract.sql";
  const { state, driver, options } = memory(plan);
  for (const phase of ["expand", "backfill", "contract"])
    await runPhase({ ...options, phase });
  driver.query = async (sql) => [
    { remaining: sql === plan.operations[0].verify ? 1 : 0 },
  ];
  await runPhase({ ...options, phase: "expand" });
  requireExpanded(plan, state);
  const changed = structuredClone(state);
  changed.attempts[0].hash = "changed";
  assert.throws(() => inspectState(plan, changed));
  assert.throws(() =>
    inspectState(plan, {
      ...state,
      applied: [...state.applied, "unknown.sql"],
    }),
  );
});

test("explicit recovery proves unapplied/applied/corrected; never clears based solely on absent journal", async () => {
  for (const resolution of ["unapplied", "applied", "corrected"]) {
    const plan = fixture();
    const { state, driver, options } = memory(plan);
    driver.apply = async (op) => {
      if (resolution === "applied") state.applied.push(op.file);
      throw Error("failure");
    };
    await assert.rejects(runPhase({ ...options, phase: "expand" }));
    const spec = {
      format: 1,
      operationId: state.attempts[0].id,
      resolution,
      incident: "https://github.com/t00ls-dev/foundation/issues/1",
      proof:
        "SELECT COUNT(*) AS remaining FROM sqlite_master WHERE name='unexpected'",
    };
    driver.query = async () => [{ remaining: 1 }];
    await assert.rejects(recover({ ...options, spec, report: {} }));
    assert.equal(state.attempts[0].state, "dirty");
    driver.query = async () => [{ remaining: 0 }];
    if (resolution === "corrected") {
      const correction = { ...plan.operations[0], file: "0004_correction.sql" };
      plan.operations.push(correction);
      spec.correction = correction.file;
      driver.apply = async (op) => state.applied.push(op.file);
    }
    await recover({ ...options, spec, report: {} });
    inspectState(plan, state);
    if (resolution === "unapplied") {
      driver.apply = async (op) => state.applied.push(op.file);
      await runPhase({
        ...options,
        phase: "expand",
        context: { ...context, attempt: "2" },
      });
    } else assert(state.applied.includes("0001_expand.sql"));
  }
});

test("deployment proof rejects partial traffic, wrong SHA/run/attempt, failed health, stale deployment", () => {
  const value = {
    deployment: {
      id: "d",
      created_on: "2026-01-01T00:00:00Z",
      versions: [{ version_id: "v", percentage: 100 }],
    },
    version: { id: "v", annotations: { "workers/tag": sha } },
    job: {
      name: "deploy",
      conclusion: "success",
      head_sha: sha,
      run_id: 100,
      run_attempt: 1,
      started_at: "2025-12-31T23:59:00Z",
      completed_at: "2026-01-01T00:00:00Z",
    },
    healthSha: sha,
    sha,
    runId: "100",
    attempt: "1",
  };
  validateDeployment(value);
  for (const change of [
    { healthSha: "old" },
    { expectedDeployment: "other" },
    { version: { id: "v", annotations: {} } },
    { job: { ...value.job, conclusion: "failure" } },
    { attempt: "2" },
    {
      deployment: {
        ...value.deployment,
        versions: [{ version_id: "v", percentage: 50 }],
      },
    },
    { deployment: { ...value.deployment, created_on: "2026-01-01T00:10:00Z" } },
  ])
    assert.throws(() => validateDeployment({ ...value, ...change }));
});

test("recovery revalidates immediately before corrective mutation and leaves stale authorization dirty", async () => {
  const plan = fixture();
  const { state, driver, options } = memory(plan);
  driver.apply = async () => {
    throw new Error("lost response");
  };
  await assert.rejects(runPhase({ ...options, phase: "expand" }));
  const correction = { ...plan.operations[0], file: "0004_correction.sql" };
  plan.operations.push(correction);
  const spec = {
    format: 1,
    operationId: state.attempts[0].id,
    resolution: "corrected",
    correction: correction.file,
    incident: "https://github.com/t00ls-dev/foundation/issues/1",
    proof: probe,
  };
  let authorizations = 0;
  driver.apply = async () => {
    throw new Error("must not execute");
  };
  const report = {};
  await assert.rejects(
    recover({
      ...options,
      spec,
      report,
      authorize: async () => {
        if (++authorizations === 2) throw new Error("master advanced");
      },
    }),
  );
  assert.equal(state.attempts[0].state, "dirty");
  assert.equal(state.applied.length, 0);
  assert.equal(report.operationId, spec.operationId);
});

test("privileged script requires trusted workflow, current master and exact checkout; D1 API fails closed", () => {
  const c = {
    repository: "t00ls-dev/foundation",
    workflow: "Deploy DEV",
    event: "workflow_run",
    sha,
    head: sha,
    master: sha,
  };
  validateContext(c);
  for (const change of [
    { repository: "fork/repo" },
    { workflow: "CI" },
    { event: "pull_request" },
    { sha: "master" },
    { master: "b".repeat(40) },
    { head: "b".repeat(40) },
  ])
    assert.throws(() => validateContext({ ...c, ...change }));
  assert.throws(() =>
    validateContext({
      ...c,
      recovery: true,
      workflow: "Recovery DEV",
      event: "workflow_dispatch",
      ref: "refs/heads/master",
    }),
  );
  for (const output of [
    {},
    { success: true, result: [] },
    { success: true, result: [{ success: false, results: [] }] },
  ])
    assert.throws(() => queryRows(output));
});

test("real local D1: intent uniqueness, phased native journal, rollback, resume and CONTRACT postcondition", async () => {
  const require = createRequire(
    new URL("../../examples/links/package.json", import.meta.url),
  );
  const { Miniflare } = require("miniflare");
  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('test') } }",
    d1Databases: ["DB"],
  });
  try {
    const db = await mf.getD1Database("DB");
    const parts = (sql) =>
      sql
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean);
    await db.batch(parts(operationsSchema).map((sql) => db.prepare(sql)));
    await db
      .prepare(
        "CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)",
      )
      .run();
    const plan = fixture();
    const sql = new Map([
      [
        "0001_expand.sql",
        "CREATE TABLE items (id INTEGER PRIMARY KEY, old_value TEXT, new_value TEXT)",
      ],
      [
        "0002_backfill.sql",
        "UPDATE items SET new_value=old_value WHERE new_value IS NULL",
      ],
      ["0003_contract.sql", "ALTER TABLE items DROP COLUMN old_value"],
    ]);
    const query = async (sql, params = []) =>
      (
        await db
          .prepare(sql)
          .bind(...params)
          .all()
      ).results;
    const driver = {
      query,
      state: async () => ({
        applied: (
          await query("SELECT name FROM d1_migrations ORDER BY id")
        ).map((r) => r.name),
        attempts: await query("SELECT * FROM foundation_migration_operations"),
      }),
      start: async (entry) => {
        await db
          .prepare(
            "INSERT INTO foundation_migration_operations (id,migration,transition_id,phase,hash,sha,started_at,state,run_id,run_attempt,actor) VALUES (?,?,?,?,?,?,?,'running','1','1','test')",
          )
          .bind(
            entry.id,
            entry.migration,
            entry.transition,
            entry.phase,
            entry.hash,
            sha,
            entry.startedAt,
          )
          .run();
      },
      finish: async (id, state) => {
        await db
          .prepare(
            "UPDATE foundation_migration_operations SET state=? WHERE id=?",
          )
          .bind(state, id)
          .run();
      },
      apply: async (op) => {
        await db.batch([
          db.prepare(sql.get(op.file)),
          db
            .prepare("INSERT INTO d1_migrations(name) VALUES (?)")
            .bind(op.file),
        ]);
      },
    };
    const options = {
      plan,
      driver,
      context,
      authorize: async () => {},
      deploymentEvidence: async () => ({
        deploymentId: "d",
        completedAt: "2026-01-01T00:00:00Z",
      }),
    };
    await runPhase({ ...options, phase: "expand" });
    await db.prepare("INSERT INTO items VALUES (1,'historic',NULL)").run();
    await runPhase({ ...options, phase: "backfill" });
    assert.equal(
      (await query("SELECT new_value FROM items"))[0].new_value,
      "historic",
    );
    await runPhase({ ...options, phase: "contract" });
    assert(
      !(await query("SELECT name FROM pragma_table_info('items')")).some(
        (r) => r.name === "old_value",
      ),
    );
    await assert.rejects(
      db.batch([
        db.prepare("CREATE TABLE must_rollback(id INTEGER)"),
        db.prepare("INSERT INTO nonexistent VALUES(1)"),
      ]),
    );
    assert.equal(
      (
        await query(
          "SELECT COUNT(*) AS n FROM sqlite_master WHERE name='must_rollback'",
        )
      )[0].n,
      0,
    );
    const entry = {
      id: "guard1",
      migration: "0001_expand.sql",
      transition: "test",
      phase: "expand",
      hash: plan.operations[0].hash,
      startedAt: new Date().toISOString(),
    };
    await driver.start(entry);
    for (const run of ["recovery-1", "recovery-2"])
      await db
        .prepare(
          "UPDATE foundation_migration_operations SET recovery=json_insert(COALESCE(recovery,'[]'),'$[#]',json(?)) WHERE id=? AND state IN ('running','dirty')",
        )
        .bind(JSON.stringify({ run }), entry.id)
        .run();
    assert.deepEqual(
      JSON.parse(
        (
          await query(
            "SELECT recovery FROM foundation_migration_operations WHERE id='guard1'",
          )
        )[0].recovery,
      ),
      [{ run: "recovery-1" }, { run: "recovery-2" }],
    );
    await assert.rejects(driver.start({ ...entry, id: "guard2" }));
    assert.throws(() =>
      requireExpanded(plan, {
        applied: plan.operations.map((op) => op.file),
        attempts: [{ ...entry, transition_id: "test", state: "running" }],
      }),
    );
  } finally {
    await mf.dispose();
  }
});

test("actual Wrangler applies only the selected phase file and journal retry is a no-op (local disposable D1)", () => {
  const plan = migrationPlan();
  const state = mkdtempSync(join(tmpdir(), "foundation-native-test-"));
  const execute = (args) =>
    execFileSync(
      "pnpm",
      ["exec", "wrangler", "d1", ...args, "--local", "--persist-to", state],
      {
        cwd: "examples/links",
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" },
      },
    );
  try {
    withMigrationFile(plan, plan.operations[0], (config) => {
      assert.deepEqual(readdirSync(join(dirname(config), "sql")), [
        plan.operations[0].file,
      ]);
      execute(["migrations", "apply", "DB", "--config", config]);
      execute(["migrations", "apply", "DB", "--config", config]);
      const value = JSON.parse(
        execute([
          "execute",
          "DB",
          "--config",
          config,
          "--command",
          "SELECT name FROM d1_migrations ORDER BY id",
          "--json",
        ]),
      );
      assert.deepEqual(
        value[0].results.map((r) => r.name),
        [plan.operations[0].file],
      );
    });
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

const workflow = (name) =>
  parse(readFileSync(`.github/workflows/${name}.yml`, "utf8"));
test("DEV coordination serializes independent phases; deploy never applies; CI has no persistent credentials", () => {
  const deploy = workflow("deploy-dev");
  const migration = workflow("migrate-dev");
  const recovery = workflow("migration-recovery-dev");
  assert.deepEqual(deploy.concurrency, {
    "group": "foundation-dev-d1",
    "cancel-in-progress": false,
  });
  assert.deepEqual(recovery.concurrency, deploy.concurrency);
  assert.deepEqual(Object.keys(migration.on), ["workflow_call"]);
  assert(!migration.concurrency, "Caller owns the lease (no nested deadlock)");
  assert.deepEqual(Object.keys(recovery.on), ["workflow_dispatch"]);
  assert.deepEqual(deploy.jobs.deploy.needs, ["validate", "expand"]);
  assert.deepEqual(deploy.jobs.backfill.needs, ["validate", "deploy"]);
  assert.deepEqual(deploy.jobs.contract.needs, [
    "validate",
    "deploy",
    "backfill",
  ]);
  for (const phase of ["expand", "backfill", "contract"]) {
    assert.equal(
      deploy.jobs[phase].uses,
      "./.github/workflows/migrate-dev.yml",
    );
    assert.equal(deploy.jobs[phase].with.phase, phase);
  }
  for (const name of ["ci", "release"])
    assert(
      !/CLOUDFLARE_D1_|migrations\.mjs (expand|backfill|contract|recover)/.test(
        readFileSync(`.github/workflows/${name}.yml`, "utf8"),
      ),
    );
  assert(
    !/db:migrate|migrations\s+apply|migrations\.mjs (expand|backfill|contract|recover)/.test(
      JSON.stringify(deploy.jobs.deploy),
    ),
  );
  assert(
    deploy.jobs.deploy.steps.some(
      (s) => s.run === "node .github/scripts/migrations.mjs verify",
    ),
  );
  assert(
    !deploy.jobs.deploy.steps.some((s) =>
      Object.values(s.env ?? {}).some((v) =>
        String(v).includes("D1_MIGRATION_TOKEN"),
      ),
    ),
  );
  assert(
    !/CLOUDFLARE_|DATABASE_URL/.test(
      readFileSync(".github/workflows/ci.yml", "utf8"),
    ),
  );
  assert(readFileSync("package.json", "utf8").includes("pnpm test:migrations"));
  assert(recovery.jobs.recover.if.includes("RECONCILE_DEV_D1"));
  for (const w of [migration, recovery]) {
    assert.deepEqual(w.permissions, { contents: "read", actions: "read" });
    for (const job of Object.values(w.jobs)) {
      assert(!job.env);
      assert(job.steps.every((s) => !s.uses?.includes("download-artifact")));
      assert(
        job.steps
          .filter((s) => s.uses?.includes("checkout"))
          .every((s) => s.with["persist-credentials"] === false),
      );
    }
  }
});

function validateScripts(scripts) {
  const resolve = (name, seen = new Set()) => {
    if (seen.has(name)) return "";
    seen.add(name);
    const command = scripts[name] ?? "";
    return `${command} ${Object.keys(scripts)
      .filter((key) =>
        new RegExp(`(?:pnpm|npm run)\\s+(?:run\\s+)?${key}(?=\\s|$|[;&])`).test(
          command,
        ),
      )
      .map((key) => resolve(key, seen))
      .join(" ")}`;
  };
  for (const name of Object.keys(scripts)) {
    if (name.startsWith("db:") || name.startsWith("test") || name === "check")
      continue;
    assert(
      !/db:migrate|db:seed|migrations\s+apply|drizzle-kit\s+(migrate|push)|d1\s+execute[^;&]*--file|migrations\.mjs\s+(expand|backfill|contract|recover)/.test(
        resolve(name),
      ),
      `Implicit mutation in ${name}`,
    );
  }
}
test("script aliases/hooks, runtime and Wrangler builds cannot reintroduce implicit migrations", () => {
  assert.throws(() =>
    validateScripts({ deploy: "pnpm setup", setup: "pnpm db:migrate" }),
  );
  assert.throws(() => validateScripts({ predeploy: "drizzle-kit push" }));
  assert.throws(() => validateScripts({ postinstall: "pnpm db:seed" }));
  const files = execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .trim()
    .split("\n");
  for (const path of files.filter((p) => /(^|\/)package\.json$/.test(p)))
    validateScripts(JSON.parse(readFileSync(path, "utf8")).scripts ?? {});
  assert(
    !JSON.parse(readFileSync("examples/links/package.json", "utf8")).scripts[
      "db:migrate:dev"
    ],
  );
  for (const path of files.filter((p) =>
    /\/(src\/.*\.(ts|tsx)|vite[^/]*\.ts|wrangler\.jsonc)$/.test(p),
  )) {
    const content = readFileSync(path, "utf8");
    // Doctor lists the interface names read-only; runtime code cannot invoke it.
    assert(
      !/drizzle-orm\/[^"']*migrator|drizzle-kit\s+(migrate|push)|migrations\s+apply|(?:pnpm|npm run)\s+db:migrate|applyMigrations\s*\(/.test(
        content,
      ),
      path,
    );
    if (path.endsWith("wrangler.jsonc"))
      assert(
        !ts.parseConfigFileTextToJson(path, content).config.build?.command,
      );
  }
});

test("SQL already recorded in Git is immutable even before operational hash adoption", () => {
  for (const [file, bytes] of migrationPlan().sql) {
    const path = `examples/links/migrations/${file}`;
    const commits = execFileSync(
      "git",
      ["log", "--format=%H", "--diff-filter=A", "--", path],
      { encoding: "utf8" },
    )
      .trim()
      .split("\n")
      .filter(Boolean);
    if (commits.length)
      assert.equal(
        execFileSync("git", ["show", `${commits.at(-1)}:${path}`], {
          encoding: "utf8",
        }),
        bytes,
        `Immutable SQL changed: ${file}`,
      );
  }
});
