import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import {
  recover,
  runPhase,
  inspectState,
  requireExpanded,
  validateDeployment,
  validatePlan,
  validateStoppedRecovery,
} from "./migration-core.mjs";
import {
  d1Driver,
  validateContext,
  validateDevBindings,
} from "./migrations.mjs";

const require = createRequire(
  new URL("../../examples/links/package.json", import.meta.url),
);
const { convertV4MiniflareOptions, Miniflare } = require("miniflare");
const sha = "a".repeat(40);
const context = { sha, runId: "200", attempt: "1", actor: "local-test" };

function fixture() {
  const sql = new Map([
    [
      "0001_base.sql",
      "CREATE TABLE items(id INTEGER PRIMARY KEY, old_value TEXT);",
    ],
    ["0002_expand.sql", "ALTER TABLE items ADD new_value TEXT;"],
    [
      "0003_backfill.sql",
      "UPDATE items SET new_value=old_value WHERE new_value IS NULL;",
    ],
    ["0004_contract.sql", "ALTER TABLE items DROP COLUMN old_value;"],
    [
      "0005_correction.sql",
      "UPDATE items SET new_value=old_value WHERE new_value IS NULL;",
    ],
  ]);
  const verifyData =
    "SELECT COUNT(*) AS remaining FROM items WHERE new_value IS NULL";
  const operations = [
    {
      file: "0001_base.sql",
      phase: "expand",
      transition: "base",
      dependsOn: [],
      verify:
        "SELECT 1-COUNT(*) AS remaining FROM sqlite_master WHERE name='items'",
    },
    {
      file: "0002_expand.sql",
      phase: "expand",
      transition: "v2",
      dependsOn: ["0001_base.sql"],
      verify:
        "SELECT 1-COUNT(*) AS remaining FROM pragma_table_info('items') WHERE name='new_value'",
    },
    {
      file: "0003_backfill.sql",
      phase: "backfill",
      transition: "v2",
      dependsOn: ["0002_expand.sql"],
      verify: verifyData,
    },
    {
      file: "0005_correction.sql",
      phase: "backfill",
      transition: "v2",
      dependsOn: ["0002_expand.sql"],
      verify: verifyData,
    },
    {
      file: "0004_contract.sql",
      phase: "contract",
      transition: "v2",
      dependsOn: [
        "0002_expand.sql",
        "0003_backfill.sql",
        "0005_correction.sql",
      ],
      verify:
        "SELECT COUNT(*) AS remaining FROM pragma_table_info('items') WHERE name='old_value'",
    },
  ];
  const plan = validatePlan(
    {
      format: 1,
      environments: { dev: { contractDelaySeconds: 0 } },
      operations,
    },
    sql,
    { entries: [...sql.keys()].map((file) => ({ tag: file.slice(0, -4) })) },
  );
  return {
    ...plan,
    sql,
    target: {
      worker: "local-test",
      database: { database_id: "disposable", binding: "DB" },
    },
  };
}

