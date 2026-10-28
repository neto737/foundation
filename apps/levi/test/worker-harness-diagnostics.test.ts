import assert from "node:assert/strict";
import { test } from "node:test";
import {
  withWorkerCleanup,
  workerOperation,
  workerRequestContext,
} from "./worker-harness-diagnostics.js";

void test("harness Worker: diagnóstico HTTP mantém causa e não imprime dados da requisição", async (t) => {
  const lines: string[] = [];
  t.mock.method(console, "error", (line: string) => lines.push(line));
  const cause = Object.assign(new Error("cookie=private; token=private"), {
    code: "ECONNRESET",
  });
  const original = new TypeError("URL com credenciais privadas", { cause });
  await assert.rejects(
    workerOperation(
      {
        phase: "dispatch",
        runtimeId: 1,
        requestId: 7,
        request: workerRequestContext(
          "https://user:private@example.test/api/%61dmin?token=private#private",
          "DELETE",
        ),
      },
      () => {
        throw original;
      },
    ),
    (error: unknown) =>
      error instanceof Error && error === original && error.cause === cause,
  );
  assert.equal(lines.length, 1);
  const diagnostic: unknown = JSON.parse(lines[0]!);
  assert.ok(diagnostic && typeof diagnostic === "object");
  assert.ok("durationMs" in diagnostic);
  assert.equal(typeof diagnostic.durationMs, "number");
  assert.ok("codes" in diagnostic);
  assert.deepEqual(diagnostic.codes, ["unknown", "ECONNRESET"]);
  assert.match(lines[0]!, /"phase":"dispatch"/);
  assert.match(lines[0]!, /"path":"\/api\/%61dmin"/);
  assert.doesNotMatch(
    lines[0]!,
    /private|cookie|token|credentials|example\.test/,
  );
  assert.deepEqual(
    workerRequestContext(
      "https://example.test/api/members/personal-data",
      "secret-method",
    ),
    { path: "[redacted]", method: "[redacted]" },
  );
});

void test("harness Worker: sucesso é silencioso e devolve o mesmo resultado", async (t) => {
  const log = t.mock.method(console, "error", () => undefined);
  const result = new Response("unchanged", { status: 404 });
  assert.equal(
    await workerOperation({ phase: "ready", runtimeId: 1 }, () => result),
    result,
  );
  assert.equal(await result.text(), "unchanged");
  assert.equal(log.mock.callCount(), 0);
});

void test("harness Worker: erro do diagnóstico não substitui erro de inicialização", async (t) => {
  t.mock.method(console, "error", () => {
    throw new Error("stderr unavailable");
  });
  const original = new Error("startup failed");
  await assert.rejects(
    workerOperation({ phase: "create", runtimeId: 1 }, () => {
      throw original;
    }),
    (error: unknown) => error === original,
  );
});

void test("harness Worker: limpeza de todos os recursos preserva falha original", async (t) => {
  const lines: string[] = [];
  t.mock.method(console, "error", (line: string) => lines.push(line));
  const closed: string[] = [];
  const original = new Error("assertion failed");
  await assert.rejects(
    withWorkerCleanup(() => {
      throw original;
    }, [
      {
        resource: "runtime",
        close: () => {
          closed.push("runtime");
          throw new Error("dispose failed");
        },
      },
      {
        resource: "observer",
        close: () => {
          closed.push("observer");
          return Promise.reject(new Error("end failed"));
        },
      },
      {
        resource: "fixture",
        close: () => {
          closed.push("fixture");
        },
      },
    ]),
    (error: unknown) => error === original,
  );
  assert.deepEqual(closed, ["runtime", "observer", "fixture"]);
  assert.equal(lines.length, 2);
  assert.doesNotMatch(lines.join("\n"), /dispose failed|end failed/);
});

void test("harness Worker: limpeza sem falha anterior expõe todos os erros", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const first = new Error("dispose failed");
  const second = new Error("end failed");
  await assert.rejects(
    withWorkerCleanup(
      () => undefined,
      [
        {
          resource: "runtime",
          close: () => {
            throw first;
          },
        },
        { resource: "observer", close: () => Promise.reject(second) },
      ],
    ),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [first, second]);
      return true;
    },
  );
});

void test("harness Worker: recurso pendente não impede iniciar a outra limpeza", async () => {
  let release: () => void = () => undefined;
  const runtime = new Promise<void>((resolve) => {
    release = resolve;
  });
  let observerClosed = false;
  const cleanup = withWorkerCleanup(
    () => undefined,
    [
      { resource: "runtime", close: () => runtime },
      {
        resource: "observer",
        close: () => {
          observerClosed = true;
        },
      },
    ],
  );
  try {
    await Promise.resolve();
    assert.equal(observerClosed, true);
  } finally {
    release();
    await cleanup;
  }
});
