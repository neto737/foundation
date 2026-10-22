import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import {
  authenticationMethod,
  bootstrapSha,
  envelopeDigest,
  hash,
  npmVersion,
  validateRecord,
  validateDistribution,
  registry,
} from "./release-core.mjs";
import {
  consumeApprovedArtifact,
  createConsumerDiagnostics,
  loadNpmConfiguration,
  manifestFromBuffer,
  publicationCredential,
  validateArtifactBuffer,
  validateNpmConfiguration,
  validateConsumerAuthority,
} from "./release-consumer.mjs";
import { validatePublisherEnvironment } from "./release-core.mjs";
import { classifyPublicationFailure } from "./release-credential.mjs";
import {
  approvalCertificate,
  confirmation,
  releaseOwner,
} from "./release-core.mjs";

const sha = "a".repeat(40);
const oidcEnv = () => ({
  EXECUTION_SHA: sha,
  ACTIONS_ID_TOKEN_REQUEST_URL:
    "https://pipelines.actions.githubusercontent.com/synthetic/oidc",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "synthetic",
});
const emptyConfig = () => ({
  data: new Map([
    ["default", { raw: { _auth: null } }],
    ["user", { raw: {}, data: {} }],
  ]),
});
const bootstrapEnv = () => ({ NPM_BOOTSTRAP_TOKEN: "synthetic" });

test("consumer CLI reports only fixed diagnostics and exits blocked at each outer gate", async () => {
  const source = readFileSync(
    new URL("./release-consumer.mjs", import.meta.url),
    "utf8",
  );
  // Exercise the actual entry point without GitHub, configuration or publish IO.
  const entry = source
    .slice(source.indexOf("async function main("))
    .replace("import.meta.url", '"file:///consumer.mjs"')
    .replace(
      "main(diagnostics).catch",
      "globalThis.completion = main(diagnostics).catch",
    );
  for (const [gate, category] of [
    ["arguments", "input"],
    ["files", "file-access"],
    ["authority", "authorization"],
    ["checkout", "snapshot"],
    ["npm-config", "configuration"],
    ["npm-exchange", "authentication"],
    ["provenance-transport", "publication"],
  ]) {
    const secret =
      "JWT.secret Authorization:Bearer secret https://secret/?token=secret";
    const fail = () => {
      throw new Error(secret, { cause: { token: secret } });
    };
    let uploads = 0;
    const output = [];
    const sandbox = {
      assert,
      JSON,
      createConsumerDiagnostics,
      process: { argv: ["node", "/consumer.mjs"], env: {} },
      pathToFileURL: () => ({ href: "file:///consumer.mjs" }),
      parseConsumerArguments: () =>
        gate === "arguments" ? fail() : "/package.tgz",
      readFile: async () => (gate === "files" ? fail() : "{}"),
      validateConsumerAuthority: async () =>
        gate === "authority" ? fail() : { executionSha: sha },
      spawnSync: () => (gate === "checkout" ? fail() : { stdout: sha }),
      loadNpmConfiguration: async () =>
        gate === "npm-config" ? fail() : emptyConfig(),
      consumeApprovedArtifact: async ({ diagnostics }) => {
        if (gate === "npm-exchange") {
          diagnostics.enter("npm-exchange");
          diagnostics.exchange(201, "EXPIRATION_INVALID", "TYPE");
          fail();
        }
        if (gate === "provenance-transport") {
          diagnostics.enter("provenance-transport");
          diagnostics.publication("SIGSTORE_LOG");
          fail();
        }
        uploads++;
      },
      console: {
        error: (value) => output.push(value),
        log: (value) => output.push(value),
      },
    };
    runInNewContext(entry, sandbox);
    await sandbox.completion;
    assert.equal(uploads, 0);
    assert.equal(sandbox.process.exitCode, 1);
    assert.equal(output.length, 1);
    const { error } = JSON.parse(output[0]);
    assert.equal(error.code, "FOUNDATION_PUBLISH_BLOCKED");
    assert.equal(error.stage, gate);
    assert.equal(error.category, category);
    assert.equal(
      error.message,
      "Foundation consumer blocked publication; verify approved metadata, authentication and bytes",
    );
    assert.deepEqual(Object.keys(error).sort(), [
      "category",
      "code",
      ...(gate === "npm-exchange" ? ["expiration_check", "http_status"] : []),
      "message",
      ...(["npm-exchange", "provenance-transport"].includes(gate)
        ? ["reason"]
        : []),
      "stage",
    ]);
    if (gate === "npm-exchange") {
      assert.equal(error.expiration_check, "TYPE");
      assert.equal(error.http_status, 201);
      assert.equal(error.reason, "EXPIRATION_INVALID");
    }
    if (gate === "provenance-transport")
      assert.equal(error.reason, "SIGSTORE_LOG");
    assert(!output[0].includes("secret"));
  }
});

test("consumer diagnostics isolate invocations and reject unlisted stage values", () => {
  const first = createConsumerDiagnostics();
  const second = createConsumerDiagnostics();
  first.enter("npm-exchange");
  assert.throws(() => first.enter("token=secret"));
  assert.equal(first.failure().error.stage, "npm-exchange");
  assert.equal(second.failure().error.stage, "arguments");
});

const diagnosticSecret =
  "JWT.sentinel Authorization:Bearer sentinel https://user:pass@secret/?token=sentinel";
const diagnosticNpmRequire = createRequire(
  createRequire(import.meta.url).resolve("npm/package.json"),
);
const diagnosticHttpErrors = diagnosticNpmRequire(
  "npm-registry-fetch/lib/errors.js",
);
const diagnosticName = "@t00ls-dev/config";
const diagnosticOptions = {
  name: diagnosticName,
  npmHttpErrorClass: diagnosticHttpErrors.HttpErrorBase,
};
function diagnosticHttpError(status = 403) {
  return new diagnosticHttpErrors.HttpErrorGeneral(
    "PUT",
    {
      status,
      statusText: diagnosticSecret,
      url: `${registry}/@t00ls-dev%2fconfig`,
      headers: { secret: diagnosticSecret },
    },
    { error: diagnosticSecret },
  );
}

