import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { parse } from "yaml";
import { runInNewContext } from "node:vm";
import {
  authenticatedJson,
  confirmation,
  digest,
  envelopeDigest,
  hash,
  names,
  reconcile,
  remainingPlan,
  validateContext,
  validateRepository,
  validateManifests,
  validatePacket,
  validatePr,
  validateRecord,
  validatePublishPlan,
  recordFromStatus,
  validateArtifactPath,
  validateReleaseCommit,
  validateRecordPlan,
  validatePackument,
  registryInventory,
  infrastructurePaths,
  protectedInputs,
  validateProtectedInputs,
  validateAncestry,
  validateAuditRun,
  registry as officialRegistry,
  approvalConfirmation,
  bootstrapSha,
  releaseOwner,
  npmVersion,
  snapshotChanges,
  validateDistribution,
  validateReleaseActor,
  approvalCertificate,
  validateApproval,
  validatePublisherEnvironment,
  canonical,
  validateReviewEvidence,
  observePublication,
  publicationObservationLimits,
} from "./release-core.mjs";
import {
  recordFromBase,
  contentBinding,
  treeAtCommit,
} from "./release-planning.mjs";
import {
  approvedCi,
  validateCiRun,
  validateDeployEvent,
} from "./ci-evidence.mjs";
import { distributionAttempts } from "../../tests/distribution-attempts.mjs";
import "./ci-reporting.test.mjs";
import "./release-consumer.test.mjs";
import "./release-recovery.test.mjs";
import "./release-exchange-diagnostic.test.mjs";
import { loadNpmConfiguration } from "./release-consumer.mjs";

const sha = "a".repeat(40);
const record = () => ({
  format: 1,
  repository: "t00ls-dev/foundation",
  cliVersion: "3.0.3",
  baseSha: "b".repeat(40),
  changesets: [{ id: "patch-access", hash: "c".repeat(64) }],
  packages: [
    {
      name: names[0],
      oldVersion: "0.1.0",
      version: "0.1.1",
      type: "patch",
      changesets: ["patch-access"],
      reason: "changeset",
      dependencies: [],
    },
  ],
});
const context = () => ({
  event: "workflow_dispatch",
  ref: "refs/heads/master",
  repository: "t00ls-dev/foundation",
  sha,
  releaseSha: sha,
  executionSha: sha,
  protectedInputsDigest: "e".repeat(64),
  masterSha: sha,
  mode: "publish",
  releasePr: 25,
  confirmation,
  planDigest: envelopeDigest(packet()),
  auditRun: 100,
  approvalRun: 101,
  distribution: "release",
  changesDigest: "d".repeat(64),
  reviewedChangesDigest: "d".repeat(64),
});
const pr = () => ({
  number: 25,
  state: "closed",
  merged: true,
  base: { ref: "master", repo: { full_name: "t00ls-dev/foundation" } },
  head: {
    sha,
    ref: "changeset-release/master",
    repo: { full_name: "t00ls-dev/foundation" },
  },
  merge_commit_sha: sha,
  user: { login: "github-actions[bot]" },
});
const artifacts = () => [
  {
    name: names[0],
    version: "0.1.1",
    path: "packages/t00ls-dev-access-0.1.1.tgz",
    hash: "f".repeat(64),
    integrity: "sha512-YWJj",
    packIntegrity: "sha256-YWJj",
  },
];
const packet = () => ({
  format: 4,
  repository: "t00ls-dev/foundation",
  registry: officialRegistry,
  access: "public",
  scopeOwner: "user:t00ls-dev",
  distribution: "release",
  authentication: "oidc",
  snapshotSha: sha,
  changesDigest: "d".repeat(64),
  releasePr: 25,
  releaseSha: sha,
  executionSha: sha,
  protectedInputsDigest: "e".repeat(64),
  record: record(),
  auditRun: 100,
  artifacts: artifacts(),
});
const registry = (versions = ["0.1.0"], latest = versions.at(-1)) => ({
  [names[0]]: {
    name: names[0],
    versions,
    latest,
    integrities: { "0.1.1": "sha512-YWJj" },
  },
});
const invalid = (name, fn) => test(name, () => assert.throws(fn));

const bootstrapRecord = () =>
  JSON.parse(
    readFileSync(
      new URL("./fixtures/release/bootstrap-record.json", import.meta.url),
      "utf8",
    ),
  );
const bootstrapContext = () => ({
  ...context(),
  distribution: "bootstrap",
  releasePr: 30,
  releaseSha: bootstrapSha,
});
const owner = () => ({ ...releaseOwner, type: "User" });
const releaseWorkflow = () => ({
  id: 456,
  path: ".github/workflows/release.yml",
});
const ownerPermission = () => ({ permission: "admin", user: owner() });
const approvalRun = () => ({
  id: 101,
  run_attempt: 1,
  workflow_id: 456,
  path: ".github/workflows/release.yml",
  repository: { full_name: "t00ls-dev/foundation" },
  head_repository: { full_name: "t00ls-dev/foundation" },
  event: "workflow_dispatch",
  head_branch: "master",
  head_sha: sha,
  actor: owner(),
  triggering_actor: owner(),
  status: "completed",
  conclusion: "success",
});
const approvalJobs = () => [
  {
    name: "approve",
    run_id: 101,
    run_attempt: 1,
    head_sha: sha,
    status: "completed",
    conclusion: "success",
  },
];

// Exact bytes recovered from bootstrap commit 90a100377fa8c1e0e1b30174d4e611c545ed0ac4.
test("historical bootstrap fixture retains provenance and independent nested state", () => {
  const bytes = readFileSync(
    new URL("./fixtures/release/bootstrap-record.json", import.meta.url),
  );
  assert.equal(
    hash(bytes),
    "8986855d4038c2135031b8f045255bda5896d46aca737ef23fcf4c1fe62857c4",
  );
  const original = bootstrapRecord();
  validateRecord(original);
  validateDistribution(bootstrapContext(), original);
  assert.equal(original.baseSha, "79dec4983d45fb9deb7459850965ce496a24a2cb");
  const changed = bootstrapRecord();
  changed.packages[0].version = "99.0.0";
  changed.packages[0].dependencies.push({ name: "mutated" });
  changed.changesets[0].hash = "0".repeat(64);
  assert.deepEqual(bootstrapRecord(), original);
});

test("bootstrap observation is not permission to publish; exact historical plan is required", async () => {
  const r = bootstrapRecord(),
    c = bootstrapContext();
  validateDistribution(c, r);
  const state = await registryInventory("bootstrap", async () => ({
    status: 404,
    json: async () => ({ error: "Not found" }),
  }));
  assert.deepEqual(Object.keys(state), names);
  assert.throws(() => reconcile(r, state), /previous version/);
  assert.equal(remainingPlan(r, reconcile(r, state, [], c), "audit").length, 9);
  assert.throws(
    () => validateContext({ ...c, approvalRun: undefined }, true),
    /approval_run/,
  );
  for (const change of [
    { releasePr: 31 },
    { releaseSha: sha },
    { distribution: undefined },
  ])
    assert.throws(() => validateDistribution({ ...c, ...change }, r));
  for (const mutate of [
    (r) => r.packages.pop(),
    (r) => (r.packages[0].version = "0.1.3"),
    (r) => (r.packages[0].oldVersion = "0.0.0"),
  ]) {
    const changed = bootstrapRecord();
    mutate(changed);
    assert.throws(() => validateDistribution(c, changed));
  }
});

test("bootstrap rejects ambiguous absence, auth/server failures and foreign pre-existing versions", async () => {
  for (const status of [401, 403, 500, 503, 206])
    await assert.rejects(
      registryInventory("bootstrap", async () => ({ status, ok: false })),
    );
  await assert.rejects(
    registryInventory("bootstrap", async () => ({
      status: 404,
      json: async () => ({ error: "unauthorized" }),
    })),
  );
  const r = bootstrapRecord(),
    c = bootstrapContext();
  const state = Object.fromEntries(
    r.packages.map((p) => [
      p.name,
      { name: p.name, versions: [], latest: null, integrities: {} },
    ]),
  );
  state[names[0]].versions = ["0.1.1"];
  assert.throws(() => reconcile(r, state, [], c), /Unexpected existing/);
});

test("bootstrap partial resume retains exact artifacts and then normal npm continuity", () => {
  const r = bootstrapRecord(),
    c = bootstrapContext();
  const a = r.packages.map((p) => ({ name: p.name, integrity: sri(p.name) }));
  const state = Object.fromEntries(
    r.packages.map((p, i) => [
      p.name,
      {
        name: p.name,
        versions: i === 0 ? [p.version] : [],
        latest: i === 0 ? p.version : null,
        integrities: i === 0 ? { [p.version]: a[i].integrity } : {},
      },
    ]),
  );
  const states = reconcile(r, state, a, c);
  assert.equal(remainingPlan(r, states, "resume").length, 8);
  assert.throws(() => remainingPlan(r, states, "publish"));
  const damaged = structuredClone(state);
  damaged[names[0]].integrities[r.packages[0].version] = "sha512-wrong";
  assert.throws(() => remainingPlan(r, reconcile(r, damaged, a, c), "resume"));
  const next = record();
  next.packages[0] = {
    ...next.packages[0],
    oldVersion: "0.1.2",
    version: "0.1.3",
  };
  assert.equal(reconcile(next, state)[0].state, "absent");
  assert.throws(() =>
    reconcile(next, {
      [names[0]]: { name: names[0], versions: [], latest: null },
    }),
  );
});

test("owner approval is proven by exact GitHub actor ID and current admin permission", () => {
  const p = packet(),
    c = context(),
    run = approvalRun();
  const actor = validateReleaseActor(
    run,
    releaseWorkflow(),
    ownerPermission(),
    { ...c, runId: run.id },
  );
  const certificate = approvalCertificate(p, actor, run.id);
  validateApproval(
    certificate,
    run,
    approvalJobs(),
    releaseWorkflow(),
    ownerPermission(),
    p,
    c,
  );
  for (const mutate of [
    (r) => r.actor.id++,
    (r) => (r.actor.login = "another"),
    (r) => (r.actor.type = "Bot"),
    (r) => r.triggering_actor.id++,
    (r) => r.run_attempt++,
    (r) => (r.head_sha = "f".repeat(40)),
    (r) => (r.event = "push"),
    (r) => (r.path = ".github/workflows/other.yml"),
    (r) => (r.head_repository.full_name = "fork/foundation"),
    (r) => (r.status = "in_progress"),
    (r) => (r.conclusion = "failure"),
  ]) {
    const changed = approvalRun();
    mutate(changed);
    assert.throws(() =>
      validateApproval(
        certificate,
        changed,
        approvalJobs(),
        releaseWorkflow(),
        ownerPermission(),
        p,
        c,
      ),
    );
  }
  assert.throws(() =>
    validateApproval(
      certificate,
      run,
      approvalJobs(),
      releaseWorkflow(),
      { ...ownerPermission(), permission: "write" },
      p,
      c,
    ),
  );
  assert.throws(() =>
    validateApproval(
      certificate,
      run,
      [],
      releaseWorkflow(),
      ownerPermission(),
      p,
      c,
    ),
  );
  assert.throws(() =>
    validateApproval(
      certificate,
      run,
      [...approvalJobs(), ...approvalJobs()],
      releaseWorkflow(),
      ownerPermission(),
      p,
      c,
    ),
  );
  assert.throws(() =>
    validateApproval(
      certificate,
      run,
      approvalJobs(),
      releaseWorkflow(),
      ownerPermission(),
      p,
      { ...c, approvalRun: undefined },
    ),
  );
});

test("approval rejects stale snapshot, artifacts, registry, historical deltas and self-declared authority", () => {
  const p = packet(),
    run = approvalRun();
  const certificate = approvalCertificate(
    p,
    { ...releaseOwner, permission: "admin" },
    run.id,
  );
  for (const [key, value] of Object.entries({
    registry: "https://npm.pkg.github.com",
    access: "restricted",
    snapshotSha: "f".repeat(40),
    artifactsDigest: "f".repeat(64),
    planDigest: "f".repeat(64),
    changesDigest: "f".repeat(64),
    distribution: "bootstrap",
    actor: { ...releaseOwner, permission: "write" },
  }))
    assert.throws(() =>
      validateApproval(
        { ...certificate, [key]: value },
        run,
        approvalJobs(),
        releaseWorkflow(),
        ownerPermission(),
        p,
        context(),
      ),
    );
  const changed = packet();
  changed.artifacts[0].hash = "0".repeat(64);
  assert.throws(() =>
    validateApproval(
      certificate,
      run,
      approvalJobs(),
      releaseWorkflow(),
      ownerPermission(),
      changed,
      context(),
    ),
  );
  assert.throws(() =>
    validateApproval(
      { approved: true },
      run,
      approvalJobs(),
      releaseWorkflow(),
      ownerPermission(),
      p,
      context(),
    ),
  );
});

test("new envelope binds destination and rejects every old envelope and unapproved changes", () => {
  const p = packet(),
    c = { ...context(), planDigest: envelopeDigest(p) };
  validatePacket(p, c, record());
  for (const change of [
    { format: 1 },
    { format: 2 },
    { format: 3 },
    { registry: "https://npm.pkg.github.com" },
    { access: "restricted" },
    { scopeOwner: "org:t00ls-dev" },
    { changesDigest: "f".repeat(64) },
    { snapshotSha: "f".repeat(40) },
    { distribution: "bootstrap" },
  ])
    assert.throws(() => validatePacket({ ...p, ...change }, c, record()));
  assert.notEqual(
    envelopeDigest({ ...p, registry: "https://npm.pkg.github.com" }),
    c.planDigest,
  );
  validateContext(
    {
      ...c,
      mode: "approve",
      confirmation: approvalConfirmation,
      approvalRun: undefined,
    },
    true,
  );
  assert.throws(() =>
    validateContext({ ...c, reviewedChangesDigest: undefined }, true),
  );
  assert.throws(() =>
    validateContext(
      { ...c, confirmation: "PUBLISH_PRIVATE_FOUNDATION_PACKAGES" },
      true,
    ),
  );
});

