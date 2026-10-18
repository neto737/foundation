#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  authenticatedJson,
  canonical,
  hash,
  npmVersion,
  registry,
  repository,
  validatePacket,
  validatePublisherEnvironment,
  validateContext,
  validateReleaseActor,
  validateApproval,
} from "./release-core.mjs";
import { approvedCi } from "./ci-evidence.mjs";
import {
  createConsumerDiagnostics,
  publicationCredential,
} from "./release-credential.mjs";
export {
  createConsumerDiagnostics,
  publicationCredential,
} from "./release-credential.mjs";

const require = createRequire(import.meta.url);
const npmRoot = dirname(require.resolve("npm/package.json"));
const npmRequire = createRequire(join(npmRoot, "package.json"));

// Inspect key names only, including shadowed configuration sources. Never
// call getCredentialsByURI, flatten authentication, or report config values.
export function validateNpmConfiguration(config) {
  for (const [where, row] of config.data) {
    if (where === "default") continue;
    for (const key of new Set([
      ...Object.keys(row.raw ?? {}),
      ...Object.keys(row.data ?? {}),
    ])) {
      assert(
        !/(?:^|:)(?:_auth(?:token)?|_password|username|password|certfile|keyfile|tokenhelper)$/i.test(
          key,
        ),
        "Configured npm credentials are forbidden",
      );
    }
  }
}

export async function loadNpmConfiguration({
  cwd = process.cwd(),
  env = process.env,
} = {}) {
  const Config = npmRequire("@npmcli/config");
  const { definitions, shorthands, flatten } = npmRequire(
    "@npmcli/config/lib/definitions",
  );
  const config = new Config({
    definitions,
    shorthands,
    flatten,
    npmPath: npmRoot,
    cwd,
    env: { ...env },
    argv: [process.execPath, "foundation-consumer"],
  });
  // Loading paths/keys must not export npm config back into the publisher env.
  config.setEnvs = () => {};
  await config.load();
  return config;
}

export function validateArtifactBuffer(bytes, artifact) {
  assert(Buffer.isBuffer(bytes), "Artifact buffer required");
  assert.equal(
    hash(bytes),
    artifact.hash,
    "Consumed artifact SHA-256 mismatch",
  );
  assert.equal(
    `sha512-${hash(bytes, "sha512", "base64")}`,
    artifact.integrity,
    "Consumed artifact SHA-512 mismatch",
  );
  assert.equal(
    `sha256-${hash(bytes, "sha256", "base64")}`,
    artifact.packIntegrity,
    "Consumed pack integrity mismatch",
  );
}