test("publication classification maps only recognized structured codes", () => {
  const cases = [
    ...["EPRIVATE", "EBADSEMVER", "EUNSCOPED", "EUSAGE"].map((code) => [
      code,
      "LOCAL_VALIDATION",
    ]),
    ["IDENTITY_TOKEN_READ_ERROR", "SIGSTORE_IDENTITY"],
    ["IDENTITY_TOKEN_PARSE_ERROR", "SIGSTORE_IDENTITY_FORMAT"],
    ["CA_CREATE_SIGNING_CERTIFICATE_ERROR", "SIGSTORE_CERTIFICATE"],
    ["TLOG_CREATE_ENTRY_ERROR", "SIGSTORE_LOG"],
    ...[
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "ENOTFOUND",
      "EAI_AGAIN",
      "CERT_HAS_EXPIRED",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "ERR_TLS_CERT_ALTNAME_INVALID",
    ].map((code) => [code, "TRANSPORT_UNATTRIBUTED"]),
    [diagnosticSecret, "UNKNOWN"],
  ];
  for (const [code, reason] of cases) {
    const error = Object.assign(new Error(diagnosticSecret), { code });
    error.cause = error;
    const result = classifyPublicationFailure(error, diagnosticOptions);
    assert.deepEqual(result, { reason });
    assert(!JSON.stringify(result).includes("sentinel"));
  }
  for (const code of [
    "MODULE_NOT_FOUND",
    "ERR_MODULE_NOT_FOUND",
    "ERR_REQUIRE_ESM",
    "ERR_DLOPEN_FAILED",
  ]) {
    assert.deepEqual(classifyPublicationFailure({ code }, { loading: true }), {
      reason: "LOCAL_LOAD",
    });
    assert.deepEqual(classifyPublicationFailure({ code }), {
      reason: "UNKNOWN",
    });
  }
  assert.deepEqual(
    classifyPublicationFailure(
      { code: "EUSAGE" },
      {
        loading: true,
      },
    ),
    { reason: "UNKNOWN" },
  );
});

test("npm HTTP classification requires the trusted error type, PUT and exact destination", () => {
  for (const status of [400, 401, 403, 404, 409, 422, 429, 500, 503, 599]) {
    const result = classifyPublicationFailure(
      diagnosticHttpError(status),
      diagnosticOptions,
    );
    assert.deepEqual(result, {
      reason: "NPM_HTTP_REJECTED",
      http_status: status,
    });
    assert(!JSON.stringify(result).includes("sentinel"));
  }
  for (const Class of [
    diagnosticHttpErrors.HttpErrorAuthOTP,
    diagnosticHttpErrors.HttpErrorAuthIPAddress,
  ]) {
    const error = new Class(
      "PUT",
      {
        status: 401,
        url: `${registry}/@t00ls-dev%2fconfig`,
        headers: {},
      },
      {},
    );
    assert.deepEqual(classifyPublicationFailure(error, diagnosticOptions), {
      reason: "NPM_HTTP_REJECTED",
      http_status: 401,
    });
  }
  for (const patch of [
    { statusCode: 200 },
    { statusCode: 600 },
    { statusCode: "403" },
    { statusCode: NaN },
    { code: "E404" },
    { code: diagnosticSecret },
    { method: "GET" },
    { uri: "not a URL" },
    { uri: "https://example.com/@t00ls-dev%2fconfig" },
    { uri: `${registry}/@t00ls-dev%2faudit` },
    { uri: `${registry}/@t00ls-dev%2fconfig?secret=sentinel` },
    { uri: `${registry}/@t00ls-dev%2fconfig#sentinel` },
    { uri: "https://user:pass@registry.npmjs.org/@t00ls-dev%2fconfig" },
  ]) {
    assert.deepEqual(
      classifyPublicationFailure(
        Object.assign(diagnosticHttpError(), patch),
        diagnosticOptions,
      ),
      { reason: "UNKNOWN" },
    );
  }
  assert.deepEqual(
    classifyPublicationFailure(
      {
        code: "E403",
        method: "PUT",
        statusCode: 403,
        uri: `${registry}/@t00ls-dev%2fconfig`,
      },
      diagnosticOptions,
    ),
    { reason: "UNKNOWN" },
  );
  assert.deepEqual(classifyPublicationFailure(diagnosticHttpError()), {
    reason: "UNKNOWN",
  });
});

test("publication classification never invokes getters, proxies, coercion or cyclic causes", () => {
  let inspected = 0;
  const dangerous = () => {
    inspected++;
    throw new Error(diagnosticSecret);
  };
  const malformed = [
    null,
    undefined,
    true,
    403,
    diagnosticSecret,
    Symbol("sentinel"),
    [],
    { code: { toString: dangerous } },
    Object.create({ code: "EUSAGE" }),
    Object.defineProperty({}, "code", { get: dangerous }),
  ];
  for (const key of ["statusCode", "method", "uri"]) {
    malformed.push(
      Object.defineProperty(diagnosticHttpError(), key, {
        get: dangerous,
      }),
    );
  }
  malformed.push(
    new Proxy(
      {},
      {
        get: dangerous,
        getOwnPropertyDescriptor: dangerous,
        getPrototypeOf: dangerous,
      },
    ),
  );
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  malformed.push(revoked.proxy);
  const proxyPrototype = diagnosticHttpError();
  Object.setPrototypeOf(
    proxyPrototype,
    new Proxy({}, { getPrototypeOf: dangerous }),
  );
  malformed.push(proxyPrototype);
  for (const error of malformed) {
    assert.deepEqual(classifyPublicationFailure(error, diagnosticOptions), {
      reason: "UNKNOWN",
    });
  }
  for (const code of ["TLOG_CREATE_ENTRY_ERROR", "ECONNRESET"]) {
    const error = { code };
    for (const key of [
      "message",
      "stack",
      "headers",
      "body",
      "cause",
      "toJSON",
    ])
      Object.defineProperty(error, key, { get: dangerous });
    assert.equal(
      classifyPublicationFailure(error).reason,
      code === "ECONNRESET" ? "TRANSPORT_UNATTRIBUTED" : "SIGSTORE_LOG",
    );
  }
  const cyclic = { code: "TLOG_CREATE_ENTRY_ERROR" };
  cyclic.cause = { cause: cyclic, message: diagnosticSecret };
  assert.deepEqual(classifyPublicationFailure(cyclic), {
    reason: "SIGSTORE_LOG",
  });
  assert.equal(inspected, 0);
});

test("publication diagnostics reset and accept only closed reasons and safe HTTP status", () => {
  const trace = createConsumerDiagnostics();
  assert.throws(() => trace.publication("UNKNOWN"));
  trace.enter("provenance-transport");
  assert.equal(trace.failure().error.reason, "UNKNOWN");
  assert.throws(() => trace.publication(diagnosticSecret));
  trace.publication("NPM_HTTP_REJECTED", 403);
  assert.equal(trace.failure().error.http_status, 403);
  trace.publication("SIGSTORE_LOG", 403);
  assert(!Object.hasOwn(trace.failure().error, "http_status"));
  trace.publication("NPM_HTTP_REJECTED", "403");
  assert(!Object.hasOwn(trace.failure().error, "http_status"));
  trace.enter("artifacts");
  assert(!Object.hasOwn(trace.failure().error, "reason"));
  trace.enter("provenance-transport");
  assert.equal(trace.failure().error.reason, "UNKNOWN");
  assert(!Object.hasOwn(trace.failure().error, "http_status"));
  assert(!JSON.stringify(trace.failure()).includes("sentinel"));
});

