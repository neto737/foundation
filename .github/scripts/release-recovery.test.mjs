import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";
import {
  recoverySource,
  releaseMode,
  recoveryBinding,
  recoveryRemaining,
  validateRecoveryTarget,
  validateContext,
  validatePacket,
  validateApproval,
  approvalCertificate,
  envelopeDigest,
  validateProtectedInputs,
  digest,
  hash,
  names,
  registry,
  remainingPlan,
} from "./release-core.mjs";
import {
  historicalContext,
  readSourceArchive,
  validateSourceArtifact,
  verifyCandidate,
  verifyRecoveryCandidates,
  verifyRecoverySource,
  verifyRecovery,
  downloadSource,
  recoveryAudit,
  validateRecoveryBinding,
  recoveryRegistry,
} from "./release-recovery.mjs";
import {
  consumeApprovedArtifact,
  validateConsumerAuthority,
} from "./release-consumer.mjs";

// Exact, public historical evidence, copied without regeneration. All requests
// below are synthetic; importing this suite never contacts GitHub/npm/OIDC.
const fixture = resolve(".github/scripts/fixtures/release");
const auditZip = readFileSync(join(fixture, "recovery-audit.zip"));
const approvalZip = readFileSync(join(fixture, "recovery-approval.zip"));
const sourceFiles = readSourceArchive(
  join(fixture, "recovery-audit.zip"),
  "audit",
);
const source = JSON.parse(sourceFiles.get("authorization.json"));
const certificate = JSON.parse(
  readSourceArchive(join(fixture, "recovery-approval.zip"), "approval").get(
    "approval.json",
  ),
);
const localVersions = new Map(
  names.map((name) => [
    name,
    JSON.parse(
      readFileSync(
        new URL(
          `../../packages/${name.split("/")[1]}/package.json`,
          import.meta.url,
        ),
      ),
    ).version,
  ]),
);
const old = recoverySource.executionSha;
const current = "e".repeat(40);
const api = "https://api.github.com/repos/t00ls-dev/foundation";
const owner = { login: "t00ls-dev", id: 14156701, type: "User" };
const workflow = { id: 456, path: ".github/workflows/release.yml" };
const permission = { permission: "admin", user: owner };
const clone = (value) => structuredClone(value);
function gitTree(sha) {
  const tree = execFileSync("git", ["ls-tree", "-r", "-t", "-z", sha], {
    encoding: "utf8",
  });
  return {
    truncated: false,
    sha: execFileSync("git", ["rev-parse", `${sha}^{tree}`], {
      encoding: "utf8",
    }).trim(),
    tree: tree
      .split("\0")
      .filter(Boolean)
      .map((row) => {
        const [, mode, type, oid, path] =
          /^(\d+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/.exec(row);
        return { mode, type, sha: oid, path };
      }),
  };
}
const originalTree = gitTree(old);
const executorTree = clone(originalTree);
executorTree.sha = "f".repeat(40);
executorTree.tree.find(
  (p) => p.path === ".github/scripts/release-consumer.mjs",
).sha = "d".repeat(40);
const context = () => ({
  recovery: true,
  mode: "resume",
  distribution: "release",
  releasePr: 136,
  releaseSha: old,
  executionSha: current,
  sha: current,
  masterSha: current,
  repository: "t00ls-dev/foundation",
  event: "workflow_dispatch",
  ref: "refs/heads/master",
  runId: 201,
  auditRun: 200,
  approvalRun: 202,
  confirmation: "PUBLISH_PUBLIC_FOUNDATION_PACKAGES",
});
const binding = () => recoveryBinding(originalTree, executorTree, context());
function packet() {
  return {
    ...clone(source),
    format: 5,
    executionSha: current,
    snapshotSha: current,
    protectedInputsDigest: binding().protectedInputsDigest,
    changesDigest: binding().changesDigest,
    auditRun: 200,
    recovery: {
      format: 1,
      source: clone(recoverySource),
      changes: binding().changes,
    },
  };
}
function boundContext(p = packet()) {
  return {
    ...context(),
    ...binding(),
    reviewedChangesDigest: p.changesDigest,
    planDigest: envelopeDigest(p),
  };
}
const run = (id, sha, name = "Release") => ({
  id,
  name,
  run_attempt: 1,
  workflow_id: workflow.id,
  path: workflow.path,
  repository: { full_name: "t00ls-dev/foundation" },
  head_repository: { full_name: "t00ls-dev/foundation" },
  event: "workflow_dispatch",
  head_branch: "master",
  head_sha: sha,
  actor: clone(owner),
  triggering_actor: clone(owner),
  status: "completed",
  conclusion: "success",
});
const job = (id, sha, name) => ({
  name,
  run_id: id,
  run_attempt: 1,
  head_sha: sha,
  status: "completed",
  conclusion: "success",
});
function metadata(kind) {
  const audit = kind === "audit";
  return {
    id: audit ? recoverySource.auditArtifact : recoverySource.approvalArtifact,
    name: `${audit ? "foundation-release" : "foundation-approval"}-${recoverySource.planDigest}`,
    expired: false,
    expires_at: "2999-11-19T23:41:42Z",
    digest: `sha256:${audit ? recoverySource.auditZipHash : recoverySource.approvalZipHash}`,
    workflow_run: {
      id: audit ? recoverySource.auditRun : recoverySource.approvalRun,
      head_sha: old,
      head_branch: "master",
      repository_id: 1371160528,
      head_repository_id: 1371160528,
    },
  };
}
function sourceDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "foundation-recovery-test-"));
  mkdirSync(join(directory, "source"));
  writeFileSync(join(directory, "source/audit.zip"), auditZip);
  writeFileSync(join(directory, "source/approval.zip"), approvalZip);
  for (const a of source.artifacts) {
    mkdirSync(join(directory, "packed/packages"), { recursive: true });
    writeFileSync(
      join(directory, "packed", a.path),
      sourceFiles.get(`packed/${a.path}`),
    );
  }
  return directory;
}
function states() {
  return source.record.packages.map((a) => ({
    name: a.name,
    version: a.version,
    state: a.name === "@t00ls-dev/config" ? "absent" : "published",
  }));
}
function apiHarness(mutate = (url, value) => value) {
  const calls = [];
  const request = async (url) => {
    calls.push(url);
    const path = url.slice(api.length);
    let value;
    if (path === "")
      value = {
        full_name: "t00ls-dev/foundation",
        id: 1371160528,
        name: "foundation",
        owner: { login: "t00ls-dev" },
        default_branch: "master",
        private: false,
      };
    else if (path === "/git/ref/heads/master")
      value = { object: { sha: current } };
    else if (path === "/actions/workflows/release.yml") value = workflow;
    else if (path === "/collaborators/t00ls-dev/permission") value = permission;
    else if (path.startsWith("/actions/artifacts/"))
      value = metadata(
        path.includes(String(recoverySource.auditArtifact))
          ? "audit"
          : "approval",
      );
    else if (path.startsWith("/compare/"))
      value = {
        status: path.includes(`${old}...${old}`) ? "identical" : "ahead",
        behind_by: 0,
        merge_base_commit: { sha: old },
        base_commit: { sha: old },
        commits: path.includes(`${old}...${old}`) ? [] : [{ sha: current }],
      };
    else if (path.startsWith("/git/commits/")) {
      const sha = path.split("/").at(-1);
      value = {
        sha,
        tree: { sha: sha === old ? originalTree.sha : executorTree.sha },
      };
    } else if (path.startsWith("/git/trees/"))
      value = path.includes(originalTree.sha) ? originalTree : executorTree;
    else if (path.startsWith("/contents/.changeset/release-plan.json"))
      value = {
        encoding: "base64",
        content: Buffer.from(JSON.stringify(source.record)).toString("base64"),
      };
    else if (path === "/pulls/136")
      value = {
        number: 136,
        state: "closed",
        merged: true,
        merge_commit_sha: old,
        base: { ref: "master", repo: { full_name: "t00ls-dev/foundation" } },
        head: {
          sha: old,
          ref: "changeset-release/master",
          repo: { full_name: "t00ls-dev/foundation" },
        },
        user: { login: "github-actions[bot]" },
      };
    else if (path.startsWith("/pulls/136/commits"))
      value = [
        {
          sha: old,
          author: { login: "github-actions[bot]" },
          committer: { login: "web-flow" },
          commit: { verification: { verified: true, reason: "valid" } },
          parents: [{ sha: source.record.baseSha }],
        },
      ];
    else if (path === "/actions/workflows/ci.yml")
      value = { id: 789, path: ".github/workflows/ci.yml" };
    else if (path.startsWith("/actions/workflows/789/runs"))
      value = { workflow_runs: [{ id: 300 }] };
    else if (path.startsWith("/actions/runs/")) {
      const id = Number(path.split("/")[3]);
      const sha = [
        recoverySource.auditRun,
        recoverySource.approvalRun,
      ].includes(id)
        ? old
        : current;
      if (path.includes("/jobs"))
        value = {
          jobs: [
            job(
              id,
              sha,
              id === 300
                ? "checks"
                : [recoverySource.auditRun, 200].includes(id)
                  ? "audit"
                  : "approve",
            ),
          ],
        };
      else {
        value = run(id, sha);
        if (id === 300)
          Object.assign(value, {
            workflow_id: 789,
            path: ".github/workflows/ci.yml",
            event: "push",
          });
      }
    } else throw new Error("Unexpected synthetic API request");
    return mutate(url, clone(value));
  };
  return { request, calls };
}
function fetchHarness({
  configPublished = false,
  missingName,
  tamperBytes = false,
} = {}) {
  const calls = [];
  const fetcher = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("/actions/artifacts/"))
      return {
        status: 302,
        headers: new Headers({
          location: `https://fixture.blob.core.windows.net/${url.includes(String(recoverySource.auditArtifact)) ? "audit" : "approval"}`,
        }),
      };
    if (url.startsWith("https://fixture.blob.core.windows.net/"))
      return {
        status: 200,
        arrayBuffer: async () =>
          url.endsWith("/audit") ? auditZip : approvalZip,
      };
    assert(url.startsWith(registry));
    assert(!options.headers?.Authorization);
    const name = names.find((name) => decodeURIComponent(url).includes(name));
    assert(name);
    if (url.endsWith(".tgz")) {
      const a = source.artifacts.find((a) => a.name === name);
      const bytes = sourceFiles.get(`packed/${a.path}`);
      return {
        status: 200,
        arrayBuffer: async () => (tamperBytes ? Buffer.from("changed") : bytes),
      };
    }
    const target = source.record.packages.find((p) => p.name === name);
    const versions = target
      ? [
          target.oldVersion,
          ...((name === "@t00ls-dev/config" && !configPublished) ||
          name === missingName
            ? []
            : [target.version]),
        ]
      : [localVersions.get(name)];
    return {
      ok: true,
      status: 200,
      json: async () => ({
        name,
        "dist-tags": { latest: versions.at(-1) },
        "versions": Object.fromEntries(
          versions.map((version) => [
            version,
            {
              name,
              version,
              dist: {
                tarball: `${registry}/${name}/-/${name.split("/")[1]}-${version}.tgz`,
                integrity:
                  source.artifacts.find(
                    (a) => a.name === name && a.version === version,
                  )?.integrity ??
                  `sha512-${Buffer.alloc(64).toString("base64")}`,
              },
            },
          ]),
        ),
      }),
    };
  };
  return { fetcher, calls };
}

