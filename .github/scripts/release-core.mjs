import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

export const repository = "t00ls-dev/foundation";
export const registry = "https://registry.npmjs.org";
export const confirmation = "PUBLISH_PUBLIC_FOUNDATION_PACKAGES";
export const approvalConfirmation = "APPROVE_PUBLIC_FOUNDATION_SNAPSHOT";
export const npmVersion = "11.5.1";
export const releaseOwner = { login: "t00ls-dev", id: 14156701 };
export const bootstrapSha = "90a100377fa8c1e0e1b30174d4e611c545ed0ac4";
export function authenticationMethod(distribution) {
  assert(
    ["release", "bootstrap"].includes(distribution),
    "Unknown authentication distribution",
  );
  return distribution === "bootstrap" ? "bootstrap-token" : "oidc";
}
export const names = [
  "access",
  "audit",
  "auth",
  "config",
  "db",
  "email",
  "observability",
  "security",
  "tenant",
].map((name) => `@t00ls-dev/${name}`);
export const shaPattern = /^[0-9a-f]{40}$/;

export function validateRepository(repo) {
  assert.equal(repo.full_name, repository, "Wrong repository identity");
  assert.equal(repo.name, "foundation", "Wrong repository name");
  assert.equal(repo.owner?.login, "t00ls-dev", "Wrong repository owner");
  assert.equal(repo.default_branch, "master", "Wrong repository base");
  assert.equal(typeof repo.private, "boolean", "Missing repository visibility");
}

export const infrastructurePaths = [
  ".github/workflows/release.yml",
  ".github/scripts/release-core.mjs",
  ".github/scripts/release.mjs",
  ".github/scripts/release-planning.mjs",
  ".github/scripts/release.test.mjs",
  "docs/runbooks/packages.md",
];

// One recovery only. These are immutable trust anchors, not caller-selected input.
export const recoverySource = Object.freeze({
  releasePr: 136,
  executionSha: "93fb7de21ce3b57db025a1c8605d65ad75b25798",
  auditRun: 39516571800,
  approvalRun: 39517695207,
  auditArtifact: 12306989280,
  approvalArtifact: 12309375138,
  auditZipHash:
    "4cbff2f867f167885fc738eb2058f1964a7b90ada5a98ffd0c56849b0e235e15",
  approvalZipHash:
    "eefc7863d65b1bca024cbbfd6cdd7f0df4fe25dc942ad79195480b29ad7b2119",
  planDigest:
    "a50aef4ff731865544775da7f3ea24384d9b696d4c1ff6b7e52c9ee104d68c2e",
  changesDigest:
    "18abfe4930f69b79b882ec91b924377dbc09586f2397cc6ab8fd30652dec076d",
  protectedInputsDigest:
    "aaccef6eb9924512b32079c4b4e4e18576967c58dcffcfa3ca382f8e951e064f",
  artifactsDigest:
    "14212e61fb5202955800dfd989cf6f28588898d0d71bafb335ad4f66af3a6399",
  recordDigest:
    "c27c99c6577673f8608146f835c167632ef6713c5917d71a7c782dd8a99cea03",
  approvalDigest:
    "97ff8eb3957c83283b21dd76f23d85f9ca76330bbff2a230ac53769eded24f07",
});

export function releaseMode(mode) {
  const recovery = [
    "recovery-audit",
    "recovery-approve",
    "recovery-resume",
  ].includes(mode);
  return { mode: recovery ? mode.slice("recovery-".length) : mode, recovery };
}

export function validateRecoveryContext(context) {
  assert.equal(context.recovery, true, "Explicit recovery mode required");
  assert.equal(context.distribution, "release");
  assert.equal(context.releasePr, recoverySource.releasePr);
  assert.equal(context.releaseSha, recoverySource.executionSha);
  assert(shaPattern.test(context.executionSha));
  assert.notEqual(context.executionSha, recoverySource.executionSha);
  assert(
    ["audit", "approve", "resume"].includes(context.mode),
    "Recovery only allows audit, approval and resume",
  );
}

// This does not expand the ordinary six infrastructure exceptions. Every leaf
// outside this closed recovery-only list must remain identical to its source.
const recoveryPaths = new Set([
  ...infrastructurePaths,
  ".github/scripts/release-consumer.mjs",
  ".github/scripts/release-consumer.test.mjs",
  ".github/scripts/release-credential.mjs",
  ".github/scripts/release-recovery.mjs",
  ".github/scripts/release-recovery.test.mjs",
  ".github/scripts/fixtures/release/recovery-audit.zip",
  ".github/scripts/fixtures/release/recovery-approval.zip",
]);

export function recoveryBinding(sourceTree, executionTree, context) {
  validateRecoveryContext(context);
  protectedInputs(sourceTree);
  const inputs = protectedInputs(executionTree);
  const changes = snapshotChanges(sourceTree, executionTree);
  assert(changes.length, "Recovery executor delta required");
  for (const change of changes) {
    assert(recoveryPaths.has(change.path), "Recovery changed artifact inputs");
    assert(
      change.after &&
        change.after.type === "blob" &&
        ["100644", "100755"].includes(change.after.mode),
      "Recovery executor must be a regular file",
    );
  }
  assert.equal(
    digest(protectedInputs(sourceTree)),
    recoverySource.protectedInputsDigest,
  );
  return {
    changes,
    changesDigest: digest({
      releaseSha: context.releaseSha,
      snapshotSha: context.executionSha,
      changes,
    }),
    protectedInputsDigest: digest(inputs),
  };
}

