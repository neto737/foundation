import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyDeployError,
  createDeployDiagnostics,
  observeFetch,
} from "./deploy-diagnostics.mjs";
import { approvedCi } from "./ci-evidence.mjs";

const secret =
  "sensitive-body-token-https://user:password@private.invalid/path";
const sha = "a".repeat(40);
function capture(phase) {
  const output = [];
  const diagnostics = createDeployDiagnostics(phase, (line) => {
    assert(!line.includes(secret));
    output.push(JSON.parse(line));
  });
  return { diagnostics, output };
}
function healthResponse({
  status = 200,
  header = sha,
  body = '{"checks":{"database":"ok"}}',
} = {}) {
  return new Response(body, {
    status,
    headers: { "X-Foundation-SHA": header },
  });
}

test("closed error reasons ignore accessors, proxies, inheritance, secrets and cycles", () => {
  let touched = 0;
  const hostile = Object.create(
    null,
    Object.fromEntries(
      ["code", "cause", "message", "stack", "name", "toJSON"].map((key) => [
        key,
        {
          get() {
            touched++;
            throw Error(secret);
          },
        },
      ]),
    ),
  );
  const proxy = new Proxy(
    {},
    {
      get() {
        touched++;
        throw Error(secret);
      },
      getOwnPropertyDescriptor() {
        touched++;
        throw Error(secret);
      },
      getPrototypeOf() {
        touched++;
        throw Error(secret);
      },
    },
  );
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  const cycle = { message: secret };
  cycle.cause = cycle;
  for (const error of [
    hostile,
    proxy,
    revoked.proxy,
    cycle,
    null,
    secret,
    7,
    Object.create({ code: "ENOENT" }),
    { code: secret },
    { cause: proxy },
  ]) {
    assert.equal(classifyDeployError(error), "UNKNOWN");
    const { diagnostics, output } = capture("health");
    diagnostics.report(error);
    assert.equal(output[0].reason, "UNKNOWN");
    assert.deepEqual(Object.keys(output[0]), [
      "code",
      "phase",
      "check",
      "category",
      "http_status",
      "reason",
    ]);
  }
  assert.equal(touched, 0);
  assert.equal(
    classifyDeployError({ cause: { code: "ECONNRESET", message: secret } }),
    "ECONNRESET",
  );
  assert.equal(
    classifyDeployError({ name: "TimeoutError", message: secret }),
    "TIMEOUT",
  );
  let deep = { code: "ENOENT" };
  for (let i = 0; i < 9; i++) deep = { cause: deep };
  assert.equal(classifyDeployError(deep), "UNKNOWN");
});

const workflow = { id: 10, path: ".github/workflows/ci.yml" };
const run = {
  id: 100,
  run_attempt: 2,
  workflow_id: 10,
  path: workflow.path,
  repository: { full_name: "t00ls-dev/foundation" },
  head_repository: { full_name: "t00ls-dev/foundation" },
  event: "push",
  head_branch: "master",
  head_sha: sha,
  status: "completed",
  conclusion: "success",
};
const job = {
  name: "checks",
  run_id: 100,
  run_attempt: 2,
  head_sha: sha,
  status: "completed",
  conclusion: "success",
};
function ciRequest(url) {
  if (url.endsWith("ci.yml")) return workflow;
  if (url.includes("/runs?")) return { workflow_runs: [run] };
  if (url.includes("/jobs?")) return { jobs: [job] };
  return run;
}

test("CI identifies rejected validations without accepting older runs or failed checks", async () => {
  for (const [override, check] of [
    [
      (url) =>
        url.endsWith("ci.yml") ? { ...workflow, path: secret } : ciRequest(url),
      "ci-workflow",
    ],
    [
      (url) =>
        url.includes("/runs?") ? { workflow_runs: [] } : ciRequest(url),
      "ci-runs",
    ],
    [(url) => (url.includes("/jobs?") ? {} : ciRequest(url)), "ci-jobs"],
    [
      (url) =>
        url.includes("/jobs?")
          ? { jobs: [{ ...job, conclusion: "failure" }] }
          : ciRequest(url),
      "ci-evidence",
    ],
  ]) {
    const { diagnostics, output } = capture("ci");
    await assert.rejects(
      approvedCi(sha, { request: async (url) => override(url), diagnostics }),
    );
    assert.equal(output.at(-1).check, check);
    assert.equal(output.at(-1).http_status, null);
  }
});