test("recovery pins exact historical envelopes, ZIPs and all five candidates", () => {
  assert.equal(envelopeDigest(source), recoverySource.planDigest);
  assert.equal(digest(certificate), recoverySource.approvalDigest);
  assert.equal(digest(source.artifacts), recoverySource.artifactsDigest);
  assert.equal(digest(source.record), recoverySource.recordDigest);
  for (const a of source.artifacts)
    verifyCandidate(sourceFiles.get(`packed/${a.path}`), a);
  validatePacket(source, historicalContext(), source.record);
});

test("recovery mode is explicit; ordinary guards and six exceptions are unchanged", () => {
  assert.deepEqual(releaseMode("recovery-audit"), {
    mode: "audit",
    recovery: true,
  });
  assert.deepEqual(releaseMode("recovery-approve"), {
    mode: "approve",
    recovery: true,
  });
  assert.deepEqual(releaseMode("recovery-resume"), {
    mode: "resume",
    recovery: true,
  });
  assert.deepEqual(releaseMode("recovery-publish"), {
    mode: "recovery-publish",
    recovery: false,
  });
  assert.throws(() =>
    validateContext({ ...context(), ...releaseMode("recovery-publish") }),
  );
  assert.throws(() => validateProtectedInputs(originalTree, executorTree));
  assert.throws(() =>
    validatePacket(
      packet(),
      { ...boundContext(), recovery: false },
      source.record,
    ),
  );
  assert.throws(() => validatePacket(source, boundContext(), source.record));
});

