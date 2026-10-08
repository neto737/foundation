import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

export const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const filenamePattern = /^\d+_[a-zA-Z0-9_-]+\.sql$/;

// Deliberately small SQLite lexer: strings/identifiers/comments cannot hide a
// second statement or destructive keyword. Unsupported syntax fails closed.
export function statements(sql) {
  const result = [];
  let tokens = [];
  const pattern =
    /\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|[a-zA-Z_][a-zA-Z_0-9]*|[0-9]+(?:\.[0-9]+)?|[(),.;=<>!+*/%-]/gy;
  let offset = 0;
  while (offset < sql.length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(sql);
    assert(match, "Unsupported SQL syntax");
    const value = match[0];
    offset = pattern.lastIndex;
    if (/^(\s|--|\/\*)/.test(value)) continue;
    if (value === ";") {
      if (tokens.length) result.push(tokens);
      tokens = [];
    } else
      tokens.push(
        /^["`\[]/.test(value)
          ? `@${value.slice(1, -1).toUpperCase()}`
          : value.startsWith("'")
            ? "literal"
            : value.toUpperCase(),
      );
  }
  if (tokens.length) result.push(tokens);
  assert(result.length, "Empty SQL operation");
  return result;
}

export function validateSql(sql, phase) {
  const groups = statements(sql);
  const createdTables = new Set();
  for (const tokens of groups) {
    assert(
      !tokens.some((t) =>
        [
          "PRAGMA",
          "ATTACH",
          "DETACH",
          "BEGIN",
          "COMMIT",
          "ROLLBACK",
          "TRIGGER",
        ].includes(t),
      ),
      "Unsupported SQL operation",
    );
    if (phase === "expand") {
      assert(
        !tokens.some((t) =>
          ["DROP", "RENAME", "REPLACE", "INSERT", "SELECT", "AS"].includes(t),
        ),
        "Incompatible EXPAND",
      );
      const create =
        tokens[0] === "CREATE" &&
        ["TABLE", "INDEX"].includes(tokens[tokens[1] === "UNIQUE" ? 2 : 1]);
      const add =
        tokens[0] === "ALTER" && tokens[1] === "TABLE" && tokens[3] === "ADD";
      assert(
        create || add,
        "EXPAND supports only CREATE TABLE/INDEX or ALTER TABLE ADD",
      );
      if (tokens[0] === "CREATE" && tokens[1] === "TABLE") {
        assert(
          tokens[2] !== "IF",
          "Conditional CREATE requires explicit reconciliation",
        );
        createdTables.add(tokens[2]);
      }
      if (tokens[1] === "UNIQUE")
        assert(
          createdTables.has(tokens[tokens.indexOf("ON") + 1]),
          "UNIQUE index on existing table is not a safe EXPAND",
        );
      if (add) {
        assert(
          !tokens.some((t) =>
            ["PRIMARY", "UNIQUE", "REFERENCES", "CHECK", "GENERATED"].includes(
              t,
            ),
          ),
          "Unsupported ADD constraint",
        );
        if (tokens.includes("NOT")) {
          const d = tokens.indexOf("DEFAULT");
          assert(
            d >= 0 &&
              (tokens[d + 1] === "literal" ||
                /^(?:\d|TRUE$|FALSE$)/.test(tokens[d + 1])),
            "NOT NULL ADD needs a non-null constant default",
          );
        }
      }
    } else if (phase === "backfill") {
      assert(
        ["UPDATE", "INSERT"].includes(tokens[0]),
        "BACKFILL supports bounded SQL UPDATE/INSERT only",
      );
      assert(
        !tokens.some((t) => ["DROP", "ALTER", "CREATE", "REPLACE"].includes(t)),
        "Schema mutation in BACKFILL",
      );
    } else {
      assert.equal(phase, "contract");
      assert(
        ["DROP", "ALTER"].includes(tokens[0]),
        "CONTRACT supports explicit DROP/ALTER only",
      );
    }
  }
}

export function validateProbe(sql) {
  const groups = statements(sql);
  assert.equal(groups.length, 1, "A probe must be one SELECT");
  assert.equal(groups[0][0], "SELECT");
  assert(
    groups[0].includes("FROM"),
    "Diagnostic proof must inspect database state",
  );
  assert(
    !groups[0].some((t) =>
      [
        "INSERT",
        "UPDATE",
        "DELETE",
        "DROP",
        "ALTER",
        "CREATE",
        "PRAGMA",
        "ATTACH",
      ].includes(t),
    ),
  );
}

export function validatePlan(policy, files, journal, environment = "dev") {
  assert.equal(policy.format, 1);
  const delay = policy.environments?.[environment]?.contractDelaySeconds;
  assert(Number.isSafeInteger(delay) && delay >= 0);
  assert(Array.isArray(policy.operations));
  const names = policy.operations.map((m) => m.file);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(
    [...names].sort(),
    [...files.keys()].sort(),
    "Every SQL needs explicit metadata",
  );
  assert.deepEqual(
    journal.entries.map((entry) => `${entry.tag}.sql`).sort(),
    [...names].sort(),
    "Drizzle journal differs from SQL",
  );
  const operations = policy.operations.map((m, i) => {
    assert(filenamePattern.test(m.file));
    assert(/^[a-z0-9][a-z0-9-]{0,79}$/.test(m.transition));
    assert(["expand", "backfill", "contract"].includes(m.phase));
    assert(
      Array.isArray(m.dependsOn) &&
        new Set(m.dependsOn).size === m.dependsOn.length,
    );
    for (const name of m.dependsOn)
      assert(
        names.indexOf(name) >= 0 && names.indexOf(name) < i,
        "Dependencies must precede operation",
      );
    validateSql(files.get(m.file), m.phase);
    validateProbe(m.verify);
    if (m.supersededBy) {
      const replacement = policy.operations.find(
        (op) => op.file === m.supersededBy,
      );
      assert(
        replacement?.phase === "contract" &&
          replacement.dependsOn.includes(m.file),
        "Supersession requires a dependent CONTRACT",
      );
    }
    if (m.phase !== "expand") {
      const required = policy.operations.filter(
        (op) =>
          op.transition === m.transition &&
          (op.phase === "expand" ||
            (m.phase === "contract" && op.phase === "backfill")),
      );
      assert(
        required.some((op) => op.phase === "expand"),
        "Post-deploy phase needs EXPAND",
      );
      for (const op of required)
        assert(m.dependsOn.includes(op.file), "Missing transition dependency");
    }
    return { ...m, hash: hash(files.get(m.file)) };
  });
  return {
    operations,
    contractDelaySeconds: delay,
    digest: hash(JSON.stringify({ policy, operations })),
  };
}

export function inspectState(plan, state, { allowDirty = false } = {}) {
  assert(
    Array.isArray(state.applied) &&
      new Set(state.applied).size === state.applied.length,
    "Invalid D1 journal",
  );
  assert(Array.isArray(state.attempts));
  if (!allowDirty)
    assert(
      !state.attempts.some((a) => ["running", "dirty"].includes(a.state)),
      "Database dirty: explicit recovery required",
    );
  for (const name of state.applied) {
    assert(
      plan.operations.some((m) => m.file === name),
      "Unknown remote migration; use current reviewed history",
    );
    assert(
      plan.operations
        .find((m) => m.file === name)
        .dependsOn.every((dep) => state.applied.includes(dep)),
      "Applied journal dependency missing",
    );
  }
  for (const attempt of state.attempts) {
    assert(
      ["running", "dirty", "applied", "resolved-unapplied"].includes(
        attempt.state,
      ),
      "Unknown operation outcome",
    );
    const op = plan.operations.find((m) => m.file === attempt.migration);
    assert(
      op &&
        op.hash === attempt.hash &&
        op.phase === attempt.phase &&
        op.transition === attempt.transition_id,
      "Applied/attempted migration is immutable",
    );
    if (attempt.state === "applied")
      assert(
        state.applied.includes(op.file),
        "Journal/operation evidence differs",
      );
  }
  return state;
}

export function requireExpanded(plan, state) {
  inspectState(plan, state);
  assert(
    plan.operations
      .filter((m) => m.phase === "expand")
      .every((m) => state.applied.includes(m.file)),
    "Required EXPAND pending; block deploy",
  );
}

export function validateDeployment({
  deployment,
  version,
  healthSha,
  job,
  sha,
  runId,
  attempt,
  expectedDeployment,
}) {
  assert(
    deployment?.id && deployment.versions?.length === 1,
    "No single active deployment",
  );
  assert.equal(deployment.versions[0].percentage, 100);
  assert.equal(deployment.versions[0].version_id, version?.id);
  assert.equal(
    version.annotations?.["workers/tag"],
    sha,
    "Rollback or obsolete deployment",
  );
  assert.equal(healthSha, sha, "Health belongs to another application SHA");
  assert.equal(job?.name, "deploy");
  assert.equal(job?.conclusion, "success");
  assert.equal(job?.head_sha, sha);
  assert.equal(job?.run_id, Number(runId));
  assert.equal(job?.run_attempt, Number(attempt));
  assert(Number.isFinite(Date.parse(job.completed_at)));
  const created = Date.parse(deployment.created_on);
  assert(
    Number.isFinite(created) &&
      created >= Date.parse(job.started_at) &&
      created <= Date.parse(job.completed_at),
    "Deployment is not from the expected job; newer/foreign promotion",
  );
  if (expectedDeployment)
    assert.equal(
      deployment.id,
      expectedDeployment,
      "Deployment changed during operation",
    );
  return {
    deploymentId: deployment.id,
    versionId: version.id,
    sha,
    runId: Number(runId),
    attempt: Number(attempt),
    completedAt: job.completed_at,
  };
}

export async function verifyOperation(driver, op) {
  const rows = await driver.query(op.verify);
  assert(
    rows.length === 1 && rows[0].remaining === 0,
    "Migration postcondition not proven",
  );
}

export async function verifyCurrentSchema(driver, plan, state, op) {
  const replacement =
    op.supersededBy &&
    state.applied.includes(op.supersededBy) &&
    plan.operations.find((m) => m.file === op.supersededBy);
  await verifyOperation(driver, replacement || op);
}

// Driver writes intent BEFORE invoking the native migrator. Running/dirty rows
// survive lost runners/API responses. GitHub success never replaces the journal.
export async function runPhase({
  phase,
  plan,
  driver,
  authorize,
  deploymentEvidence,
  context,
  now = () => new Date(),
  report = { operations: [] },
}) {
  assert(["expand", "backfill", "contract"].includes(phase));
  let state = inspectState(plan, await driver.state());
  for (const op of plan.operations.filter((m) => m.phase === phase)) {
    await authorize();
    state = inspectState(plan, await driver.state());
    if (state.applied.includes(op.file)) {
      await verifyCurrentSchema(driver, plan, state, op);
      report.operations.push({
        migration: op.file,
        transition: op.transition,
        phase,
        result: "already-applied",
      });
      continue;
    }
    if (
      phase === "contract" &&
      !op.dependsOn.every((name) => state.applied.includes(name))
    ) {
      report.operations.push({
        migration: op.file,
        transition: op.transition,
        phase,
        result: "ineligible",
        reason: "dependencies-pending",
      });
      continue;
    }
    assert(
      op.dependsOn.every((name) => state.applied.includes(name)),
      "Dependency not applied",
    );
    for (const name of op.dependsOn)
      await verifyCurrentSchema(
        driver,
        plan,
        state,
        plan.operations.find((m) => m.file === name),
      );
    let evidence;
    if (phase !== "expand") {
      try {
        evidence = await deploymentEvidence();
        if (phase === "contract")
          assert(
            now().getTime() >=
              Date.parse(evidence.completedAt) +
                plan.contractDelaySeconds * 1000,
            "Additional window not elapsed",
          );
      } catch {
        report.operations.push({
          migration: op.file,
          transition: op.transition,
          phase,
          result: "ineligible",
          reason: "deployment-evidence-or-window-not-proven",
        });
        if (phase === "backfill")
          throw new Error("BACKFILL requires current healthy deployment");
        continue;
      }
    }
    const entry = {
      id: `${context.runId}-${context.attempt}-${op.file}`,
      migration: op.file,
      transition: op.transition,
      phase,
      hash: op.hash,
      sha: context.sha,
      startedAt: now().toISOString(),
      result: "dirty",
      evidence,
    };
    await driver.start(entry, context);
    report.operations.push(entry);
    try {
      // Revalidate after durable intent and immediately before mutation.
      await authorize();
      if (evidence) await deploymentEvidence(evidence.deploymentId);
      await driver.apply(op);
      const after = await driver.state();
      assert(
        after.applied.includes(op.file),
        "Native journal did not confirm application",
      );
      await verifyOperation(driver, op);
      if (evidence) await deploymentEvidence(evidence.deploymentId);
      await driver.finish(entry.id, "applied");
      entry.result = "applied";
    } catch {
      // No blind retry: absence from journal cannot prove absence of side effects.
      await driver.finish(entry.id, "dirty").catch(() => {});
      throw new Error(
        `Dirty migration: ${op.file}; reconcile through Recovery DEV`,
      );
    } finally {
      entry.finishedAt = now().toISOString();
    }
  }
  return report;
}

export async function recover({
  spec,
  plan,
  driver,
  authorize,
  context,
  report,
  assertRecoveryStopped,
}) {
  assert.equal(spec.format, 1);
  assert(
    Object.keys(spec).every((key) =>
      [
        "format",
        "operationId",
        "resolution",
        "incident",
        "proof",
        "correction",
        "supersedesRecovery",
      ].includes(key),
    ),
    "Unsupported recovery field/target override",
  );
  assert(["unapplied", "applied", "corrected"].includes(spec.resolution));
  if (spec.resolution !== "corrected")
    assert(
      spec.correction === undefined,
      "Correction requires corrected resolution",
    );
  assert(
    typeof spec.incident === "string" &&
      /^https:\/\/github\.com\/t00ls-dev\/foundation\/(issues|pull)\/\d+$/.test(
        spec.incident,
      ),
  );
  validateProbe(spec.proof);
  await authorize();
  const state = inspectState(plan, await driver.state(), { allowDirty: true });
  const blocked = state.attempts.filter((a) =>
    ["running", "dirty"].includes(a.state),
  );
  const attempt = state.attempts.find((a) => a.id === spec.operationId);
  assert(attempt, "Recovery operation not found");
  assert.equal(attempt.id, spec.operationId);
  const op = plan.operations.find((m) => m.file === attempt.migration);
  Object.assign(report, {
    operationId: attempt.id,
    migration: op.file,
    transition: op.transition,
    resolution: spec.resolution,
    incident: spec.incident,
  });
  const history = recoveryHistory(attempt);
  for (const record of history) {
    if (record.correctionHash && state.applied.includes(record.correction)) {
      assert(
        plan.operations.find((m) => m.file === record.correction)?.hash ===
          record.correctionHash,
        "Applied correction hash differs from audit",
      );
    }
  }
  const previous = history.at(-1);
  if (!["running", "dirty"].includes(attempt.state)) {
    assert.equal(blocked.length, 0, "Another operation is dirty");
    assert(
      previous &&
        [
          "format",
          "operationId",
          "resolution",
          "incident",
          "proof",
          "correction",
        ].every((key) => (previous[key] ?? null) === (spec[key] ?? null)),
      "Recovery definition differs from completed evidence",
    );
    assert.equal(
      attempt.state,
      spec.resolution === "unapplied" ? "resolved-unapplied" : "applied",
    );
    if (spec.resolution === "unapplied")
      assert(
        !state.applied.includes(op.file),
        "Operation advanced since recovery",
      );
    else {
      assert(state.applied.includes(op.file));
      await verifyCurrentSchema(driver, plan, state, op);
      if (spec.resolution === "corrected") {
        const correction = plan.operations.find(
          (m) => m.file === spec.correction,
        );
        assert(
          correction &&
            previous.correctionHash === correction.hash &&
            state.applied.includes(correction.file),
          "Correction evidence differs",
        );
        await verifyCurrentSchema(driver, plan, state, correction);
      }
    }
    const proof = await driver.query(spec.proof);
    assert(
      proof.length === 1 && proof[0].remaining === 0,
      "Completed recovery proof no longer passes",
    );
    await authorize();
    report.result = "already-reconciled";
    return;
  }
  assert.equal(blocked.length, 1);
  if (previous?.recoveryId && previous.outcome === "running") {
    assert.equal(
      spec.supersedesRecovery,
      previous.recoveryId,
      "Recovery already owned; explicit interrupted-run evidence required",
    );
    assert(assertRecoveryStopped, "Stopped recovery evidence required");
    report.superseded = await assertRecoveryStopped(previous);
  }
  const ownedContext = {
    ...context,
    recoveryId: randomUUID(),
    ...(report.superseded ? { superseded: report.superseded } : {}),
  };
  report.recoveryId = ownedContext.recoveryId;
  try {
    await driver.claimRecovery(attempt, spec, ownedContext);
    await authorize();
    await driver.recordRecovery(attempt.id, spec, null, ownedContext);
    if (spec.resolution === "corrected") {
      const correction = plan.operations.find(
        (m) => m.file === spec.correction,
      );
      assert(
        correction &&
          correction.file !== op.file &&
          correction.transition === op.transition &&
          correction.phase !== "contract",
        "Reviewed new compatible correction required",
      );
      assert(
        correction.dependsOn.every((name) => state.applied.includes(name)),
      );
      await driver.recordRecovery(
        attempt.id,
        spec,
        correction.hash,
        ownedContext,
      );
      await authorize();
      if (!(await driver.state()).applied.includes(correction.file))
        await driver.apply(correction);
      assert(
        (await driver.state()).applied.includes(correction.file),
        "Correction native journal proof missing",
      );
      await verifyOperation(driver, correction);
    }
    const proof = await driver.query(spec.proof);
    assert(
      proof.length === 1 && proof[0].remaining === 0,
      "Human diagnostic proof did not pass",
    );
    const applied = (await driver.state()).applied.includes(op.file);
    if (spec.resolution === "unapplied")
      assert(!applied, "Already applied: cannot authorize reapplication");
    else {
      await verifyOperation(driver, op);
      if (spec.resolution === "applied")
        assert(applied, "Native journal proof missing");
      if (!applied) {
        await authorize();
        await driver.reconcileJournal(op.file);
      }
    }
    await authorize();
    await driver.recordRecovery(
      attempt.id,
      spec,
      plan.operations.find((m) => m.file === spec.correction)?.hash ?? null,
      ownedContext,
    );
    inspectState(plan, await driver.state(), { allowDirty: true });
    await driver.finishRecovery(
      attempt.id,
      ownedContext,
      "completed",
      spec.resolution === "unapplied" ? "resolved-unapplied" : "applied",
    );
    Object.assign(report, {
      operationId: attempt.id,
      resolution: spec.resolution,
      incident: spec.incident,
      result: "reconciled",
    });
  } catch (error) {
    await driver
      .finishRecovery(attempt.id, ownedContext, "failed")
      .catch(() => {});
    throw error;
  }
}

export function recoveryHistory(attempt) {
  const history = attempt.recovery == null ? [] : JSON.parse(attempt.recovery);
  assert(
    Array.isArray(history) &&
      history.every(
        (record) =>
          record && typeof record === "object" && !Array.isArray(record),
      ),
    "Invalid recovery audit history",
  );
  for (const record of history) {
    if (record.recoveryId !== undefined || record.outcome !== undefined) {
      assert(
        typeof record.recoveryId === "string" && record.recoveryId.length > 0,
        "Invalid recovery ownership identity",
      );
      assert(
        ["running", "failed", "completed"].includes(record.outcome),
        "Unknown recovery ownership outcome",
      );
    }
  }
  return history;
}

export function validateStoppedRecovery(run, claim) {
  assert.equal(run.id, Number(claim.runId));
  assert.equal(run.repository?.full_name, "t00ls-dev/foundation");
  assert.equal(run.head_repository?.full_name, "t00ls-dev/foundation");
  assert.equal(run.path, ".github/workflows/migration-recovery-dev.yml");
  assert.equal(run.event, "workflow_dispatch");
  assert.equal(run.head_branch, "master");
  assert.equal(run.head_sha, claim.sha);
  assert(
    Number.isSafeInteger(run.run_attempt) &&
      run.run_attempt >= Number(claim.attempt),
  );
  assert.equal(run.status, "completed", "Prior recovery is still active");
  assert(
    [
      "success",
      "failure",
      "cancelled",
      "timed_out",
      "startup_failure",
      "action_required",
      "skipped",
      "neutral",
    ].includes(run.conclusion),
  );
  return {
    runId: run.id,
    attempt: run.run_attempt,
    sha: run.head_sha,
    conclusion: run.conclusion,
    recoveryId: claim.recoveryId,
  };
}