test("consumer records publication failures and rethrows the identical error without retry", async () => {
  for (const [error, reason] of [
    [{ code: "EUSAGE" }, "LOCAL_VALIDATION"],
    [{ code: "IDENTITY_TOKEN_READ_ERROR" }, "SIGSTORE_IDENTITY"],
    [{ code: "IDENTITY_TOKEN_PARSE_ERROR" }, "SIGSTORE_IDENTITY_FORMAT"],
    [{ code: "CA_CREATE_SIGNING_CERTIFICATE_ERROR" }, "SIGSTORE_CERTIFICATE"],
    [{ code: "TLOG_CREATE_ENTRY_ERROR" }, "SIGSTORE_LOG"],
    [{ code: "ECONNRESET" }, "TRANSPORT_UNATTRIBUTED"],
    [
      Object.assign(diagnosticHttpError(), {
        uri: `${registry}/@t00ls-dev%2faccess`,
      }),
      "NPM_HTTP_REJECTED",
    ],
    [new Error(diagnosticSecret), "UNKNOWN"],
  ]) {
    const f = fixture();
    const trace = createConsumerDiagnostics();
    let calls = 0;
    await assert.rejects(
      consumeApprovedArtifact({
        ...f,
        diagnostics: trace,
        publishBuffer: async (_, bytes, options) => {
          calls++;
          assert.deepEqual(bytes, f.bytes);
          assert.equal(options.provenance, true);
          assert.deepEqual(options.forceAuth, { token: "synthetic" });
          throw error;
        },
      }),
      (caught) => caught === error,
    );
    assert.equal(calls, 1);
    assert.equal(trace.failure().error.reason, reason);
    assert.equal(trace.failure().error.stage, "provenance-transport");
    assert(!JSON.stringify(trace.failure()).includes("sentinel"));
  }
});

test("consumer classifies load failures and preserves the original failure if diagnosis fails", async () => {
  const library = diagnosticNpmRequire("libnpmpublish");
  const original = Object.getOwnPropertyDescriptor(library, "publish");
  const error = Object.assign(new Error(diagnosticSecret), {
    code: "MODULE_NOT_FOUND",
  });
  try {
    Object.defineProperty(library, "publish", {
      configurable: true,
      get() {
        throw error;
      },
    });
    const trace = createConsumerDiagnostics();
    await assert.rejects(
      consumeApprovedArtifact({ ...fixture(), diagnostics: trace }),
      (caught) => caught === error,
    );
    assert.equal(trace.failure().error.reason, "LOCAL_LOAD");
  } finally {
    Object.defineProperty(library, "publish", original);
  }
  const trace = createConsumerDiagnostics();
  trace.publication = () => {
    throw new Error(diagnosticSecret);
  };
  await assert.rejects(
    consumeApprovedArtifact({
      ...fixture(),
      diagnostics: trace,
      publishBuffer: async () => {
        throw error;
      },
    }),
    (caught) => caught === error,
  );
  assert.equal(trace.failure().error.reason, "UNKNOWN");
});

test("fresh numeric OIDC metadata is opaque and never converted to an expiration date", async (t) => {
  const fail = () =>
    assert.fail("Numeric metadata must not be interpreted as time");
  t.mock.method(Date, "now", fail);
  t.mock.method(Date, "parse", fail);
  const identity = `synthetic.${Buffer.from(JSON.stringify({ repository: "t00ls-dev/foundation", ref: "refs/heads/master", sha })).toString("base64url")}.synthetic`;
  for (const expires of [
    1,
    3600,
    1700000000,
    1700000000000,
    Number.MAX_SAFE_INTEGER,
  ]) {
    let requests = 0;
    const token = await publicationCredential(
      oidcEnv(),
      "release",
      "@t00ls-dev/audit",
      async () =>
        ++requests === 1
          ? { status: 200, json: async () => ({ value: identity }) }
          : {
              status: 201,
              json: async () => ({
                token_type: "oidc",
                token: "synthetic-temporary",
                expires,
              }),
            },
    );
    assert.equal(token, "synthetic-temporary");
    assert.equal(requests, 2);
  }
});

test("registry rejection of fresh OIDC credentials aborts once without fallback or credential reuse", async () => {
  const identity = `synthetic.${Buffer.from(JSON.stringify({ repository: "t00ls-dev/foundation", ref: "refs/heads/master", sha })).toString("base64url")}.synthetic`;
  const seen = [];
  for (const statusCode of [401, 403]) {
    const f = fixture("release");
    const trace = createConsumerDiagnostics();
    let requests = 0,
      transports = 0;
    const secret = `synthetic-token-${statusCode}`;
    await assert.rejects(
      consumeApprovedArtifact({
        ...f,
        diagnostics: trace,
        credential: (env, distribution, name, _request, diagnostics) =>
          publicationCredential(
            env,
            distribution,
            name,
            async () =>
              ++requests === 1
                ? { status: 200, json: async () => ({ value: identity }) }
                : {
                    status: 201,
                    json: async () => ({
                      token_type: "oidc",
                      token: secret,
                      expires: 3600,
                    }),
                  },
            diagnostics,
          ),
        publishBuffer: async (metadata, bytes, options) => {
          transports++;
          assert.deepEqual(bytes, f.bytes);
          assert.notEqual(bytes, f.bytes);
          assert.equal(metadata.name, f.packet.artifacts[0].name);
          assert.deepEqual(options.forceAuth, { token: secret });
          assert.equal(options.registry, registry);
          assert.equal(options.access, "public");
          assert.equal(options.defaultTag, "latest");
          assert.equal(options.provenance, true);
          seen.push(options.forceAuth.token);
          throw Object.assign(new Error(secret), { statusCode });
        },
      }),
    );
    assert.equal(requests, 2);
    assert.equal(transports, 1);
    assert.equal(trace.failure().error.stage, "provenance-transport");
    assert.equal(trace.failure().error.code, "FOUNDATION_PUBLISH_BLOCKED");
    assert(!JSON.stringify(trace.failure()).includes(secret));
  }
  assert.equal(new Set(seen).size, 2);
});

test("exchange diagnostics validate metadata and reset between stages and invocations", () => {
  const trace = createConsumerDiagnostics();
  assert.throws(() => trace.exchange(401, "HTTP_REJECTED"));
  trace.enter("npm-exchange");
  assert.throws(() => trace.exchange(401, "secret-response"));
  for (const status of [undefined, null, "401", 0, 99, 600, 201.5, NaN, {}]) {
    trace.exchange(status, "INVALID_RESPONSE");
    assert.equal(trace.failure().error.http_status, null);
  }
  trace.exchange(401, "HTTP_REJECTED");
  assert.equal(trace.failure().error.http_status, 401);
  const other = createConsumerDiagnostics();
  other.enter("npm-exchange");
  assert.equal(other.failure().error.http_status, null);
  assert.equal(other.failure().error.reason, "UNCLASSIFIED");
  trace.enter("artifacts");
  assert(!Object.hasOwn(trace.failure().error, "http_status"));
  assert(!Object.hasOwn(trace.failure().error, "reason"));
  trace.enter("npm-exchange");
  assert.equal(trace.failure().error.http_status, null);
  assert.equal(trace.failure().error.reason, "UNCLASSIFIED");
});

