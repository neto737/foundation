import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  authenticatedJson,
  canonical,
  digest,
  envelopeDigest,
  hash,
  repository,
  registry,
  recoverySource,
  recoveryBinding,
  recoveryRemaining,
  releaseMode,
  validateAncestry,
  validateContext,
  validateRepository,
  validateRecoveryContext,
  validatePacket,
  validateApproval,
  validateAuditRun,
  validateReleaseActor,
  validateReviewEvidence,
  validatePr,
  validateReleaseCommit,
  validateProtectedInputs,
  validatePublishPlan,
  registryInventory,
  reconcile,
} from "./release-core.mjs";
import { treeAtCommit, contentBinding } from "./release-planning.mjs";
import { approvedCi } from "./ci-evidence.mjs";

const api = `https://api.github.com/repos/${repository}`;
const json = (bytes) => JSON.parse(bytes.toString());
const write = (path, bytes) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes, { mode: 0o600 });
};
const sourceFiles = [
  "authorization.json",
  "reviewed-changes.json",
  "registry-plan.json",
  "packed/publish-plan.json",
  ...[
    "audit-1.0.1",
    "auth-0.3.1",
    "config-0.1.3",
    "db-1.0.1",
    "tenant-1.0.1",
  ].map((name) => `packed/packages/t00ls-dev-${name}.tgz`),
];

export function historicalContext() {
  return {
    mode: "resume",
    distribution: "release",
    releasePr: recoverySource.releasePr,
    releaseSha: recoverySource.executionSha,
    executionSha: recoverySource.executionSha,
    auditRun: recoverySource.auditRun,
    approvalRun: recoverySource.approvalRun,
    planDigest: recoverySource.planDigest,
    reviewedChangesDigest: recoverySource.changesDigest,
    changesDigest: recoverySource.changesDigest,
    protectedInputsDigest: recoverySource.protectedInputsDigest,
  };
}

export function validateSourceArtifact(meta, kind, repositoryId) {
  const audit = kind === "audit";
  assert.equal(
    meta.id,
    audit ? recoverySource.auditArtifact : recoverySource.approvalArtifact,
  );
  assert.equal(meta.expired, false, "Original artifact expired");
  assert(
    Number.isFinite(Date.parse(meta.expires_at)) &&
      Date.parse(meta.expires_at) > Date.now(),
    "Original artifact retention ended",
  );
  assert.equal(
    meta.digest,
    `sha256:${audit ? recoverySource.auditZipHash : recoverySource.approvalZipHash}`,
  );
  assert.equal(
    meta.name,
    `${audit ? "foundation-release" : "foundation-approval"}-${recoverySource.planDigest}`,
  );
  assert.equal(
    meta.workflow_run?.id,
    audit ? recoverySource.auditRun : recoverySource.approvalRun,
  );
  assert.equal(meta.workflow_run?.head_sha, recoverySource.executionSha);
  assert.equal(meta.workflow_run?.head_branch, "master");
  assert(Number.isSafeInteger(repositoryId) && repositoryId > 0);
  assert.equal(meta.workflow_run?.repository_id, repositoryId);
  assert.equal(meta.workflow_run?.head_repository_id, repositoryId);
}

// Read only named entries; never extract archive paths or execute its content.
export function readSourceArchive(path, kind) {
  assert(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink());
  assert.equal(
    hash(readFileSync(path)),
    kind === "audit"
      ? recoverySource.auditZipHash
      : recoverySource.approvalZipHash,
    "Original ZIP hash mismatch",
  );
  const files = execFileSync("unzip", ["-Z1", path], { encoding: "utf8" })
    .trim()
    .split("\n");
  assert.deepEqual(
    [...files].sort(),
    [...(kind === "audit" ? sourceFiles : ["approval.json"])].sort(),
    "Unexpected source ZIP entries",
  );
  return new Map(
    files.map((file) => [
      file,
      execFileSync("unzip", ["-p", path, file], { maxBuffer: 4 * 1024 * 1024 }),
    ]),
  );
}