export function validateRecoveryTarget(artifact, context) {
  if (!context.recovery) return;
  validateRecoveryContext(context);
  assert.equal(
    artifact.name,
    "@t00ls-dev/config",
    "Recovery cannot republish completed packages",
  );
  assert.equal(artifact.version, "0.1.3");
  assert.equal(
    artifact.hash,
    "d8831160f65313d662e12e02555b841930ffb3346b66b666887773862cc52f0a",
  );
}

export function recoveryRemaining(record, states, context) {
  validateRecoveryContext(context);
  assert.equal(digest(record), recoverySource.recordDigest);
  const remaining = remainingPlan(record, states, "resume");
  assert.equal(
    remaining.length,
    1,
    "Recovery requires config absent; stop for human reconciliation",
  );
  assert.equal(
    remaining[0].name,
    "@t00ls-dev/config",
    "Recovery cannot republish completed packages",
  );
  assert.equal(remaining[0].version, "0.1.3");
  return remaining;
}

export function protectedInputs(tree) {
  assert.equal(tree.truncated, false, "Incomplete protected-input tree");
  assert(shaPattern.test(tree.sha), "Invalid tree identity");
  assert(Array.isArray(tree.tree), "Missing protected-input entries");
  const seen = new Set();
  const entries = [];
  for (const file of tree.tree) {
    assert(
      typeof file.path === "string" &&
        file.path.length > 0 &&
        !file.path.startsWith("/") &&
        file.path
          .split("/")
          .every((part) => part && part !== "." && part !== ".."),
      "Unsafe Git input path",
    );
    assert(!seen.has(file.path), "Duplicate Git input path");
    seen.add(file.path);
    assert(shaPattern.test(file.sha), "Invalid Git object identity");
    if (file.type === "tree") {
      assert.equal(file.mode, "040000");
      assert(
        !infrastructurePaths.includes(file.path),
        "Infrastructure exception must be a regular file",
      );
      continue; // Parent tree OIDs change when an allowed leaf changes.
    }
    assert(
      file.type === "blob" && ["100644", "100755"].includes(file.mode),
      "Symlinks/gitlinks are unsupported release inputs",
    );
    if (infrastructurePaths.includes(file.path)) continue;
    entries.push({
      path: file.path,
      mode: file.mode,
      type: file.type,
      oid: file.sha,
    });
  }
  for (const path of [
    "LICENSE",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    ".changeset/release-plan.json",
    ...names.map((name) => `packages/${name.split("/")[1]}/package.json`),
    ...names.map((name) => `packages/${name.split("/")[1]}/LICENSE`),
  ])
    assert(
      entries.some((entry) => entry.path === path),
      `Missing protected input: ${path}`,
    );
  return entries.sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
}

export function validateProtectedInputs(releaseTree, executionTree) {
  const approved = protectedInputs(releaseTree);
  assert.deepEqual(
    protectedInputs(executionTree),
    approved,
    "Protected release inputs changed",
  );
  return digest(approved);
}

export function snapshotChanges(releaseTree, snapshotTree) {
  // Validate complete trees, then include even the six executor exceptions in review.
  protectedInputs(releaseTree);
  protectedInputs(snapshotTree);
  const entries = (tree) =>
    new Map(
      tree.tree
        .filter((f) => f.type !== "tree")
        .map((f) => [f.path, { mode: f.mode, type: f.type, oid: f.sha }]),
    );
  const before = entries(releaseTree),
    after = entries(snapshotTree);
  return [...new Set([...before.keys(), ...after.keys()])]
    .sort()
    .flatMap((path) =>
      canonical(before.get(path) ?? null) === canonical(after.get(path) ?? null)
        ? []
        : [
            {
              path,
              before: before.get(path) ?? null,
              after: after.get(path) ?? null,
            },
          ],
    );
}

export function validateReviewEvidence(evidence, expected) {
  assert.equal(
    canonical(evidence),
    canonical(expected),
    "Historical review evidence changed",
  );
}

export function validateDistribution(context, record) {
  assert(
    ["release", "bootstrap"].includes(context.distribution),
    "Explicit distribution mode required",
  );
  if (context.distribution !== "bootstrap") return;
  assert.equal(context.releasePr, 30, "Bootstrap is restricted to PR #30");
  assert.equal(
    context.releaseSha,
    bootstrapSha,
    "Immutable bootstrap provenance required",
  );
  assert.deepEqual(
    record.packages.map((p) => p.name).sort(),
    [...names].sort(),
    "Bootstrap requires exactly nine packages",
  );
  for (const item of record.packages) {
    assert.equal(item.oldVersion, "0.1.1");
    assert.equal(
      item.version,
      ["@t00ls-dev/auth", "@t00ls-dev/security"].includes(item.name)
        ? "0.2.0"
        : "0.1.2",
    );
  }
}

export function validateReleaseActor(run, workflow, permission, context) {
  assert(
    Number.isSafeInteger(context.runId) && context.runId > 0,
    "Authorization run identity required",
  );
  assert(Number.isSafeInteger(workflow.id) && workflow.id > 0);
  assert.equal(run.id, context.runId, "Wrong authorization run");
  assert.equal(run.run_attempt, 1, "Re-runs cannot authorize releases");
  assert.equal(run.workflow_id, workflow.id);
  assert.equal(workflow.path, ".github/workflows/release.yml");
  assert.equal(run.path, workflow.path);
  assert.equal(run.repository?.full_name, repository);
  assert.equal(run.head_repository?.full_name, repository);
  assert.equal(run.event, "workflow_dispatch");
  assert.equal(run.head_branch, "master");
  assert.equal(run.head_sha, context.executionSha);
  assert(
    ["in_progress", "completed"].includes(run.status),
    "Incomplete authorization run",
  );
  for (const actor of [run.actor, run.triggering_actor, permission.user]) {
    assert.equal(actor?.type, "User", "Human release owner required");
    assert.equal(actor?.login, releaseOwner.login);
    assert.equal(
      actor?.id,
      releaseOwner.id,
      "Immutable approver identity mismatch",
    );
  }
  assert.equal(
    permission.permission,
    "admin",
    "Current administrator authority required",
  );
  return { ...releaseOwner, permission: "admin" };
}