test("exchange failures expose only safe reasons and status and never reach transport", async () => {
  const secret =
    "JWT.sentinel npm_sentinel Authorization:Bearer https://user:pass@secret/";
  const valid = {
    token_type: "oidc",
    token: secret,
    expires: new Date(Date.now() + 60000).toISOString(),
  };
  const identity = `synthetic.${Buffer.from(JSON.stringify({ repository: "t00ls-dev/foundation", ref: "refs/heads/master", sha })).toString("base64url")}.synthetic`;
  const cases = [
    ...[301, 400, 401, 403, 404, 429, 500, 503].map((status) => ({
      response: {
        status,
        json: () => assert.fail("Rejected bodies must not be read"),
      },
      status,
      reason: "HTTP_REJECTED",
    })),
    ...[undefined, null, {}, { status: "201" }, { status: 600 }].map(
      (response) => ({
        response,
        status: null,
        reason: "INVALID_RESPONSE",
      }),
    ),
    ...[null, [], secret, 42].map((body) => ({
      body,
      reason: "INVALID_RESPONSE",
    })),
    { response: { status: 201 }, reason: "INVALID_RESPONSE" },
    { bodyError: new SyntaxError(secret), reason: "INVALID_RESPONSE" },
    { bodyError: new DOMException(secret, "TimeoutError"), reason: "TIMEOUT" },
    { bodyError: new TypeError(secret), reason: "NETWORK_ERROR" },
    { body: { ...valid, token_type: secret }, reason: "TOKEN_TYPE_INVALID" },
    ...[undefined, null, "", 123].map((token) => ({
      body: { ...valid, token },
      reason: "TOKEN_MISSING",
    })),
    {
      body: { ...valid, expires: secret },
      reason: "EXPIRATION_INVALID",
      expirationCheck: "SYNTAX",
    },
    {
      body: { ...valid, expires: new Date(0).toISOString() },
      reason: "TOKEN_EXPIRED",
    },
    {
      requestError: new DOMException(secret, "TimeoutError"),
      status: null,
      reason: "TIMEOUT",
    },
    {
      requestError: new TypeError(secret, { cause: { token: secret } }),
      status: null,
      reason: "NETWORK_ERROR",
    },
    { requestError: new Error(secret), status: null, reason: "UNCLASSIFIED" },
  ];
  for (const scenario of cases) {
    const diagnostics = createConsumerDiagnostics();
    let calls = 0;
    let uploads = 0;
    const request = async () => {
      if (++calls === 1)
        return { status: 200, json: async () => ({ value: identity }) };
      if (scenario.requestError) throw scenario.requestError;
      if (Object.hasOwn(scenario, "response")) return scenario.response;
      return {
        status: 201,
        headers: { authorization: secret },
        json: async () => {
          if (scenario.bodyError) throw scenario.bodyError;
          return scenario.body;
        },
      };
    };
    await assert.rejects(
      consumeApprovedArtifact({
        ...fixture("release"),
        diagnostics,
        credential: (env, distribution, name, _request, trace) =>
          publicationCredential(env, distribution, name, request, trace),
        publishBuffer: async () => {
          uploads++;
        },
      }),
    );
    assert.equal(calls, 2);
    assert.equal(uploads, 0);
    const { error } = diagnostics.failure();
    assert.equal(error.code, "FOUNDATION_PUBLISH_BLOCKED");
    assert.equal(error.stage, "npm-exchange");
    assert.equal(error.category, "authentication");
    assert.equal(
      error.http_status,
      Object.hasOwn(scenario, "status") ? scenario.status : 201,
    );
    assert.equal(error.reason, scenario.reason);
    assert.equal(error.expiration_check, scenario.expirationCheck);
    assert.deepEqual(Object.keys(error).sort(), [
      "category",
      "code",
      ...(scenario.expirationCheck ? ["expiration_check"] : []),
      "http_status",
      "message",
      "reason",
      "stage",
    ]);
    assert(!JSON.stringify(error).includes(secret));
    assert(!JSON.stringify(error).includes("sentinel"));
  }
});

test("expiration diagnostics accept only fixed checks and clear them between gates", () => {
  const trace = createConsumerDiagnostics();
  trace.enter("npm-exchange");
  for (const check of ["TYPE", "EMPTY", "SYNTAX", "CALENDAR", "PARSE"]) {
    trace.exchange(201, "EXPIRATION_INVALID", check);
    assert.equal(trace.failure().error.expiration_check, check);
  }
  assert.throws(() => trace.exchange(201, "EXPIRATION_INVALID", "secret"));
  assert.throws(() => trace.exchange(401, "HTTP_REJECTED", "TYPE"));
  assert.throws(() => trace.exchange(201, "TOKEN_EXPIRED", "TYPE"));
  assert(!JSON.stringify(trace.failure()).includes("secret"));
  assert(
    !Object.hasOwn(
      createConsumerDiagnostics().failure().error,
      "expiration_check",
    ),
  );
  trace.exchange(201, "TOKEN_EXPIRED");
  assert(!Object.hasOwn(trace.failure().error, "expiration_check"));
  trace.exchange(201, "EXPIRATION_INVALID", "TYPE");
  trace.enter("provenance-transport");
  assert(!Object.hasOwn(trace.failure().error, "expiration_check"));
});

test("expiration checks distinguish rejection without exposing values or consulting the clock early", async (t) => {
  const now = Date.parse("2026-10-18T15:00:00Z");
  let clockReads = 0;
  t.mock.method(Date, "now", () => {
    clockReads++;
    return now;
  });
  const secret = "JWT.sentinel npm_sentinel https://user:pass@secret/";
  const identity = `synthetic.${Buffer.from(JSON.stringify({ repository: "t00ls-dev/foundation", ref: "refs/heads/master", sha })).toString("base64url")}.synthetic`;
  const cases = [
    ...[
      null,
      true,
      0,
      -1,
      1.5,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
      [secret],
      { secret },
    ].map((expires) => ({ expires, check: "TYPE" })),
    { expires: "", check: "EMPTY" },
    ...[
      secret,
      "2026-10-18T16:00:00",
      "2026-10-19",
      "2026-10-18 16:00:00Z",
      "2026-12-31T23:59:60Z",
      "+010000-01-01T00:00:00Z",
      "2026-10-18T16:00:00+24:00",
    ].map((expires) => ({ expires, check: "SYNTAX" })),
    ...["2026-11-31T16:00:00Z", "2100-02-29T16:00:00Z"].map((expires) => ({
      expires,
      check: "CALENDAR",
    })),
    { expires: "2026-10-18T16:00:00Z\n", check: "SYNTAX" },
    { expires: "2026-10-18T16:00:00Z", check: "PARSE", invalidParser: true },
  ];
  for (const scenario of cases) {
    const trace = createConsumerDiagnostics();
    clockReads = 0;
    let requests = 0;
    let uploads = 0;
    const parser = scenario.invalidParser
      ? t.mock.method(Date, "parse", () => NaN)
      : null;
    try {
      await assert.rejects(
        consumeApprovedArtifact({
          ...fixture("release"),
          diagnostics: trace,
          credential: (env, distribution, name, _request, diagnostics) =>
            publicationCredential(
              env,
              distribution,
              name,
              async () =>
                ++requests === 1
                  ? { status: 200, json: async () => ({ value: identity }) }
                  : {
                      status: 201,
                      json: async () => ({
                        token_type: "oidc",
                        token: secret,
                        expires: scenario.expires,
                      }),
                    },
              diagnostics,
            ),
          publishBuffer: async () => {
            uploads++;
          },
        }),
      );
    } finally {
      parser?.mock.restore();
    }
    assert.equal(requests, 2);
    assert.equal(uploads, 0);
    assert.equal(clockReads, 0);
    const result = trace.failure();
    assert.equal(result.error.code, "FOUNDATION_PUBLISH_BLOCKED");
    assert.equal(result.error.stage, "npm-exchange");
    assert.equal(result.error.category, "authentication");
    assert.equal(result.error.http_status, 201);
    assert.equal(result.error.reason, "EXPIRATION_INVALID");
    assert.equal(result.error.expiration_check, scenario.check);
    assert.deepEqual(Object.keys(result.error).sort(), [
      "category",
      "code",
      "expiration_check",
      "http_status",
      "message",
      "reason",
      "stage",
    ]);
    for (const value of [secret, identity, "sentinel", "2026-", "2100-"])
      assert(!JSON.stringify(result).includes(value));
  }
});