test("CI default HTTP transport reports HTTP, invalid JSON, network and missing config", async (t) => {
  t.mock.property(process, "env", {
    ...process.env,
    GITHUB_TOKEN: "fixture-only",
  });
  for (const [request, category, status] of [
    [async () => new Response(secret, { status: 403 }), "http", 403],
    [async () => new Response(secret), "unexpected-response", 200],
    [
      async () => {
        throw Error(secret);
      },
      "network",
      null,
    ],
  ]) {
    t.mock.method(globalThis, "fetch", request);
    const { diagnostics, output } = capture("ci");
    await assert.rejects(approvedCi(sha, { diagnostics }));
    assert.equal(output.at(-1).check, "ci-workflow-read");
    assert.equal(output.at(-1).category, category);
    assert.equal(output.at(-1).http_status, status);
  }
  delete process.env.GITHUB_TOKEN;
  const { diagnostics, output } = capture("ci");
  await assert.rejects(approvedCi(sha, { diagnostics }));
  assert.equal(output[0].category, "configuration");
});

test("diagnostic write/classification failure never masks the operational error or success", async () => {
  const original = new Proxy(
    {},
    {
      get() {
        throw Error(secret);
      },
    },
  );
  const diagnostics = createDeployDiagnostics("ci", () => {
    throw Error("logger failed");
  });
  async function requireOriginal() {
    let caught;
    try {
      await approvedCi(sha, {
        diagnostics,
        request: async () => {
          throw original;
        },
      });
    } catch (error) {
      caught = error;
    }
    assert.equal(caught, original);
  }
  await requireOriginal();
  diagnostics.failure = () => {
    throw Error("classifier failed");
  };
  await requireOriginal();
  assert.deepEqual(
    await approvedCi(sha, {
      diagnostics,
      request: async (url) => ciRequest(url),
      log: () => {},
    }),
    { sha, runId: 100, attempt: 2 },
  );
});

test("CI CLI handles local read and invalid event JSON without disclosing raw errors", () => {
  const dir = mkdtempSync(join(tmpdir(), "foundation-diagnostic-"));
  try {
    const path = join(dir, "event.json");
    writeFileSync(path, secret);
    for (const [eventPath, check] of [
      [path, "ci-event-json"],
      [join(dir, "missing"), "ci-event-read"],
    ]) {
      const result = spawnSync(
        process.execPath,
        [".github/scripts/ci-evidence.mjs", "deploy"],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            GITHUB_REPOSITORY: "t00ls-dev/foundation",
            GITHUB_EVENT_PATH: eventPath,
          },
        },
      );
      assert.equal(result.status, 1);
      assert(!result.stderr.includes(secret));
      const diagnostic = JSON.parse(result.stderr.trim());
      assert.equal(diagnostic.check, check);
      assert.equal(diagnostic.http_status, null);
      assert.equal(
        diagnostic.category,
        check === "ci-event-read" ? "local-operation" : "unexpected-response",
      );
      assert.equal(
        diagnostic.reason,
        check === "ci-event-read" ? "ENOENT" : "UNKNOWN",
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unwinding a reported error does not emit a stale context", () => {
  const { diagnostics, output } = capture("migrations");
  const original = Error(secret);
  diagnostics.start("d1-query", "http");
  diagnostics.received(403);
  diagnostics.report(original);
  diagnostics.start("migration-execution");
  diagnostics.report(original);
  assert.equal(output.length, 1);
  assert.equal(output[0].http_status, 403);
  assert.equal(output[0].check, "d1-query");
});
