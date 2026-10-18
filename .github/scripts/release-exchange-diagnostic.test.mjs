import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { releaseOwner, repository } from "./release-core.mjs";
import {
  diagnoseExchange,
  classifyExpiration,
  diagnosticConfirmation,
  diagnosticPackage,
} from "./release-exchange-diagnostic.mjs";

const sha = "a".repeat(40);
const sentinel = "JWT.sentinel npm_sentinel https://user:pass@secret/";
const env = () => ({
  RELEASE_MODE: "diagnose-exchange",
  DISTRIBUTION_MODE: "release",
  RELEASE_CONFIRMATION: diagnosticConfirmation,
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REF: "refs/heads/master",
  GITHUB_REPOSITORY: repository,
  GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/release.yml@refs/heads/master`,
  GITHUB_SHA: sha,
  EXECUTION_SHA: sha,
  GITHUB_RUN_ID: "10",
  GITHUB_RUN_ATTEMPT: "1",
  ACTIONS_ID_TOKEN_REQUEST_URL:
    "https://pipelines.actions.githubusercontent.com/synthetic/oidc",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: sentinel,
});

function githubRequest(url) {
  const actor = { ...releaseOwner, type: "User" };
  const run = {
    id: 10,
    workflow_id: 20,
    path: ".github/workflows/release.yml",
    actor,
    triggering_actor: actor,
    run_attempt: 1,
    repository: { full_name: repository },
    head_repository: { full_name: repository },
    event: "workflow_dispatch",
    head_branch: "master",
    head_sha: sha,
    status: "in_progress",
  };
  if (url.endsWith("/heads/master")) return { object: { sha } };
  if (url.endsWith("/workflows/release.yml")) return { id: 20, path: run.path };
  if (url.endsWith("/permission")) return { permission: "admin", user: actor };
  if (url.endsWith("/runs/10")) return run;
  if (url.endsWith("/workflows/ci.yml"))
    return { id: 21, path: ".github/workflows/ci.yml" };
  if (url.includes("/workflows/21/runs?"))
    return { workflow_runs: [{ id: 11 }] };
  if (url.endsWith("/runs/11"))
    return {
      ...run,
      id: 11,
      workflow_id: 21,
      path: ".github/workflows/ci.yml",
      event: "push",
      status: "completed",
      conclusion: "success",
    };
  if (url.includes("/runs/11/attempts/1/jobs?"))
    return {
      jobs: [
        {
          name: "checks",
          run_id: 11,
          run_attempt: 1,
          head_sha: sha,
          status: "completed",
          conclusion: "success",
        },
      ],
    };
  throw new Error(sentinel);
}

test("isolated exchange emits only permitted fields and never continues to transport", async (t) => {
  const now = Date.parse("2026-10-18T15:00:00Z");
  t.mock.method(Date, "now", () => now);
  for (const scenario of [
    { expires: null, reason: "EXPIRATION_INVALID", check: "TYPE" },
    { expires: true, reason: "EXPIRATION_INVALID", check: "TYPE" },
    { expires: [sentinel], reason: "EXPIRATION_INVALID", check: "TYPE" },
    {
      expires: { hidden: sentinel },
      reason: "EXPIRATION_INVALID",
      check: "TYPE",
    },
    { expires: 1700000000, reason: "VALID" },
    { expires: 1700000000000, reason: "VALID" },
    { expires: 3600, reason: "VALID" },
    { expires: "", reason: "EXPIRATION_INVALID", check: "EMPTY" },
    { expires: sentinel, reason: "EXPIRATION_INVALID", check: "SYNTAX" },
    {
      expires: "2026-11-31T16:00:00Z",
      reason: "EXPIRATION_INVALID",
      check: "CALENDAR",
    },
    {
      expires: "2026-10-18T16:00:00Z",
      invalidParser: true,
      reason: "EXPIRATION_INVALID",
      check: "PARSE",
    },
    { missing: true, reason: "EXPIRATION_MISSING" },
    { expires: "2026-10-18T15:00:00Z", reason: "TOKEN_EXPIRED" },
    { expires: "2026-10-18T16:00:00Z", reason: "VALID" },
    { http: 401, reason: "HTTP_REJECTED" },
    { brokenJson: true, reason: "INVALID_RESPONSE" },
    { network: true, reason: "NETWORK_ERROR" },
    { timeout: true, reason: "TIMEOUT" },
  ]) {
    let calls = 0;
    const parser = scenario.invalidParser
      ? t.mock.method(Date, "parse", () => NaN)
      : null;
    let result;
    try {
      result = await diagnoseExchange({
        env: env(),
        checkoutSha: sha,
        githubRequest,
        request: async (url, options) => {
          calls++;
          assert(calls <= 2);
          assert.equal(options.body, undefined);
          if (calls === 1) {
            assert.equal(
              new URL(url).searchParams.get("audience"),
              "npm:registry.npmjs.org",
            );
            return {
              status: 200,
              json: async () => ({
                value: `synthetic.${Buffer.from(JSON.stringify({ repository, ref: "refs/heads/master", sha })).toString("base64url")}.synthetic`,
              }),
            };
          }
          assert.equal(
            url,
            `https://registry.npmjs.org/-/npm/v1/oidc/token/exchange/package/${encodeURIComponent(diagnosticPackage)}`,
          );
          assert.equal(options.method, "POST");
          if (scenario.network) throw new TypeError(sentinel);
          if (scenario.timeout) {
            const error = new Error(sentinel);
            error.name = "TimeoutError";
            throw error;
          }
          return {
            status: scenario.http ?? 201,
            json: async () => {
              if (scenario.brokenJson) throw new SyntaxError(sentinel);
              return {
                token_type: "oidc",
                token: sentinel,
                ...(scenario.missing ? {} : { expires: scenario.expires }),
              };
            },
          };
        },
      });
    } finally {
      parser?.mock.restore();
    }
    assert.equal(calls, 2);
    assert.deepEqual(Object.keys(result).sort(), [
      "category",
      "expiration_check",
      ...(Object.hasOwn(result, "expiration_number_kind")
        ? ["expiration_number_kind"]
        : []),
      "expiration_type",
      "http_status",
      "reason",
      "stage",
    ]);
    assert.equal(result.stage, "npm-exchange");
    assert.equal(result.category, "authentication");
    assert.equal(result.reason, scenario.reason);
    assert.equal(result.expiration_check, scenario.check ?? null);
    assert.deepEqual(
      {
        expiration_type: result.expiration_type,
        ...(result.expiration_number_kind
          ? { expiration_number_kind: result.expiration_number_kind }
          : {}),
      },
      scenario.http ||
        scenario.brokenJson ||
        scenario.network ||
        scenario.timeout
        ? { expiration_type: "UNOBSERVED" }
        : classifyExpiration(
            scenario.missing ? {} : { expires: scenario.expires },
          ),
    );
    const serialized = JSON.stringify(result);
    for (const forbidden of [sentinel, "2026-", "synthetic", "secret"])
      assert(!serialized.includes(forbidden));
  }
});

