import assert from "node:assert/strict";

// Adaptado de Foundation .github/scripts/ci-checks.mjs (22a4aa0).
try {
  const needs = JSON.parse(process.env.CI_NEEDS);
  assert.deepEqual(Object.keys(needs).sort(), ["e2e", "static", "tests"]);
  for (const name of ["static", "tests", "e2e"])
    assert.equal(needs[name]?.result, "success");
  console.info("CI aprovada: static, tests e e2e concluídos com sucesso.");
} catch {
  console.error("CI reprovada: todos os jobs obrigatórios devem ter sucesso.");
  process.exitCode = 1;
}
