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
      consumeApprovedArtifact: async () => {
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
      "message",
      "stage",
    ]);
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