test("exchange accepts observed numeric metadata without units and strictly validates date-time metadata", async (t) => {
  const now = Date.parse("2026-10-18T15:00:00.000Z");
  t.mock.method(Date, "now", () => now);
  const secret = "JWT.sentinel npm_sentinel Authorization:Bearer secret";
  const identity = `synthetic.${Buffer.from(JSON.stringify({ repository: "t00ls-dev/foundation", ref: "refs/heads/master", sha })).toString("base64url")}.synthetic`;
  const cases = [
    ...[1, 3600, 1700000000, 1700000000000, Number.MAX_SAFE_INTEGER].map(
      (expires) => ({
        label: "opaque numeric metadata",
        expires,
        reason: null,
      }),
    ),
    ...[
      "2026-10-18T16:00:00.000Z",
      "2026-10-18T16:00:00Z",
      "2026-10-18T18:30:00+02:30",
      "2026-10-18T09:00:00-07:00",
      "2026-10-18t16:00:00z",
      "2026-10-18T16:00:00.123456Z",
      "2028-02-29T16:00:00Z",
    ].map((expires) => ({ label: expires, expires, reason: null })),
    ...[
      "2026-10-18T14:59:59.999Z",
      "2026-10-18T15:00:00.000Z",
      "2026-10-18T17:00:00+02:00",
    ].map((expires) => ({ label: expires, expires, reason: "TOKEN_EXPIRED" })),
    { label: "absent", reason: "EXPIRATION_MISSING" },
    ...[
      undefined,
      null,
      true,
      0,
      -1,
      0.5,
      Number.MAX_SAFE_INTEGER + 1,
      NaN,
      Infinity,
      ["2026-10-18T16:00:00Z"],
      { expires: "2026-10-18T16:00:00Z", secret },
      "",
      "3600",
      secret,
      "2026-10-18T16:00:00",
      "2026-10-19",
      "Sun, 18 Oct 2026 16:00:00 GMT",
      "2026-11-31T16:00:00Z",
      "2027-02-29T16:00:00Z",
      "2100-02-29T16:00:00Z",
      "2026-13-01T16:00:00Z",
      "2026-10-18T24:00:00Z",
      "2026-10-18T16:60:00Z",
      "2026-10-18T16:00:00+24:00",
      "2026-10-18T16:00:00+02:60",
      "2026-10-18T16:00:00Z\n",
    ].map((expires, index) => ({
      label: `invalid expiration ${index}`,
      expires,
      reason: "EXPIRATION_INVALID",
    })),
  ];
  for (const scenario of cases) {
    await t.test(scenario.label, async () => {
      const diagnostics = createConsumerDiagnostics();
      let requests = 0;
      let uploads = 0;
      const body = { token_type: "oidc", token: secret };
      if (Object.hasOwn(scenario, "expires")) body.expires = scenario.expires;
      const run = consumeApprovedArtifact({
        ...fixture("release"),
        diagnostics,
        credential: (env, distribution, name, _request, trace) =>
          publicationCredential(
            env,
            distribution,
            name,
            async () =>
              ++requests === 1
                ? { status: 200, json: async () => ({ value: identity }) }
                : { status: 201, json: async () => body },
            trace,
          ),
        publishBuffer: async (_manifest, _bytes, options) => {
          assert.equal(options.forceAuth.token, secret);
          uploads++;
        },
      });
      if (scenario.reason === null) {
        await run;
        assert.equal(uploads, 1);
      } else {
        await assert.rejects(run);
        assert.equal(uploads, 0);
        const result = diagnostics.failure();
        assert.equal(result.error.code, "FOUNDATION_PUBLISH_BLOCKED");
        assert.equal(result.error.stage, "npm-exchange");
        assert.equal(result.error.category, "authentication");
        assert.equal(result.error.http_status, 201);
        assert.equal(result.error.reason, scenario.reason);
        assert(!JSON.stringify(result).includes("sentinel"));
        assert(!JSON.stringify(result).includes(secret));
        assert(!JSON.stringify(result).includes(identity));
      }
      assert.equal(requests, 2);
    });
  }
});

test("expiration decisions with explicit offsets are independent of the process timezone", () => {
  const source = `
    import assert from 'node:assert/strict';
    import {publicationCredential,createConsumerDiagnostics} from ${JSON.stringify(new URL("./release-consumer.mjs", import.meta.url).href)};
    Date.now=()=>Date.parse('2026-10-18T15:00:00Z');
    const sha='a'.repeat(40);
    const identity='synthetic.'+Buffer.from(JSON.stringify({repository:'t00ls-dev/foundation',ref:'refs/heads/master',sha})).toString('base64url')+'.synthetic';
    const env={EXECUTION_SHA:sha,ACTIONS_ID_TOKEN_REQUEST_URL:'https://pipelines.actions.githubusercontent.com/synthetic/oidc',ACTIONS_ID_TOKEN_REQUEST_TOKEN:'synthetic'};
    const cases=[['2026-10-18T16:00:00Z',true],['2026-10-18T18:30:00+02:30',true],['2026-10-18T09:00:00-07:00',true],['2026-10-18T16:00:00-00:00',true],['2026-10-18T16:00:00',false],['2026-10-18T15:00:00Z',false]];
    for(const [expires,expected]of cases){let count=0,accepted=false;const trace=createConsumerDiagnostics();try{await publicationCredential(env,'release','@t00ls-dev/audit',async()=>++count===1?{status:200,json:async()=>({value:identity})}:{status:201,json:async()=>({token_type:'oidc',token:'synthetic',expires})},trace);accepted=true;}catch{}assert.equal(accepted,expected);assert.equal(count,2);}
  `;
  for (const timezone of [
    "UTC",
    "America/New_York",
    "Pacific/Kiritimati",
    "Etc/GMT+12",
  ]) {
    execFileSync(process.execPath, ["--input-type=module", "--eval", source], {
      env: { ...process.env, TZ: timezone },
      stdio: "pipe",
    });
  }
});