async function pages(url, request) {
  const rows = [];
  for (let page = 1; ; page++) {
    const result = await request(
      `${url}${url.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
    );
    const data = Array.isArray(result) ? result : result.jobs;
    assert(Array.isArray(data));
    rows.push(...data);
    if (data.length < 100) return rows;
  }
}

export async function validateRecoveryBinding(context, request) {
  validateRecoveryContext(context);
  validateAncestry(
    await request(
      `${api}/compare/${context.releaseSha}...${context.executionSha}`,
    ),
    context.releaseSha,
    context.executionSha,
  );
  return recoveryBinding(
    await treeAtCommit(context.releaseSha, request),
    await treeAtCommit(context.executionSha, request),
    context,
  );
}

export async function verifyRecoverySource(directory, context, request) {
  validateRecoveryContext(context);
  const repo = await request(api);
  validateRepository(repo);
  for (const kind of ["audit", "approval"]) {
    const id =
      kind === "audit"
        ? recoverySource.auditArtifact
        : recoverySource.approvalArtifact;
    validateSourceArtifact(
      await request(`${api}/actions/artifacts/${id}`),
      kind,
      repo.id,
    );
  }
  const auditFiles = readSourceArchive(
    join(directory, "source/audit.zip"),
    "audit",
  );
  const approvalFiles = readSourceArchive(
    join(directory, "source/approval.zip"),
    "approval",
  );
  const source = json(auditFiles.get("authorization.json"));
  const certificate = json(approvalFiles.get("approval.json"));
  const historical = historicalContext();
  validatePacket(source, historical, source.record);
  assert.equal(digest(source.record), recoverySource.recordDigest);
  assert.equal(digest(source.artifacts), recoverySource.artifactsDigest);
  assert.equal(digest(certificate), recoverySource.approvalDigest);
  const workflow = await request(`${api}/actions/workflows/release.yml`);
  const permission = () => request(`${api}/collaborators/t00ls-dev/permission`);
  const auditUrl = `${api}/actions/runs/${recoverySource.auditRun}`;
  const approvalUrl = `${api}/actions/runs/${recoverySource.approvalRun}`;
  const audit = await request(auditUrl);
  const auditJobs = await pages(`${auditUrl}/jobs?filter=latest`, request);
  validateAuditRun(audit, auditJobs, workflow.id, historical);
  const sourceAuditJobs = auditJobs.filter((job) => job.name === "audit");
  assert.equal(sourceAuditJobs.length, 1);
  const sourceAudit = sourceAuditJobs[0];
  assert.equal(sourceAudit.run_id, recoverySource.auditRun);
  assert.equal(sourceAudit.run_attempt, 1);
  assert.equal(sourceAudit.head_sha, recoverySource.executionSha);
  assert.equal(sourceAudit.status, "completed");
  validateReleaseActor(audit, workflow, await permission(), {
    ...historical,
    runId: audit.id,
  });
  const approvalJobs = await pages(
    `${approvalUrl}/jobs?filter=latest`,
    request,
  );
  // Both API identity/authority and the exact historical certificate remain required.
  validateApproval(
    certificate,
    await request(approvalUrl),
    approvalJobs,
    workflow,
    await permission(),
    source,
    historical,
  );
  validateAuditRun(await request(auditUrl), auditJobs, workflow.id, historical);
  validateApproval(
    certificate,
    await request(approvalUrl),
    approvalJobs,
    workflow,
    await permission(),
    source,
    historical,
  );
  const binding = await contentBinding(
    historical.releaseSha,
    historical.executionSha,
    request,
    historical,
    source.record,
  );
  assert.equal(
    binding.protectedInputsDigest,
    recoverySource.protectedInputsDigest,
  );
  assert.equal(binding.changesDigest, recoverySource.changesDigest);
  validateReviewEvidence(json(auditFiles.get("reviewed-changes.json")), {
    releaseSha: historical.releaseSha,
    snapshotSha: historical.executionSha,
    changesDigest: binding.changesDigest,
    changes: binding.changes,
  });
  const pr = await request(`${api}/pulls/${historical.releasePr}`);
  validatePr(pr, historical, source.record);
  validateReleaseCommit(
    await pages(`${api}/pulls/${historical.releasePr}/commits`, request),
    pr,
    source.record,
  );
  validateProtectedInputs(
    await treeAtCommit(pr.head.sha, request),
    binding.releaseTree,
  );
  const sourceRecord = await request(
    `${api}/contents/.changeset/release-plan.json?ref=${historical.releaseSha}`,
  );
  assert.equal(sourceRecord.encoding, "base64");
  assert.deepEqual(
    json(Buffer.from(sourceRecord.content, "base64")),
    source.record,
  );
  validatePublishPlan(
    json(auditFiles.get("registry-plan.json")),
    source.record.packages,
  );
  const packed = json(auditFiles.get("packed/publish-plan.json"));
  validatePublishPlan(packed, source.record.packages);
  for (const artifact of source.artifacts) {
    const bytes = auditFiles.get(`packed/${artifact.path}`);
    verifyCandidate(bytes, artifact);
    const entry = packed.plan.flat().find((p) => p.name === artifact.name);
    assert.deepEqual(entry.tarball, {
      path: artifact.path,
      integrity: artifact.packIntegrity,
    });
  }
  return { source, auditFiles };
}

export function verifyCandidate(bytes, artifact) {
  assert(Buffer.isBuffer(bytes), "Missing original candidate");
  assert.equal(
    hash(bytes),
    artifact.hash,
    "Original candidate SHA-256 mismatch",
  );
  assert.equal(`sha512-${hash(bytes, "sha512", "base64")}`, artifact.integrity);
  assert.equal(
    `sha256-${hash(bytes, "sha256", "base64")}`,
    artifact.packIntegrity,
  );
}

export function verifyRecoveryCandidates(directory, artifacts) {
  assert.equal(digest(artifacts), recoverySource.artifactsDigest);
  for (const artifact of artifacts) {
    const path = join(directory, "packed", artifact.path);
    assert(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink());
    verifyCandidate(readFileSync(path), artifact);
  }
}

async function publicBytes(url, fetcher) {
  const response = await fetcher(url, {
    headers: { "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(30000),
    redirect: "error",
  });
  assert.equal(response.status, 200, "Recovery public download failed");
  const bytes = Buffer.from(await response.arrayBuffer());
  assert(bytes.length < 4 * 1024 * 1024, "Recovery download too large");
  return bytes;
}

export async function recoveryRegistry(packet, context, fetcher = fetch) {
  const inventory = await registryInventory("release", fetcher, {
    revalidate: true,
  });
  const states = reconcile(packet.record, inventory, packet.artifacts, context);
  recoveryRemaining(packet.record, states, context);
  // Metadata alone must not cause completed packages to be treated as safe.
  for (const artifact of packet.artifacts.filter(
    (a) => a.name !== "@t00ls-dev/config",
  )) {
    const name = artifact.name.split("/")[1];
    verifyCandidate(
      await publicBytes(
        `${registry}/${artifact.name}/-/${name}-${artifact.version}.tgz`,
        fetcher,
      ),
      artifact,
    );
  }
  for (const name of Object.keys(inventory)) {
    if (packet.record.packages.some((p) => p.name === name)) continue;
    const pkg = json(
      readFileSync(
        new URL(
          `../../packages/${name.split("/")[1]}/package.json`,
          import.meta.url,
        ),
      ),
    );
    assert.equal(
      inventory[name].latest,
      pkg.version,
      "Unplanned registry version",
    );
    assert(inventory[name].versions.includes(pkg.version));
  }
  return states;
}

export async function verifyRecovery(
  directory,
  packet,
  context,
  request,
  fetcher = fetch,
) {
  const { source } = await verifyRecoverySource(directory, context, request);
  const auditUrl = `${api}/actions/runs/${context.auditRun}`;
  const workflow = await request(`${api}/actions/workflows/release.yml`);
  const jobs = await pages(`${auditUrl}/jobs?filter=latest`, request);
  // Two observations reject concurrent reruns/revocation; failure is never retried.
  for (let observation = 0; observation < 2; observation++) {
    const audit = await request(auditUrl);
    validateAuditRun(audit, jobs, workflow.id, context);
    validateReleaseActor(
      audit,
      workflow,
      await request(`${api}/collaborators/t00ls-dev/permission`),
      { ...context, runId: context.auditRun },
    );
  }
  assert.deepEqual(packet.artifacts, source.artifacts);
  assert.deepEqual(packet.record, source.record);
  const binding = await validateRecoveryBinding(context, request);
  assert.deepEqual(packet.recovery.changes, binding.changes);
  validatePacket(packet, { ...context, ...binding }, source.record);
  verifyRecoveryCandidates(directory, packet.artifacts);
  return recoveryRegistry(packet, context, fetcher);
}

export async function downloadSource(
  directory,
  token,
  request,
  fetcher = fetch,
) {
  assert(
    !existsSync(directory),
    "Recovery import requires a new evidence directory",
  );
  const repo = await request(api);
  validateRepository(repo);
  for (const kind of ["audit", "approval"]) {
    const id =
      kind === "audit"
        ? recoverySource.auditArtifact
        : recoverySource.approvalArtifact;
    validateSourceArtifact(
      await request(`${api}/actions/artifacts/${id}`),
      kind,
      repo.id,
    );
    // Send GitHub authorization only to GitHub. Never forward it to the signed URL.
    assert(token, "GitHub read credential required");
    const redirect = await fetcher(`${api}/actions/artifacts/${id}/zip`, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });
    assert.equal(redirect.status, 302, "Original archive unavailable");
    const url = new URL(redirect.headers.get("location"));
    assert(url.protocol === "https:" && !url.username && !url.password);
    assert(
      url.hostname.endsWith(".blob.core.windows.net") ||
        url.hostname.endsWith(".actions.githubusercontent.com"),
      "Unexpected artifact storage host",
    );
    const bytes = await publicBytes(url.href, fetcher);
    assert.equal(
      hash(bytes),
      kind === "audit"
        ? recoverySource.auditZipHash
        : recoverySource.approvalZipHash,
      "Original ZIP hash mismatch",
    );
    write(join(directory, `source/${kind}.zip`), bytes);
  }
}

export async function recoveryAudit(
  directory,
  env,
  {
    request = (url) => authenticatedJson(url, env.GITHUB_TOKEN),
    fetcher = fetch,
    checkout = () =>
      execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    workingTree = () =>
      execFileSync(
        "git",
        ["status", "--porcelain", "--untracked-files=normal"],
        { encoding: "utf8" },
      ).trim(),
  } = {},
) {
  const context = {
    ...releaseMode(env.RELEASE_MODE),
    event: env.GITHUB_EVENT_NAME,
    ref: env.GITHUB_REF,
    repository: env.GITHUB_REPOSITORY,
    sha: env.GITHUB_SHA,
    executionSha: env.EXECUTION_SHA,
    releasePr: Number(env.RELEASE_PR),
    releaseSha: env.RELEASE_SHA,
    distribution: env.DISTRIBUTION_MODE,
    masterSha: (await request(`${api}/git/ref/heads/master`)).object.sha,
    runId: Number(env.GITHUB_RUN_ID),
  };
  const authority = async () => {
    validateContext({
      ...context,
      masterSha: (await request(`${api}/git/ref/heads/master`)).object.sha,
    });
    assert.equal(checkout(), context.executionSha);
    assert.equal(workingTree(), "");
    assert.equal(Number(env.GITHUB_RUN_ATTEMPT), 1);
    validateReleaseActor(
      await request(`${api}/actions/runs/${context.runId}`),
      await request(`${api}/actions/workflows/release.yml`),
      await request(`${api}/collaborators/t00ls-dev/permission`),
      context,
    );
    await approvedCi(context.executionSha, { request });
    assert.equal(
      (await request(`${api}/git/ref/heads/master`)).object.sha,
      context.executionSha,
    );
  };
  assert.equal(context.mode, "audit");
  validateRecoveryContext(context);
  await authority();
  await downloadSource(directory, env.GITHUB_TOKEN, request, fetcher);
  const { source, auditFiles } = await verifyRecoverySource(
    directory,
    context,
    request,
  );
  const binding = await validateRecoveryBinding(context, request);
  const packet = {
    ...source,
    format: 5,
    snapshotSha: context.executionSha,
    executionSha: context.executionSha,
    protectedInputsDigest: binding.protectedInputsDigest,
    changesDigest: binding.changesDigest,
    auditRun: context.runId,
    recovery: { format: 1, source: recoverySource, changes: binding.changes },
  };
  validatePacket(
    packet,
    {
      ...context,
      ...binding,
      auditRun: context.runId,
      reviewedChangesDigest: binding.changesDigest,
      planDigest: envelopeDigest(packet),
    },
    source.record,
  );
  for (const artifact of source.artifacts)
    write(
      join(directory, "packed", artifact.path),
      auditFiles.get(`packed/${artifact.path}`),
    );
  verifyRecoveryCandidates(directory, packet.artifacts);
  const states = await recoveryRegistry(packet, context, fetcher);
  write(join(directory, "authorization.json"), canonical(packet) + "\n");
  write(
    join(directory, "reviewed-changes.json"),
    canonical({
      releaseSha: context.releaseSha,
      snapshotSha: context.executionSha,
      changesDigest: binding.changesDigest,
      changes: binding.changes,
    }) + "\n",
  );
  write(join(directory, "recovery-inventory.json"), canonical(states) + "\n");
  await authority();
  const report = {
    auditRun: context.runId,
    executionSha: context.executionSha,
    artifactSnapshotSha: recoverySource.executionSha,
    planDigest: envelopeDigest(packet),
    changesDigest: binding.changesDigest,
    states,
    artifacts: packet.artifacts,
  };
  if (env.GITHUB_OUTPUT)
    writeFileSync(env.GITHUB_OUTPUT, `plan_digest=${report.planDigest}\n`, {
      flag: "a",
    });
  if (env.GITHUB_STEP_SUMMARY)
    writeFileSync(
      env.GITHUB_STEP_SUMMARY,
      "\n## Recuperação: bytes originais, novo executor\n```json\n" +
        JSON.stringify(report, null, 2) +
        "\n```\n",
      { flag: "a" },
    );
  return report;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  Promise.resolve()
    .then(() => {
      assert.equal(
        process.argv.length,
        3,
        "Recovery evidence directory required",
      );
      return recoveryAudit(resolve(process.argv[2]), process.env);
    })
    .then((report) => console.log(JSON.stringify(report, null, 2)))
    .catch(() => {
      console.error(
        "Foundation recovery audit blocked; verify source evidence, authority and registry",
      );
      process.exitCode = 1;
    });
}