export function approvalCertificate(packet, actor, runId) {
  return {
    format: packet.format === 5 ? 3 : 2,
    domain:
      packet.format === 5
        ? "foundation-npm-recovery-approval"
        : "foundation-npm-snapshot-approval",
    registry,
    access: "public",
    distribution: packet.distribution,
    authentication: packet.authentication,
    releasePr: packet.releasePr,
    releaseSha: packet.releaseSha,
    snapshotSha: packet.snapshotSha,
    executionSha: packet.executionSha,
    protectedInputsDigest: packet.protectedInputsDigest,
    changesDigest: packet.changesDigest,
    planDigest: envelopeDigest(packet),
    auditRun: packet.auditRun,
    artifactsDigest: digest(packet.artifacts),
    approvalRun: runId,
    actor,
  };
}

export function validateApproval(
  certificate,
  run,
  jobs,
  workflow,
  permission,
  packet,
  context,
) {
  validatePacket(packet, context, packet.record);
  assert(
    Number.isSafeInteger(context.approvalRun) && context.approvalRun > 0,
    "Approval run required",
  );
  const actor = validateReleaseActor(run, workflow, permission, {
    ...context,
    runId: context.approvalRun,
  });
  assert.equal(run.status, "completed");
  assert.equal(run.conclusion, "success");
  const approvals = jobs.filter((job) => job.name === "approve");
  assert.equal(approvals.length, 1, "Exactly one approval job required");
  const job = approvals[0];
  assert.equal(job.run_id, run.id);
  assert.equal(job.run_attempt, 1);
  assert.equal(job.head_sha, context.executionSha);
  assert.equal(job.status, "completed");
  assert.equal(job.conclusion, "success");
  assert.equal(
    digest(certificate),
    digest(approvalCertificate(packet, actor, run.id)),
    "Snapshot/artifact approval mismatch",
  );
}

export function validatePublisherEnvironment(
  env,
  actualNpmVersion,
  distribution = "release",
) {
  assert.equal(
    actualNpmVersion,
    npmVersion,
    "Pinned OIDC-compatible npm required",
  );
  assert(
    !env.NODE_AUTH_TOKEN && !env.NPM_TOKEN && !env.NPM_CONFIG_TOKEN,
    "Token fallback is forbidden",
  );
  for (const key of Object.keys(env)) {
    assert(
      !/^npm_config_.*(?:auth|password|username|certfile|keyfile|tokenhelper)/i.test(
        key,
      ),
      "Ambient npm authentication is forbidden",
    );
  }
  if (authenticationMethod(distribution) === "bootstrap-token") {
    assert(
      typeof env.NPM_BOOTSTRAP_TOKEN === "string" &&
        env.NPM_BOOTSTRAP_TOKEN.trim().length > 0,
      "Bootstrap publication credential required",
    );
  } else {
    assert(
      !env.NPM_BOOTSTRAP_TOKEN && !env.NPM_ID_TOKEN,
      "Traditional or injected identity fallback is forbidden",
    );
    assert(
      env.ACTIONS_ID_TOKEN_REQUEST_URL && env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
      "OIDC publisher context required",
    );
  }
}

export function validateAncestry(comparison, releaseSha, executionSha) {
  assert(shaPattern.test(releaseSha) && shaPattern.test(executionSha));
  assert.equal(
    comparison.base_commit?.sha,
    releaseSha,
    "Comparison base mismatch",
  );
  assert.equal(
    comparison.merge_base_commit?.sha,
    releaseSha,
    "Release SHA is not an ancestor of execution SHA",
  );
  assert.equal(comparison.behind_by, 0, "Execution is behind release content");
  assert.equal(
    comparison.status,
    releaseSha === executionSha ? "identical" : "ahead",
    "Invalid release/execution ancestry",
  );
}

export function validateAuditRun(audit, jobs, workflowId, context) {
  assert.equal(audit.id, context.auditRun, "Different audit run");
  assert.equal(audit.run_attempt, 1, "Audit re-run requires a new dispatch");
  assert.equal(audit.event, "workflow_dispatch");
  assert.equal(audit.conclusion, "success");
  assert.equal(audit.head_branch, "master");
  assert.equal(
    audit.head_sha,
    context.executionSha,
    "Audit used a different executor; new audit required",
  );
  assert.equal(audit.workflow_id, workflowId);
  if (context.recovery) {
    assert.equal(audit.status, "completed");
    assert.equal(audit.repository?.full_name, repository);
    assert.equal(audit.head_repository?.full_name, repository);
    assert.equal(audit.path, ".github/workflows/release.yml");
    const audits = jobs.filter((job) => job.name === "audit");
    assert.equal(audits.length, 1);
    assert.equal(audits[0].run_id, audit.id);
    assert.equal(audits[0].run_attempt, 1);
    assert.equal(audits[0].head_sha, context.executionSha);
    assert.equal(audits[0].status, "completed");
    assert.equal(audits[0].conclusion, "success");
  }
  assert(
    Array.isArray(jobs) &&
      jobs.some((job) => job.name === "audit" && job.conclusion === "success"),
    "Referenced run did not complete the audit job",
  );
}