test("recovery packet binds executor, source, delta, every extra field and destination", () => {
  const p = packet(),
    c = boundContext(p);
  validateContext(c, true);
  validatePacket(p, c, source.record);
  for (const mutate of [
    (p) => (p.executionSha = old),
    (p) => (p.snapshotSha = old),
    (p) => (p.protectedInputsDigest = "a".repeat(64)),
    (p) => (p.registry = "https://example.invalid"),
    (p) => (p.access = "restricted"),
    (p) => p.auditRun++,
    (p) => p.releasePr++,
    (p) => p.recovery.source.auditRun++,
    (p) => p.recovery.source.approvalArtifact++,
    (p) => (p.recovery.source.auditZipHash = "a".repeat(64)),
    (p) => (p.recovery.changes[0].after.oid = "a".repeat(40)),
    (p) => (p.artifacts[0].hash = "b".repeat(64)),
    (p) => (p.artifacts[0].name = "@t00ls-dev/unexpected"),
    (p) => (p.artifacts[2].version = "0.1.4"),
    (p) => (p.record.packages[0].version = "9.0.0"),
    (p) => (p.recovery.extra = true),
    (p) => (p.extraAuthority = "not approved"),
  ]) {
    const changed = clone(p);
    mutate(changed);
    assert.notEqual(envelopeDigest(changed), envelopeDigest(p));
    assert.throws(() => validatePacket(changed, c, source.record));
  }
  assert.throws(() => validateContext({ ...c, masterSha: old }, true));
  assert.throws(() => validateContext({ ...c, executionSha: old }, true));
  assert.throws(() => validateContext({ ...c, mode: "publish" }, true));
});