// Only the HTTP transport/native invocation is replaced. State, SQL CAS,
// audit writes, reconciliation and the recovery algorithm are production code.
async function withDatabase(fn) {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('local') } }",
      d1Databases: ["DB"],
    }),
  );
  const db = await mf.getD1Database("DB");
  const previousFetch = globalThis.fetch;
  const previousAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
  process.env.CLOUDFLARE_ACCOUNT_ID = "audit-local";
  let fault;
  globalThis.fetch = async (url, options) => {
    assert.equal(
      String(url),
      "https://api.cloudflare.com/client/v4/accounts/audit-local/d1/database/disposable/query",
      "Tests must never contact an external resource",
    );
    assert.equal(options.headers.Authorization, "Bearer fixture-only");
    if (fault) {
      const response = await fault(url, options);
      if (response) return response;
    }
    const { sql, params } = JSON.parse(options.body);
    const queries = sql
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean);
    const result = await db.batch(
      queries.map((part) => db.prepare(part).bind(...(params ?? []))),
    );
    return new Response(JSON.stringify({ success: true, result }), {
      status: 200,
    });
  };
  const plan = fixture();
  const driver = d1Driver(plan, "fixture-only");
  driver.apply = async (op) => {
    await db.batch([
      ...plan.sql
        .get(op.file)
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => db.prepare(part)),
      db.prepare("INSERT INTO d1_migrations(name) VALUES (?)").bind(op.file),
    ]);
  };
  const authorize = async () =>
    validateContext({
      repository: "t00ls-dev/foundation",
      workflow: "Recovery DEV",
      event: "workflow_dispatch",
      ref: "refs/heads/master",
      confirmation: "RECONCILE_DEV_D1",
      recovery: true,
      sha,
      head: sha,
      master: sha,
    });
  const options = {
    plan,
    driver,
    context,
    authorize,
    deploymentEvidence: async () => ({
      deploymentId: "local",
      completedAt: "2026-01-01T00:00:00Z",
    }),
  };
  try {
    await driver.initialize();
    await driver.query(
      "CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)",
    );
    await fn({
      plan,
      driver,
      db,
      options,
      setFault: (value) => {
        fault = value;
      },
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousAccount === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;
    else process.env.CLOUDFLARE_ACCOUNT_ID = previousAccount;
    await mf.dispose();
  }
}

async function dirtyBackfill(driver, options) {
  await runPhase({ ...options, phase: "expand" });
  await driver.query("INSERT INTO items(id,old_value) VALUES(1,'historic')");
  const op = options.plan.operations.find(
    (m) => m.file === "0003_backfill.sql",
  );
  const entry = {
    id: "original-backfill",
    migration: op.file,
    transition: op.transition,
    phase: op.phase,
    hash: op.hash,
    sha,
    startedAt: new Date().toISOString(),
  };
  await driver.start(entry, context);
  await driver.finish(entry.id, "dirty");
  return {
    format: 1,
    operationId: entry.id,
    resolution: "corrected",
    correction: "0005_correction.sql",
    incident: "https://github.com/t00ls-dev/foundation/issues/1",
    proof: op.verify,
  };
}

test("legacy completed recovery audits remain repeatable without changing their format", async () =>
  withDatabase(async ({ driver, options }) => {
    const spec = await dirtyBackfill(driver, options);
    await recover({ ...options, spec, report: {} });
    const row = (await driver.state()).attempts.find(
      (a) => a.id === spec.operationId,
    );
    const legacy = JSON.parse(row.recovery).map(
      ({ recoveryId, outcome, ...record }) => record,
    );
    await driver.query(
      "UPDATE foundation_migration_operations SET recovery=? WHERE id=?",
      [JSON.stringify(legacy), spec.operationId],
    );
    const before = await driver.state();
    const report = {};
    await recover({ ...options, spec, report });
    assert.equal(report.result, "already-reconciled");
    assert.deepEqual(await driver.state(), before);
  }));

test("D1 compare-and-set selects one owner from the same snapshot and rejects release by the loser", async () =>
  withDatabase(async ({ driver, options }) => {
    const spec = await dirtyBackfill(driver, options);
    const attempt = (await driver.state()).attempts.find(
      (a) => a.id === spec.operationId,
    );
    const left = { ...context, recoveryId: "owner-left" };
    const right = { ...context, runId: "201", recoveryId: "owner-right" };
    const results = await Promise.allSettled([
      driver.claimRecovery(attempt, spec, left),
      driver.claimRecovery(attempt, spec, right),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(results.filter((r) => r.status === "rejected").length, 1);
    const before = await driver.state();
    const winner = JSON.parse(
      before.attempts.find((a) => a.id === spec.operationId).recovery,
    ).at(-1).recoveryId;
    const loser = winner === left.recoveryId ? right : left;
    await assert.rejects(driver.finishRecovery(attempt.id, loser, "failed"));
    assert.deepEqual(await driver.state(), before);
    await driver.finishRecovery(
      attempt.id,
      winner === left.recoveryId ? left : right,
      "failed",
    );
    assert.equal(
      (await driver.state()).attempts.find((a) => a.id === spec.operationId)
        .state,
      "dirty",
    );
  }));

test("unknown recovery ownership outcome cannot authorize a takeover", async () =>
  withDatabase(async ({ driver, options }) => {
    const spec = await dirtyBackfill(driver, options);
    const attempt = (await driver.state()).attempts.find(
      (a) => a.id === spec.operationId,
    );
    await driver.claimRecovery(attempt, spec, {
      ...context,
      recoveryId: "active-owner",
    });
    await driver.query(
      "UPDATE foundation_migration_operations SET recovery=json_set(recovery,'$[#-1].outcome','unknown') WHERE id=?",
      [spec.operationId],
    );
    const before = await driver.state();
    await assert.rejects(recover({ ...options, spec, report: {} }), /outcome/i);
    assert.deepEqual(await driver.state(), before);
  }));

test("an applied correction remains immutable even while the original operation is dirty", async () =>
  withDatabase(async ({ driver, options }) => {
    const spec = await dirtyBackfill(driver, options);
    const apply = driver.apply;
    driver.apply = async (op) => {
      await apply(op);
      throw Error("lost acknowledgement");
    };
    await assert.rejects(recover({ ...options, spec, report: {} }));
    const before = await driver.state();
    options.plan.operations.find((m) => m.file === spec.correction).hash =
      "different";
    await assert.rejects(
      recover({ ...options, spec, report: {} }),
      /hash differs/,
    );
    assert.deepEqual(await driver.state(), before);
  }));

test("a completed recovery is repeatable without SQL or audit rewrite", async () =>
  withDatabase(async ({ driver, options }) => {
    const spec = await dirtyBackfill(driver, options);
    await recover({ ...options, spec, report: {} });
    const before = await driver.state();
    driver.apply = async () => {
      throw new Error("Already recovered SQL must not execute");
    };
    const report = {};
    await recover({ ...options, spec, report });
    assert.equal(report.result, "already-reconciled");
    assert.deepEqual(await driver.state(), before);
    assert(
      readFileSync(".github/scripts/migrations.mjs", "utf8").includes(
        'if (phase === "recover") report.recoveryResult = report.result;',
      ),
    );
  }));

test("correction postcondition cannot replace the correction native journal", async () =>
  withDatabase(async ({ driver, options }) => {
    const spec = await dirtyBackfill(driver, options);
    driver.apply = async (op) => {
      await driver.query(options.plan.sql.get(op.file));
    };
    await assert.rejects(recover({ ...options, spec, report: {} }), /journal/i);
    const state = await driver.state();
    assert.equal(
      state.attempts.find((a) => a.id === spec.operationId).state,
      "dirty",
    );
    assert(!state.applied.includes("0003_backfill.sql"));
  }));

test("applied journal entries require their dependencies", async () =>
  withDatabase(async ({ driver, plan }) => {
    await driver.query(
      "INSERT INTO d1_migrations(name) VALUES('0004_contract.sql')",
    );
    const state = await driver.state();
    assert.throws(() => inspectState(plan, state), /dependenc/i);
  }));

test("two recoveries of the same dirty record cannot both enter correction", async () =>
  withDatabase(async ({ driver, options }) => {
    const spec = await dirtyBackfill(driver, options);
    const apply = driver.apply;
    let release, firstStarted, secondEntered;
    const paused = new Promise((resolve) => {
      release = resolve;
    });
    const first = new Promise((resolve) => {
      firstStarted = resolve;
    });
    const second = new Promise((resolve) => {
      secondEntered = resolve;
    });
    let entered = 0;
    driver.apply = async (op) => {
      entered++;
      if (entered === 1) firstStarted();
      else secondEntered("entered");
      await paused;
      return apply(op);
    };
    const one = recover({ ...options, spec, report: {} });
    await first;
    const two = recover({
      ...options,
      context: { ...context, runId: "201" },
      spec,
      report: {},
    });
    let outcome;
    try {
      outcome = await Promise.race([
        second,
        two.then(
          () => "completed",
          () => "rejected",
        ),
      ]);
    } finally {
      release();
      await Promise.allSettled([one, two]);
    }
    assert.equal(outcome, "rejected");
    assert.equal(entered, 1);
  }));

test("failure before EXPAND writes no intent; native failure during EXPAND rolls back and requires explicit unapplied recovery", async () =>
  withDatabase(async ({ driver, db, options }) => {
    await assert.rejects(
      runPhase({
        ...options,
        phase: "expand",
        authorize: async () => {
          throw Error("unauthorized SHA");
        },
      }),
    );
    assert.deepEqual(await driver.state(), { applied: [], attempts: [] });
    const apply = driver.apply;
    driver.apply = async (op) => {
      if (op.file !== "0002_expand.sql") return apply(op);
      await db.batch([
        db.prepare("ALTER TABLE items ADD new_value TEXT"),
        db.prepare("INSERT INTO nonexistent VALUES(1)"),
      ]);
    };
    await assert.rejects(runPhase({ ...options, phase: "expand" }), /Dirty/);
    const state = await driver.state();
    const dirty = state.attempts.find((a) => a.state === "dirty");
    assert(!state.applied.includes(dirty.migration));
    assert.equal(
      (
        await driver.query(
          "SELECT COUNT(*) AS n FROM pragma_table_info('items') WHERE name='new_value'",
        )
      )[0].n,
      0,
    );
    const spec = {
      format: 1,
      operationId: dirty.id,
      resolution: "unapplied",
      incident: "https://github.com/t00ls-dev/foundation/issues/1",
      proof:
        "SELECT COUNT(*) AS remaining FROM pragma_table_info('items') WHERE name='new_value'",
    };
    await recover({ ...options, spec, report: {} });
    driver.apply = apply;
    await runPhase({
      ...options,
      phase: "expand",
      context: { ...context, attempt: "2" },
    });
    requireExpanded(options.plan, await driver.state());
  }));

for (const reason of [
  "deploy interrupted",
  "health failed",
  "wrong SHA",
  "later deployment",
]) {
  test(`EXPAND remains usable but post-deploy mutations do not advance after ${reason}`, async () =>
    withDatabase(async ({ driver, options }) => {
      await runPhase({ ...options, phase: "expand" });
      const before = await driver.state();
      requireExpanded(options.plan, before);
      const proof = {
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
          run_id: 200,
          run_attempt: 1,
          started_at: "2025-12-31T23:59:00Z",
          completed_at: "2026-01-01T00:00:00Z",
        },
        healthSha: sha,
        sha,
        runId: "200",
        attempt: "1",
      };
      if (reason === "deploy interrupted") proof.job.conclusion = "cancelled";
      if (reason === "health failed") proof.healthSha = null;
      if (reason === "wrong SHA")
        proof.version.annotations["workers/tag"] = "b".repeat(40);
      if (reason === "later deployment") proof.expectedDeployment = "obsolete";
      const deploymentEvidence = async () => validateDeployment(proof);
      await assert.rejects(
        runPhase({ ...options, phase: "backfill", deploymentEvidence }),
      );
      const report = await runPhase({
        ...options,
        phase: "contract",
        deploymentEvidence,
      });
      assert.equal(report.operations[0].result, "ineligible");
      assert.deepEqual(await driver.state(), before);
    }));
}

for (const phase of ["backfill", "contract"]) {
  test(`interrupted ${phase} after complete native commit reconciles without reapplication`, async () =>
    withDatabase(async ({ driver, options }) => {
      await runPhase({ ...options, phase: "expand" });
      await driver.query(
        "INSERT INTO items(id,old_value) VALUES(1,'historic')",
      );
      if (phase === "contract")
        await runPhase({ ...options, phase: "backfill" });
      const apply = driver.apply;
      driver.apply = async (op) => {
        await apply(op);
        throw Error("response lost after real commit");
      };
      await assert.rejects(runPhase({ ...options, phase }), /Dirty/);
      const state = await driver.state();
      const dirty = state.attempts.find((a) => a.state === "dirty");
      assert(state.applied.includes(dirty.migration));
      const op = options.plan.operations.find(
        (m) => m.file === dirty.migration,
      );
      const spec = {
        format: 1,
        operationId: dirty.id,
        resolution: "applied",
        incident: "https://github.com/t00ls-dev/foundation/issues/1",
        proof: op.verify,
      };
      driver.apply = async () => {
        throw Error("must not reapply");
      };
      await recover({ ...options, spec, report: {} });
      const report = {};
      await recover({ ...options, spec, report });
      assert.equal(report.result, "already-reconciled");
      inspectState(options.plan, await driver.state());
    }));
}

test("actual partial data needs a new corrective migration, not applied/unapplied guessing", async () =>
  withDatabase(async ({ driver, options }) => {
    const spec = await dirtyBackfill(driver, options);
    await driver.query("INSERT INTO items(id,old_value) VALUES(2,'second')");
    await driver.query("UPDATE items SET new_value=old_value WHERE id=1");
    await assert.rejects(
      recover({
        ...options,
        spec: { ...spec, resolution: "applied", correction: undefined },
        report: {},
      }),
    );
    await assert.rejects(
      recover({
        ...options,
        spec: { ...spec, resolution: "unapplied", correction: undefined },
        report: {},
      }),
    );
    await recover({ ...options, spec, report: {} });
    assert.deepEqual(
      await driver.query("SELECT new_value FROM items ORDER BY id"),
      [{ new_value: "historic" }, { new_value: "second" }],
    );
    assert((await driver.state()).applied.includes(spec.correction));
  }));

test("interrupted correction with native journal is resumed without reexecuting its SQL", async () =>
  withDatabase(async ({ driver, options }) => {
    const spec = await dirtyBackfill(driver, options);
    const apply = driver.apply;
    driver.apply = async (op) => {
      await apply(op);
      throw Error("response lost");
    };
    await assert.rejects(recover({ ...options, spec, report: {} }));
    driver.apply = async () => {
      throw Error("must not reapply correction");
    };
    await recover({ ...options, spec, report: {} });
    inspectState(options.plan, await driver.state());
  }));

test("lost acknowledgement of atomic recovery finish is repeatable without corrupting the completed audit", async () =>
  withDatabase(async ({ driver, db, options, setFault }) => {
    const spec = await dirtyBackfill(driver, options);
    setFault(async (_, request) => {
      const { sql, params } = JSON.parse(request.body);
      if (!sql.includes(", state=?, finished_at=?")) return;
      setFault(undefined);
      await db
        .prepare(sql)
        .bind(...params)
        .all();
      throw Error("response lost after atomic finish");
    });
    await assert.rejects(recover({ ...options, spec, report: {} }));
    const before = await driver.state();
    assert.equal(
      before.attempts.find((a) => a.id === spec.operationId).state,
      "applied",
    );
    const report = {};
    await recover({ ...options, spec, report });
    assert.equal(report.result, "already-reconciled");
    assert.deepEqual(await driver.state(), before);
  }));

test("abandoned recovery ownership requires explicit identity and verified stopped workflow before takeover", async () =>
  withDatabase(async ({ driver, options }) => {
    const spec = await dirtyBackfill(driver, options);
    const attempt = (await driver.state()).attempts.find(
      (a) => a.id === spec.operationId,
    );
    const owner = { ...context, runId: "900", recoveryId: "abandoned-owner" };
    await driver.claimRecovery(attempt, spec, owner);
    const before = await driver.state();
    await assert.rejects(
      recover({ ...options, spec, report: {} }),
      /already owned/,
    );
    const claim = JSON.parse(
      before.attempts.find((a) => a.id === spec.operationId).recovery,
    ).at(-1);
    const run = {
      id: 900,
      repository: { full_name: "t00ls-dev/foundation" },
      head_repository: { full_name: "t00ls-dev/foundation" },
      path: ".github/workflows/migration-recovery-dev.yml",
      event: "workflow_dispatch",
      head_branch: "master",
      head_sha: sha,
      run_attempt: 1,
      status: "in_progress",
      conclusion: null,
    };
    const next = { ...spec, supersedesRecovery: owner.recoveryId };
    await assert.rejects(
      recover({
        ...options,
        spec: next,
        report: {},
        assertRecoveryStopped: async () => validateStoppedRecovery(run, claim),
      }),
    );
    assert.deepEqual(await driver.state(), before);
    for (const change of [
      { head_sha: "b".repeat(40) },
      { path: ".github/workflows/ci.yml" },
      { head_branch: "feature" },
      { repository: { full_name: "fork/repo" } },
    ])
      assert.throws(() =>
        validateStoppedRecovery(
          { ...run, status: "completed", conclusion: "failure", ...change },
          claim,
        ),
      );
    await recover({
      ...options,
      spec: next,
      report: {},
      assertRecoveryStopped: async () =>
        validateStoppedRecovery(
          { ...run, status: "completed", conclusion: "cancelled" },
          claim,
        ),
    });
    inspectState(options.plan, await driver.state());
  }));

test("wrong SHA, target overrides, corrupted audit and changed completed evidence fail closed", async () =>
  withDatabase(async ({ driver, options }) => {
    const spec = await dirtyBackfill(driver, options);
    const before = await driver.state();
    await assert.rejects(
      recover({
        ...options,
        spec,
        report: {},
        authorize: async () =>
          validateContext({
            repository: "t00ls-dev/foundation",
            workflow: "Recovery DEV",
            event: "workflow_dispatch",
            ref: "refs/heads/master",
            confirmation: "RECONCILE_DEV_D1",
            recovery: true,
            sha,
            head: sha,
            master: "b".repeat(40),
          }),
      }),
    );
    await assert.rejects(
      recover({
        ...options,
        spec: { ...spec, environment: "production" },
        report: {},
      }),
    );
    assert.deepEqual(await driver.state(), before);
    await driver.query(
      "UPDATE foundation_migration_operations SET recovery='not-json' WHERE id=?",
      [spec.operationId],
    );
    await assert.rejects(recover({ ...options, spec, report: {} }));
    await driver.query(
      "UPDATE foundation_migration_operations SET recovery=NULL WHERE id=?",
      [spec.operationId],
    );
    await recover({ ...options, spec, report: {} });
    const completed = await driver.state();
    await assert.rejects(
      recover({
        ...options,
        spec: {
          ...spec,
          proof: "SELECT COUNT(*) AS remaining FROM items WHERE id=1",
        },
        report: {},
      }),
    );
    assert.deepEqual(await driver.state(), completed);
    await driver.query("DELETE FROM d1_migrations WHERE name=?", [
      spec.correction,
    ]);
    await assert.rejects(recover({ ...options, spec, report: {} }));
  }));

for (const status of [401, 403, 503]) {
  test(`HTTP ${status} at D1 transport blocks recovery without logging response secrets or clearing dirty`, async () =>
    withDatabase(async ({ driver, options, setFault }) => {
      const spec = await dirtyBackfill(driver, options);
      const before = await driver.state();
      setFault(
        () =>
          new Response("fixture-sensitive-response-not-for-logs", { status }),
      );
      await assert.rejects(
        recover({ ...options, spec, report: {} }),
        (error) => {
          assert(!error.message.includes("fixture-sensitive-response"));
          return true;
        },
      );
      setFault(undefined);
      assert.deepEqual(await driver.state(), before);
    }));
}

test("connectivity loss preserves durable intent and missing credentials reject recovery before D1", async () =>
  withDatabase(async ({ driver, options, setFault }) => {
    const spec = await dirtyBackfill(driver, options);
    const before = await driver.state();
    assert.throws(() => validateDevBindings("recover", options.plan, {}));
    setFault(() => {
      throw new TypeError("simulated network loss");
    });
    await assert.rejects(recover({ ...options, spec, report: {} }));
    setFault(undefined);
    assert.deepEqual(await driver.state(), before);
  }));

test("unknown journal names, missing journal table and divergent attempt hash cannot be cleaned by recovery", async () =>
  withDatabase(async ({ driver, options }) => {
    const spec = await dirtyBackfill(driver, options);
    const hash = options.plan.operations.find(
      (m) => m.file === "0003_backfill.sql",
    ).hash;
    await driver.query(
      "UPDATE foundation_migration_operations SET hash='divergent' WHERE id=?",
      [spec.operationId],
    );
    await assert.rejects(
      recover({ ...options, spec, report: {} }),
      /immutable/,
    );
    await driver.query(
      "UPDATE foundation_migration_operations SET hash=? WHERE id=?",
      [hash, spec.operationId],
    );
    await driver.query("INSERT INTO d1_migrations(name) VALUES('unknown.sql')");
    await assert.rejects(
      recover({ ...options, spec, report: {} }),
      /Unknown remote/,
    );
    await driver.query("DELETE FROM d1_migrations WHERE name='unknown.sql'");
    const audit = (await driver.state()).attempts;
    await driver.query("DROP TABLE d1_migrations");
    await assert.rejects(
      recover({ ...options, spec, report: {} }),
      /Journal\/operation/,
    );
    assert.deepEqual((await driver.state()).attempts, audit);
  }));