export function validateArtifactPath(item) {
  assert(names.includes(item.name), "Unexpected artifact package");
  compareVersions(item.version, item.version);
  assert.equal(
    item.path,
    `packages/${item.name.replace(/^@/, "").replace("/", "-")}-${item.version}.tgz`,
    "Artifact path differs from Changesets package/version filename",
  );
}

export function validateReleaseCommit(commits, pr, record) {
  assert.equal(
    commits.length,
    1,
    "Exactly one generated release commit required",
  );
  const commit = commits[0];
  assert(shaPattern.test(pr.head.sha), "Invalid release head SHA");
  assert.equal(commit.sha, pr.head.sha, "Release commit differs from PR head");
  assert.equal(commit.author?.login, "github-actions[bot]");
  assert.equal(
    commit.committer?.login,
    "web-flow",
    "GitHub API-generated commit required",
  );
  assert.equal(
    commit.commit?.verification?.verified,
    true,
    "Verified release signature required",
  );
  assert.equal(commit.commit?.verification?.reason, "valid");
  assert.deepEqual(
    commit.parents?.map((parent) => parent.sha),
    [record.baseSha],
    "Single planning-base parent required",
  );
}

export function validateRecordPlan(record, expected) {
  validateRecord(record);
  validateRecord(expected);
  assert.equal(
    digest(record),
    digest(expected),
    "Release record differs from independently recalculated Changesets plan",
  );
}

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export const digest = (value) =>
  createHash("sha256").update(canonical(value)).digest("hex");
export const hash = (bytes, algorithm = "sha256", encoding = "hex") =>
  createHash(algorithm).update(bytes).digest(encoding);

export async function authenticatedJson(
  url,
  token,
  fetcher = fetch,
  accept = "application/vnd.github+json",
) {
  assert(token, "Authentication token required");
  const response = await fetcher(url, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": accept,
      "User-Agent": "foundation-private-release",
    },
    signal: AbortSignal.timeout(30000),
    redirect: "error",
  });
  assert(
    response.ok && response.status === 200,
    `Authenticated request failed: ${response.status} ${url}`,
  );
  return response.json();
}

// Only the nine holding tarballs inspected on 2026-10-15 are recognized.
// This is an observation allowlist, never approval of a publishable version.
const stageVersion = "0.0.0-stage";
const stageDescription = "Temporary package placeholder for staged publishing";
const observedStageDistributions = {
  access: [
    "sha512-C1kObSGOdTFnaxpe1UQpmiViTeuzcorWxMUZjTLD4+n2FnpNXhvWenTlGz/sNdC8Of4mEdlhijAeissgejaRCA==",
    "83a9bb9f1af89e147ac8e0c1353f7155bb85fed0",
    339,
  ],
  audit: [
    "sha512-XiZAFUpUTBSwjq2IbsB5GF1ppSlX+jvW6vJii4dR4RsY/VClqcmmQjs+50HFNjdi+V7AMC5dYIGXUnpS4TVH4A==",
    "b2a9b3ff501f7c26a67287fd40410e5e36bce26b",
    338,
  ],
  auth: [
    "sha512-vygCBOpuYq3EUlPkhKFR+9EKBf4l9zQpUikfH9XzdeIuOF/8Fz86RCLX2QX4yJUJdrxA0lIqXa2pC/mROJ6y/g==",
    "8cbd3d382b729a8c584aa186c3144b50419e913b",
    337,
  ],
  config: [
    "sha512-aU2xBT5D5wLZPfVuKX3RqHMz7leYi9N0jVHIFhBVUclUUuy2o7FEzrqkuYYSvSb15FUJu9x+zG3iQGMwcw7SxA==",
    "8b51ac8446655fbc763c93e9c0487581004999d1",
    339,
  ],
  db: [
    "sha512-XKSaLkxO4IBG3i7YP3MbVSJRLJ3T14eDJfvPxxAkS3V9BfK8+plrNqZb4cvbmXYdK33obyOdngMpRA02wETB1w==",
    "6a92b8c55d17869abd79ade7695f171ef8364b1b",
    335,
  ],
  email: [
    "sha512-UBE8gtZYXWha+X15EyHS5sS5B7rjERSJVoGfPmdgOOCC+MlAh5f4PCpo81Vbs5s9IAeaO4KllcVcfv9vNWCfuQ==",
    "ef8bc44c0403894bdb569c7fc25be8cbead951fb",
    338,
  ],
  observability: [
    "sha512-8QtoXDdsheMVevFPzE5aoSBeFYAURYoylC+8o0oJahjNNA8oVUThePvgmTN8zYYzzkykOcvmvFd+ZLwp64sSsg==",
    "6030c12edd95850c0be045eda3043dde37836b86",
    346,
  ],
  security: [
    "sha512-eteEVbapQoGxfntpLOgxF38dxUgFO1GuhUpnqJ7GjgwQdHg4xpU2r4LQYTGLo3MnaQ0PBQuX/wim27dERrpERg==",
    "fbfb48de86ce05770ee2b102b4ff5b053288999a",
    341,
  ],
  tenant: [
    "sha512-LkZd92YYDBh235RzDU0ileAuMFgEvpqWtwPTbQGLF6TrPIUvOjVU8olu0xHA33hozjLOYzuftims6rQQ+rUiUA==",
    "64d4b41bd442a99f57c65a32e5e116e377233450",
    339,
  ],
};

function stageObservation(name) {
  return {
    version: stageVersion,
    integrity: observedStageDistributions[name.split("/")[1]][0],
    tarball: `${registry}/${name}/-/${name.split("/")[1]}-${stageVersion}.tgz`,
  };
}

