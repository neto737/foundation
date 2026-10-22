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
import { migrationHealth } from "./migration-health.mjs";
import { approvedCi } from "./ci-evidence.mjs";
import { d1Driver, deploymentEvidence } from "./migrations.mjs";

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

test("HTTP context comes from the current response and clears for independent work", async () => {
  const { diagnostics, output } = capture("ci");
  await observeFetch(diagnostics, "ci-workflow-read", async () =>
    healthResponse({ status: 503 }),
  )();
  diagnostics.report({ status: 401, statusCode: 403, message: secret });
  assert.equal(output.at(-1).http_status, 503);
  assert.equal(output.at(-1).category, "http");
  const error = { cause: { code: "ENOTFOUND" }, status: 502 };
  await assert.rejects(
    observeFetch(diagnostics, "ci-runs-read", async () => {
      throw error;
    })(),
    (actual) => actual === error,
  );
  diagnostics.report(error);
  assert.equal(output.at(-1).http_status, null);
  assert.equal(output.at(-1).category, "network");
  diagnostics.start("output-write", "local-operation");
  diagnostics.report({ code: "ENOSPC", message: secret });
  assert.equal(output.at(-1).http_status, null);
  assert.equal(output.at(-1).reason, "ENOSPC");
  diagnostics.start(secret, secret);
  diagnostics.received(secret);
  diagnostics.report(Error(secret));
  assert.equal(output.at(-1).check, "configuration");
  assert.equal(output.at(-1).category, "configuration");
  assert.equal(output.at(-1).http_status, null);
});

for (const [name, request, check, category, status] of [
  [
    "http",
    async () => healthResponse({ status: 503 }),
    "health-read",
    "http",
    503,
  ],
  [
    "network",
    async () => {
      throw Object.assign(Error(secret), { code: "ECONNRESET" });
    },
    "health-read",
    "network",
    null,
  ],
  [
    "json",
    async () => healthResponse({ body: secret }),
    "health-json",
    "unexpected-response",
    200,
  ],
  [
    "sha",
    async () => healthResponse({ header: "b".repeat(40) }),
    "health-sha",
    "configuration",
    200,
  ],
  [
    "database",
    async () => healthResponse({ body: '{"checks":{"database":"failed"}}' }),
    "health-database",
    "unexpected-response",
    200,
  ],
])
  test(`smoke ${name} retains six attempts, waits, failure and sanitized context`, async () => {
    const { diagnostics, output } = capture("health");
    let calls = 0;
    const waits = [];
    await assert.rejects(
      migrationHealth({
        env: { HEALTH_URL: "https://foundation.t00ls.dev", EXPECTED_SHA: sha },
        diagnostics,
        request: async (url, options) => {
          assert.equal(url, "https://foundation.t00ls.dev/health");
          assert.equal(options.cache, "no-store");
          assert.equal(options.redirect, "error");
          calls++;
          return request();
        },
        wait: async (ms) => {
          waits.push(ms);
        },
      }),
      /Expected DEV application SHA\/database health not proven/,
    );
    assert.equal(calls, 6);
    assert.deepEqual(waits, Array(6).fill(5000));
    assert.equal(output.length, 1);
    assert.deepEqual(
      {
        check: output[0].check,
        category: output[0].category,
        status: output[0].http_status,
      },
      { check, category, status },
    );
  });

test("smoke recovery preserves success, short circuit and no diagnostic failure", async () => {
  const { diagnostics, output } = capture("health");
  let calls = 0;
  let jsonCalls = 0;
  const waits = [];
  await migrationHealth({
    env: { HEALTH_URL: "https://foundation.t00ls.dev", EXPECTED_SHA: sha },
    diagnostics,
    request: async () => {
      calls++;
      if (calls === 1)
        return {
          ok: false,
          status: 503,
          json() {
            jsonCalls++;
          },
        };
      return healthResponse();
    },
    wait: async (ms) => {
      waits.push(ms);
    },
  });
  assert.equal(calls, 2);
  assert.equal(jsonCalls, 0);
  assert.deepEqual(waits, [5000]);
  assert.deepEqual(output, []);
  await assert.rejects(
    migrationHealth({
      env: { HEALTH_URL: secret },
      diagnostics,
      request: () => assert.fail("No network"),
    }),
  );
  assert.equal(output.at(-1).check, "configuration");
  assert.equal(output.at(-1).http_status, null);
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

test("administrative queries preserve results, errors and scoped HTTP evidence", async (t) => {
  t.mock.property(process, "env", {
    ...process.env,
    CLOUDFLARE_ACCOUNT_ID: "synthetic",
  });
  const plan = { target: { database: { database_id: "synthetic" } } };
  for (const [fetcher, category, check, status] of [
    [
      async () => new Response(secret, { status: 502 }),
      "http",
      "d1-query",
      502,
    ],
    [async () => new Response(secret), "unexpected-response", "d1-query", 200],
    [
      async () => Response.json({ success: true, result: [] }),
      "unexpected-response",
      "d1-result",
      200,
    ],
    [
      async () => {
        throw { code: "ENOTFOUND", message: secret };
      },
      "network",
      "d1-query",
      null,
    ],
  ]) {
    t.mock.method(globalThis, "fetch", fetcher);
    const { diagnostics, output } = capture("migrations");
    const driver = d1Driver(plan, "synthetic-token", diagnostics);
    await assert.rejects(driver.query("SELECT 1"));
    assert.equal(output[0].category, category);
    assert.equal(output[0].check, check);
    assert.equal(output[0].http_status, status);
    assert.equal(diagnostics.failure().http_status, null);
  }
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      success: true,
      result: [{ success: true, results: [{ n: 1 }] }],
    }),
  );
  assert.deepEqual(await d1Driver(plan, "synthetic-token").query("SELECT 1"), [
    { n: 1 },
  ]);
});

