import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applicationDatabaseUrl,
  applyRuntimeGrants,
  prepareRuntimeRoles,
} from "./runtime-acl-fixture.js";

test("harness ACL: valida destinos antes de qualquer conexão, sem expor a URL inválida", async () => {
  const names = [
    "NODE_ENV",
    "LEVI_LOCAL_DATABASE",
    "LEVI_TEST_RUNTIME_DATABASE_URL",
  ] as const;
  const before = names.map((name) => process.env[name]);
  const observer =
    "postgresql://levi_test:synthetic-only@127.0.0.1:54321/levi_test";
  const runtime = observer.replace("levi_test:", "levi_dev_runtime:");
  const migrator = observer.replace("levi_test:", "levi_dev_migrator:");
  try {
    process.env.NODE_ENV = "test";
    process.env.LEVI_LOCAL_DATABASE = "1";
    delete process.env.LEVI_TEST_RUNTIME_DATABASE_URL;
    assert.equal(applicationDatabaseUrl(observer), observer);
    process.env.LEVI_TEST_RUNTIME_DATABASE_URL = runtime;
    assert.equal(applicationDatabaseUrl(observer), runtime);
    for (const input of [
      "URL inválida contendo segredo-sintético",
      runtime.replace("127.0.0.1", "remote.example.test"),
      runtime.replace("54321", "54322"),
      runtime.replace("/levi_test", "/other"),
      runtime.replace("levi_dev_runtime:", "levi_dev_migrator:"),
      runtime.replace("postgresql:", "https:"),
      `${runtime}?host=remote.example.test`,
      `${runtime}?port=54322`,
      `${runtime}?user=levi_dev_migrator`,
      `${runtime}#fragment`,
    ]) {
      process.env.LEVI_TEST_RUNTIME_DATABASE_URL = input;
      assert.throws(
        () => applicationDatabaseUrl(observer),
        (error: Error) => {
          assert.ok(!error.message.includes(input));
          return true;
        },
      );
    }
    // Mesmo sem runtime configurada, o observador não pode apontar fora do harness.
    delete process.env.LEVI_TEST_RUNTIME_DATABASE_URL;
    for (const suffix of [
      "?host=remote.example.test",
      "?user=another",
      "#fragment",
    ])
      assert.throws(() => applicationDatabaseUrl(observer + suffix));
    // As funções que escrevem fixtures recusam overrides antes de abrir Client.
    for (const suffix of [
      "?host=remote.example.test",
      "?port=54322",
      "?user=another",
    ]) {
      await assert.rejects(
        prepareRuntimeRoles(observer + suffix),
        /harness descartável/,
      );
      await assert.rejects(
        applyRuntimeGrants(migrator + suffix),
        /harness descartável/,
      );
    }
    process.env.LEVI_LOCAL_DATABASE = "0";
    assert.throws(() => applicationDatabaseUrl(observer));
  } finally {
    for (const [index, name] of names.entries()) {
      if (before[index] === undefined) delete process.env[name];
      else process.env[name] = before[index];
    }
  }
});