test("snapshot review covers complete historical differences including executor exceptions", () => {
  const before = inputTree(),
    after = structuredClone(before);
  after.tree.find((f) => f.path === "packages/access/package.json").sha =
    "f".repeat(40);
  after.tree.find((f) => f.path === infrastructurePaths[0]).sha = "e".repeat(
    40,
  );
  assert.throws(() => validateProtectedInputs(before, after));
  const changes = snapshotChanges(before, after);
  assert.deepEqual(
    changes.map((c) => c.path),
    [infrastructurePaths[0], "packages/access/package.json"],
  );
  assert.notEqual(digest(changes), digest([]));
  const evidence = {
    releaseSha: bootstrapSha,
    snapshotSha: sha,
    changesDigest: digest(changes),
    changes,
  };
  validateReviewEvidence(evidence, structuredClone(evidence));
  assert.throws(() =>
    validateReviewEvidence({ ...evidence, changes: [] }, evidence),
  );
  const forgedReview = structuredClone(evidence);
  forgedReview.changes[0].after.oid = "0".repeat(40);
  assert.throws(() => validateReviewEvidence(forgedReview, evidence));
  const approved = structuredClone(after);
  approved.tree.find((f) => f.path === "packages/access/package.json").sha =
    "d".repeat(40);
  assert.throws(() => validateProtectedInputs(after, approved));
});