export function manifestFromBuffer(bytes, artifact) {
  const result = spawnSync("tar", ["-xOzf", "-", "package/package.json"], {
    input: bytes,
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(result.status, 0, "Consumed tarball manifest unreadable");
  let manifest;
  try {
    manifest = JSON.parse(result.stdout.toString());
  } catch {
    throw new Error("Consumed tarball manifest invalid");
  }
  assert.equal(manifest.name, artifact.name);
  assert.equal(manifest.version, artifact.version);
  assert.equal(manifest.license, "MIT");
  assert(!manifest.private);
  assert.equal(manifest.repository, `https://github.com/${repository}`);
  assert.equal(
    canonical(manifest.publishConfig),
    canonical({ registry, access: "public" }),
  );
  return manifest;
}

export async function consumeApprovedArtifact({
  packet,
  context,
  path,
  packDirectory,
  env,
  config,
  readBytes = readFile,
  credential = publicationCredential,
  manifest = manifestFromBuffer,
  publishBuffer,
  diagnostics = createConsumerDiagnostics(),
}) {
  diagnostics.enter("artifacts");
  validatePacket(packet, context, packet.record);
  diagnostics.enter("npm-config");
  validatePublisherEnvironment(
    env,
    npmRequire("./package.json").version,
    context.distribution,
  );
  validateNpmConfiguration(config);
  diagnostics.enter("artifacts");
  const artifact = packet.artifacts.find(
    (a) => resolve(packDirectory, a.path) === resolve(path),
  );
  assert(artifact, "Unapproved artifact path");
  // Capture a private buffer once. Filesystem changes after capture cannot alter
  // the bytes passed to npm's buffer API, even during authentication/provenance IO.
  const bytes = Buffer.from(await readBytes(path));
  validateArtifactBuffer(bytes, artifact);
  const metadata = manifest(bytes, artifact);
  const token = await credential(
    env,
    context.distribution,
    artifact.name,
    undefined,
    diagnostics,
  );
  diagnostics.enter("artifacts");
  validateArtifactBuffer(bytes, artifact);
  diagnostics.enter("provenance-transport");
  publishBuffer ??= npmRequire("libnpmpublish").publish;
  await publishBuffer(metadata, bytes, {
    registry,
    "access": "public",
    "defaultTag": "latest",
    "algorithms": ["sha512"],
    npmVersion,
    // Only the explicitly established credential is used. No CLI/config flatten,
    // tokenHelper, ambient auth or npm's optional OIDC/fallback path is involved.
    "forceAuth": { token },
    "//registry.npmjs.org/:_authToken": token,
    "provenance": true,
  });
  return { name: artifact.name, version: artifact.version };
}

export function parseConsumerArguments(args) {
  assert.equal(
    args[0],
    "publish",
    "Consumer only supports tarball publication",
  );
  assert(args[1]?.endsWith(".tgz"), "Explicit tarball required");
  const rest = args.slice(2);
  for (let i = 0; i < rest.length; i++) {
    if (["--json", "--no-git-checks"].includes(rest[i])) continue;
    if (rest[i] === "--access") {
      assert.equal(rest[++i], "public");
      continue;
    }
    if (rest[i] === "--tag") {
      assert.equal(rest[++i], "latest");
      continue;
    }
    throw new Error("Unsupported consumer option");
  }
  return resolve(args[1]);
}

export async function validateConsumerAuthority(
  env,
  packet,
  certificate,
  request = (url) => authenticatedJson(url, env.GITHUB_TOKEN),
) {
  const api = `https://api.github.com/repos/${repository}`;
  const master = await request(`${api}/git/ref/heads/master`);
  const context = {
    event: env.GITHUB_EVENT_NAME,
    ref: env.GITHUB_REF,
    repository: env.GITHUB_REPOSITORY,
    sha: env.GITHUB_SHA,
    masterSha: master.object.sha,
    executionSha: env.EXECUTION_SHA,
    releaseSha: env.RELEASE_SHA,
    releasePr: Number(env.RELEASE_PR),
    mode: env.RELEASE_MODE,
    distribution: env.DISTRIBUTION_MODE,
    confirmation: env.RELEASE_CONFIRMATION,
    planDigest: env.PLAN_DIGEST,
    reviewedChangesDigest: env.CHANGES_DIGEST,
    changesDigest: env.CHANGES_DIGEST,
    protectedInputsDigest: packet.protectedInputsDigest,
    auditRun: Number(env.AUDIT_RUN),
    approvalRun: Number(env.APPROVAL_RUN),
    runId: Number(env.GITHUB_RUN_ID),
  };
  validateContext(context, true);
  assert(
    ["publish", "resume"].includes(context.mode),
    "Consumer publication context required",
  );
  const workflow = await request(`${api}/actions/workflows/release.yml`);
  const permissionUrl = `${api}/collaborators/t00ls-dev/permission`;
  validateReleaseActor(
    await request(`${api}/actions/runs/${context.runId}`),
    workflow,
    await request(permissionUrl),
    context,
  );
  assert.equal(Number(env.GITHUB_RUN_ATTEMPT), 1);
  await approvedCi(context.executionSha, { request });
  const approvalUrl = `${api}/actions/runs/${context.approvalRun}`;
  const approval = await request(approvalUrl);
  const jobs = [];
  for (let page = 1; ; page++) {
    const response = await request(
      `${approvalUrl}/jobs?filter=latest&per_page=100&page=${page}`,
    );
    assert(Array.isArray(response.jobs));
    jobs.push(...response.jobs);
    if (response.jobs.length < 100) break;
  }
  validateApproval(
    certificate,
    approval,
    jobs,
    workflow,
    await request(permissionUrl),
    packet,
    context,
  );
  validateApproval(
    certificate,
    await request(approvalUrl),
    jobs,
    workflow,
    await request(permissionUrl),
    packet,
    context,
  );
  assert.equal(
    (await request(`${api}/git/ref/heads/master`)).object.sha,
    context.executionSha,
    "Consumer snapshot moved",
  );
  return context;
}

async function main(diagnostics) {
  const env = process.env;
  diagnostics.enter("arguments");
  const path = parseConsumerArguments(process.argv.slice(2));
  diagnostics.enter("files");
  const packet = JSON.parse(
    await readFile(env.FOUNDATION_APPROVED_PACKET, "utf8"),
  );
  const certificate = JSON.parse(
    await readFile(env.FOUNDATION_APPROVAL_CERT, "utf8"),
  );
  diagnostics.enter("authority");
  const context = await validateConsumerAuthority(env, packet, certificate);
  diagnostics.enter("checkout");
  assert.equal(
    spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(),
    context.executionSha,
    "Consumer checkout mismatch",
  );
  diagnostics.enter("npm-config");
  const config = await loadNpmConfiguration();
  const result = await consumeApprovedArtifact({
    packet,
    context,
    path,
    packDirectory: env.FOUNDATION_PACK_DIRECTORY,
    env,
    config,
    diagnostics,
  });
  console.log(JSON.stringify(result));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const diagnostics = createConsumerDiagnostics();
  main(diagnostics).catch(() => {
    // Errors/config/server responses may contain credentials: never serialize them.
    console.error(JSON.stringify(diagnostics.failure()));
    process.exitCode = 1;
  });
}