test("exchange timeout during response body reading preserves HTTP status", async (t) => {
  const controller = new AbortController();
  t.mock.method(AbortSignal, "timeout", () => controller.signal);
  const diagnostics = createConsumerDiagnostics();
  const identity = `synthetic.${Buffer.from(JSON.stringify({ repository: "t00ls-dev/foundation", ref: "refs/heads/master", sha })).toString("base64url")}.synthetic`;
  let calls = 0;
  await assert.rejects(
    publicationCredential(
      oidcEnv(),
      "release",
      "@t00ls-dev/audit",
      async () =>
        ++calls === 1
          ? { status: 200, json: async () => ({ value: identity }) }
          : {
              status: 201,
              json: async () => {
                controller.abort();
                throw new DOMException("secret body", "AbortError");
              },
            },
      diagnostics,
    ),
  );
  assert.equal(calls, 2);
  assert.equal(diagnostics.failure().error.http_status, 201);
  assert.equal(diagnostics.failure().error.reason, "TIMEOUT");
  assert(!JSON.stringify(diagnostics.failure()).includes("secret"));
});

test("consumer inner failures retain safe categories and stop before later operations", async () => {
  for (const [gate, category] of [
    ["npm-config", "configuration"],
    ["artifacts", "integrity"],
    ["bootstrap-identity", "authentication"],
    ["oidc-broker", "authentication"],
    ["npm-exchange", "authentication"],
    ["provenance-transport", "publication"],
  ]) {
    const diagnostics = createConsumerDiagnostics();
    const f = fixture();
    const fail = () => {
      throw new Error("secret-token HTTP body stack");
    };
    let uploads = 0;
    let requests = 0;
    const identity = `synthetic.${Buffer.from(JSON.stringify({ repository: "t00ls-dev/foundation", ref: "refs/heads/master", sha })).toString("base64url")}.synthetic`;
    if (gate === "npm-config")
      f.config.data.set("user", { raw: { _authToken: "secret" } });
    if (gate === "artifacts") f.readBytes = fail;
    if (["bootstrap-identity", "oidc-broker", "npm-exchange"].includes(gate)) {
      f.credential = (_env, _distribution, name, _request, trace) =>
        publicationCredential(
          gate === "bootstrap-identity" ? bootstrapEnv() : oidcEnv(),
          gate === "bootstrap-identity" ? "bootstrap" : "release",
          name,
          async () => {
            requests++;
            if (gate !== "npm-exchange" || requests === 2) fail();
            return { status: 200, json: async () => ({ value: identity }) };
          },
          trace,
        );
    }
    await assert.rejects(
      consumeApprovedArtifact({
        ...f,
        diagnostics,
        publishBuffer: async () => {
          uploads++;
          fail();
        },
      }),
    );
    assert.equal(uploads, gate === "provenance-transport" ? 1 : 0);
    assert.equal(
      requests,
      gate === "npm-exchange"
        ? 2
        : ["oidc-broker", "bootstrap-identity"].includes(gate)
          ? 1
          : 0,
    );
    const result = diagnostics.failure();
    assert.equal(result.error.stage, gate);
    assert.equal(result.error.category, category);
    assert.equal(result.error.code, "FOUNDATION_PUBLISH_BLOCKED");
    assert(!JSON.stringify(result).includes("secret"));
  }
});
function fixture(
  distribution = "bootstrap",
  bytes = Buffer.from("synthetic approved bytes"),
) {
  const record = JSON.parse(
    readFileSync(
      new URL("./fixtures/release/bootstrap-record.json", import.meta.url),
      "utf8",
    ),
  );
  // Validate the historical baseline before any negative scenario mutates it.
  validateRecord(record);
  validateDistribution(
    { distribution: "bootstrap", releasePr: 30, releaseSha: bootstrapSha },
    record,
  );
  const artifacts = record.packages.map((p) => ({
    name: p.name,
    version: p.version,
    path: `packages/${p.name.replace(/^@/, "").replace("/", "-")}-${p.version}.tgz`,
    hash: hash(bytes),
    integrity: `sha512-${hash(bytes, "sha512", "base64")}`,
    packIntegrity: `sha256-${hash(bytes, "sha256", "base64")}`,
  }));
  const packet = {
    format: 4,
    repository: "t00ls-dev/foundation",
    registry,
    access: "public",
    scopeOwner: "user:t00ls-dev",
    distribution,
    authentication: authenticationMethod(distribution),
    releasePr: 30,
    releaseSha: bootstrapSha,
    snapshotSha: sha,
    executionSha: sha,
    changesDigest: "d".repeat(64),
    protectedInputsDigest: "e".repeat(64),
    auditRun: 123,
    artifacts,
    record,
  };
  const context = {
    ...packet,
    reviewedChangesDigest: packet.changesDigest,
    planDigest: envelopeDigest(packet),
  };
  return {
    packet,
    context,
    bytes,
    packDirectory: "/synthetic/packed",
    path: `/synthetic/packed/${artifacts[0].path}`,
    env: distribution === "bootstrap" ? bootstrapEnv() : oidcEnv(),
    config: emptyConfig(),
    readBytes: async () => bytes,
    manifest: (_, artifact) => ({
      name: artifact.name,
      version: artifact.version,
    }),
    credential: async () => "synthetic",
  };
}

test("consumer fixture preserves historical bytes and independent records", () => {
  assert.equal(
    hash(
      readFileSync(
        new URL("./fixtures/release/bootstrap-record.json", import.meta.url),
      ),
    ),
    "8986855d4038c2135031b8f045255bda5896d46aca737ef23fcf4c1fe62857c4",
  );
  const original = fixture().packet.record;
  const changed = fixture().packet.record;
  changed.packages[0].dependencies.push({ name: "mutated" });
  changed.changesets[0].hash = "0".repeat(64);
  assert.deepEqual(fixture().packet.record, original);
});

test("S01 bootstrap has its own required credential and authentication-bound approval", () => {
  validatePublisherEnvironment(bootstrapEnv(), npmVersion, "bootstrap");
  assert.throws(() =>
    validatePublisherEnvironment({}, npmVersion, "bootstrap"),
  );
  assert.throws(() =>
    validatePublisherEnvironment(bootstrapEnv(), npmVersion, "release"),
  );
  const f = fixture();
  assert.notEqual(
    envelopeDigest({ ...f.packet, authentication: "oidc" }),
    f.context.planDigest,
  );
});