test("recovery rejects artifact input changes without global exceptions", () => {
  for (const path of [
    "packages/config/src/index.ts",
    "pnpm-lock.yaml",
    "package.json",
    ".changeset/release-plan.json",
    "LICENSE",
  ]) {
    const tree = clone(executorTree);
    const entry = tree.tree.find((p) => p.path === path);
    if (entry) entry.sha = "1".repeat(40);
    else
      tree.tree.push({
        path,
        type: "blob",
        mode: "100644",
        sha: "1".repeat(40),
      });
    assert.throws(
      () => recoveryBinding(originalTree, tree, context()),
      /artifact inputs/,
    );
  }
  const tree = clone(executorTree);
  tree.tree.find(
    (p) => p.path === ".github/scripts/release-consumer.mjs",
  ).mode = "120000";
  assert.throws(() => recoveryBinding(originalTree, tree, context()));
});

test("new approval requires current executor and owner; old certificate is only origin evidence", () => {
  const p = packet(),
    c = boundContext(p);
  const approval = approvalCertificate(
    p,
    { ...owner, permission: "admin", type: undefined },
    202,
  );
  // Match the canonical actor shape produced by validateReleaseActor.
  approval.actor = { login: owner.login, id: owner.id, permission: "admin" };
  assert.equal(approval.format, 3);
  assert.equal(approval.domain, "foundation-npm-recovery-approval");
  validateApproval(
    approval,
    run(202, current),
    [job(202, current, "approve")],
    workflow,
    permission,
    p,
    c,
  );
  assert.throws(() =>
    validateApproval(
      certificate,
      run(202, current),
      [job(202, current, "approve")],
      workflow,
      permission,
      p,
      c,
    ),
  );
  assert.throws(() =>
    validateApproval(
      approval,
      run(202, old),
      [job(202, old, "approve")],
      workflow,
      permission,
      p,
      c,
    ),
  );
  for (const mutate of [
    (r) => r.actor.id++,
    (r) => (r.triggering_actor.login = "other"),
    (r) => r.run_attempt++,
    (r) => (r.conclusion = "failure"),
  ]) {
    const r = run(202, current);
    mutate(r);
    assert.throws(() =>
      validateApproval(
        approval,
        r,
        [job(202, current, "approve")],
        workflow,
        permission,
        p,
        c,
      ),
    );
  }
  assert.throws(() =>
    validateApproval(
      approval,
      run(202, current),
      [job(202, current, "approve")],
      workflow,
      { ...permission, permission: "write" },
      p,
      c,
    ),
  );
});

test("only config can remain; complete or unexpectedly partial states require human reconciliation", () => {
  assert.deepEqual(
    recoveryRemaining(source.record, states(), context()).map((p) => p.name),
    ["@t00ls-dev/config"],
  );
  assert.throws(() => remainingPlan(source.record, states(), "audit"));
  for (const index of [0, 1, 3, 4]) {
    const changed = states();
    changed[index].state = "absent";
    assert.throws(() => recoveryRemaining(source.record, changed, context()));
  }
  const complete = states().map((p) => ({ ...p, state: "published" }));
  assert.throws(
    () => recoveryRemaining(source.record, complete, context()),
    /human reconciliation/,
  );
  for (const a of source.artifacts) {
    if (a.name === "@t00ls-dev/config") validateRecoveryTarget(a, context());
    else assert.throws(() => validateRecoveryTarget(a, context()), /republish/);
  }
});