test("expiration type classifications reveal no numeric value, unit or nested content", () => {
  const nested = Object.defineProperty({}, "sensitive", {
    get() {
      throw new Error(sentinel);
    },
  });
  for (const [value, type, kind] of [
    [null, "NULL"],
    [false, "BOOLEAN"],
    [true, "BOOLEAN"],
    [sentinel, "STRING"],
    [[], "ARRAY"],
    [[nested], "ARRAY"],
    [nested, "OBJECT"],
    [1, "NUMBER", "POSITIVE_SAFE_INTEGER"],
    [3600, "NUMBER", "POSITIVE_SAFE_INTEGER"],
    [1700000000, "NUMBER", "POSITIVE_SAFE_INTEGER"],
    [1700000000000, "NUMBER", "POSITIVE_SAFE_INTEGER"],
    [Number.MAX_SAFE_INTEGER, "NUMBER", "POSITIVE_SAFE_INTEGER"],
    [0, "NUMBER", "NON_POSITIVE_SAFE_INTEGER"],
    [-42, "NUMBER", "NON_POSITIVE_SAFE_INTEGER"],
    [Number.MAX_SAFE_INTEGER + 1, "NUMBER", "UNSAFE_INTEGER"],
    [0.25, "NUMBER", "FRACTIONAL"],
    [Number.MIN_VALUE, "NUMBER", "FRACTIONAL"],
    [NaN, "NUMBER", "NON_FINITE"],
    [Infinity, "NUMBER", "NON_FINITE"],
    [-Infinity, "NUMBER", "NON_FINITE"],
    [undefined, "OTHER"],
  ]) {
    const result = classifyExpiration({ expires: value, created: sentinel });
    assert.deepEqual(result, {
      expiration_type: type,
      ...(kind ? { expiration_number_kind: kind } : {}),
    });
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      sentinel,
      "sensitive",
      "created",
      "170000",
      "3600",
    ])
      assert(!serialized.includes(forbidden));
  }
  assert.deepEqual(classifyExpiration({}), { expiration_type: "MISSING" });
  for (const body of [null, [], "malformed", 1])
    assert.deepEqual(classifyExpiration(body), {
      expiration_type: "UNOBSERVED",
    });
});

