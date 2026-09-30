import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const repository = "t00ls-dev/foundation";
export const registry = "https://npm.pkg.github.com";
export const confirmation = "PUBLISH_PRIVATE_FOUNDATION_PACKAGES";
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

export async function authenticatedJson(url, token, fetcher = fetch) {
  assert(token, "Authentication token required");
  const response = await fetcher(url, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "User-Agent": "foundation-private-release",
    },
    signal: AbortSignal.timeout(30000),
    redirect: "error",
  });
  assert(
    response.ok,
    `Authenticated request failed: ${response.status} ${url}`,
  );
  return response.json();
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
  assert.equal(context.event, "workflow_dispatch", "Manual dispatch required");
  assert.equal(context.ref, "refs/heads/master", "master required");
  assert.equal(context.repository, repository, "Unexpected repository");
  assert(shaPattern.test(context.expectedSha), "Full expected_sha required");
  assert.equal(context.sha, context.expectedSha, "Workflow SHA mismatch");
  assert.equal(context.masterSha, context.expectedSha, "master moved");
  assert(["audit", "publish", "resume"].includes(context.mode), "Invalid mode");
  assert(
    Number.isSafeInteger(context.releasePr) && context.releasePr > 0,
    "Invalid release_pr",
  );
  if (authorization) {
    assert.equal(
      context.confirmation,
      confirmation,
      "Incorrect private publication confirmation",
    );
    assert(
      /^[0-9a-f]{64}$/.test(context.planDigest),
      "Full plan_digest required",
    );
    assert(
      Number.isSafeInteger(context.auditRun) && context.auditRun > 0,
      "audit_run required",
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
    context.expectedSha,
    "Release merge commit differs from authorized SHA",
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
    assert.equal(pkg.license, "UNLICENSED");
    assert.equal(pkg.repository, "https://github.com/t00ls-dev/foundation");
    assert.equal(pkg.publishConfig?.registry, registry);
    assert.equal(pkg.publishConfig?.access, "restricted");
    assert.deepEqual(pkg.files, ["dist", "README.md"]);
    const approved = record.packages.find((item) => item.name === pkg.name);
    if (approved)
      assert.equal(pkg.version, approved.version, "Unauthorized local version");
    compareVersions(pkg.version, pkg.version);
  }
}

// Inventory is authenticated; missing/inaccessible packages and malformed
// responses are errors, never interpreted as permission to first-publish.
export function reconcile(record, inventory, artifacts = []) {
  validateRecord(record);
  const states = [];
  for (const item of record.packages) {
    const pkg = inventory[item.name];
    assert(
      pkg && pkg.visibility === "private" && pkg.repository === repository,
      `Registry inaccessible/privacy/link mismatch: ${item.name}`,
    );
    assert(
      Array.isArray(pkg.versions) && pkg.versions.includes(item.oldVersion),
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
    if (state === "absent" && pkg.latest !== item.oldVersion)
      state = "divergent";
    states.push({ name: item.name, version: item.version, state });
  }
  return states;
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
  return digest({
    format: packet.format,
    repository: packet.repository,
    releasePr: packet.releasePr,
    sha: packet.sha,
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
        item.access === "restricted" &&
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
  assert.equal(packet.format, 1);
  assert.equal(packet.repository, repository);
  assert.equal(packet.releasePr, context.releasePr);
  assert.equal(packet.sha, context.expectedSha);
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