for (const key of [
  "id",
  "digest",
  "name",
  "expired",
  "expires_at",
  "workflow_run.id",
  "workflow_run.head_sha",
  "workflow_run.head_branch",
  "workflow_run.repository_id",
  "workflow_run.head_repository_id",
])
  test(`original artifact metadata rejects changed ${key}`, () => {
    const meta = metadata("audit");
    validateSourceArtifact(meta, "audit", 1371160528);
    const keys = key.split(".");
    const obj = keys.length === 1 ? meta : meta[keys[0]];
    obj[keys.at(-1)] =
      key === "expired"
        ? true
        : key === "expires_at"
          ? "2000-01-01"
          : "changed";
    assert.throws(() => validateSourceArtifact(meta, "audit", 1371160528));
  });

test("ZIP, missing/changed/symlink candidates and signatures fail closed", () => {
  const directory = sourceDirectory();
  try {
    verifyRecoveryCandidates(directory, source.artifacts);
    const a = source.artifacts[0],
      path = join(directory, "packed", a.path);
    writeFileSync(path, Buffer.from("changed"));
    assert.throws(() => verifyRecoveryCandidates(directory, source.artifacts));
    rmSync(path);
    assert.throws(() => verifyRecoveryCandidates(directory, source.artifacts));
    symlinkSync(join(directory, "source/audit.zip"), path);
    assert.throws(() => verifyRecoveryCandidates(directory, source.artifacts));
    writeFileSync(join(directory, "source/audit.zip"), Buffer.from("changed"));
    assert.throws(
      () => readSourceArchive(join(directory, "source/audit.zip"), "audit"),
      /ZIP hash/,
    );
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("full source validation uses historical authority separately from current binding", async () => {
  const directory = sourceDirectory();
  try {
    const { request } = apiHarness();
    assert.deepEqual(
      (await verifyRecoverySource(directory, context(), request)).source,
      source,
    );
    assert.deepEqual(
      await validateRecoveryBinding(context(), request),
      binding(),
    );
    const p = packet();
    await verifyRecovery(
      directory,
      p,
      boundContext(p),
      request,
      fetchHarness().fetcher,
    );
    for (const fail of [
      (u, v) => {
        if (u.endsWith("/permission")) v.permission = "write";
        return v;
      },
      (u, v) => {
        if (
          u.includes(`/actions/runs/${recoverySource.auditRun}`) &&
          !u.includes("/jobs")
        )
          v.run_attempt = 2;
        return v;
      },
      (u, v) => {
        if (
          u.includes(`/actions/runs/${recoverySource.approvalRun}`) &&
          !u.includes("/jobs")
        )
          v.actor.id++;
        return v;
      },
      (u, v) => {
        if (u.endsWith("/actions/workflows/release.yml"))
          v.path = ".github/workflows/foreign.yml";
        return v;
      },
    ])
      await assert.rejects(
        verifyRecoverySource(directory, context(), apiHarness(fail).request),
      );
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("registry refuses completed config, missing previous successes and divergent public bytes", async () => {
  const p = packet();
  assert.equal(
    (await recoveryRegistry(p, context(), fetchHarness().fetcher)).filter(
      (s) => s.state === "published",
    ).length,
    4,
  );
  for (const options of [
    { configPublished: true },
    { missingName: "@t00ls-dev/auth" },
    { tamperBytes: true },
  ])
    await assert.rejects(
      recoveryRegistry(p, context(), fetchHarness(options).fetcher),
    );
});

test("source download never forwards GitHub credential and never replaces an existing directory", async () => {
  const root = mkdtempSync(join(tmpdir(), "foundation-recovery-download-"));
  const directory = join(root, "new");
  const h = fetchHarness();
  try {
    await downloadSource(
      directory,
      "synthetic",
      apiHarness().request,
      h.fetcher,
    );
    assert.equal(
      hash(readFileSync(join(directory, "source/audit.zip"))),
      recoverySource.auditZipHash,
    );
    for (const call of h.calls)
      assert.equal(
        !!call.options.headers?.Authorization,
        call.url.startsWith(api),
      );
    await assert.rejects(
      downloadSource(directory, "synthetic", apiHarness().request, h.fetcher),
    );
    const headers = new Headers({
      location: "https://untrusted.invalid/archive",
    });
    await assert.rejects(
      downloadSource(
        join(root, "bad"),
        "synthetic",
        apiHarness().request,
        async () => ({ status: 302, headers }),
      ),
      /storage host/,
    );
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("recovery audit imports exact bytes without install/build/pack or publication", async () => {
  const root = mkdtempSync(join(tmpdir(), "foundation-recovery-audit-"));
  const env = {
    RELEASE_MODE: "recovery-audit",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/master",
    GITHUB_REPOSITORY: "t00ls-dev/foundation",
    GITHUB_SHA: current,
    EXECUTION_SHA: current,
    RELEASE_PR: "136",
    RELEASE_SHA: old,
    DISTRIBUTION_MODE: "release",
    GITHUB_RUN_ID: "200",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_TOKEN: "synthetic",
  };
  const h = fetchHarness();
  try {
    const report = await recoveryAudit(join(root, "evidence"), env, {
      request: apiHarness().request,
      fetcher: h.fetcher,
      checkout: () => current,
      workingTree: () => "",
    });
    assert.equal(report.auditRun, 200);
    assert.equal(report.artifacts.length, 5);
    for (const a of source.artifacts)
      assert(
        readFileSync(join(root, "evidence/packed", a.path)).equals(
          sourceFiles.get(`packed/${a.path}`),
        ),
      );
    const p = JSON.parse(
      readFileSync(join(root, "evidence/authorization.json")),
    );
    validatePacket(p, boundContext(p), source.record);
    assert(
      h.calls.every((c) => !c.options.method || c.options.method === "GET"),
    );
    assert(h.calls.every((c) => !/oidc|fulcio|rekor/.test(c.url)));
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("audit and consumer reject master changes before any credential or upload", async () => {
  const root = mkdtempSync(join(tmpdir(), "foundation-recovery-stop-"));
  const env = {
    RELEASE_MODE: "recovery-audit",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/master",
    GITHUB_REPOSITORY: "t00ls-dev/foundation",
    GITHUB_SHA: current,
    EXECUTION_SHA: current,
    RELEASE_PR: "136",
    RELEASE_SHA: old,
    DISTRIBUTION_MODE: "release",
    GITHUB_RUN_ID: "200",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_TOKEN: "synthetic",
  };
  let masters = 0;
  const request = apiHarness((u, v) => {
    if (u.endsWith("/git/ref/heads/master") && ++masters >= 2)
      v.object.sha = old;
    return v;
  }).request;
  const h = fetchHarness();
  try {
    await assert.rejects(
      recoveryAudit(join(root, "evidence"), env, {
        request,
        fetcher: h.fetcher,
        checkout: () => current,
        workingTree: () => "",
      }),
    );
    assert.equal(h.calls.length, 0);
    const p = packet();
    await assert.rejects(
      validateConsumerAuthority(
        {
          ...env,
          RELEASE_MODE: "recovery-resume",
          AUDIT_RUN: "200",
          APPROVAL_RUN: "202",
          PLAN_DIGEST: envelopeDigest(p),
          CHANGES_DIGEST: p.changesDigest,
          RELEASE_CONFIRMATION: "PUBLISH_PUBLIC_FOUNDATION_PACKAGES",
        },
        p,
        certificate,
        apiHarness((u, v) => {
          if (u.endsWith("/git/ref/heads/master")) v.object.sha = old;
          return v;
        }).request,
      ),
    );
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("actual consumer refuses completed packages before synthetic authentication", async () => {
  const p = packet(),
    c = boundContext(p);
  let credentials = 0,
    uploads = 0;
  for (const a of source.artifacts.filter(
    (a) => a.name !== "@t00ls-dev/config",
  )) {
    await assert.rejects(
      consumeApprovedArtifact({
        packet: p,
        context: c,
        path: resolve("/synthetic", a.path),
        packDirectory: "/synthetic",
        env: {
          GITHUB_ACTIONS: "true",
          ACTIONS_ID_TOKEN_REQUEST_URL: "https://synthetic.invalid",
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: "synthetic",
        },
        config: { data: new Map() },
        credential: async () => {
          credentials++;
        },
        publishBuffer: async () => {
          uploads++;
        },
      }),
      /republish/,
    );
  }
  assert.equal(credentials, 0);
  assert.equal(uploads, 0);
});

test("workflow recovery audit has no install/build/pack, and shares the publisher and security permissions", () => {
  const w = parse(readFileSync(".github/workflows/release.yml", "utf8"));
  const audit = w.jobs.audit;
  for (const step of audit.steps) {
    if (
      step.uses === "./.github/actions/setup" ||
      /\b(?:pnpm|release\.mjs)\b/.test(step.run ?? "")
    )
      assert.equal(step.if, "inputs.mode == 'audit'");
  }
  assert.equal(audit.permissions["id-token"], undefined);
  assert.equal(w.jobs.approve.permissions["id-token"], undefined);
  assert.equal(w.jobs.publish.permissions["id-token"], "write");
  assert.match(w.jobs.publish.if, /inputs\.mode\s*== 'recovery-resume'/);
  assert.equal(w.jobs.publish.needs, "preflight");
  assert.equal(w.concurrency["cancel-in-progress"], false);
  const recovery = readFileSync(".github/scripts/release-recovery.mjs", "utf8");
  assert(
    !/spawnSync|libnpmpublish|publicationCredential|changeset.*pack|pnpm.*install/.test(
      recovery,
    ),
  );
});

test("recovery audit import graph loads without any node_modules installation", () => {
  const root = mkdtempSync(join(tmpdir(), "foundation-recovery-no-deps-"));
  try {
    for (const name of [
      "release-recovery.mjs",
      "release-core.mjs",
      "release-planning.mjs",
      "ci-evidence.mjs",
    ])
      writeFileSync(join(root, name), readFileSync(`.github/scripts/${name}`));
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "await import(process.argv[2]);",
        "synthetic-import",
        join(root, "release-recovery.mjs"),
      ],
      { cwd: root },
    );
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("registry manifests remain mandatory and version-bound in the module checkout from either cwd", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "foundation-recovery-manifests-"),
  );
  const root = process.cwd();
  const scripts = join(directory, ".github/scripts");
  try {
    mkdirSync(scripts, { recursive: true });
    for (const file of [
      "release-recovery.mjs",
      "release-core.mjs",
      "release-planning.mjs",
      "ci-evidence.mjs",
    ]) {
      writeFileSync(
        join(scripts, file),
        readFileSync(new URL(file, import.meta.url)),
      );
    }
    mkdirSync(join(directory, "packages/config"), { recursive: true });
    for (const name of names.filter(
      (name) => !source.record.packages.some((p) => p.name === name),
    )) {
      const path = join(directory, "packages", name.split("/")[1]);
      mkdirSync(path, { recursive: true });
      writeFileSync(
        join(path, "package.json"),
        JSON.stringify({ name, version: localVersions.get(name) }),
      );
    }
    const { recoveryRegistry: isolatedRegistry } = await import(
      pathToFileURL(join(scripts, "release-recovery.mjs"))
    );
    const manifest = join(directory, "packages/access/package.json");
    const original = readFileSync(manifest);
    const p = packet();
    for (const cwd of [directory, join(directory, "packages/config")]) {
      process.chdir(cwd);
      await isolatedRegistry(p, context(), fetchHarness().fetcher);
      rmSync(manifest);
      await assert.rejects(
        isolatedRegistry(p, context(), fetchHarness().fetcher),
        { code: "ENOENT" },
      );
      writeFileSync(manifest, JSON.stringify({ version: "999.0.0" }));
      await assert.rejects(
        isolatedRegistry(p, context(), fetchHarness().fetcher),
        /Unplanned registry version/,
      );
      writeFileSync(manifest, "invalid JSON");
      await assert.rejects(
        isolatedRegistry(p, context(), fetchHarness().fetcher),
        SyntaxError,
      );
      writeFileSync(manifest, original);
    }
  } finally {
    process.chdir(root);
    rmSync(directory, { recursive: true });
  }
});

test("current consumer validates authority from root and packages/config, then sends only the captured config buffer synthetically", async () => {
  const directory = sourceDirectory();
  const p = packet();
  const env = {
    RELEASE_MODE: "recovery-resume",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/master",
    GITHUB_REPOSITORY: "t00ls-dev/foundation",
    GITHUB_SHA: current,
    EXECUTION_SHA: current,
    RELEASE_PR: "136",
    RELEASE_SHA: old,
    DISTRIBUTION_MODE: "release",
    GITHUB_RUN_ID: "201",
    GITHUB_RUN_ATTEMPT: "1",
    AUDIT_RUN: "200",
    APPROVAL_RUN: "202",
    PLAN_DIGEST: envelopeDigest(p),
    CHANGES_DIGEST: p.changesDigest,
    RELEASE_CONFIRMATION: "PUBLISH_PUBLIC_FOUNDATION_PACKAGES",
    FOUNDATION_APPROVED_PACKET: join(directory, "authorization.json"),
    ACTIONS_ID_TOKEN_REQUEST_URL: "https://synthetic.invalid",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "synthetic",
  };
  let credentials = 0,
    uploads = 0;
  try {
    const approval = approvalCertificate(
      p,
      { login: owner.login, id: owner.id, permission: "admin" },
      202,
    );
    const root = process.cwd();
    let c;
    for (const cwd of [root, join(root, "packages/config")]) {
      try {
        process.chdir(cwd);
        c = await validateConsumerAuthority(
          env,
          p,
          approval,
          apiHarness().request,
          fetchHarness().fetcher,
        );
        assert.equal(c.recovery, true);
        await assert.rejects(
          validateConsumerAuthority(
            env,
            p,
            { ...approval, executionSha: old },
            apiHarness().request,
            fetchHarness().fetcher,
          ),
          /Snapshot\/artifact approval mismatch/,
        );
      } finally {
        process.chdir(root);
      }
    }
    const artifact = p.artifacts.find((p) => p.name === "@t00ls-dev/config");
    const original = sourceFiles.get(`packed/${artifact.path}`);
    await consumeApprovedArtifact({
      packet: p,
      context: c,
      path: join(directory, "packed", artifact.path),
      packDirectory: join(directory, "packed"),
      env,
      config: { data: new Map() },
      credential: async () => {
        credentials++;
        return "synthetic";
      },
      publishBuffer: async (metadata, bytes, options) => {
        uploads++;
        assert.equal(metadata.name, "@t00ls-dev/config");
        assert(bytes.equals(original));
        assert.equal(options.provenance, true);
        assert.equal(options.registry, registry);
        assert.equal(options.access, "public");
        assert.equal(options.defaultTag, "latest");
        assert.deepEqual(options.forceAuth, { token: "synthetic" });
      },
    });
    assert.equal(credentials, 1);
    assert.equal(uploads, 1);
    await assert.rejects(
      validateConsumerAuthority(
        env,
        p,
        approval,
        apiHarness().request,
        fetchHarness({ configPublished: true }).fetcher,
      ),
      /human reconciliation/,
    );
    let masterReads = 0;
    const moved = apiHarness((url, value) => {
      if (url.endsWith("/git/ref/heads/master") && ++masterReads >= 2)
        value.object.sha = old;
      return value;
    });
    await assert.rejects(
      validateConsumerAuthority(
        env,
        p,
        approval,
        moved.request,
        fetchHarness().fetcher,
      ),
      /snapshot moved/,
    );
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("late master movement preserves imported evidence and blocks completion", async () => {
  const root = mkdtempSync(join(tmpdir(), "foundation-recovery-late-stop-"));
  const env = {
    RELEASE_MODE: "recovery-audit",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/master",
    GITHUB_REPOSITORY: "t00ls-dev/foundation",
    GITHUB_SHA: current,
    EXECUTION_SHA: current,
    RELEASE_PR: "136",
    RELEASE_SHA: old,
    DISTRIBUTION_MODE: "release",
    GITHUB_RUN_ID: "200",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_TOKEN: "synthetic",
  };
  let imported = false;
  const h = fetchHarness();
  const request = apiHarness((u, v) => {
    if (imported && u.endsWith("/git/ref/heads/master")) v.object.sha = old;
    return v;
  }).request;
  try {
    await assert.rejects(
      recoveryAudit(join(root, "evidence"), env, {
        request,
        fetcher: async (...args) => {
          const value = await h.fetcher(...args);
          if (args[0].endsWith(".tgz")) imported = true;
          return value;
        },
        checkout: () => current,
        workingTree: () => "",
      }),
      /master moved/,
    );
    assert(imported);
    assert.equal(
      hash(readFileSync(join(root, "evidence/source/audit.zip"))),
      recoverySource.auditZipHash,
    );
    assert(
      h.calls.every((c) => !c.options.method || c.options.method === "GET"),
    );
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("live Git delta mismatch cannot be replaced by a forged current protected digest", async () => {
  const directory = sourceDirectory();
  const p = packet();
  try {
    const request = apiHarness((u, v) => {
      if (u.includes(`/git/trees/${executorTree.sha}`))
        v.tree.find(
          (e) => e.path === ".github/scripts/release-consumer.mjs",
        ).sha = "1".repeat(40);
      return v;
    }).request;
    await assert.rejects(
      verifyRecovery(
        directory,
        p,
        boundContext(p),
        request,
        fetchHarness().fetcher,
      ),
    );
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("recovery revalidates both source audit jobs and the new audit in every consumer verification", async () => {
  const directory = sourceDirectory();
  const p = packet();
  try {
    for (const fail of [
      (u, v) => {
        if (u.includes(`/actions/runs/${recoverySource.auditRun}/jobs`))
          v.jobs[0].run_id++;
        return v;
      },
      (u, v) => {
        if (u.includes(`/actions/runs/${recoverySource.auditRun}/jobs`))
          v.jobs[0].head_sha = current;
        return v;
      },
      (u, v) => {
        if (u.endsWith("/actions/runs/200")) v.run_attempt = 2;
        return v;
      },
      (u, v) => {
        if (u.includes("/actions/runs/200/jobs"))
          v.jobs[0].conclusion = "failure";
        return v;
      },
      (u, v) => {
        if (u.endsWith("/actions/runs/200")) v.actor.id++;
        return v;
      },
    ])
      await assert.rejects(
        verifyRecovery(
          directory,
          p,
          boundContext(p),
          apiHarness(fail).request,
          fetchHarness().fetcher,
        ),
      );
  } finally {
    rmSync(directory, { recursive: true });
  }
});