test("consumer keeps owner approval, executor identity and exact master CI as prerequisites", async () => {
  const f = fixture();
  const actor = { ...releaseOwner, type: "User" };
  const run = {
    id: 555,
    workflow_id: 10,
    path: ".github/workflows/release.yml",
    actor,
    triggering_actor: actor,
    run_attempt: 1,
    repository: { full_name: "t00ls-dev/foundation" },
    head_repository: { full_name: "t00ls-dev/foundation" },
    event: "workflow_dispatch",
    head_branch: "master",
    head_sha: sha,
    status: "in_progress",
  };
  const approved = {
    ...run,
    id: 444,
    status: "completed",
    conclusion: "success",
  };
  const env = {
    ...bootstrapEnv(),
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/master",
    GITHUB_REPOSITORY: "t00ls-dev/foundation",
    GITHUB_SHA: sha,
    EXECUTION_SHA: sha,
    RELEASE_SHA: bootstrapSha,
    RELEASE_PR: "30",
    RELEASE_MODE: "publish",
    DISTRIBUTION_MODE: "bootstrap",
    RELEASE_CONFIRMATION: confirmation,
    PLAN_DIGEST: f.context.planDigest,
    CHANGES_DIGEST: f.context.changesDigest,
    AUDIT_RUN: "123",
    APPROVAL_RUN: "444",
    GITHUB_RUN_ID: "555",
    GITHUB_RUN_ATTEMPT: "1",
  };
  const certificate = approvalCertificate(
    f.packet,
    { ...releaseOwner, permission: "admin" },
    444,
  );
  const ci = {
    id: 999,
    workflow_id: 11,
    path: ".github/workflows/ci.yml",
    repository: run.repository,
    head_repository: run.head_repository,
    event: "push",
    head_branch: "master",
    head_sha: sha,
    status: "completed",
    conclusion: "success",
    run_attempt: 1,
  };
  const request = async (url) => {
    if (url.endsWith("/heads/master")) return { object: { sha } };
    if (url.endsWith("/workflows/release.yml"))
      return { id: 10, path: run.path };
    if (url.endsWith("/workflows/ci.yml")) return { id: 11, path: ci.path };
    if (url.includes("/workflows/11/runs?"))
      return { workflow_runs: [{ id: 999 }] };
    if (url.endsWith("/runs/999")) return ci;
    if (url.includes("/runs/999/attempts/1/jobs?"))
      return {
        jobs: [
          {
            name: "checks",
            run_id: 999,
            run_attempt: 1,
            head_sha: sha,
            status: "completed",
            conclusion: "success",
          },
        ],
      };
    if (url.endsWith("/permission"))
      return { permission: "admin", user: actor };
    if (url.endsWith("/runs/555")) return run;
    if (url.endsWith("/runs/444")) return approved;
    if (url.includes("/runs/444/jobs?"))
      return {
        jobs: [
          {
            name: "approve",
            run_id: 444,
            run_attempt: 1,
            head_sha: sha,
            status: "completed",
            conclusion: "success",
          },
        ],
      };
    throw new Error("Unexpected fixture API request");
  };
  assert.equal(
    (await validateConsumerAuthority(env, f.packet, certificate, request))
      .executionSha,
    sha,
  );
  await assert.rejects(
    validateConsumerAuthority(
      { ...env, GITHUB_SHA: "b".repeat(40) },
      f.packet,
      certificate,
      request,
    ),
  );
  await assert.rejects(
    validateConsumerAuthority(
      env,
      f.packet,
      { ...certificate, authentication: "oidc" },
      request,
    ),
  );
  await assert.rejects(
    validateConsumerAuthority(env, f.packet, certificate, async (url) =>
      url.endsWith("/permission")
        ? { permission: "write", user: actor }
        : request(url),
    ),
  );
  await assert.rejects(
    validateConsumerAuthority(env, f.packet, certificate, async (url) =>
      url.endsWith("/runs/999")
        ? { ...ci, conclusion: "failure" }
        : request(url),
    ),
  );
  await assert.rejects(
    validateConsumerAuthority(env, f.packet, certificate, async (url) =>
      url.endsWith("/runs/555")
        ? { ...run, actor: { ...actor, id: 12 } }
        : request(url),
    ),
  );
});

test("S01 bootstrap verifies npm owner using only the explicit temporary credential", async () => {
  const calls = [];
  const token = await publicationCredential(
    bootstrapEnv(),
    "bootstrap",
    "@t00ls-dev/access",
    async (url, options) => {
      calls.push(url);
      assert.equal(options.headers.Authorization, "Bearer synthetic");
      return { status: 200, json: async () => ({ username: "t00ls-dev" }) };
    },
  );
  assert.equal(token, "synthetic");
  assert.deepEqual(calls, [`${registry}/-/whoami`]);
  await assert.rejects(
    publicationCredential(
      bootstrapEnv(),
      "bootstrap",
      "@t00ls-dev/access",
      async () => ({ status: 200, json: async () => ({ username: "other" }) }),
    ),
  );
  await assert.rejects(
    publicationCredential(
      bootstrapEnv(),
      "bootstrap",
      "@t00ls-dev/access",
      async () => ({ status: 401 }),
    ),
  );
});

test("S02 alteration after initial validation blocks before authentication and upload", async () => {
  const f = fixture();
  validateArtifactBuffer(f.bytes, f.packet.artifacts[0]);
  let uploads = 0,
    credentials = 0;
  await assert.rejects(
    consumeApprovedArtifact({
      ...f,
      readBytes: async () => Buffer.from("changed after preparation"),
      credential: async () => {
        credentials++;
        return "synthetic";
      },
      publishBuffer: async () => {
        uploads++;
      },
    }),
    /SHA-256/,
  );
  assert.equal(credentials, 0);
  assert.equal(uploads, 0);
});

test("S02 file/reader mutation after capture cannot change the uploaded private buffer", async () => {
  const f = fixture();
  const original = Buffer.from(f.bytes);
  let uploaded;
  await consumeApprovedArtifact({
    ...f,
    credential: async () => {
      f.bytes.fill(0);
      return "synthetic";
    },
    publishBuffer: async (_, bytes, options) => {
      uploaded = Buffer.from(bytes);
      assert.equal(options.registry, registry);
      assert.equal(options.forceAuth.token, "synthetic");
    },
  });
  assert.deepEqual(uploaded, original);
  assert.notDeepEqual(f.bytes, original);
});

test("S02 consumer rejects unapproved path, divergent envelope/method/hash/version and keeps approved bytes", async () => {
  for (const mutate of [
    (f) => (f.path = "/synthetic/unknown.tgz"),
    (f) => (f.packet.format = 3),
    (f) => (f.packet.registry = "https://npm.pkg.github.com"),
    (f) => (f.packet.authentication = "oidc"),
    (f) => (f.packet.artifacts[0].hash = "0".repeat(64)),
    (f) => (f.packet.record.packages[0].version = "0.1.3"),
    (f) => (f.context.releasePr = 31),
  ]) {
    const f = fixture();
    mutate(f);
    let called = false;
    await assert.rejects(
      consumeApprovedArtifact({
        ...f,
        publishBuffer: async () => {
          called = true;
        },
      }),
    );
    assert.equal(called, false);
  }
});