test("B01 real workspace registry and Release environment agree; legacy scope remains rejected", async () => {
  const temp = mkdtempSync(join(tmpdir(), "foundation-registry-config-"));
  try {
    const workflow = parse(
      readFileSync(".github/workflows/release.yml", "utf8"),
    );
    assert.equal(workflow.env.NPM_CONFIG_REGISTRY, officialRegistry);
    const userConfig = join(temp, "user.npmrc"),
      globalConfig = join(temp, "global.npmrc");
    writeFileSync(userConfig, "");
    writeFileSync(globalConfig, "");
    const env = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => !/^npm_config_|^(?:NODE_AUTH_TOKEN|NPM_TOKEN)$/i.test(key),
        ),
      ),
      NPM_CONFIG_USERCONFIG: userConfig,
      NPM_CONFIG_GLOBALCONFIG: globalConfig,
    };
    const source = readFileSync(".github/scripts/release.mjs", "utf8");
    const start = source.indexOf("  const scopeRegistry = run(");
    const end = source.indexOf(
      '  assert(\n    !readdirSync(".changeset")',
      start,
    );
    assert(
      start >= 0 && end > start,
      "Actual sourceGates registry guard required",
    );
    const registryGuard = source.slice(start, end);
    const configGet = (cwd, env, key) =>
      execFileSync("pnpm", ["config", "get", key], {
        cwd,
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    const checkGuard = (cwd, env) =>
      runInNewContext(registryGuard, {
        assert,
        registry: officialRegistry,
        run: (command, args) => {
          assert.equal(command, "pnpm");
          assert.deepEqual(Array.from(args.slice(0, 2)), ["config", "get"]);
          return configGet(cwd, env, args[2]);
        },
      });
    const npmRequire = createRequire(
      createRequire(import.meta.url).resolve("npm/package.json"),
    );
    checkGuard(resolve("."), { ...env, ...workflow.env });
    for (const runtime of [env, { ...env, ...workflow.env }]) {
      // No scope override in env: pnpm must read the versioned project mapping.
      assert.equal(
        configGet(resolve("."), runtime, "@t00ls-dev:registry"),
        officialRegistry,
      );
      const packageScope = configGet(
        resolve("packages/access"),
        runtime,
        "@t00ls-dev:registry",
      );
      const packageRegistry =
        packageScope === "undefined"
          ? configGet(resolve("packages/access"), runtime, "registry")
          : packageScope;
      assert.equal(new URL(packageRegistry).origin, officialRegistry);
      const config = await loadNpmConfiguration({
        cwd: resolve("."),
        env: runtime,
      });
      const options = {
        "registry": config.get("registry"),
        "@t00ls-dev:registry": config.get("@t00ls-dev:registry"),
      };
      for (const name of names) {
        assert.equal(
          npmRequire("npm-registry-fetch").pickRegistry(
            npmRequire("npm-package-arg")(name),
            options,
          ),
          officialRegistry,
        );
        assert.equal(
          JSON.parse(
            readFileSync(`packages/${name.split("/")[1]}/package.json`, "utf8"),
          ).publishConfig.registry,
          officialRegistry,
        );
      }
    }
    const legacy = join(temp, "legacy");
    mkdirSync(legacy);
    writeFileSync(
      join(legacy, "package.json"),
      JSON.stringify({ private: true, packageManager: "pnpm@10.15.1" }),
    );
    writeFileSync(
      join(legacy, ".npmrc"),
      readFileSync(".npmrc", "utf8").replace(
        /^@t00ls-dev:registry=.*$/m,
        "@t00ls-dev:registry=https://npm.pkg.github.com",
      ),
    );
    assert.throws(
      () => checkGuard(legacy, { ...env, ...workflow.env }),
      /Unexpected scoped registry configuration/,
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("OIDC requires the pinned npm and rejects missing context or token fallback", () => {
  const env = {
    ACTIONS_ID_TOKEN_REQUEST_URL: "https://example.invalid/oidc",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "synthetic",
  };
  validatePublisherEnvironment(env, npmVersion);
  assert.throws(() => validatePublisherEnvironment(env, "10.9.8"));
  assert.throws(() => validatePublisherEnvironment({}, npmVersion));
  for (const name of ["NODE_AUTH_TOKEN", "NPM_TOKEN", "NPM_CONFIG_TOKEN"])
    assert.throws(() =>
      validatePublisherEnvironment({ ...env, [name]: "synthetic" }, npmVersion),
    );
  assert.equal(
    JSON.parse(readFileSync("node_modules/npm/package.json", "utf8")).version,
    npmVersion,
  );
});

test("actual Changesets to pnpm tarball publisher delegates to explicit npm path without publishing", () => {
  const temp = mkdtempSync(join(tmpdir(), "foundation-npm-wrapper-"));
  try {
    const pkg = JSON.parse(
      readFileSync("packages/access/package.json", "utf8"),
    );
    const input = join(temp, "plan.json"),
      packed = join(temp, "packed"),
      consumer = join(temp, "consumer"),
      captured = join(temp, "captured.json"),
      npmStub = join(temp, "npm-stub.cjs");
    const release = {
      kind: "publish",
      name: pkg.name,
      version: pkg.version,
      access: "public",
      tag: "latest",
    };
    writeFileSync(input, JSON.stringify({ version: 1, plan: [[release]] }));
    execFileSync(
      "pnpm",
      [
        "exec",
        "changeset",
        "pack",
        "--from-publish-plan",
        input,
        "--out-dir",
        packed,
      ],
      { encoding: "utf8" },
    );
    const plan = JSON.parse(
      readFileSync(join(packed, "publish-plan.json"), "utf8"),
    );
    const artifact = join(packed, plan.plan[0][0].tarball.path);
    const originalHash = hash(readFileSync(artifact));
    mkdirSync(join(consumer, "packages/access"), { recursive: true });
    mkdirSync(join(consumer, ".changeset"));
    writeFileSync(
      join(consumer, "package.json"),
      JSON.stringify({
        name: "wrapper-fixture",
        private: true,
        packageManager: "pnpm@10.15.1",
      }),
    );
    writeFileSync(
      join(consumer, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n",
    );
    writeFileSync(
      join(consumer, "packages/access/package.json"),
      JSON.stringify(pkg),
    );
    writeFileSync(
      join(consumer, ".changeset/config.json"),
      JSON.stringify({
        ...JSON.parse(readFileSync(".changeset/config.json", "utf8")),
        ignore: [],
      }),
    );
    // The only npm executable in this test is a recorder: no registry requests.
    writeFileSync(
      npmStub,
      `#!/usr/bin/env node\nconst fs=require("node:fs");fs.writeFileSync(${JSON.stringify(captured)},JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),oidcPresent:Boolean(process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)}));console.log("{}");\n`,
      { mode: 0o755 },
    );
    execFileSync(
      process.execPath,
      [
        resolve("node_modules/@changesets/cli/bin.js"),
        "publish",
        "--from-pack-dir",
        packed,
        "--no-git-tag",
      ],
      {
        encoding: "utf8",
        cwd: consumer,
        env: {
          ...process.env,
          npm_config_npm_path: npmStub,
          npm_config_registry: officialRegistry,
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: "synthetic",
        },
      },
    );
    const invocation = JSON.parse(readFileSync(captured, "utf8"));
    assert.equal(invocation.args[0], "publish");
    assert.equal(resolve(invocation.cwd, invocation.args[1]), artifact);
    assert(
      invocation.args.includes("public") && invocation.args.includes("latest"),
    );
    assert.equal(invocation.oidcPresent, true);
    assert.equal(
      hash(readFileSync(artifact)),
      originalHash,
      "Publisher must not repack approved bytes",
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

const repositoryMetadata = (privateRepo) => ({
  full_name: "t00ls-dev/foundation",
  name: "foundation",
  owner: { login: "t00ls-dev" },
  default_branch: "master",
  private: privateRepo,
});
for (const privateRepo of [false, true]) {
  test(`release accepts exact repository with private=${privateRepo}`, () => {
    validateRepository(repositoryMetadata(privateRepo));
    validateContext(context(), true);
  });
  for (const change of [
    { full_name: "t00ls-dev/other", name: "other" },
    { full_name: "other/foundation", owner: { login: "other" } },
    { name: "other" },
    { owner: { login: "other" } },
    { default_branch: "feature" },
    { private: undefined },
  ]) {
    invalid(
      `repository private=${privateRepo} rejects ${JSON.stringify(change)}`,
      () =>
        validateRepository({ ...repositoryMetadata(privateRepo), ...change }),
    );
  }
  for (const change of [
    { repository: "t00ls-dev/other" },
    { repository: "other/foundation" },
    { ref: "refs/heads/feature" },
    { sha: "f".repeat(40) },
    { event: "pull_request" },
    { confirmation: undefined },
  ]) {
    invalid(
      `release private=${privateRepo} rejects ${JSON.stringify(change)}`,
      () => {
        validateRepository(repositoryMetadata(privateRepo));
        validateContext({ ...context(), ...change }, true);
      },
    );
  }
  test(`release private=${privateRepo} rejects invalid CI evidence`, () => {
    validateRepository(repositoryMetadata(privateRepo));
    assert.throws(() =>
      validateCiRun(
        { ...ciRun(), conclusion: "failure" },
        [ciJob()],
        ciWorkflow(),
        sha,
      ),
    );
  });
}

test("executor validates API repository identity for every context", () => {
  const source = readFileSync(".github/scripts/release.mjs", "utf8");
  assert.match(
    source,
    /const repo = await request\(gh\);\s+validateRepository\(repo\);/,
  );
  assert.match(source, /validateContext\(value, value.mode !== "audit"\)/);
  assert.match(source, /await approvedCi\(value.executionSha\)/);
});

test("actual nine manifests use MIT and public npm publication", () => {
  for (const name of names) {
    const pkg = JSON.parse(
      readFileSync(`packages/${name.split("/")[1]}/package.json`, "utf8"),
    );
    assert.equal(pkg.license, "MIT");
    assert.equal(
      readFileSync(`packages/${name.split("/")[1]}/LICENSE`, "utf8"),
      readFileSync("LICENSE", "utf8"),
    );
    assert.equal(pkg.publishConfig.access, "public");
    assert.equal(pkg.publishConfig.registry, officialRegistry);
  }
  assert.equal(JSON.parse(readFileSync("package.json", "utf8")).private, true);
});

function inputTree() {
  const paths = [
    "LICENSE",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    ".changeset/release-plan.json",
    "turbo.json",
    ".npmrc",
    "tests/distribution.mjs",
    "tooling/typescript-config/base.json",
    ".github/workflows/ci.yml",
    ".github/workflows/deploy-dev.yml",
    ".github/scripts/ci-evidence.mjs",
    ".github/scripts/release-version.mjs",
    ...names.flatMap((name) => {
      const dir = `packages/${name.split("/")[1]}`;
      return [
        `${dir}/package.json`,
        `${dir}/LICENSE`,
        `${dir}/CHANGELOG.md`,
        `${dir}/src/index.ts`,
        `${dir}/tsconfig.build.json`,
        `${dir}/README.md`,
      ];
    }),
    ...infrastructurePaths,
  ];
  return {
    sha: "c".repeat(40),
    truncated: false,
    tree: paths.map((path) => ({
      path,
      mode: "100644",
      type: "blob",
      sha: hash(Buffer.from(path), "sha1"),
    })),
  };
}
const ancestry = (releaseSha = sha, executionSha = "d".repeat(40)) => ({
  base_commit: { sha: releaseSha },
  merge_base_commit: { sha: releaseSha },
  behind_by: 0,
  status: releaseSha === executionSha ? "identical" : "ahead",
});
test("equal release/execution SHA and protected tree are valid", () => {
  assert.deepEqual(infrastructurePaths, [
    ".github/workflows/release.yml",
    ".github/scripts/release-core.mjs",
    ".github/scripts/release.mjs",
    ".github/scripts/release-planning.mjs",
    ".github/scripts/release.test.mjs",
    "docs/runbooks/packages.md",
  ]);
  validateContext(context(), true);
  validateAncestry(ancestry(sha, sha), sha, sha);
  const tree = inputTree();
  assert.equal(
    validateProtectedInputs(tree, tree),
    digest(protectedInputs(tree)),
  );
});
test("descendant executor may change exactly the six regular infrastructure files", () => {
  const original = inputTree(),
    execution = structuredClone(original);
  execution.tree.push({
    path: ".github",
    type: "tree",
    mode: "040000",
    sha: "f".repeat(40),
  });
  for (const file of execution.tree)
    if (infrastructurePaths.includes(file.path)) file.sha = "d".repeat(40);
  execution.tree.reverse();
  validateAncestry(ancestry(), sha, "d".repeat(40));
  assert.equal(
    validateProtectedInputs(original, execution),
    digest(protectedInputs(original)),
  );
});
test("all protected entries including manifests/source/build/lock/config reject byte changes", () => {
  const original = inputTree();
  for (const path of protectedInputs(original).map((entry) => entry.path)) {
    const execution = structuredClone(original);
    execution.tree.find((file) => file.path === path).sha = "f".repeat(40);
    assert.throws(
      () => validateProtectedInputs(original, execution),
      undefined,
      path,
    );
  }
});
for (const [label, mutate] of [
  [
    "addition",
    (tree) =>
      tree.tree.push({
        path: "packages/access/src/new.ts",
        type: "blob",
        mode: "100644",
        sha,
      }),
  ],
  [
    "removal",
    (tree) => {
      tree.tree = tree.tree.filter(
        (file) => file.path !== "packages/access/src/index.ts",
      );
    },
  ],
  [
    "rename",
    (tree) => {
      tree.tree.find(
        (file) => file.path === "packages/access/src/index.ts",
      ).path = "packages/access/src/renamed.ts";
    },
  ],
  [
    "mode",
    (tree) => {
      tree.tree.find(
        (file) => file.path === "packages/access/src/index.ts",
      ).mode = "100755";
    },
  ],
  [
    "symlink",
    (tree) => {
      tree.tree[0].mode = "120000";
    },
  ],
  [
    "gitlink",
    (tree) => {
      tree.tree[0].type = "commit";
      tree.tree[0].mode = "160000";
    },
  ],
  [
    "infrastructure symlink",
    (tree) => {
      tree.tree.find((file) => file.path === infrastructurePaths[1]).mode =
        "120000";
    },
  ],
  [
    "infrastructure directory",
    (tree) => {
      const file = tree.tree.find(
        (file) => file.path === infrastructurePaths[1],
      );
      file.mode = "040000";
      file.type = "tree";
    },
  ],
  [
    "directory exception expansion",
    (tree) =>
      tree.tree.push({
        path: ".github/scripts/other.mjs",
        type: "blob",
        mode: "100644",
        sha,
      }),
  ],
  [
    "workflow exception expansion",
    (tree) =>
      tree.tree.push({
        path: ".github/workflows/other.yml",
        type: "blob",
        mode: "100644",
        sha,
      }),
  ],
  [
    "truncated API tree",
    (tree) => {
      tree.truncated = true;
    },
  ],
  [
    "empty API tree",
    (tree) => {
      tree.tree = [];
    },
  ],
  [
    "missing object ID",
    (tree) => {
      delete tree.tree[0].sha;
    },
  ],
  ["duplicate path", (tree) => tree.tree.push({ ...tree.tree[0] })],
])
  invalid(`protected-input projection rejects ${label}`, () => {
    const tree = inputTree();
    mutate(tree);
    validateProtectedInputs(inputTree(), tree);
  });
for (const [label, mutate] of [
  [
    "wrong merge base",
    (comparison) => {
      comparison.merge_base_commit.sha = "b".repeat(40);
    },
  ],
  [
    "wrong requested base",
    (comparison) => {
      comparison.base_commit.sha = "b".repeat(40);
    },
  ],
  [
    "diverged",
    (comparison) => {
      comparison.status = "diverged";
    },
  ],
  [
    "behind",
    (comparison) => {
      comparison.behind_by = 1;
    },
  ],
  [
    "incomplete API",
    (comparison) => {
      delete comparison.merge_base_commit;
    },
  ],
])
  invalid(`release ancestry rejects ${label}`, () => {
    const comparison = ancestry();
    mutate(comparison);
    validateAncestry(comparison, sha, "d".repeat(40));
  });
test("real binding loader uses immutable commit/tree API identities", async () => {
  const executionSha = "d".repeat(40),
    original = inputTree(),
    execution = structuredClone(original);
  execution.sha = "e".repeat(40);
  execution.tree.find((file) => file.path === infrastructurePaths[1]).sha =
    "f".repeat(40);
  const routes = new Map([
    [`/compare/${sha}...${executionSha}`, ancestry()],
    [`/git/commits/${sha}`, { sha, tree: { sha: original.sha } }],
    [
      `/git/commits/${executionSha}`,
      { sha: executionSha, tree: { sha: execution.sha } },
    ],
    [`/git/trees/${original.sha}?recursive=1`, original],
    [`/git/trees/${execution.sha}?recursive=1`, execution],
  ]);
  const binding = await contentBinding(sha, executionSha, async (url) => {
    const key = url.replace(
      "https://api.github.com/repos/t00ls-dev/foundation",
      "",
    );
    assert(routes.has(key), key);
    return routes.get(key);
  });
  assert.equal(
    binding.protectedInputsDigest,
    digest(protectedInputs(original)),
  );
  await assert.rejects(
    treeAtCommit(sha, async () => ({ sha: executionSha })),
    /commit lookup mismatch/,
  );
  await assert.rejects(
    treeAtCommit(sha, async (url) =>
      url.includes("/commits/")
        ? { sha, tree: { sha: original.sha } }
        : { ...original, sha: execution.sha },
    ),
    /tree lookup mismatch/,
  );
  await assert.rejects(
    contentBinding(sha, executionSha, async () => {
      throw new Error("API unavailable");
    }),
  );
});
test("repository fixture with MIT inputs preserves the #27 permitted delta", () => {
  const tree = {
    sha: execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
      encoding: "utf8",
    }).trim(),
    truncated: false,
    tree: execFileSync("git", ["ls-tree", "-r", "-z", "HEAD"], {
      encoding: "utf8",
    })
      .split("\0")
      .filter(Boolean)
      .map((line) => {
        const split = line.indexOf("\t");
        const [mode, type, sha] = line.slice(0, split).split(" ");
        return { path: line.slice(split + 1), mode, type, sha };
      }),
  };
  for (const path of [
    "LICENSE",
    ...names.map((name) => `packages/${name.split("/")[1]}/LICENSE`),
  ]) {
    if (!tree.tree.some((entry) => entry.path === path))
      tree.tree.push({
        path,
        mode: "100644",
        type: "blob",
        sha: hash(readFileSync(path), "sha1"),
      });
  }
  const execution = structuredClone(tree);
  for (const path of [
    ".github/scripts/release-core.mjs",
    ".github/scripts/release.mjs",
    ".github/scripts/release.test.mjs",
    "docs/runbooks/packages.md",
  ])
    execution.tree.find((file) => file.path === path).sha = "f".repeat(40);
  assert.equal(
    validateProtectedInputs(tree, execution),
    digest(protectedInputs(tree)),
  );
});
test("release PR binds content SHA while context binds current executor SHA", () => {
  const c = {
    ...context(),
    executionSha: "d".repeat(40),
    sha: "d".repeat(40),
    masterSha: "d".repeat(40),
  };
  validateContext(c, true);
  validatePr(pr(), c, record());
  assert.throws(
    () => validatePr(pr(), { ...c, releaseSha: "c".repeat(40) }, record()),
    /release_sha/,
  );
  assert.throws(
    () => validateContext({ ...c, masterSha: "f".repeat(40) }, true),
    /master moved/,
  );
  assert.throws(() =>
    validateContext({ ...c, ref: "refs/heads/feature" }, true),
  );
});
for (const [label, values] of [
  ["old internal field", { expectedSha: sha }],
  ["old input", { expected_sha: sha }],
  ["old env/event input", { legacyExpectedSha: sha }],
])
  invalid(`legacy expected_sha rejected clearly: ${label}`, () =>
    validateContext({ ...context(), ...values }),
  );
test("resume binds both SHAs and original protected inputs/artifacts", () => {
  const p = packet(),
    c = {
      ...context(),
      mode: "resume",
      executionSha: "d".repeat(40),
      sha: "d".repeat(40),
      masterSha: "d".repeat(40),
    };
  p.executionSha = c.executionSha;
  p.snapshotSha = c.executionSha;
  c.planDigest = envelopeDigest(p);
  validateContext(c, true);
  validatePacket(p, c, record());
  for (const mutate of [
    (p) => {
      p.releaseSha = "f".repeat(40);
    },
    (p) => {
      p.executionSha = "f".repeat(40);
    },
    (p) => {
      p.protectedInputsDigest = "f".repeat(64);
    },
    (p) => {
      p.record.packages[0].version = "0.2.0";
    },
    (p) => {
      p.artifacts[0].hash = "e".repeat(64);
    },
    (p) => {
      p.artifacts[0].integrity = sri("changed");
    },
    (p) => {
      p.auditRun++;
    },
  ]) {
    const changed = structuredClone(p);
    mutate(changed);
    assert.throws(() => validatePacket(changed, c, record()));
  }
  const newExecutor = {
    ...c,
    executionSha: "f".repeat(40),
    sha: "f".repeat(40),
    masterSha: "f".repeat(40),
  };
  validateContext(newExecutor, true);
  assert.throws(
    () => validatePacket(p, newExecutor, record()),
    /execution SHA|Snapshot differs/,
  );
  const changed = structuredClone(p);
  changed.executionSha = newExecutor.executionSha;
  changed.snapshotSha = newExecutor.executionSha;
  assert.notEqual(envelopeDigest(changed), c.planDigest);
  assert.throws(
    () => validatePacket(changed, newExecutor, record()),
    /digest mismatch/,
  );
  assert.throws(
    () => validateContext({ ...c, masterSha: "f".repeat(40) }, true),
    /master moved/,
  );
  assert.throws(
    () => validatePacket({ ...p, format: 1 }, c, record()),
    /Legacy/,
  );
});
test("audit run provenance binds execution SHA, not historical release SHA", () => {
  const c = { ...context(), executionSha: "d".repeat(40) };
  const audit = {
    id: c.auditRun,
    run_attempt: 1,
    event: "workflow_dispatch",
    conclusion: "success",
    head_branch: "master",
    head_sha: c.executionSha,
    workflow_id: 123,
  };
  const jobs = [{ name: "audit", conclusion: "success" }];
  validateAuditRun(audit, jobs, 123, c);
  assert.throws(() =>
    validateAuditRun({ ...audit, head_sha: c.releaseSha }, jobs, 123, c),
  );
  assert.throws(() =>
    validateAuditRun({ ...audit, id: c.auditRun + 1 }, jobs, 123, c),
  );
  assert.throws(() =>
    validateAuditRun(audit, [{ name: "audit", conclusion: "failure" }], 123, c),
  );
});

const sri = (value) => `sha512-${hash(Buffer.from(value), "sha512", "base64")}`;
const packument = (
  name = names[0],
  versions = ["0.1.0"],
  latest = versions.at(-1),
) => ({
  name,
  "dist-tags": { latest },
  "versions": Object.fromEntries(
    versions.map((version) => [
      version,
      {
        name,
        version,
        dist: {
          integrity: sri(`${name}@${version}`),
          tarball: `${officialRegistry}/${name}/-/${name.split("/")[1]}-${version}.tgz`,
        },
      },
    ]),
  ),
});

// Public metadata collected 2026-10-15. Email and signature values are synthetic;
// the nine identities, distribution hashes and sizes are the observed values.
const observedStages = [
  [
    "access",
    "sha512-C1kObSGOdTFnaxpe1UQpmiViTeuzcorWxMUZjTLD4+n2FnpNXhvWenTlGz/sNdC8Of4mEdlhijAeissgejaRCA==",
    "83a9bb9f1af89e147ac8e0c1353f7155bb85fed0",
    339,
  ],
  [
    "audit",
    "sha512-XiZAFUpUTBSwjq2IbsB5GF1ppSlX+jvW6vJii4dR4RsY/VClqcmmQjs+50HFNjdi+V7AMC5dYIGXUnpS4TVH4A==",
    "b2a9b3ff501f7c26a67287fd40410e5e36bce26b",
    338,
  ],
  [
    "auth",
    "sha512-vygCBOpuYq3EUlPkhKFR+9EKBf4l9zQpUikfH9XzdeIuOF/8Fz86RCLX2QX4yJUJdrxA0lIqXa2pC/mROJ6y/g==",
    "8cbd3d382b729a8c584aa186c3144b50419e913b",
    337,
  ],
  [
    "config",
    "sha512-aU2xBT5D5wLZPfVuKX3RqHMz7leYi9N0jVHIFhBVUclUUuy2o7FEzrqkuYYSvSb15FUJu9x+zG3iQGMwcw7SxA==",
    "8b51ac8446655fbc763c93e9c0487581004999d1",
    339,
  ],
  [
    "db",
    "sha512-XKSaLkxO4IBG3i7YP3MbVSJRLJ3T14eDJfvPxxAkS3V9BfK8+plrNqZb4cvbmXYdK33obyOdngMpRA02wETB1w==",
    "6a92b8c55d17869abd79ade7695f171ef8364b1b",
    335,
  ],
  [
    "email",
    "sha512-UBE8gtZYXWha+X15EyHS5sS5B7rjERSJVoGfPmdgOOCC+MlAh5f4PCpo81Vbs5s9IAeaO4KllcVcfv9vNWCfuQ==",
    "ef8bc44c0403894bdb569c7fc25be8cbead951fb",
    338,
  ],
  [
    "observability",
    "sha512-8QtoXDdsheMVevFPzE5aoSBeFYAURYoylC+8o0oJahjNNA8oVUThePvgmTN8zYYzzkykOcvmvFd+ZLwp64sSsg==",
    "6030c12edd95850c0be045eda3043dde37836b86",
    346,
  ],
  [
    "security",
    "sha512-eteEVbapQoGxfntpLOgxF38dxUgFO1GuhUpnqJ7GjgwQdHg4xpU2r4LQYTGLo3MnaQ0PBQuX/wim27dERrpERg==",
    "fbfb48de86ce05770ee2b102b4ff5b053288999a",
    341,
  ],
  [
    "tenant",
    "sha512-LkZd92YYDBh235RzDU0ileAuMFgEvpqWtwPTbQGLF6TrPIUvOjVU8olu0xHA33hozjLOYzuftims6rQQ+rUiUA==",
    "64d4b41bd442a99f57c65a32e5e116e377233450",
    339,
  ],
];
const stagePackument = (name = names[0], versions = ["0.1.2"]) => {
  const [, integrity, shasum, unpackedSize] = observedStages.find(
    ([short]) => name === `@t00ls-dev/${short}`,
  );
  const result = packument(name, versions);
  result.versions["0.0.0-stage"] = {
    name,
    version: "0.0.0-stage",
    _id: `${name}@0.0.0-stage`,
    stub: true,
    maintainers: [{ name: "t00ls-dev", email: "fixture@example.invalid" }],
    dist: {
      shasum,
      tarball: `${officialRegistry}/${name}/-/${name.split("/")[1]}-0.0.0-stage.tgz`,
      fileCount: 2,
      integrity,
      signatures: [{ sig: "Zml4dHVyZQ==", keyid: "SHA256:Zml4dHVyZQ==" }],
      unpackedSize,
    },
    _npmUser: { name: "t00ls-dev", email: "fixture@example.invalid" },
    description: "Temporary package placeholder for staged publishing",
    directories: {},
  };
  return result;
};

for (const [short, integrity] of observedStages)
  test(`observed ${short} placeholder is retained separately, never a stable version`, () => {
    const name = `@t00ls-dev/${short}`;
    const version = ["auth", "security"].includes(short) ? "0.2.0" : "0.1.2";
    const result = validatePackument(stagePackument(name, [version]), name);
    assert.deepEqual(result.versions, [version]);
    assert.equal(result.latest, version);
    assert.deepEqual(result.placeholders, [
      {
        version: "0.0.0-stage",
        integrity,
        tarball: `${officialRegistry}/${name}/-/${short}-0.0.0-stage.tgz`,
      },
    ]);
    assert(!("0.0.0-stage" in result.integrities));
  });

for (const [label, mutate] of [
  ["name", (p) => (p.name = names[1])],
  ["version", (p) => (p.version = "0.0.1")],
  ["id", (p) => (p._id = `${names[1]}@0.0.0-stage`)],
  ["marker", (p) => (p.stub = false)],
  ["description", (p) => (p.description = "not a holding version")],
  ["publisher", (p) => (p._npmUser.name = "other")],
  ["maintainer", (p) => (p.maintainers = [])],
  ["directories", (p) => (p.directories = { lib: "dist" })],
  ["script", (p) => (p.scripts = { install: "unexpected" })],
  ["main", (p) => (p.main = "index.js")],
  ["dependencies", (p) => (p.dependencies = { unexpected: "*" })],
  ["unknown integrity", (p) => (p.dist.integrity = sri("other bytes"))],
  ["other package integrity", (p) => (p.dist.integrity = observedStages[1][1])],
  ["shasum", (p) => (p.dist.shasum = "0".repeat(40))],
  ["file count", (p) => (p.dist.fileCount = 3)],
  ["unpacked size", (p) => p.dist.unpackedSize++],
  ["tarball", (p) => (p.dist.tarball += "?override=1")],
  [
    "signature shape",
    (p) => (p.dist.signatures = [{ sig: "bad!", keyid: "x" }]),
  ],
  ["signature type", (p) => (p.dist.signatures[0].sig = null)],
])
  test(`staging placeholder rejects inconsistent ${label}`, () => {
    const p = stagePackument();
    mutate(p.versions["0.0.0-stage"]);
    assert.throws(() => validatePackument(p, names[0]));
  });

test("placeholder cannot be latest or authorize a prerelease or stable stub", () => {
  const latest = stagePackument();
  latest["dist-tags"].latest = "0.0.0-stage";
  assert.throws(() => validatePackument(latest, names[0]), /latest/);
  const arbitrary = stagePackument();
  arbitrary.versions["0.0.0-other"] = arbitrary.versions["0.0.0-stage"];
  assert.throws(() => validatePackument(arbitrary, names[0]), /stable SemVer/);
  const stable = stagePackument();
  stable.versions["0.1.2"].stub = true;
  assert.throws(
    () => validatePackument(stable, names[0]),
    /cannot be a placeholder/,
  );
});

const publishedBootstrap = () => {
  const r = bootstrapRecord();
  const state = Object.fromEntries(
    r.packages.map((p) => [
      p.name,
      validatePackument(stagePackument(p.name, [p.version]), p.name),
    ]),
  );
  const a = r.packages.map((p) => ({
    name: p.name,
    integrity: state[p.name].integrities[p.version],
  }));
  return { r, state, a, c: bootstrapContext() };
};

test("bootstrap reconciles nine targets plus known placeholders, without authorizing reupload", () => {
  const { r, state, a, c } = publishedBootstrap();
  const states = reconcile(r, state, a, c);
  assert(
    states.every((p) => p.state === "published" && p.placeholders.length === 1),
  );
  assert.deepEqual(remainingPlan(r, states, "resume"), []);
  assert.throws(() => remainingPlan(r, states, "publish"), /explicit resume/);
  const next = record();
  next.packages[0] = {
    ...next.packages[0],
    oldVersion: "0.1.2",
    version: "0.1.3",
  };
  assert.equal(reconcile(next, state)[0].state, "absent");
  next.packages[0].oldVersion = "0.0.0-stage";
  assert.throws(() => reconcile(next, state));
});

test("known placeholders never hide target divergence or unexpected versions", () => {
  for (const mutate of [
    (state, r) =>
      (state[names[0]].integrities[r.packages[0].version] = sri("changed")),
    (state) => (state[names[0]].latest = "0.0.0-stage"),
    (state) => state[names[0]].versions.push("9.0.0"),
    (state) => state[names[0]].versions.push("0.1.1"),
    (state) => state[names[0]].versions.push("0.2.0-beta.1"),
    (state) => (state[names[0]].placeholders[0].integrity = sri("changed")),
  ]) {
    const { r, state, a, c } = publishedBootstrap();
    mutate(state, r);
    assert.throws(() => remainingPlan(r, reconcile(r, state, a, c), "resume"));
  }
});

function observationHarness({
  missingRounds = 1,
  distribution = "bootstrap",
  retryAbsent = true,
} = {}) {
  const { r, state, a, c } = publishedBootstrap();
  if (distribution === "release") {
    r.packages = [{ ...r.packages[0], oldVersion: "0.1.2", version: "0.1.3" }];
    a[0].integrity = sri(`${names[0]}@0.1.3`);
  }
  let clock = 0;
  let reads = 0;
  const sleeps = [];
  const fetcher = async (url, options) => {
    assert.equal(options.method ?? "GET", "GET");
    assert.equal(options.body, undefined);
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(
      options.headers["Cache-Control"],
      retryAbsent ? "no-cache" : undefined,
    );
    assert.equal(options.cache, retryAbsent ? "no-store" : undefined);
    assert.equal(options.redirect, "error");
    assert(options.signal instanceof AbortSignal);
    const round = Math.floor(reads++ / names.length);
    if (distribution === "bootstrap" && round < missingRounds)
      return { status: 404, json: async () => ({ error: "Not found" }) };
    const name = decodeURIComponent(new URL(url).pathname.slice(1));
    const versions =
      distribution === "release" && name === names[0]
        ? round < missingRounds
          ? ["0.1.2"]
          : ["0.1.2", "0.1.3"]
        : state[name].versions;
    return {
      ok: true,
      status: 200,
      json: async () => stagePackument(name, versions),
    };
  };
  return {
    r,
    a,
    c: { ...c, distribution },
    options: {
      retryAbsent,
      fetcher,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    },
    sleeps,
    reads: () => reads,
    advance: (ms) => (clock += ms),
  };
}

for (const distribution of ["bootstrap", "release"])
  test(`${distribution} observes transient absence then confirms, GET-only`, async () => {
    const h = observationHarness({ distribution });
    const result = await observePublication(h.r, h.a, h.c, h.options);
    assert(result.states.every((p) => p.state === "published"));
    assert.equal(result.observation.attempts, 2);
    assert.equal(result.observation.exhausted, false);
    assert.equal(h.reads(), 18);
    assert.deepEqual(h.sleeps, [30000]);
  });

test("persistent absence stops at the attempt limit, never success", async () => {
  const h = observationHarness({ missingRounds: Infinity });
  const result = await observePublication(h.r, h.a, h.c, h.options);
  assert(result.states.every((p) => p.state === "absent"));
  assert.equal(result.observation.exhausted, true);
  assert.equal(
    result.observation.attempts,
    publicationObservationLimits.maxAttempts,
  );
  assert.equal(h.sleeps.length, publicationObservationLimits.maxAttempts - 1);
  assert.equal(
    h.reads(),
    publicationObservationLimits.maxAttempts * names.length,
  );
});

test("duration limit includes reads; late publication is not accepted", async () => {
  const h = observationHarness({ missingRounds: Infinity });
  const fetcher = h.options.fetcher;
  h.options.fetcher = async (...args) => {
    h.advance(10000);
    return fetcher(...args);
  };
  const exhausted = await observePublication(h.r, h.a, h.c, h.options);
  assert.equal(exhausted.observation.exhausted, true);
  assert(exhausted.states.every((p) => p.state === "absent"));
  assert(h.reads() < publicationObservationLimits.maxAttempts * names.length);
  const late = observationHarness({ missingRounds: 0 });
  const accepted = late.options.fetcher;
  late.options.fetcher = async (...args) => {
    late.advance(publicationObservationLimits.maxDurationMs);
    return accepted(...args);
  };
  await assert.rejects(
    observePublication(late.r, late.a, late.c, late.options),
    /deadline/,
  );
});

test("sleep cannot cause another read beyond the observation duration", async () => {
  const h = observationHarness({ missingRounds: Infinity });
  h.options.sleep = async () =>
    h.advance(publicationObservationLimits.maxDurationMs);
  const result = await observePublication(h.r, h.a, h.c, h.options);
  assert.equal(result.observation.attempts, 1);
  assert.equal(result.observation.exhausted, true);
  assert(result.states.every((p) => p.state === "absent"));
});

test("unaccepted uploads and already-complete observations never poll", async () => {
  for (const retryAbsent of [false, true]) {
    const h = observationHarness({
      missingRounds: retryAbsent ? 0 : Infinity,
      retryAbsent,
    });
    const result = await observePublication(h.r, h.a, h.c, h.options);
    assert.equal(result.observation.attempts, 1);
    assert.deepEqual(h.sleeps, []);
  }
});

test("concrete target divergence stops observation immediately", async () => {
  const h = observationHarness({ missingRounds: 0 });
  h.a[0].integrity = sri("not approved");
  const result = await observePublication(h.r, h.a, h.c, h.options);
  assert.equal(result.states[0].state, "divergent");
  assert.equal(result.observation.attempts, 1);
  assert.deepEqual(h.sleeps, []);
});

for (const status of [401, 403, 404, 429, 500, 503, 206])
  test(`observation fails closed without retry on HTTP ${status}`, async () => {
    const h = observationHarness({ distribution: "release" });
    let calls = 0;
    h.options.fetcher = async () => {
      calls++;
      return { status, ok: false };
    };
    await assert.rejects(
      observePublication(h.r, h.a, h.c, h.options),
      /Registry request failed/,
    );
    assert.equal(calls, 1);
    assert.deepEqual(h.sleeps, []);
  });

test("observation never treats network, malformed JSON or ambiguous 404 as absence", async () => {
  for (const response of [
    async () => {
      throw new Error("network unavailable");
    },
    async () => {
      throw new DOMException("timeout", "TimeoutError");
    },
    async () => ({
      status: 404,
      json: async () => ({ error: "unauthorized" }),
    }),
    async () => ({
      status: 200,
      ok: true,
      json: async () => {
        throw new SyntaxError("JSON");
      },
    }),
    async () => ({ status: 200, ok: true, json: async () => ({}) }),
  ]) {
    const h = observationHarness();
    await assert.rejects(
      observePublication(h.r, h.a, h.c, { ...h.options, fetcher: response }),
    );
    assert.deepEqual(h.sleeps, []);
  }
});

test("actual publisher uploads once; polling only observes and preserves final authority gates", async () => {
  const source = readFileSync(".github/scripts/release.mjs", "utf8");
  const start = source.indexOf("async function publish(directory)");
  const publisher = source.slice(start, source.indexOf("\ntry {", start));
  for (const { exitCode, missingRounds, authorityFailure } of [
    { exitCode: 0, missingRounds: 1 },
    { exitCode: 0, missingRounds: Infinity },
    { exitCode: 1, missingRounds: Infinity },
    { exitCode: 0, missingRounds: 1, authorityFailure: true },
  ]) {
    const h = observationHarness({
      missingRounds,
      retryAbsent: exitCode === 0,
    });
    let uploads = 0;
    let authorityChecks = 0;
    const writes = new Map();
    const publish = runInNewContext(`${publisher}; publish`, {
      assert,
      join,
      resolve,
      context: async () => {
        authorityChecks++;
        if (authorityFailure && authorityChecks === 3)
          throw new Error("authority changed");
        return { ...h.c, mode: "publish" };
      },
      prepare: async () => ({
        value: { ...h.c, mode: "publish" },
        record: h.r,
        packet: { artifacts: h.a },
      }),
      inventory: () =>
        registryInventory("bootstrap", async () => ({
          status: 404,
          json: async () => ({ error: "Not found" }),
        })),
      unchangedPackages: () => {},
      remainingPlan,
      reconcile,
      changesetsPlan: () => ({ plan: {} }),
      packPlan: () => ({}),
      sourceGates: () => {},
      validatePublisherEnvironment: () => {},
      validateNpmConfiguration: () => {},
      loadNpmConfiguration: async () => ({}),
      require: () => ({ version: npmVersion }),
      process: { env: {} },
      registry: officialRegistry,
      spawnSync: () => {
        uploads++;
        return { status: exitCode };
      },
      write: (path, value) => writes.set(path, value),
      summarize: () => {},
      observePublication: (r, a, c, options) =>
        observePublication(r, a, c, { ...h.options, ...options }),
    });
    if (exitCode === 0 && missingRounds === 1 && !authorityFailure)
      await publish("/synthetic-release");
    else
      await assert.rejects(
        publish("/synthetic-release"),
        /Partial\/failed|authority changed/,
      );
    assert.equal(uploads, 1);
    assert.equal(authorityChecks, 3);
    const result = writes.get("/synthetic-release/reconciliation.json");
    assert.equal(result.exitCode, exitCode);
    if (authorityFailure) {
      assert(result.states.every((p) => p.state === "divergent"));
      assert.equal(result.error, "authority changed");
    } else {
      assert.equal(
        result.observation.attempts,
        exitCode !== 0
          ? 1
          : missingRounds === 1
            ? 2
            : publicationObservationLimits.maxAttempts,
      );
      assert(
        result.states.every(
          (p) => p.state === (missingRounds === 1 ? "published" : "absent"),
        ),
      );
    }
  }
});

test("valid packument yields only observed registry facts, no administrative claims", () => {
  const result = validatePackument(packument(), names[0]);
  assert.deepEqual(result, {
    name: names[0],
    versions: ["0.1.0"],
    latest: "0.1.0",
    integrities: { "0.1.0": sri(`${names[0]}@0.1.0`) },
  });
  assert(
    !("visibility" in result) &&
      !("repositoryAssociation" in result) &&
      !("repository" in result),
  );
});
test("real inventory reads all nine npm packuments without credentials", async () => {
  const urls = [];
  const result = await registryInventory("release", async (url, options) => {
    urls.push(url);
    assert.equal(new URL(url).origin, officialRegistry);
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.headers.Accept, "application/json");
    assert.equal(options.redirect, "error");
    assert(options.signal instanceof AbortSignal);
    const name = decodeURIComponent(new URL(url).pathname.slice(1));
    return { ok: true, status: 200, json: async () => packument(name) };
  });
  assert.deepEqual(
    urls,
    names.map((name) => `${officialRegistry}/${name.replace("/", "%2F")}`),
  );
  assert.deepEqual(Object.keys(result), names);
  assert.equal(reconcile(record(), result)[0].state, "absent");
});
for (const [label, mutate] of [
  [
    "wrong package",
    (p) => {
      p.name = names[1];
    },
  ],
  [
    "wrong namespace",
    (p) => {
      p.name = "@other/access";
    },
  ],
  [
    "missing versions",
    (p) => {
      delete p.versions;
    },
  ],
  [
    "empty versions",
    (p) => {
      p.versions = {};
    },
  ],
  [
    "missing dist-tags",
    (p) => {
      delete p["dist-tags"];
    },
  ],
  [
    "invalid latest",
    (p) => {
      p["dist-tags"].latest = "0.1.1";
    },
  ],
  [
    "wrong version package",
    (p) => {
      p.versions["0.1.0"].name = names[1];
    },
  ],
  [
    "wrong version identity",
    (p) => {
      p.versions["0.1.0"].version = "0.1.1";
    },
  ],
  [
    "missing dist",
    (p) => {
      delete p.versions["0.1.0"].dist;
    },
  ],
  [
    "missing integrity",
    (p) => {
      delete p.versions["0.1.0"].dist.integrity;
    },
  ],
  [
    "invalid integrity",
    (p) => {
      p.versions["0.1.0"].dist.integrity = "sha512-short";
    },
  ],
  [
    "missing tarball",
    (p) => {
      delete p.versions["0.1.0"].dist.tarball;
    },
  ],
  [
    "foreign tarball",
    (p) => {
      p.versions["0.1.0"].dist.tarball = "https://example.invalid/fixture.tgz";
    },
  ],
  [
    "wrong tarball package",
    (p) => {
      p.versions["0.1.0"].dist.tarball =
        `https://npm.pkg.github.com/download/${names[1]}/0.1.0/fixture`;
    },
  ],
  [
    "prerelease drift",
    (p) => {
      p.versions["0.2.0-beta.1"] = {};
    },
  ],
])
  invalid(`packument rejects ${label}`, () => {
    const p = packument();
    mutate(p);
    validatePackument(p, names[0]);
  });
for (const status of [401, 403, 404, 500, 503, 206])
  test(`inventory fails closed on HTTP ${status}, never onboards on 404`, async () => {
    await assert.rejects(
      registryInventory("release", async () => ({
        ok: status < 300,
        status,
        json: async () => packument(),
      })),
      /Registry request failed/,
    );
  });
test("inventory rejects network failure, timeout and invalid JSON", async () => {
  for (const failure of [
    new Error("network"),
    new DOMException("timeout", "TimeoutError"),
  ])
    await assert.rejects(
      registryInventory("release", async () => {
        throw failure;
      }),
    );
  await assert.rejects(
    registryInventory("release", async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("invalid JSON");
      },
    })),
  );
});
invalid(
  "registry anchor oldVersion missing is never treated as a new package",
  () =>
    reconcile(record(), {
      [names[0]]: validatePackument(packument(names[0], ["0.1.1"]), names[0]),
    }),
);
for (const mode of ["audit", "publish"])
  invalid(
    `validated packument target already present blocks normal ${mode}`,
    () => {
      const inventory = {
        [names[0]]: validatePackument(
          packument(names[0], ["0.1.0", "0.1.1"]),
          names[0],
        ),
      };
      const artifact = [
        { ...artifacts()[0], integrity: sri(`${names[0]}@0.1.1`) },
      ];
      remainingPlan(record(), reconcile(record(), inventory, artifact), mode);
    },
  );
test("validated packument resume accepts only original artifact integrity", () => {
  const inventory = {
    [names[0]]: validatePackument(
      packument(names[0], ["0.1.0", "0.1.1"]),
      names[0],
    ),
  };
  const artifact = [{ ...artifacts()[0], integrity: sri(`${names[0]}@0.1.1`) }];
  assert.deepEqual(
    remainingPlan(record(), reconcile(record(), inventory, artifact), "resume"),
    [],
  );
  artifact[0].integrity = sri("different bytes");
  assert.throws(
    () =>
      remainingPlan(
        record(),
        reconcile(record(), inventory, artifact),
        "resume",
      ),
    /divergence/,
  );
});

const commit = () => ({
  sha,
  author: { login: "github-actions[bot]" },
  committer: { login: "web-flow" },
  commit: { verification: { verified: true, reason: "valid" } },
  parents: [{ sha: record().baseSha }],
});
test("verified API-generated release commit matches PR head and single base parent", () =>
  validateReleaseCommit([commit()], pr(), record()));
for (const [label, change] of [
  [
    "head SHA",
    (c) => {
      c.sha = "c".repeat(40);
    },
  ],
  [
    "parent",
    (c) => {
      c.parents[0].sha = "c".repeat(40);
    },
  ],
  [
    "extra parent",
    (c) => {
      c.parents.push({ sha });
    },
  ],
  [
    "unsigned",
    (c) => {
      c.commit.verification.verified = false;
    },
  ],
  [
    "invalid signature",
    (c) => {
      c.commit.verification.reason = "invalid";
    },
  ],
  [
    "missing signature evidence",
    (c) => {
      delete c.commit.verification;
    },
  ],
  [
    "human committer with bot author",
    (c) => {
      c.committer.login = "human";
    },
  ],
])
  invalid(`release commit rejects ${label}`, () => {
    const c = commit();
    change(c);
    validateReleaseCommit([c], pr(), record());
  });

function baseSnapshot(overrides = {}) {
  const files = new Map([
    [
      "package.json",
      Buffer.from(
        JSON.stringify({
          name: "@t00ls-dev/release-fixture",
          version: "0.1.0",
          private: true,
          packageManager: "pnpm@10.15.1",
        }),
      ),
    ],
    ["pnpm-workspace.yaml", readFileSync("pnpm-workspace.yaml")],
    [".changeset/config.json", readFileSync(".changeset/config.json")],
    [
      ".changeset/fix-package-distribution.md",
      Buffer.from(
        `---\n${names.map((name) => `"${name}": patch`).join("\n")}\n---\nFixture: original nine-package patch release.\n`,
      ),
    ],
    ...names.map((name) => {
      const path = `packages/${name.split("/")[1]}/package.json`;
      return [path, Buffer.from(JSON.stringify({ name, version: "0.1.0" }))];
    }),
  ]);
  for (const [path, bytes] of Object.entries(overrides))
    files.set(path, Buffer.from(bytes));
  return {
    baseSha: record().baseSha,
    cliVersion: "3.0.3",
    tree: {
      truncated: false,
      tree: [...files.keys()].map((path) => ({
        path,
        type: "blob",
        mode: "100644",
      })),
    },
    content: async (path, ref) => {
      assert.equal(ref, record().baseSha);
      assert(files.has(path));
      return files.get(path);
    },
  };
}
test("independent planning uses original nine-package PATCH changeset and accepts correct record", async () => {
  const expected = await recordFromBase(baseSnapshot());
  assert.equal(expected.packages.length, 9);
  assert(
    expected.packages.every(
      (pkg) =>
        pkg.oldVersion === "0.1.0" &&
        pkg.version === "0.1.1" &&
        pkg.type === "patch",
    ),
  );
  validateRecordPlan(structuredClone(expected), expected);
});
test("planning recalculates legacy bases and discovers private apps without changing the npm record", async () => {
  const current = await recordFromBase(baseSnapshot());
  const legacy = await recordFromBase(
    baseSnapshot({
      "pnpm-workspace.yaml":
        "packages:\n  - packages/*\n  - tooling/*\n  - examples/*\n  - tests/*\n",
    }),
  );
  assert.deepEqual(legacy, current);
  const withApp = await recordFromBase(
    baseSnapshot({
      "apps/pilot/package.json": JSON.stringify({
        name: "pilot",
        version: "0.1.0",
        private: true,
      }),
    }),
  );
  assert.deepEqual(withApp, current);
});
test("regression: correct PATCH hash and bot author/parent cannot authorize access-only major", async () => {
  const expected = await recordFromBase(baseSnapshot());
  const forged = structuredClone(expected);
  forged.packages = [
    { ...forged.packages[0], type: "major", version: "1.0.0" },
  ];
  assert.equal(forged.changesets[0].hash, expected.changesets[0].hash);
  const unsigned = commit();
  unsigned.commit.verification.verified = false;
  assert.throws(() => validateReleaseCommit([unsigned], pr(), forged));
  // Even a verified commit cannot replace Changesets' independent derivation.
  validateReleaseCommit([commit()], pr(), forged);
  assert.throws(
    () => validateRecordPlan(forged, expected),
    /independently recalculated/,
  );
});
test("independent plan comparison rejects changed/omitted/extra packages, versions, bumps and changesets", async () => {
  const expected = await recordFromBase(baseSnapshot());
  for (const mutate of [
    (r) => {
      r.packages.pop();
    },
    (r) => {
      r.packages.push({ ...r.packages[0] });
    },
    (r) => {
      r.packages[0].name = "@t00ls-dev/unexpected";
    },
    (r) => {
      r.packages[0].oldVersion = "0.0.0";
      r.packages[0].type = "minor";
      r.packages[0].version = "0.1.0";
    },
    (r) => {
      r.packages[0].type = "minor";
      r.packages[0].version = "0.2.0";
    },
    (r) => {
      r.changesets[0].id = "different";
      r.packages.forEach((p) => {
        p.changesets = ["different"];
      });
    },
  ]) {
    const changed = structuredClone(expected);
    mutate(changed);
    assert.throws(() => validateRecordPlan(changed, expected));
  }
});
test("real Changesets planning derives internal dependency bump and rejects divergent derived record", async () => {
  const audit = {
    name: names[1],
    version: "0.1.0",
    dependencies: { [names[0]]: "workspace:^0.1.0" },
  };
  const expected = await recordFromBase(
    baseSnapshot({
      "packages/audit/package.json": JSON.stringify(audit),
      ".changeset/fix-package-distribution.md": `---\n"${names[0]}": minor\n---\nFixture dependency propagation.\n`,
    }),
  );
  const derived = expected.packages.find((pkg) => pkg.name === names[1]);
  assert.equal(derived.reason, "internal-dependency");
  assert.equal(derived.version, "0.1.1");
  assert.deepEqual(derived.dependencies, [names[0]]);
  validateRecordPlan(expected, expected);
  const changed = structuredClone(expected);
  changed.packages.find((pkg) => pkg.name === names[1]).version = "0.2.0";
  changed.packages.find((pkg) => pkg.name === names[1]).type = "minor";
  assert.throws(() => validateRecordPlan(changed, expected));
});
test("planning base fails closed on truncated tree, links and missing inputs", async () => {
  for (const mutate of [
    (s) => {
      s.tree.truncated = true;
    },
    (s) => {
      s.tree.tree[0].mode = "120000";
    },
    (s) => {
      s.tree.tree = s.tree.tree.filter(
        (file) => file.path !== ".changeset/config.json",
      );
    },
  ]) {
    const snapshot = baseSnapshot();
    mutate(snapshot);
    await assert.rejects(recordFromBase(snapshot));
  }
});

for (const [label, path] of [
  ["wrong version", "packages/t00ls-dev-access-0.1.2.tgz"],
  ["wrong package", "packages/t00ls-dev-audit-0.1.1.tgz"],
  ["traversal", "packages/../t00ls-dev-access-0.1.1.tgz"],
  ["absolute path", "/packages/t00ls-dev-access-0.1.1.tgz"],
  ["subdirectory", "packages/extra/t00ls-dev-access-0.1.1.tgz"],
  ["wrong extension", "packages/t00ls-dev-access-0.1.1.tar"],
  ["arbitrary filename", "packages/access.tgz"],
])
  invalid(`audit and preflight artifact rule rejects ${label}`, () => {
    const p = packet();
    p.artifacts[0].path = path;
    assert.throws(() => validateArtifactPath(p.artifacts[0]));
    validatePacket(
      p,
      { ...context(), planDigest: envelopeDigest(p) },
      record(),
    );
  });
invalid("unexpected extra artifact rejected even with matching digest", () => {
  const p = packet();
  p.artifacts.push({
    ...p.artifacts[0],
    name: names[1],
    path: "packages/t00ls-dev-audit-0.1.1.tgz",
  });
  validatePacket(p, { ...context(), planDigest: envelopeDigest(p) }, record());
});

test("record generation from Changesets status is deterministic, without versioning", () => {
  const status = {
    changesets: [{ id: "patch-access" }],
    releases: [
      {
        name: names[0],
        type: "patch",
        oldVersion: "0.1.0",
        newVersion: "0.1.1",
        changesets: ["patch-access"],
      },
      {
        name: names[1],
        type: "patch",
        oldVersion: "0.1.0",
        newVersion: "0.1.1",
        changesets: [],
      },
      { name: "@t00ls-dev/integration-tests", type: "none" },
    ],
  };
  const input = {
    baseSha: sha,
    cliVersion: "3.0.3",
    changesetBytes: () => Buffer.from("fixture changeset"),
    manifestByName: (name) => ({
      version: "0.1.0",
      dependencies: name === names[1] ? { [names[0]]: "workspace:*" } : {},
    }),
  };
  const first = recordFromStatus(status, input);
  assert.equal(first.packages.length, 2);
  assert.equal(first.packages[1].reason, "internal-dependency");
  assert.equal(
    first.changesets[0].hash,
    hash(Buffer.from("fixture changeset")),
  );
  assert.deepEqual(
    recordFromStatus(
      { ...status, releases: [...status.releases].reverse() },
      input,
    ),
    first,
  );
});

test("valid manual authorization and stable deterministic digest", () => {
  validateContext(context(), true);
  validatePr(pr(), context(), record());
  assert.equal(digest({ b: 2, a: 1 }), digest({ a: 1, b: 2 }));
  const p = packet(),
    c = context();
  c.planDigest = envelopeDigest(p);
  validatePacket(p, c, record());
});
for (const [field, value] of [
  ["event", "push"],
  ["event", "pull_request"],
  ["ref", "refs/heads/feature"],
  ["sha", "c".repeat(40)],
  ["masterSha", "c".repeat(40)],
  ["releaseSha", "short"],
  ["executionSha", "short"],
  ["confirmation", "wrong"],
  ["mode", "automatic"],
  ["auditRun", 0],
])
  invalid(`reject context ${field}=${value}`, () =>
    validateContext({ ...context(), [field]: value }, true),
  );
invalid("PR missing", () => validatePr(null, context(), record()));
invalid("PR nonexistent/different", () =>
  validatePr({ ...pr(), number: 26 }, context(), record()),
);
invalid("PR not merged", () =>
  validatePr({ ...pr(), merged: false }, context(), record()),
);
invalid("wrong PR base", () => {
  const p = pr();
  p.base.ref = "feature";
  validatePr(p, context(), record());
});
invalid("wrong merge SHA", () =>
  validatePr(
    { ...pr(), merge_commit_sha: "c".repeat(40) },
    context(),
    record(),
  ),
);
invalid("unexpected package", () => {
  const r = record();
  r.packages[0].name = "@t00ls-dev/unexpected";
  validateRecord(r);
});
invalid("private tooling in plan", () => {
  const r = record();
  r.packages[0].name = "@t00ls-dev/typescript-config";
  validateRecord(r);
});
invalid("version not authorized by bump", () => {
  const r = record();
  r.packages[0].version = "0.2.0";
  validateRecord(r);
});
invalid("unexplained derived bump", () => {
  const r = record();
  r.packages[0].reason = "internal-dependency";
  r.packages[0].changesets = [];
  validateRecord(r);
});
test("valid internal dependency propagation", () => {
  const r = record();
  r.packages.push({
    ...r.packages[0],
    name: names[1],
    reason: "internal-dependency",
    changesets: [],
    dependencies: [names[0]],
  });
  validateRecord(r);
});
invalid("digest divergent", () =>
  validatePacket(
    packet(),
    { ...context(), planDigest: "0".repeat(64) },
    record(),
  ),
);
invalid("computed Changesets plan differs", () =>
  validatePublishPlan(
    {
      version: 1,
      plan: [
        [
          {
            name: names[1],
            version: "0.1.1",
            kind: "publish",
            access: "public",
            tag: "latest",
          },
        ],
      ],
    },
    record().packages,
  ),
);
invalid("resume different plan", () => {
  const p = packet(),
    c = context();
  c.planDigest = envelopeDigest(p);
  const r = record();
  r.packages[0].version = "0.1.2";
  validatePacket(p, c, r);
});
invalid("different audit run", () => {
  const p = packet(),
    c = context();
  c.planDigest = envelopeDigest(p);
  c.auditRun++;
  validatePacket(p, c, record());
});
invalid("unsafe artifact path", () => {
  const p = packet(),
    c = context();
  p.artifacts[0].path = "../secret.tgz";
  c.planDigest = envelopeDigest(p);
  validatePacket(p, c, record());
});
invalid("registry inaccessible", () => reconcile(record(), {}));
invalid("registry malformed/auth failure", () =>
  reconcile(record(), { [names[0]]: { error: "unauthorized" } }),
);
test("HTTP/auth/network failures are never absence", async () => {
  for (const status of [401, 403, 404, 500])
    await assert.rejects(
      authenticatedJson(
        "https://example.invalid/registry",
        "fake-test-token",
        async () => ({ ok: false, status, json: async () => ({}) }),
      ),
    );
  await assert.rejects(
    authenticatedJson(
      "https://example.invalid/registry",
      "fake-test-token",
      async () => {
        throw new Error("network unavailable");
      },
    ),
  );
  await assert.rejects(
    authenticatedJson("https://example.invalid/registry", "", async () => {
      throw new Error("must not fetch");
    }),
  );
});
invalid("registry package identity divergent", () => {
  const i = registry();
  i[names[0]].name = names[1];
  reconcile(record(), i);
});
invalid("downgrade", () =>
  remainingPlan(
    record(),
    reconcile(record(), registry(["0.1.0", "0.2.0"]), artifacts()),
    "resume",
  ),
);
invalid("already published in normal audit", () =>
  remainingPlan(
    record(),
    reconcile(record(), registry(["0.1.0", "0.1.1"]), artifacts()),
    "audit",
  ),
);
invalid("already published in initial publish", () =>
  remainingPlan(
    record(),
    reconcile(record(), registry(["0.1.0", "0.1.1"]), artifacts()),
    "publish",
  ),
);
invalid("published bytes differ", () => {
  const i = registry(["0.1.0", "0.1.1"]);
  i[names[0]].integrities["0.1.1"] = "sha512-other";
  remainingPlan(record(), reconcile(record(), i, artifacts()), "resume");
});
test("resume complete is reconciliation only", () =>
  assert.deepEqual(
    remainingPlan(
      record(),
      reconcile(record(), registry(["0.1.0", "0.1.1"]), artifacts()),
      "resume",
    ),
    [],
  ));
test("partial release publishes only absent remainder", () => {
  const r = record();
  r.packages.push({ ...r.packages[0], name: names[1] });
  const i = {
    ...registry(["0.1.0", "0.1.1"]),
    [names[1]]: { ...registry()[names[0]], name: names[1] },
  };
  const states = reconcile(r, i, artifacts());
  assert.deepEqual(
    states.map((item) => item.state),
    ["published", "absent"],
  );
  assert.deepEqual(
    remainingPlan(r, states, "resume").map((item) => item.name),
    [names[1]],
  );
});
invalid("resume registry divergence", () =>
  remainingPlan(
    record(),
    [{ name: names[0], version: "0.1.1", state: "divergent" }],
    "resume",
  ),
);
test("workspace policy and unauthorized version checks", () => {
  const manifests = names.map((name) => ({
    path: `packages/${name.split("/")[1]}`,
    pkg: {
      name,
      version: name === names[0] ? "0.1.1" : "0.1.0",
      license: "MIT",
      repository: "https://github.com/t00ls-dev/foundation",
      publishConfig: {
        registry: officialRegistry,
        access: "public",
      },
      files: ["dist", "README.md"],
    },
  }));
  manifests.push({
    path: ".",
    pkg: { name: "@t00ls-dev/foundation", private: true },
  });
  validateManifests(manifests, record());
  for (const license of ["UNLICENSED", "Apache-2.0", undefined]) {
    manifests[0].pkg.license = license;
    assert.throws(() => validateManifests(manifests, record()));
  }
  manifests[0].pkg.license = "MIT";
  manifests[0].pkg.version = "0.1.2";
  assert.throws(() => validateManifests(manifests, record()));
  manifests[0].pkg.version = "0.1.1";
  manifests.push({
    path: "tooling/config",
    pkg: { name: "@t00ls-dev/config-private" },
  });
  assert.throws(() => validateManifests(manifests, record()));
});

test("actual Changesets 3.0.3 pack-directory format works offline without publishing", () => {
  const temp = mkdtempSync(join(tmpdir(), "foundation-release-pack-test-"));
  try {
    const pkg = JSON.parse(
      readFileSync("packages/access/package.json", "utf8"),
    );
    const input = join(temp, "plan.json"),
      out = join(temp, "packed");
    writeFileSync(
      input,
      JSON.stringify({
        version: 1,
        plan: [
          [
            {
              kind: "publish",
              name: pkg.name,
              version: pkg.version,
              access: "public",
              tag: "latest",
            },
          ],
        ],
      }),
    );
    execFileSync(
      "pnpm",
      [
        "exec",
        "changeset",
        "pack",
        "--from-publish-plan",
        input,
        "--out-dir",
        out,
      ],
      { encoding: "utf8" },
    );
    const plan = JSON.parse(readFileSync(join(out, "publish-plan.json")));
    const entry = plan.plan.flat()[0];
    assert.equal(entry.name, pkg.name);
    assert.equal(entry.version, pkg.version);
    const bytes = readFileSync(join(out, entry.tarball.path));
    const executor = readFileSync(".github/scripts/release.mjs", "utf8");
    const inspectorSource = executor.slice(
      executor.indexOf("function inspect("),
      executor.indexOf("function packPlan("),
    );
    const inspector = (read) =>
      runInNewContext(`${inspectorSource}; inspect`, {
        assert,
        join,
        hash,
        canonical,
        names,
        registry: officialRegistry,
        readFileSync: read,
        jsonFrom: (buffer) => JSON.parse(buffer.toString()),
        run: (command, args) =>
          execFileSync(command, args, { encoding: "utf8" }),
        Buffer,
      });
    const inspected = {
      ...entry,
      path: entry.tarball.path,
      hash: hash(bytes),
      integrity: `sha512-${hash(bytes, "sha512", "base64")}`,
      packIntegrity: entry.tarball.integrity,
    };
    inspector(readFileSync)(out, inspected);
    assert.throws(
      () =>
        inspector((path, options) =>
          path === "LICENSE"
            ? "substituted license"
            : readFileSync(path, options),
        )(out, inspected),
      /Artifact license differs from approved source/,
    );
    validateArtifactPath({ ...entry, path: entry.tarball.path });
    assert.equal(
      entry.tarball.path,
      `packages/t00ls-dev-access-${pkg.version}.tgz`,
    );
    const r = record();
    const [major, minor, patch] = pkg.version.split(".").map(BigInt);
    const previous =
      patch > 0n
        ? { oldVersion: `${major}.${minor}.${patch - 1n}`, type: "patch" }
        : minor > 0n
          ? { oldVersion: `${major}.${minor - 1n}.0`, type: "minor" }
          : { oldVersion: `${major - 1n}.0.0`, type: "major" };
    r.packages[0] = {
      ...r.packages[0],
      ...previous,
      version: pkg.version,
    };
    const p = packet();
    p.record = r;
    p.artifacts = [
      {
        name: entry.name,
        version: entry.version,
        path: entry.tarball.path,
        hash: hash(bytes),
        packIntegrity: entry.tarball.integrity,
        integrity: `sha512-${hash(bytes, "sha512", "base64")}`,
      },
    ];
    validatePacket(p, { ...context(), planDigest: envelopeDigest(p) }, r);
    assert.equal(
      entry.tarball.integrity,
      `sha256-${hash(bytes, "sha256", "base64")}`,
    );
    assert(entry.tarball.path.startsWith("packages/"));
    const help = execFileSync(
      "pnpm",
      ["exec", "changeset", "publish", "--help"],
      { encoding: "utf8" },
    );
    assert(help.includes("--from-pack-dir") && help.includes("--git-tag"));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("workflow separates release modes and isolated credential-only OIDC diagnostics", () => {
  const workflow = parse(readFileSync(".github/workflows/release.yml", "utf8"));
  const ci = parse(readFileSync(".github/workflows/ci.yml", "utf8"));
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.equal(workflow.on.workflow_dispatch.inputs.mode.default, "audit");
  assert(!("expected_sha" in workflow.on.workflow_dispatch.inputs));
  assert.equal(workflow.on.workflow_dispatch.inputs.release_sha.required, true);
  assert.equal(
    workflow.on.workflow_dispatch.inputs.execution_sha.required,
    true,
  );
  for (const name of ["audit", "approve", "preflight", "publish"]) {
    assert.equal(workflow.jobs[name].permissions.packages, undefined);
    assert.equal(workflow.env.RELEASE_SHA, "${{ inputs.release_sha }}");
    assert.equal(workflow.env.EXECUTION_SHA, "${{ inputs.execution_sha }}");
    assert(!("EXPECTED_SHA" in workflow.env));
  }
  assert.equal(workflow.jobs.audit.permissions["id-token"], undefined);
  assert.equal(workflow.jobs.approve.permissions["id-token"], undefined);
  assert.equal(workflow.jobs.preflight.permissions["id-token"], undefined);
  for (const [name, job] of Object.entries(workflow.jobs)) {
    const references = JSON.stringify(job).includes(
      "secrets.NPM_BOOTSTRAP_TOKEN",
    );
    assert.equal(references, name === "publish");
  }
  const bootstrapSecret = workflow.jobs.publish.steps.find(
    (step) => step.env?.NPM_BOOTSTRAP_TOKEN,
  )?.env.NPM_BOOTSTRAP_TOKEN;
  assert.equal(
    bootstrapSecret,
    "${{ inputs.distribution == 'bootstrap' && secrets.NPM_BOOTSTRAP_TOKEN || '' }}",
  );
  assert.equal(workflow.env.NPM_BOOTSTRAP_TOKEN, undefined);
  assert.deepEqual(
    Object.entries(workflow.jobs)
      .filter(([, job]) => job.permissions?.["id-token"] === "write")
      .map(([name]) => name),
    ["publish", "diagnose-exchange"],
  );
  const condition = workflow.jobs.publish.if.replace(/\s+/g, " ");
  assert(
    condition.includes("github.event_name == 'workflow_dispatch'") &&
      condition.includes("github.ref == 'refs/heads/master'") &&
      condition.includes("needs.preflight.result == 'success'") &&
      condition.includes("inputs.mode == 'publish' || inputs.mode == 'resume'"),
  );
  assert(!ci.jobs.version.steps.some((step) => step.with?.["publish-script"]));
  assert(
    ci.jobs.version.steps.some(
      (step) =>
        step.with?.["version-script"] ===
        "node .github/scripts/release-version.mjs",
    ),
  );
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  assert.deepEqual(ci.jobs.version.concurrency, workflow.concurrency);
  assert.equal(ci.jobs.version.needs, "checks");
  assert(ci.jobs.version.if.includes("github.event_name == 'push'"));
  assert(ci.jobs.version.if.includes("github.ref == 'refs/heads/master'"));
  assert.equal(ci.jobs.version.permissions.contents, "write");
  assert.equal(ci.jobs.version.permissions["pull-requests"], "write");
  assert(!("packages" in ci.jobs.version.permissions));
  assert.equal(ci.permissions.contents, "read");
  validateCiStructure(ci, ciSetup());
  for (const job of [ci.jobs.version, ...Object.values(workflow.jobs)]) {
    assert(
      !job.steps.some((step) =>
        /pnpm check|playwright install/.test(step.run ?? ""),
      ),
    );
  }
  for (const job of Object.values(workflow.jobs)) {
    assert.equal(job.permissions.actions, "read");
  }
  assert(
    workflow.jobs.audit.steps.some(
      (step) => step.run === "pnpm --filter './packages/*' -r build",
    ),
  );
  assert(
    !workflow.jobs.preflight.steps.some((step) =>
      /\bbuild\b/.test(step.run ?? ""),
    ),
  );
  assert(workflow.jobs.publish.steps.some((step) => step.if === "always()"));
  const expression = condition.slice(3, -2).trim();
  const valid = {
    github: { event_name: "workflow_dispatch", ref: "refs/heads/master", sha },
    inputs: {
      mode: "publish",
      confirmation,
      execution_sha: sha,
      release_sha: sha,
    },
    needs: { preflight: { result: "success" } },
  };
  assert.equal(runInNewContext(expression, valid, { timeout: 1000 }), true);
  for (const candidate of [
    { ...valid, github: { ...valid.github, event_name: "push" } },
    { ...valid, github: { ...valid.github, ref: "refs/heads/feature" } },
    { ...valid, inputs: { ...valid.inputs, mode: "audit" } },
    { ...valid, inputs: { ...valid.inputs, confirmation: "wrong" } },
    { ...valid, inputs: { ...valid.inputs, execution_sha: "b".repeat(40) } },
    { ...valid, needs: { preflight: { result: "failure" } } },
    { ...valid, needs: { preflight: { result: "skipped" } } },
  ])
    assert.equal(
      runInNewContext(expression, candidate, { timeout: 1000 }),
      false,
    );
});

const ciSetup = () =>
  parse(readFileSync(".github/actions/setup/action.yml", "utf8"));
const currentCi = () => parse(readFileSync(".github/workflows/ci.yml", "utf8"));
const validationCommands = {
  static: ["pnpm format:check", "pnpm lint", "pnpm typecheck"],
  tests: [
    'pnpm test -- --reporter=default --reporter="$GITHUB_WORKSPACE/.github/scripts/vitest-summary.mjs"',
    'pnpm test:integration -- --reporter=default --reporter="$GITHUB_WORKSPACE/.github/scripts/vitest-summary.mjs"',
    "pnpm build",
    "pnpm test:release",
    "pnpm test:migrations",
  ],
  e2e: [
    "pnpm --filter @t00ls-dev/example-links exec playwright install --with-deps chromium",
    "pnpm test:e2e -- --shard=${{ matrix.shard }}/4",
  ],
  distribution: ["pnpm test:distribution"],
};

// Compare executable YAML objects, not text occurrences. Any new execution
// condition, shell, environment override or dependency requires explicit review.
function validateCiStructure(ci, setup) {
  assert.deepEqual(ci.on, {
    pull_request: null,
    push: { branches: ["master"] },
  });
  assert.deepEqual(ci.permissions, { contents: "read" });
  assert.equal(ci.env, undefined);
  assert.equal(ci.defaults, undefined);
  assert.deepEqual(ci.concurrency, {
    "group": "ci-${{ github.ref }}",
    "cancel-in-progress": true,
  });
  const jobs = structuredClone(ci.jobs);
  for (const job of Object.values(jobs))
    for (const step of job.steps) delete step.name;
  assert.deepEqual(Object.keys(jobs).sort(), [
    "checks",
    "distribution",
    "e2e",
    "static",
    "tests",
    "version",
  ]);
  assert.equal(
    Object.values(jobs).filter((j) => j.name === "checks").length,
    0,
  );
  for (const [name, commands] of Object.entries(validationCommands)) {
    const expected = {
      "runs-on": "ubuntu-latest",
      "steps": [
        { uses: "actions/checkout@v7", with: { "fetch-depth": 0 } },
        { uses: "./.github/actions/setup" },
        ...commands.map((run) => ({ run })),
      ],
    };
    if (name === "e2e")
      expected.strategy = {
        "fail-fast": false,
        "matrix": { shard: [1, 2, 3, 4] },
      };
    if (name === "tests") {
      expected.steps[2].env = { GITHUB_TEST_SUITE: "Unitários" };
      expected.steps[3].env = { GITHUB_TEST_SUITE: "Integração" };
    }
    if (name === "distribution") {
      expected.strategy = {
        "fail-fast": false,
        "matrix": { attempt: [1, 2] },
      };
      expected.steps.at(-1).env = {
        DISTRIBUTION_ATTEMPT: "${{ matrix.attempt }}",
      };
    }
    assert.deepEqual(jobs[name], expected, `Required validation job: ${name}`);
  }
  assert.deepEqual(jobs.checks, {
    "if": "always()",
    "needs": Object.keys(validationCommands),
    "runs-on": "ubuntu-latest",
    "steps": [
      { uses: "actions/checkout@v7" },
      {
        run: "node .github/scripts/ci-checks.mjs",
        env: { CI_NEEDS: "${{ toJSON(needs) }}" },
      },
    ],
  });
  assert.equal(jobs.version.needs, "checks");
  assert.equal(
    jobs.version.if,
    "github.event_name == 'push' && github.ref == 'refs/heads/master' && github.repository == 't00ls-dev/foundation'",
  );
  assert.deepEqual(setup.runs, {
    using: "composite",
    steps: [
      { uses: "pnpm/action-setup@v6.1.0" },
      {
        uses: "actions/setup-node@v7",
        with: { "node-version": "22.23.3", "cache": "pnpm" },
      },
      { run: "pnpm install --frozen-lockfile", shell: "bash" },
    ],
  });
  const local = JSON.parse(readFileSync("package.json", "utf8")).scripts.check;
  assert.equal(
    local,
    "pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build && pnpm test:e2e && pnpm test:distribution && pnpm test:release && pnpm test:migrations",
  );
}

test("CI structural guard covers the complete local gate", () =>
  validateCiStructure(currentCi(), ciSetup()));
for (const name of Object.keys(validationCommands)) {
  for (const [index] of validationCommands[name].entries()) {
    for (const mutation of ["remove", "disable", "ignore", "mask"]) {
      test(`CI guard rejects ${name} command ${index}: ${mutation}`, () => {
        const ci = currentCi();
        const steps = ci.jobs[name].steps;
        const step = steps[index + 2];
        if (mutation === "remove") steps.splice(index + 2, 1);
        if (mutation === "disable") step.if = "false";
        if (mutation === "ignore") step["continue-on-error"] = true;
        if (mutation === "mask") step.run += " || true";
        assert.throws(() => validateCiStructure(ci, ciSetup()));
      });
    }
  }
  for (const mutation of [
    "remove",
    "detach",
    "condition",
    "dependency",
    "ignore",
  ]) {
    test(`CI guard rejects ${name} job: ${mutation}`, () => {
      const ci = currentCi();
      if (mutation === "remove") delete ci.jobs[name];
      if (mutation === "detach")
        ci.jobs.checks.needs = ci.jobs.checks.needs.filter((n) => n !== name);
      if (mutation === "condition") ci.jobs[name].if = "false";
      if (mutation === "dependency") ci.jobs[name].needs = "version";
      if (mutation === "ignore") ci.jobs[name]["continue-on-error"] = true;
      assert.throws(() => validateCiStructure(ci, ciSetup()));
    });
  }
}
for (const mutate of [
  (ci) => {
    ci.jobs.checks.if = "success()";
  },
  (ci) => {
    ci.jobs.checks.steps[1].if = "false";
  },
  (ci) => {
    ci.jobs.checks.steps[1].run = "true";
  },
  (ci) => {
    ci.jobs.static.name = "checks";
  },
  (ci) => {
    ci.jobs.e2e.strategy.matrix.shard.pop();
  },
  (ci) => {
    ci.jobs.e2e.strategy.matrix.exclude = [{ shard: 4 }];
  },
  (ci) => {
    ci.jobs.distribution.strategy.matrix.attempt.pop();
  },
  (ci) => {
    ci.jobs.version.needs = "static";
  },
  (ci) => {
    ci.jobs.version.if = "always()";
  },
  (ci) => {
    ci.on = { workflow_dispatch: null };
  },
]) {
  test(`CI guard rejects altered execution contract: ${mutate.toString()}`, () => {
    const ci = currentCi();
    mutate(ci);
    assert.throws(() => validateCiStructure(ci, ciSetup()));
  });
}
test("CI guard rejects disabled or missing dependency installation", () => {
  for (const mutation of ["disable", "remove"]) {
    const setup = ciSetup();
    if (mutation === "disable") setup.runs.steps[2].if = "false";
    else setup.runs.steps.pop();
    assert.throws(() => validateCiStructure(currentCi(), setup));
  }
});
test("checks fails closed on every unsuccessful or missing dependency", () => {
  const needs = Object.fromEntries(
    Object.keys(validationCommands).map((name) => [
      name,
      { result: "success" },
    ]),
  );
  const run = (value) =>
    execFileSync(process.execPath, [".github/scripts/ci-checks.mjs"], {
      env: { ...process.env, CI_NEEDS: JSON.stringify(value) },
      stdio: "pipe",
    });
  run(needs);
  for (const name of Object.keys(needs)) {
    for (const result of ["failure", "cancelled", "skipped", "neutral", null])
      assert.throws(() => run({ ...needs, [name]: { result } }));
    const missing = { ...needs };
    delete missing[name];
    assert.throws(() => run(missing));
  }
  assert.throws(() => run({ ...needs, unexpected: { result: "success" } }));
});
test("distribution accepts exclusively attempts 1/2 and preserves local execution", () => {
  assert.deepEqual(distributionAttempts(undefined), [1, 2]);
  assert.deepEqual(distributionAttempts("1"), [1]);
  assert.deepEqual(distributionAttempts("2"), [2]);
  for (const value of [
    "",
    "0",
    "3",
    "01",
    "1.0",
    "1x",
    " 1",
    "2 ",
    "NaN",
    "1,2",
  ])
    assert.throws(() => distributionAttempts(value));
});

test("only Version Packages retains checkout credentials for Changesets history fetches", () => {
  const ci = parse(readFileSync(".github/workflows/ci.yml", "utf8"));
  const release = parse(readFileSync(".github/workflows/release.yml", "utf8"));
  const deploy = parse(
    readFileSync(".github/workflows/deploy-dev.yml", "utf8"),
  );
  const checkouts = (job) =>
    job.steps.filter((step) => step.uses?.startsWith("actions/checkout@"));
  assert.equal(checkouts(ci.jobs.version).length, 1);
  assert.equal(checkouts(ci.jobs.version)[0].with["persist-credentials"], true);
  assert(!("token" in checkouts(ci.jobs.version)[0].with));
  for (const job of [...Object.values(release.jobs), deploy.jobs.deploy]) {
    assert(checkouts(job).length > 0);
    for (const step of checkouts(job))
      assert.equal(step.with["persist-credentials"], false);
  }
  const action = ci.jobs.version.steps.find(
    (step) => step.uses === "changesets/action@v2.1.2",
  );
  assert(action);
  assert(!action.with["push-with-git-cli"]);
  assert(!action.with["publish-script"]);
});

const ciWorkflow = () => ({ id: 123, path: ".github/workflows/ci.yml" });
const ciRun = () => ({
  id: 100,
  run_attempt: 2,
  workflow_id: 123,
  path: ".github/workflows/ci.yml",
  repository: { full_name: "t00ls-dev/foundation" },
  head_repository: { full_name: "t00ls-dev/foundation" },
  event: "push",
  head_branch: "master",
  head_sha: sha,
  status: "completed",
  conclusion: "success",
});
const ciJob = () => ({
  name: "checks",
  run_id: 100,
  run_attempt: 2,
  head_sha: sha,
  status: "completed",
  conclusion: "success",
});

test("CI evidence accepts only the exact completed master push and checks attempt", () => {
  assert.deepEqual(validateCiRun(ciRun(), [ciJob()], ciWorkflow(), sha), {
    runId: 100,
    attempt: 2,
    sha,
  });
  for (const patch of [
    { repository: { full_name: "attacker/foundation" } },
    { head_repository: { full_name: "attacker/foundation" } },
    { head_repository: null },
    { workflow_id: 999 },
    { path: ".github/workflows/fake.yml" },
    { event: "pull_request" },
    { event: "workflow_dispatch" },
    { head_branch: "feature" },
    { head_sha: "b".repeat(40) },
    { status: "in_progress" },
    ...["failure", "cancelled", "skipped", "neutral", null].map(
      (conclusion) => ({ conclusion }),
    ),
    { run_attempt: 0 },
    { id: undefined },
  ])
    assert.throws(() =>
      validateCiRun({ ...ciRun(), ...patch }, [ciJob()], ciWorkflow(), sha),
    );
  for (const patch of [
    { name: "version" },
    { run_id: 999 },
    { run_attempt: 1 },
    { head_sha: "b".repeat(40) },
    { status: "in_progress" },
    ...["failure", "cancelled", "skipped", "neutral", null].map(
      (conclusion) => ({ conclusion }),
    ),
  ])
    assert.throws(() =>
      validateCiRun(ciRun(), [{ ...ciJob(), ...patch }], ciWorkflow(), sha),
    );
  for (const jobs of [[], [ciJob(), ciJob()], null])
    assert.throws(() => validateCiRun(ciRun(), jobs, ciWorkflow(), sha));
  assert.throws(() =>
    validateCiRun(
      ciRun(),
      [ciJob()],
      { ...ciWorkflow(), path: "fake.yml" },
      sha,
    ),
  );
  assert.throws(() =>
    validateCiRun(ciRun(), [ciJob()], ciWorkflow(), "master"),
  );
});

test("deploy event rejects PRs, forks, incomplete runs and invalid SHAs before checkout", () => {
  const event = { repository: ciRun().repository, workflow_run: ciRun() };
  assert.equal(validateDeployEvent(event).head_sha, sha);
  assert.throws(() =>
    validateDeployEvent({
      ...event,
      repository: { full_name: "attacker/foundation" },
    }),
  );
  assert.throws(() =>
    validateDeployEvent({ ...event, workflow_run: undefined }),
  );
  for (const patch of [
    { repository: { full_name: "attacker/foundation" } },
    { head_repository: { full_name: "attacker/foundation" } },
    { event: "pull_request" },
    { head_branch: "feature" },
    { head_sha: "master; malicious" },
    { status: "in_progress" },
    { conclusion: "failure" },
    { id: 0 },
    { run_attempt: undefined },
  ])
    assert.throws(() =>
      validateDeployEvent({ ...event, workflow_run: { ...ciRun(), ...patch } }),
    );
});

test("CI lookup binds workflow, newest run, attempt jobs and fails closed on API errors or reruns", async () => {
  const requests = [];
  const request = async (url) => {
    requests.push(url);
    if (url.endsWith("/actions/workflows/ci.yml")) return ciWorkflow();
    if (url.includes("/runs?"))
      return { workflow_runs: [ciRun(), { ...ciRun(), id: 99 }] };
    if (url.includes("/jobs?")) return { jobs: [ciJob()] };
    return ciRun();
  };
  await approvedCi(sha, { request });
  assert(
    requests.some((url) =>
      url.includes(`head_sha=${sha}&event=push&branch=master`),
    ),
  );
  assert(requests.some((url) => url.includes("/runs/100/attempts/2/jobs?")));
  assert(!requests.some((url) => url.includes("/runs/99")));
  for (const override of [
    async () => {
      throw new Error("403");
    },
    async (url) =>
      url.includes("/runs?") ? { workflow_runs: [] } : request(url),
    async (url) => (url.includes("/runs?") ? {} : request(url)),
    async (url) =>
      url.endsWith("/runs/100")
        ? { ...ciRun(), conclusion: "failure" }
        : request(url),
    async (url) => (url.includes("/jobs?") ? { jobs: [] } : request(url)),
  ])
    await assert.rejects(approvedCi(sha, { request: override }));
  let reads = 0;
  await assert.rejects(
    approvedCi(sha, {
      request: async (url) => {
        if (url.endsWith("/runs/100") && ++reads === 2)
          return { ...ciRun(), run_attempt: 3 };
        return request(url);
      },
    }),
  );
  await assert.rejects(
    approvedCi(sha, { request, origin: { ...ciRun(), run_attempt: 1 } }),
  );
  await approvedCi(sha, { request, origin: ciRun() });
});

test("CI evidence paginates attempt jobs and rejects a newly created run", async () => {
  let lists = 0;
  const requestedPages = [];
  const request = async (url) => {
    if (url.endsWith("/actions/workflows/ci.yml")) return ciWorkflow();
    if (url.includes("/runs?")) {
      lists++;
      return { workflow_runs: [ciRun()] };
    }
    if (url.includes("/jobs?")) {
      const page = Number(new URL(url).searchParams.get("page"));
      requestedPages.push(page);
      return {
        jobs:
          page === 1
            ? Array.from({ length: 100 }, (_, index) => ({
                name: `other-${index}`,
              }))
            : [ciJob()],
      };
    }
    return ciRun();
  };
  await approvedCi(sha, { request });
  assert.deepEqual(requestedPages, [1, 2]);
  assert.equal(lists, 2);
  lists = 0;
  await assert.rejects(
    approvedCi(sha, {
      request: async (url) => {
        const value = await request(url);
        if (url.includes("/runs?") && lists === 2)
          return { workflow_runs: [{ ...ciRun(), id: 101 }] };
        return value;
      },
    }),
  );
});

test("Deploy DEV accepts only explicit manual entry and blocks automatic events and reruns", () => {
  const workflow = parse(
    readFileSync(".github/workflows/deploy-dev.yml", "utf8"),
  );
  assert.equal(workflow.name, "Deploy DEV");
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.deepEqual(Object.keys(workflow.on.workflow_dispatch.inputs), [
    "execution_sha",
  ]);
  assert.equal(
    workflow.on.workflow_dispatch.inputs.execution_sha.required,
    true,
  );
  assert.equal(
    workflow.on.workflow_dispatch.inputs.execution_sha.type,
    "string",
  );
  const valid = {
    github: {
      repository: "t00ls-dev/foundation",
      event_name: "workflow_dispatch",
      ref: "refs/heads/master",
      sha,
      run_attempt: "1",
      event: {},
    },
    inputs: { execution_sha: sha },
  };
  const accepts = (context) =>
    runInNewContext(workflow.jobs.validate.if, context, { timeout: 1000 });
  assert.equal(accepts(valid), true);
  // Manual retries still require the same entry checks and fresh CI evidence.
  assert.equal(
    accepts({ ...valid, github: { ...valid.github, run_attempt: "2" } }),
    true,
  );
  for (const event_name of [
    "workflow_run",
    "push",
    "pull_request",
    "pull_request_target",
    "repository_dispatch",
  ]) {
    for (const attempt of [1, 2])
      assert.equal(
        accepts({
          ...valid,
          github: {
            ...valid.github,
            event_name,
            run_attempt: String(attempt),
            event: {
              workflow_run: {
                ...ciRun(),
                id: 40151793873,
                run_attempt: attempt,
              },
            },
          },
        }),
        false,
        `${event_name}, attempt ${attempt}: even a green historical CI cannot enter`,
      );
  }
  for (const candidate of [
    {
      ...valid,
      github: { ...valid.github, repository: "attacker/foundation" },
    },
    { ...valid, github: { ...valid.github, ref: "refs/heads/feature" } },
    { ...valid, github: { ...valid.github, ref: "refs/tags/release" } },
    { ...valid, inputs: { execution_sha: "b".repeat(40) } },
    { ...valid, inputs: { execution_sha: "master" } },
    { ...valid, inputs: { execution_sha: "" } },
    { ...valid, inputs: {} },
  ])
    assert.equal(accepts(candidate), false);

  const needs = {
    expand: ["validate"],
    deploy: ["validate", "expand"],
    backfill: ["validate", "deploy"],
    contract: ["validate", "deploy", "backfill"],
  };
  assert.deepEqual(Object.keys(workflow.jobs), [
    "validate",
    ...Object.keys(needs),
  ]);
  for (const [name, required] of Object.entries(needs)) {
    const job = workflow.jobs[name];
    assert.deepEqual([job.needs].flat(), required);
    assert(!/always\(|failure\(|cancelled\(/.test(job.if ?? ""));
  }
  assert(workflow.jobs.deploy.if.includes("needs.expand.result == 'success'"));
  const guard = workflow.jobs.validate.steps.find((step) => step.id === "ci");
  assert.equal(guard.run, "node .github/scripts/ci-evidence.mjs deploy");
  assert.deepEqual(guard.env, { GITHUB_TOKEN: "${{ github.token }}" });
  assert.equal(
    workflow.jobs.validate.outputs.sha,
    "${{ steps.ci.outputs.sha }}",
  );
});

test("deploy validates trusted workflow code before exact-SHA checkout and limits secrets", () => {
  const workflow = parse(
    readFileSync(".github/workflows/deploy-dev.yml", "utf8"),
  );
  const job = workflow.jobs.deploy;
  const steps = job.steps;
  assert.equal(workflow.permissions.actions, "read");
  assert(job.if.includes("github.event.workflow_run.event == 'push'"));
  assert(
    job.if.includes(
      "github.event.workflow_run.head_repository.full_name == 't00ls-dev/foundation'",
    ),
  );
  assert(!job.env);
  assert.equal(steps[0].with.ref, "${{ github.sha }}");
  assert.equal(steps[1].run, "node .github/scripts/ci-evidence.mjs deploy");
  assert.equal(steps[2].with.ref, "${{ steps.ci.outputs.sha }}");
  for (const step of steps.filter((step) =>
    step.uses?.startsWith("actions/checkout@"),
  ))
    assert.equal(step.with["persist-credentials"], false);
  assert(
    !steps.some((step) => step.uses?.startsWith("actions/download-artifact@")),
  );
  for (const step of steps.filter((step) => step.env?.CLOUDFLARE_API_TOKEN))
    assert(
      [
        "Require the DEV schema before deploy (read-only)",
        "Deploy DEV",
      ].includes(step.name),
    );
});