test("deployment evidence keeps failed HTTP associated with the deployment query", async (t) => {
  t.mock.property(process, "env", {
    ...process.env,
    GITHUB_TOKEN: "fixture-only",
  });
  process.env.GITHUB_RUN_ATTEMPT = "2";
  process.env.CLOUDFLARE_ACCOUNT_ID = "synthetic";
  process.env.CLOUDFLARE_WORKER_READ_TOKEN = "fixture-only";
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    if (calls === 1)
      return Response.json({
        run_attempt: 2,
        path: ".github/workflows/deploy-dev.yml",
      });
    if (calls === 2) return Response.json({ jobs: [{ name: "deploy" }] });
    return new Response(secret, { status: 403 });
  });
  const { diagnostics, output } = capture("migrations");
  await assert.rejects(
    deploymentEvidence(
      { target: { worker: "synthetic" } },
      undefined,
      diagnostics,
    ),
  );
  assert.equal(calls, 3);
  assert.equal(output[0].check, "deployments-read");
  assert.equal(output[0].http_status, 403);
  assert.equal(diagnostics.failure().http_status, null);
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

test("deployment evidence retains SHA, version, traffic, job and health gates", async (t) => {
  t.mock.property(process, "env", {
    ...process.env,
    GITHUB_TOKEN: "synthetic",
    GITHUB_RUN_ID: "100",
    GITHUB_RUN_ATTEMPT: "2",
    EXPECTED_SHA: sha,
    CLOUDFLARE_ACCOUNT_ID: "synthetic",
    CLOUDFLARE_WORKER_READ_TOKEN: "synthetic",
    DEV_HEALTH_URL: "https://foundation.t00ls.dev",
  });
  const deployment = {
    id: "synthetic-deployment",
    created_on: "2026-10-22T10:01:00Z",
    versions: [{ version_id: "synthetic-version", percentage: 100 }],
  };
  const version = {
    id: "synthetic-version",
    annotations: { "workers/tag": sha },
  };
  const deployJob = {
    ...job,
    name: "deploy",
    started_at: "2026-10-22T10:00:00Z",
    completed_at: "2026-10-22T10:02:00Z",
  };
  for (const variation of [
    "success",
    "sha",
    "version",
    "traffic",
    "job",
    "database",
    "json",
    "changed-deployment",
  ]) {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => {
      calls++;
      if (calls === 1)
        return Response.json({
          run_attempt: 2,
          path: ".github/workflows/deploy-dev.yml",
        });
      if (calls === 2)
        return Response.json({
          jobs: [
            {
              ...deployJob,
              ...(variation === "job" ? { conclusion: "failure" } : {}),
            },
          ],
        });
      if (calls === 3)
        return Response.json({
          success: true,
          result: {
            deployments: [
              {
                ...deployment,
                ...(variation === "traffic"
                  ? { versions: [{ version_id: version.id, percentage: 50 }] }
                  : {}),
              },
            ],
          },
        });
      if (calls === 4)
        return Response.json({
          success: true,
          result: {
            ...version,
            ...(variation === "version" ? { id: "other-version" } : {}),
          },
        });
      return healthResponse({
        header: variation === "sha" ? "b".repeat(40) : sha,
        body:
          variation === "json"
            ? secret
            : JSON.stringify({
                checks: {
                  database: variation === "database" ? "failed" : "ok",
                },
              }),
      });
    });
    const { diagnostics, output } = capture("migrations");
    const operation = deploymentEvidence(
      { target: { worker: "synthetic" } },
      variation === "changed-deployment" ? "other" : deployment.id,
      diagnostics,
    );
    if (variation === "success") {
      assert.deepEqual(await operation, {
        deploymentId: deployment.id,
        versionId: version.id,
        sha,
        runId: 100,
        attempt: 2,
        completedAt: deployJob.completed_at,
      });
      assert.deepEqual(output, []);
    } else {
      await assert.rejects(operation);
      const check =
        variation === "database"
          ? "health-database"
          : variation === "json"
            ? "health-json"
            : "deployment-validation";
      assert.equal(output[0].check, check);
      assert.equal(
        output[0].http_status,
        check.startsWith("health-") ? 200 : null,
      );
    }
    assert.equal(calls, 5);
  }
});