test("JSON serializes Date as string and preserves other types without a temporal interpretation", () => {
  for (const [value, expected] of [
    [new Date("2030-01-01T00:00:00Z"), "STRING"],
    [null, "NULL"],
    [1234567890, "NUMBER"],
    [1234567890000, "NUMBER"],
    [3600, "NUMBER"],
    [true, "BOOLEAN"],
    [[sentinel], "ARRAY"],
    [{ hidden: sentinel }, "OBJECT"],
  ]) {
    const decoded = JSON.parse(JSON.stringify({ expires: value }));
    assert.equal(classifyExpiration(decoded).expiration_type, expected);
  }
  assert.equal(
    classifyExpiration(JSON.parse('{"expires":1e400}')).expiration_number_kind,
    "NON_FINITE",
  );
});

test("diagnostic rejects stale snapshots, retries and unauthorized contexts before OIDC", async () => {
  for (const overrides of [
    { RELEASE_MODE: "publish" },
    { DISTRIBUTION_MODE: "bootstrap" },
    { RELEASE_CONFIRMATION: "PUBLISH_PUBLIC_FOUNDATION_PACKAGES" },
    { GITHUB_REF: "refs/heads/other" },
    {
      GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/other.yml@refs/heads/master`,
    },
    { GITHUB_RUN_ATTEMPT: "2" },
    { EXECUTION_SHA: "b".repeat(40) },
  ]) {
    let calls = 0;
    const result = await diagnoseExchange({
      env: { ...env(), ...overrides },
      checkoutSha: sha,
      githubRequest,
      request: async () => {
        calls++;
        throw new Error(sentinel);
      },
    });
    assert.equal(result.stage, "authority");
    assert.equal(calls, 0);
  }
  for (const mutation of [
    (url, result) =>
      url.endsWith("/heads/master")
        ? { object: { sha: "b".repeat(40) } }
        : result,
    (url, result) =>
      url.endsWith("/permission") ? { ...result, permission: "write" } : result,
    (url, result) =>
      url.endsWith("/runs/10")
        ? { ...result, actor: { login: "other" } }
        : result,
    (url, result) =>
      url.endsWith("/runs/11") ? { ...result, conclusion: "failure" } : result,
  ]) {
    let calls = 0;
    const result = await diagnoseExchange({
      env: env(),
      checkoutSha: sha,
      githubRequest: async (url) => mutation(url, githubRequest(url)),
      request: async () => {
        calls++;
        throw new Error(sentinel);
      },
    });
    assert.equal(result.stage, "authority");
    assert.equal(calls, 0);
  }
});

test("diagnostic module graph contains no publishing library or transport path", () => {
  const seen = new Set();
  function visit(url) {
    if (seen.has(url.href)) return;
    seen.add(url.href);
    const source = readFileSync(url, "utf8");
    assert(
      !/libnpmpublish|consumeApprovedArtifact|publishBuffer|createRequire|import\s*\(/.test(
        source,
      ),
    );
    for (const match of source.matchAll(/from\s+"([^"]+)"/g)) {
      if (match[1].startsWith(".")) visit(new URL(match[1], url));
      else assert(match[1].startsWith("node:"));
    }
  }
  visit(new URL("./release-exchange-diagnostic.mjs", import.meta.url));
  assert.equal(seen.size, 4);
  const entry = readFileSync(
    new URL("./release-exchange-diagnostic.mjs", import.meta.url),
    "utf8",
  );
  assert.equal((entry.match(/execFileSync\(/g) ?? []).length, 1);
  assert(entry.includes('execFileSync("git", ["rev-parse", "HEAD"]'));
  const workflow = parse(
    readFileSync(new URL("../workflows/release.yml", import.meta.url), "utf8"),
  );
  const job = workflow.jobs["diagnose-exchange"];
  assert(job.if.includes("inputs.mode == 'diagnose-exchange'"));
  assert(job.if.includes("inputs.execution_sha == github.sha"));
  assert(job.if.includes("github.run_attempt == 1"));
  assert(job.if.includes(diagnosticConfirmation));
  assert.equal(job.permissions["id-token"], "write");
  assert.equal(job.environment, undefined);
  assert.deepEqual(
    job.steps.filter((step) => step.run).map((step) => step.run),
    ["node .github/scripts/release-exchange-diagnostic.mjs"],
  );
  assert(!JSON.stringify(job).includes("download-artifact"));
  assert(!JSON.stringify(job).includes("NPM_BOOTSTRAP_TOKEN"));
  for (const mode of ["audit", "approve", "preflight", "publish"])
    assert(!workflow.jobs[mode].if.includes("diagnose-exchange"));
});
