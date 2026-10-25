import assert from "node:assert/strict";

const needs = JSON.parse(process.env.CI_NEEDS);
assert.deepEqual(Object.keys(needs).sort(), [
  "distribution",
  "e2e",
  "levi-e2e",
  "levi-tests",
  "static",
  "tests",
]);
for (const [name, job] of Object.entries(needs))
  assert.equal(job.result, "success", `Required CI job ${name}: ${job.result}`);
