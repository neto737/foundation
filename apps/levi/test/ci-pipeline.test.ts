import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

void test("agregador CI recusa falha, cancelamento, omissão e job inesperado", () => {
  const success = Object.fromEntries(
    ["static", "tests", "e2e"].map((name) => [name, { result: "success" }]),
  );
  const execute = (needs: string) =>
    spawnSync(process.execPath, ["tools/ci-checks.mjs"], {
      env: { CI_NEEDS: needs },
      encoding: "utf8",
    });
  assert.equal(execute(JSON.stringify(success)).status, 0);
  for (const name of Object.keys(success)) {
    for (const result of ["failure", "cancelled", "skipped", "pending"])
      assert.equal(
        execute(JSON.stringify({ ...success, [name]: { result } })).status,
        1,
      );
    const missing = { ...success };
    delete missing[name];
    assert.equal(execute(JSON.stringify(missing)).status, 1);
  }
  for (const input of [
    "private-invalid-json",
    "null",
    JSON.stringify({ ...success, other: { result: "success" } }),
  ]) {
    const result = execute(input);
    assert.equal(result.status, 1);
    assert.ok(!result.stderr.includes("private-"));
  }
});

void test("resumo de deploy usa apenas estados e SHA válidos, sem ecoar entradas privadas", async () => {
  const directory = await mkdtemp(join(tmpdir(), "levi-summary-"));
  try {
    const file = join(directory, "summary.md");
    const result = spawnSync(process.execPath, ["tools/deploy-summary.mjs"], {
      env: {
        GITHUB_STEP_SUMMARY: file,
        LEVI_DEPLOY_SHA: "a".repeat(40),
        SUMMARY_STATUS: "failure",
        SUMMARY_STEPS: JSON.stringify({
          install: { conclusion: "success" },
          publish: { conclusion: "private-token" },
          private: { outputs: "private-url" },
        }),
      },
      encoding: "utf8",
    });
    assert.equal(result.status, 0);
    const summary = await readFile(file, "utf8");
    assert.ok(summary.includes("a".repeat(40)) && summary.includes("failure"));
    assert.ok(summary.includes("| install | success |"));
    assert.ok(!summary.includes("private-"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