function validateStagePlaceholder(pkg, name) {
  assert.deepEqual(
    Object.keys(pkg).sort(),
    [
      "name",
      "version",
      "_id",
      "stub",
      "maintainers",
      "dist",
      "_npmUser",
      "description",
      "directories",
    ].sort(),
    "Unexpected staging placeholder fields",
  );
  assert.equal(pkg._id, `${name}@${stageVersion}`);
  assert.equal(pkg.stub, true, "Invalid staging placeholder marker");
  assert.equal(pkg.description, stageDescription);
  assert.deepEqual(pkg.directories, {});
  assert.equal(pkg._npmUser?.name, "t00ls-dev");
  assert.equal(typeof pkg._npmUser.email, "string");
  assert(pkg._npmUser.email.length > 0);
  assert.deepEqual(Object.keys(pkg._npmUser).sort(), ["email", "name"]);
  assert.deepEqual(pkg.maintainers, [pkg._npmUser]);
  assert.deepEqual(
    Object.keys(pkg.dist).sort(),
    [
      "shasum",
      "tarball",
      "fileCount",
      "integrity",
      "signatures",
      "unpackedSize",
    ].sort(),
  );
  const [integrity, shasum, unpackedSize] =
    observedStageDistributions[name.split("/")[1]];
  assert.equal(
    pkg.dist.integrity,
    integrity,
    "Unknown staging placeholder bytes",
  );
  assert.equal(pkg.dist.shasum, shasum);
  assert.equal(pkg.dist.fileCount, 2);
  assert.equal(pkg.dist.unpackedSize, unpackedSize);
  assert(Array.isArray(pkg.dist.signatures) && pkg.dist.signatures.length > 0);
  for (const signature of pkg.dist.signatures) {
    assert.deepEqual(Object.keys(signature).sort(), ["keyid", "sig"]);
    assert.equal(typeof signature.keyid, "string");
    assert.equal(typeof signature.sig, "string");
    assert(/^SHA256:[A-Za-z0-9+/]+={0,2}$/.test(signature.keyid));
    assert(/^[A-Za-z0-9+/]+={0,2}$/.test(signature.sig));
  }
}

export function validatePackument(packument, name) {
  const object = (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  assert(names.includes(name), "Package outside registry allowlist");
  assert(object(packument), "Invalid registry packument");
  assert.equal(packument.name, name, "Registry package identity mismatch");
  assert(object(packument.versions), "Missing registry versions");
  const versions = Object.keys(packument.versions);
  assert(versions.length > 0, "Empty registry versions; onboarding required");
  assert(object(packument["dist-tags"]), "Missing registry dist-tags");
  const latest = packument["dist-tags"].latest;
  assert(
    versions.includes(latest),
    "Registry latest must identify an existing version",
  );
  const integrities = {};
  const placeholders = [];
  for (const version of versions) {
    if (version !== stageVersion) compareVersions(version, version);
    const pkg = packument.versions[version];
    assert(object(pkg), "Malformed registry version");
    assert.equal(pkg.name, name, "Registry version package identity mismatch");
    assert.equal(pkg.version, version, "Registry version identity mismatch");
    assert(object(pkg.dist), "Missing registry distribution metadata");
    assert(
      /^sha512-[a-zA-Z0-9+/]{86}==$/.test(pkg.dist.integrity ?? ""),
      "Missing/invalid registry SHA-512 integrity",
    );
    const tarball = new URL(pkg.dist.tarball);
    assert.equal(
      tarball.origin,
      registry,
      "Unexpected registry tarball origin",
    );
    assert(
      !tarball.username && !tarball.password && !tarball.hash,
      "Unsafe registry tarball URL",
    );
    assert.equal(tarball.search, "", "Unexpected tarball query");
    assert.equal(
      decodeURIComponent(tarball.pathname),
      `/${name}/-/${name.split("/")[1]}-${version}.tgz`,
      "Registry tarball package/version mismatch",
    );
    if (version === stageVersion) {
      validateStagePlaceholder(pkg, name);
      assert.notEqual(
        latest,
        stageVersion,
        "Registry latest cannot be a placeholder",
      );
      placeholders.push(stageObservation(name));
    } else {
      assert(!pkg.stub, "Stable registry version cannot be a placeholder");
      integrities[version] = pkg.dist.integrity;
    }
  }
  return {
    name,
    versions: versions.filter((version) => version !== stageVersion),
    latest,
    integrities,
    ...(placeholders.length ? { placeholders } : {}),
  };
}

export async function registryInventory(
  distribution = "release",
  fetcher = fetch,
  { signal, revalidate = false } = {},
) {
  assert(
    ["release", "bootstrap"].includes(distribution),
    "Unknown distribution mode",
  );
  const result = {};
  for (const name of names) {
    signal?.throwIfAborted();
    const response = await fetcher(`${registry}/${name.replace("/", "%2F")}`, {
      headers: {
        Accept: "application/json",
        ...(revalidate ? { "Cache-Control": "no-cache" } : {}),
      },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000),
      ...(revalidate ? { cache: "no-store" } : {}),
      redirect: "error",
    });
    if (response.status === 404 && distribution === "bootstrap") {
      assert.equal(
        (await response.json()).error,
        "Not found",
        "Invalid absence response",
      );
      // Observation only: reconciliation, approval and publisher gates must authorize creation.
      result[name] = { name, versions: [], latest: null, integrities: {} };
    } else {
      assert(
        response.ok && response.status === 200,
        `Registry request failed: ${response.status}`,
      );
      result[name] = validatePackument(await response.json(), name);
    }
  }
  return result;
}

