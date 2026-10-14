#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  authenticationMethod,
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

async function responseJson(response, status, message) {
  assert.equal(response.status, status, message);
  try {
    return await response.json();
  } catch {
    throw new Error(message);
  }
}

export async function publicationCredential(
  env,
  distribution,
  name,
  request = fetch,
) {
  validatePublisherEnvironment(env, npmVersion, distribution);
  const method = authenticationMethod(distribution);
  if (method === "bootstrap-token") {
    const identity = await responseJson(
      await request(`${registry}/-/whoami`, {
        headers: {
          Authorization: `Bearer ${env.NPM_BOOTSTRAP_TOKEN}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(30000),
        redirect: "error",
      }),
      200,
      "Bootstrap npm identity could not be verified",
    );
    assert.equal(
      identity.username,
      "t00ls-dev",
      "Bootstrap npm owner mismatch",
    );
    return env.NPM_BOOTSTRAP_TOKEN;
  }

  const url = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  assert.equal(url.protocol, "https:", "Invalid OIDC broker protocol");
  assert(
    url.hostname.endsWith(".actions.githubusercontent.com"),
    "Invalid OIDC broker origin",
  );
  url.searchParams.set("audience", "npm:registry.npmjs.org");
  const identity = await responseJson(
    await request(url.href, {
      headers: {
        Authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(30000),
      redirect: "error",
    }),
    200,
    "GitHub OIDC identity request failed",
  );
  assert(
    typeof identity.value === "string" && identity.value.length > 0,
    "OIDC identity missing",
  );
  let claims;
  try {
    claims = JSON.parse(
      Buffer.from(identity.value.split(".")[1], "base64url").toString(),
    );
  } catch {
    throw new Error("Invalid OIDC identity claims");
  }
  assert.equal(claims.repository, repository, "OIDC repository mismatch");
  assert.equal(claims.ref, "refs/heads/master", "OIDC ref mismatch");
  assert.equal(claims.sha, env.EXECUTION_SHA, "OIDC snapshot mismatch");
  const exchanged = await responseJson(
    await request(
      `${registry}/-/npm/v1/oidc/token/exchange/package/${encodeURIComponent(name)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${identity.value}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(30000),
        redirect: "error",
      },
    ),
    201,
    "npm OIDC exchange failed; no credential fallback permitted",
  );
  assert.equal(exchanged.token_type, "oidc", "Unexpected OIDC credential type");
  assert(
    typeof exchanged.token === "string" && exchanged.token.length > 0,
    "OIDC exchange credential missing",
  );
  assert(
    Number.isFinite(Date.parse(exchanged.expires)) &&
      Date.parse(exchanged.expires) > Date.now(),
    "Expired OIDC exchange credential",
  );
  return exchanged.token;
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
}) {
  validatePacket(packet, context, packet.record);
  validatePublisherEnvironment(
    env,
    npmRequire("./package.json").version,
    context.distribution,
  );
  validateNpmConfiguration(config);
  const artifact = packet.artifacts.find(
    (a) => resolve(packDirectory, a.path) === resolve(path),
  );
  assert(artifact, "Unapproved artifact path");
  // Capture a private buffer once. Filesystem changes after capture cannot alter
  // the bytes passed to npm's buffer API, even during authentication/provenance IO.
  const bytes = Buffer.from(await readBytes(path));
  validateArtifactBuffer(bytes, artifact);
  const metadata = manifest(bytes, artifact);
  const token = await credential(env, context.distribution, artifact.name);
  validateArtifactBuffer(bytes, artifact);
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

async function main() {
  const env = process.env;
  const path = parseConsumerArguments(process.argv.slice(2));
  const packet = JSON.parse(
    await readFile(env.FOUNDATION_APPROVED_PACKET, "utf8"),
  );
  const certificate = JSON.parse(
    await readFile(env.FOUNDATION_APPROVAL_CERT, "utf8"),
  );
  const context = await validateConsumerAuthority(env, packet, certificate);
  assert.equal(
    spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(),
    context.executionSha,
    "Consumer checkout mismatch",
  );
  const result = await consumeApprovedArtifact({
    packet,
    context,
    path,
    packDirectory: env.FOUNDATION_PACK_DIRECTORY,
    env,
    config: await loadNpmConfiguration(),
  });
  console.log(JSON.stringify(result));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    // Errors/config/server responses may contain credentials: never serialize them.
    console.error(
      JSON.stringify({
        error: {
          code: "FOUNDATION_PUBLISH_BLOCKED",
          message:
            "Foundation consumer blocked publication; verify approved metadata, authentication and bytes",
        },
      }),
    );
    process.exitCode = 1;
  });
}