test("S03 config sources and shadowed auth keys are rejected without accessing values", () => {
  for (const source of ["builtin", "global", "user", "project", "env", "cli"]) {
    for (const key of [
      "//registry.npmjs.org/:_authToken",
      "_auth",
      "username",
      "_password",
      "//registry.npmjs.org/:certfile",
      "//registry.npmjs.org/:keyfile",
      "//registry.npmjs.org/:tokenHelper",
    ]) {
      const raw = {};
      Object.defineProperty(raw, key, {
        enumerable: true,
        get() {
          throw new Error("Sensitive value must not be read");
        },
      });
      assert.throws(
        () =>
          validateNpmConfiguration({
            data: new Map([[source, { raw, data: {} }]]),
          }),
        /Configured npm credentials/,
      );
    }
  }
  validateNpmConfiguration(emptyConfig());
});

test("S03 actual npm configuration loader finds credential keys in isolated user/project files", async () => {
  const temp = mkdtempSync(join(tmpdir(), "foundation-auth-config-"));
  try {
    const cwd = join(temp, "project"),
      home = join(temp, "home");
    mkdirSync(cwd);
    mkdirSync(home);
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({ private: true, name: "auth-fixture" }),
    );
    const userconfig = join(home, ".npmrc"),
      globalconfig = join(temp, "global.npmrc");
    writeFileSync(globalconfig, "");
    writeFileSync(userconfig, "//registry.npmjs.org/:_authToken=synthetic\n");
    const env = {
      HOME: home,
      npm_config_userconfig: userconfig,
      npm_config_globalconfig: globalconfig,
    };
    const config = await loadNpmConfiguration({ cwd, env });
    assert.throws(
      () => validateNpmConfiguration(config),
      /Configured npm credentials/,
    );
    writeFileSync(userconfig, "");
    writeFileSync(
      join(cwd, ".npmrc"),
      "//registry.npmjs.org/:_password=synthetic\n",
    );
    const project = await loadNpmConfiguration({ cwd, env });
    assert.throws(
      () => validateNpmConfiguration(project),
      /Configured npm credentials/,
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("S03 OIDC exchange is mandatory; missing identity/configuration/exchange never uploads", async () => {
  const identity = `synthetic.${Buffer.from(JSON.stringify({ repository: "t00ls-dev/foundation", ref: "refs/heads/master", sha })).toString("base64url")}.synthetic`;
  let calls = 0;
  const request = async (_, options) => {
    calls++;
    assert.equal(options.redirect, "error");
    return calls === 1
      ? { status: 200, json: async () => ({ value: identity }) }
      : {
          status: 201,
          json: async () => ({
            token_type: "oidc",
            token: "synthetic",
            expires: new Date(Date.now() + 60000).toISOString(),
          }),
        };
  };
  assert.equal(
    await publicationCredential(
      oidcEnv(),
      "release",
      "@t00ls-dev/access",
      request,
    ),
    "synthetic",
  );
  assert.equal(calls, 2);
  for (const status of [401, 403, 404, 500]) {
    let counter = 0;
    await assert.rejects(
      publicationCredential(
        oidcEnv(),
        "release",
        "@t00ls-dev/access",
        async () =>
          ++counter === 1
            ? { status: 200, json: async () => ({ value: identity }) }
            : { status },
      ),
      /no credential fallback/,
    );
  }
  const f = fixture("release");
  let uploads = 0;
  await assert.rejects(
    consumeApprovedArtifact({
      ...f,
      credential: () =>
        publicationCredential(
          oidcEnv(),
          "release",
          "@t00ls-dev/access",
          async () => ({ status: 403 }),
        ),
      publishBuffer: async () => {
        uploads++;
      },
    }),
  );
  assert.equal(uploads, 0);
  for (const key of [
    "NPM_BOOTSTRAP_TOKEN",
    "NPM_TOKEN",
    "NODE_AUTH_TOKEN",
    "NPM_ID_TOKEN",
    "npm_config_//registry.npmjs.org/:_authToken",
  ])
    assert.throws(() =>
      validatePublisherEnvironment(
        { ...oidcEnv(), [key]: "synthetic" },
        npmVersion,
        "release",
      ),
    );
});

test("S02 real tarball parsing and npm buffer transport use the approved bytes, never a path reread", async () => {
  const temp = mkdtempSync(join(tmpdir(), "foundation-buffer-transport-"));
  const require = createRequire(import.meta.url),
    npmRequire = createRequire(require.resolve("npm/package.json"));
  const fetchPath = npmRequire.resolve("npm-registry-fetch"),
    publishPath = npmRequire.resolve("libnpmpublish/lib/publish.js");
  const originalFetch = npmRequire(fetchPath),
    originalModule = require.cache[publishPath];
  let uploads = 0;
  try {
    const directory = join(temp, "package");
    mkdirSync(directory);
    const f = fixture();
    const artifact = f.packet.artifacts[0];
    const manifest = {
      name: artifact.name,
      version: artifact.version,
      license: "MIT",
      repository: "https://github.com/t00ls-dev/foundation",
      publishConfig: { registry, access: "public" },
    };
    writeFileSync(join(directory, "package.json"), JSON.stringify(manifest));
    const tarball = join(temp, "fixture.tgz");
    execFileSync("tar", ["-czf", tarball, "-C", temp, "package"]);
    const bytes = readFileSync(tarball),
      actual = fixture("bootstrap", bytes);
    actual.readBytes = async () => readFileSync(tarball);
    actual.manifest = manifestFromBuffer;
    actual.credential = async () => {
      writeFileSync(tarball, "changed on disk during authentication");
      return "synthetic";
    };
    const fakeFetch = async (path, options) => {
      uploads++;
      assert.equal(path, "@t00ls-dev%2faccess");
      assert.equal(options.method, "PUT");
      const attachment = Object.values(options.body._attachments)[0];
      assert.deepEqual(Buffer.from(attachment.data, "base64"), bytes);
      assert.equal(
        options.body.versions[artifact.version].dist.integrity,
        actual.packet.artifacts[0].integrity,
      );
      return { status: 201 };
    };
    fakeFetch.pickRegistry = (_, options) => options.registry;
    require.cache[fetchPath].exports = fakeFetch;
    delete require.cache[publishPath];
    const publish = npmRequire(publishPath);
    // Only the fixture disables provenance to avoid remote Sigstore/OIDC IO.
    await consumeApprovedArtifact({
      ...actual,
      publishBuffer: (metadata, data, options) =>
        publish(metadata, data, { ...options, provenance: false }),
    });
    assert.equal(uploads, 1);
  } finally {
    require.cache[fetchPath].exports = originalFetch;
    if (originalModule) require.cache[publishPath] = originalModule;
    else delete require.cache[publishPath];
    rmSync(temp, { recursive: true, force: true });
  }
});