export function compareVersions(left, right) {
  const parse = (v) => {
    assert(
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(v),
      `Only stable SemVer is supported: ${v}`,
    );
    return v.split(".").map(BigInt);
  };
  const a = parse(left),
    b = parse(right);
  for (let index = 0; index < 3; index++)
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  return 0;
}

export function recordFromStatus(
  status,
  { baseSha, cliVersion, changesetBytes, manifestByName },
) {
  const releases = status.releases.filter((item) => item.type !== "none");
  const record = {
    format: 1,
    repository,
    cliVersion,
    baseSha,
    changesets: status.changesets
      .map((item) => ({ id: item.id, hash: hash(changesetBytes(item.id)) }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    packages: releases
      .map((item) => {
        assert(
          names.includes(item.name),
          "Unexpected package in Changesets status",
        );
        const pkg = manifestByName(item.name);
        assert.equal(
          pkg.version,
          item.oldVersion,
          "Changesets planning base version mismatch",
        );
        return {
          name: item.name,
          oldVersion: item.oldVersion,
          version: item.newVersion,
          type: item.type,
          changesets: [...item.changesets].sort(),
          reason: item.changesets.length ? "changeset" : "internal-dependency",
          dependencies: Object.keys({
            ...pkg.dependencies,
            ...pkg.optionalDependencies,
            ...pkg.peerDependencies,
            ...pkg.devDependencies,
          })
            .filter((name) => releases.some((release) => release.name === name))
            .sort(),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
  validateRecord(record);
  return record;
}

export function validateContext(context, authorization = false) {
  assert(
    context.recovery === undefined || typeof context.recovery === "boolean",
    "Invalid recovery mode",
  );
  if (context.recovery) validateRecoveryContext(context);
  assert(
    !Object.hasOwn(context, "expectedSha") &&
      !Object.hasOwn(context, "expected_sha") &&
      context.legacyExpectedSha === undefined,
    "expected_sha is no longer supported; use release_sha and execution_sha",
  );
  assert.equal(context.event, "workflow_dispatch", "Manual dispatch required");
  assert.equal(context.ref, "refs/heads/master", "master required");
  assert.equal(context.repository, repository, "Unexpected repository");
  assert(shaPattern.test(context.releaseSha), "Full release_sha required");
  assert(shaPattern.test(context.executionSha), "Full execution_sha required");
  assert.equal(
    context.sha,
    context.executionSha,
    "Workflow execution SHA mismatch",
  );
  assert.equal(
    context.masterSha,
    context.executionSha,
    "master moved after executor authorization",
  );
  assert(
    ["release", "bootstrap"].includes(context.distribution),
    "Explicit distribution mode required",
  );
  assert(
    ["audit", "approve", "publish", "resume"].includes(context.mode),
    "Invalid mode",
  );
  assert(
    Number.isSafeInteger(context.releasePr) && context.releasePr > 0,
    "Invalid release_pr",
  );
  if (authorization) {
    assert.equal(
      context.confirmation,
      context.mode === "approve" ? approvalConfirmation : confirmation,
      "Incorrect public release confirmation",
    );
    assert(
      /^[0-9a-f]{64}$/.test(context.planDigest),
      "Full plan_digest required",
    );
    assert(
      Number.isSafeInteger(context.auditRun) && context.auditRun > 0,
      "audit_run required",
    );
    assert(
      /^[0-9a-f]{64}$/.test(context.reviewedChangesDigest),
      "Exact reviewed changes_digest required",
    );
    if (context.mode !== "approve")
      assert(
        Number.isSafeInteger(context.approvalRun) && context.approvalRun > 0,
        "approval_run required",
      );
  }
}

export function validateRecord(record) {
  assert.equal(record.format, 1, "Unknown release record format");
  assert.equal(record.repository, repository);
  assert(shaPattern.test(record.baseSha), "Invalid planning base");
  assert.equal(
    record.cliVersion,
    "3.0.3",
    "Review record support when upgrading Changesets",
  );
  assert(
    Array.isArray(record.changesets) && record.changesets.length > 0,
    "No consumed changesets",
  );
  const ids = new Set();
  for (const item of record.changesets) {
    assert(
      /^[a-zA-Z0-9_-]+$/.test(item.id) && /^[0-9a-f]{64}$/.test(item.hash),
      "Invalid changeset provenance",
    );
    assert(!ids.has(item.id), "Duplicate changeset");
    ids.add(item.id);
  }
  assert(
    Array.isArray(record.packages) && record.packages.length > 0,
    "Empty approved plan",
  );
  const seen = new Set();
  for (const item of record.packages) {
    assert(
      names.includes(item.name),
      `Unexpected/private package: ${item.name}`,
    );
    assert(!seen.has(item.name), "Duplicate approved package");
    seen.add(item.name);
    assert(["patch", "minor", "major"].includes(item.type));
    assert(
      compareVersions(item.version, item.oldVersion) > 0,
      "Release must advance version",
    );
    const old = item.oldVersion.split(".").map(BigInt);
    const calculated =
      item.type === "major"
        ? `${old[0] + 1n}.0.0`
        : item.type === "minor"
          ? `${old[0]}.${old[1] + 1n}.0`
          : `${old[0]}.${old[1]}.${old[2] + 1n}`;
    assert.equal(
      item.version,
      calculated,
      "Version differs from declared bump",
    );
    assert(
      Array.isArray(item.changesets) &&
        item.changesets.every((id) => ids.has(id)),
      "Unknown consumed changeset",
    );
    assert(Array.isArray(item.dependencies));
    if (item.reason === "changeset") assert(item.changesets.length > 0);
    else {
      assert.equal(item.reason, "internal-dependency");
      assert(
        item.dependencies.some((name) =>
          record.packages.some((release) => release.name === name),
        ),
        "Unexplained dependency bump",
      );
    }
  }
}

export function validatePr(pr, context, record) {
  assert(pr && pr.number === context.releasePr, "Release PR missing");
  assert.equal(pr.state, "closed");
  assert.equal(pr.merged, true, "Release PR not merged");
  assert.equal(pr.base?.ref, "master", "Wrong PR base");
  assert.equal(pr.base?.repo?.full_name, repository);
  assert.equal(pr.head?.repo?.full_name, repository);
  assert.equal(
    pr.head?.ref,
    "changeset-release/master",
    "Not a Version Packages PR",
  );
  assert.equal(
    pr.merge_commit_sha,
    context.releaseSha,
    "Release merge commit differs from release_sha",
  );
  assert(
    pr.user?.login === "github-actions[bot]",
    "Release PR must be generated by Changesets Action",
  );
  validateRecord(record);
}

export function validateManifests(manifests, record) {
  validateRecord(record);
  const publicPackages = manifests.filter(({ pkg }) => pkg.private !== true);
  assert.deepEqual(
    publicPackages.map(({ pkg }) => pkg.name).sort(),
    [...names].sort(),
    "Unexpected public workspace",
  );
  for (const { pkg, path } of manifests) {
    if (!names.includes(pkg.name)) {
      assert.equal(pkg.private, true, `Private workspace required: ${path}`);
      continue;
    }
    assert.equal(path, `packages/${pkg.name.split("/")[1]}`);
    assert.equal(pkg.license, "MIT");
    assert.equal(pkg.repository, "https://github.com/t00ls-dev/foundation");
    assert.equal(pkg.publishConfig?.registry, registry);
    assert.equal(pkg.publishConfig?.access, "public");
    assert.deepEqual(
      pkg.publishConfig,
      { registry, access: "public" },
      "Unexpected publication overrides",
    );
    assert.deepEqual(pkg.files, ["dist", "README.md"]);
    const approved = record.packages.find((item) => item.name === pkg.name);
    if (approved)
      assert.equal(pkg.version, approved.version, "Unauthorized local version");
    compareVersions(pkg.version, pkg.version);
  }
}

// Inventory contains registry-observed facts. Privacy and administrative
// repository association are onboarding invariants, not npm runtime facts.
export function reconcile(
  record,
  inventory,
  artifacts = [],
  context = { distribution: "release" },
) {
  validateRecord(record);
  validateDistribution(context, record);
  const states = [];
  for (const item of record.packages) {
    const pkg = inventory[item.name];
    assert(
      pkg && pkg.name === item.name,
      `Registry inaccessible/identity mismatch: ${item.name}`,
    );
    assert(Array.isArray(pkg.versions));
    for (const version of pkg.versions) compareVersions(version, version);
    if (pkg.placeholders !== undefined)
      assert.deepEqual(
        pkg.placeholders,
        [stageObservation(item.name)],
        "Unrecognized registry placeholder observation",
      );
    if (context.distribution === "bootstrap")
      assert(
        pkg.versions.every((v) => v === item.version),
        "Unexpected existing bootstrap versions",
      );
    else
      assert(
        pkg.versions.includes(item.oldVersion),
        "Registry lacks approved previous version",
      );
    const higher = pkg.versions
      .filter((v) => /^\d+\.\d+\.\d+$/.test(v))
      .some((v) => compareVersions(v, item.version) > 0);
    const artifact = artifacts.find((a) => a.name === item.name);
    let state = pkg.versions.includes(item.version) ? "published" : "absent";
    if (
      higher ||
      (state === "published" &&
        (!artifact ||
          pkg.integrities?.[item.version] !== artifact.integrity ||
          pkg.latest !== item.version))
    )
      state = "divergent";
    if (
      state === "absent" &&
      pkg.latest !==
        (context.distribution === "bootstrap" ? null : item.oldVersion)
    )
      state = "divergent";
    states.push({
      name: item.name,
      version: item.version,
      state,
      ...(pkg.placeholders ? { placeholders: pkg.placeholders } : {}),
    });
  }
  return states;
}

export const publicationObservationLimits = Object.freeze({
  maxAttempts: 12,
  maxDurationMs: 360000,
  intervalMs: 30000,
});

// No upload callback: retries are observations only, after accepted uploads.
export async function observePublication(
  record,
  artifacts,
  context,
  {
    retryAbsent = false,
    fetcher = fetch,
    now = () => performance.now(),
    sleep = (ms, signal) => delay(ms, undefined, { signal }),
  } = {},
) {
  const { maxAttempts, maxDurationMs, intervalMs } =
    publicationObservationLimits;
  const started = now();
  const signal = AbortSignal.timeout(maxDurationMs);
  let states;
  let attempts = 0;
  while (attempts < maxAttempts && now() - started < maxDurationMs) {
    states = reconcile(
      record,
      await registryInventory(context.distribution, fetcher, {
        signal,
        revalidate: retryAbsent,
      }),
      artifacts,
      context,
    );
    attempts++;
    const elapsedMs = now() - started;
    assert(
      elapsedMs < maxDurationMs,
      "Post-publication observation deadline exceeded",
    );
    if (
      !retryAbsent ||
      states.some((item) => item.state === "divergent") ||
      states.every((item) => item.state === "published")
    )
      return { states, observation: { attempts, elapsedMs, exhausted: false } };
    if (attempts < maxAttempts)
      await sleep(Math.min(intervalMs, maxDurationMs - elapsedMs), signal);
  }
  assert(states, "Post-publication observation deadline exceeded");
  return {
    states,
    observation: { attempts, elapsedMs: now() - started, exhausted: true },
  };
}

export function remainingPlan(record, states, mode) {
  assert(["audit", "publish", "resume"].includes(mode), "Unknown release mode");
  assert(
    states.every((item) =>
      ["published", "absent", "divergent"].includes(item.state),
    ),
    "Unknown registry state",
  );
  assert(states.length === record.packages.length);
  for (const item of record.packages)
    assert(
      states.some(
        (state) => state.name === item.name && state.version === item.version,
      ),
    );
  assert(
    !states.some((item) => item.state === "divergent"),
    "Registry divergence/downgrade; stop",
  );
  if (mode !== "resume")
    assert(
      states.every((item) => item.state === "absent"),
      "Already-published target requires explicit resume",
    );
  return record.packages.filter(
    (item) =>
      states.find((state) => state.name === item.name).state === "absent",
  );
}

export function envelopeDigest(packet) {
  if (packet.format === 5) return digest(packet);
  return digest({
    format: packet.format,
    repository: packet.repository,
    registry: packet.registry,
    access: packet.access,
    scopeOwner: packet.scopeOwner,
    distribution: packet.distribution,
    authentication: packet.authentication,
    snapshotSha: packet.snapshotSha,
    changesDigest: packet.changesDigest,
    releasePr: packet.releasePr,
    releaseSha: packet.releaseSha,
    executionSha: packet.executionSha,
    protectedInputsDigest: packet.protectedInputsDigest,
    auditRun: packet.auditRun,
    record: packet.record,
    artifacts: packet.artifacts,
  });
}

export function validatePublishPlan(plan, approved) {
  assert.equal(plan.version, 1);
  assert(Array.isArray(plan.plan));
  const entries = plan.plan.flat();
  assert(
    entries.every(
      (item) =>
        item.kind === "publish" &&
        item.access === "public" &&
        item.tag === "latest",
    ),
    "Unexpected Changesets publish entry",
  );
  assert.deepEqual(
    entries.map((item) => `${item.name}@${item.version}`).sort(),
    approved.map((item) => `${item.name}@${item.version}`).sort(),
    "Changesets/approved/registry plan divergence",
  );
}

export function validatePacket(packet, context, record) {
  assert.equal(
    packet.format,
    context.recovery ? 5 : 4,
    "Legacy/unknown authorization envelope; new audit required",
  );
  if (context.recovery) {
    validateRecoveryContext(context);
    assert.equal(packet.recovery?.format, 1);
    assert.deepEqual(Object.keys(packet.recovery).sort(), [
      "changes",
      "format",
      "source",
    ]);
    assert.deepEqual(
      packet.recovery.source,
      recoverySource,
      "Recovery source mismatch",
    );
    assert.equal(digest(record), recoverySource.recordDigest);
    assert.equal(
      digest(packet.artifacts),
      recoverySource.artifactsDigest,
      "Original candidates changed",
    );
    assert.equal(
      digest({
        releaseSha: context.releaseSha,
        snapshotSha: context.executionSha,
        changes: packet.recovery.changes,
      }),
      context.changesDigest,
      "Recovery delta mismatch",
    );
  } else {
    assert(
      !Object.hasOwn(packet, "recovery"),
      "Recovery envelope requires explicit mode",
    );
  }
  assert.equal(packet.repository, repository);
  assert.equal(packet.registry, registry, "Wrong authorization registry");
  assert.equal(packet.access, "public", "Public authorization required");
  assert.equal(packet.scopeOwner, "user:t00ls-dev");
  assert.equal(packet.distribution, context.distribution);
  assert.equal(
    packet.authentication,
    authenticationMethod(context.distribution),
    "Authorization authentication mismatch",
  );
  validateDistribution(context, record);
  assert.equal(
    packet.snapshotSha,
    context.executionSha,
    "Snapshot differs from executor",
  );
  assert(
    /^[0-9a-f]{64}$/.test(context.changesDigest),
    "Verified change digest required",
  );
  assert.equal(packet.changesDigest, context.changesDigest);
  assert.equal(
    context.reviewedChangesDigest,
    context.changesDigest,
    "Reviewed changes digest mismatch",
  );
  assert.equal(packet.releasePr, context.releasePr);
  assert.equal(packet.releaseSha, context.releaseSha, "Different release SHA");
  assert.equal(
    packet.executionSha,
    context.executionSha,
    "Different execution SHA; new audit required",
  );
  assert(
    /^[0-9a-f]{64}$/.test(context.protectedInputsDigest),
    "Verified protected-input digest required",
  );
  assert.equal(
    packet.protectedInputsDigest,
    context.protectedInputsDigest,
    "Protected-input digest mismatch",
  );
  assert.equal(digest(packet.record), digest(record), "Audit plan changed");
  assert.equal(packet.auditRun, context.auditRun, "Different audit provenance");
  assert.equal(
    envelopeDigest(packet),
    context.planDigest,
    "Audit/artifact digest mismatch",
  );
  assert.deepEqual(
    packet.artifacts.map((a) => `${a.name}@${a.version}`).sort(),
    record.packages.map((p) => `${p.name}@${p.version}`).sort(),
  );
  for (const item of packet.artifacts) {
    validateArtifactPath(item);
    assert(
      /^[0-9a-f]{64}$/.test(item.hash) &&
        /^sha512-[a-zA-Z0-9+/]+={0,2}$/.test(item.integrity),
      "Invalid artifact hashes",
    );
    assert(
      /^sha256-[a-zA-Z0-9+/]+={0,2}$/.test(item.packIntegrity),
      "Invalid Changesets pack integrity",
    );
  }
}
