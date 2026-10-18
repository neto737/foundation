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

const failureCategories = Object.freeze({
  "arguments": "input",
  "files": "file-access",
  "authority": "authorization",
  "checkout": "snapshot",
  "npm-config": "configuration",
  "artifacts": "integrity",
  "bootstrap-identity": "authentication",
  "oidc-broker": "authentication",
  "npm-exchange": "authentication",
  "provenance-transport": "publication",
});

const exchangeReasons = new Set([
  "HTTP_REJECTED",
  "INVALID_RESPONSE",
  "TOKEN_TYPE_INVALID",
  "TOKEN_MISSING",
  "EXPIRATION_MISSING",
  "EXPIRATION_INVALID",
  "TOKEN_EXPIRED",
  "TIMEOUT",
  "NETWORK_ERROR",
  "UNCLASSIFIED",
]);

const expirationChecks = new Set([
  "TYPE",
  "EMPTY",
  "SYNTAX",
  "CALENDAR",
  "PARSE",
]);

export function createConsumerDiagnostics() {
  let stage = "arguments";
  let httpStatus = null;
  let reason = "UNCLASSIFIED";
  let expirationCheck;
  return {
    enter(next) {
      assert(Object.hasOwn(failureCategories, next));
      stage = next;
      httpStatus = null;
      reason = "UNCLASSIFIED";
      expirationCheck = undefined;
    },
    exchange(status, nextReason, nextExpirationCheck) {
      assert.equal(stage, "npm-exchange");
      assert(exchangeReasons.has(nextReason));
      assert(
        nextExpirationCheck === undefined ||
          (nextReason === "EXPIRATION_INVALID" &&
            expirationChecks.has(nextExpirationCheck)),
      );
      httpStatus =
        Number.isInteger(status) && status >= 100 && status <= 599
          ? status
          : null;
      reason = nextReason;
      expirationCheck = nextExpirationCheck;
    },
    failure() {
      // Deliberately accepts no exception: messages, causes and server responses
      // must never reach the public diagnostic, even for unexpected failures.
      return {
        error: {
          code: "FOUNDATION_PUBLISH_BLOCKED",
          message:
            "Foundation consumer blocked publication; verify approved metadata, authentication and bytes",
          stage,
          category: failureCategories[stage],
          ...(stage === "npm-exchange"
            ? {
                http_status: httpStatus,
                reason,
                ...(expirationCheck
                  ? { expiration_check: expirationCheck }
                  : {}),
              }
            : {}),
        },
      };
    },
  };
}

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
  diagnostics = createConsumerDiagnostics(),
) {
  diagnostics.enter("npm-config");
  validatePublisherEnvironment(env, npmVersion, distribution);
  const method = authenticationMethod(distribution);
  if (method === "bootstrap-token") {
    diagnostics.enter("bootstrap-identity");
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

  diagnostics.enter("oidc-broker");
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
  diagnostics.enter("npm-exchange");
  const signal = AbortSignal.timeout(30000);
  let response;
  try {
    response = await request(
      `${registry}/-/npm/v1/oidc/token/exchange/package/${encodeURIComponent(name)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${identity.value}`,
          Accept: "application/json",
        },
        signal,
        redirect: "error",
      },
    );
  } catch (error) {
    diagnostics.exchange(
      null,
      signal.aborted || error?.name === "TimeoutError"
        ? "TIMEOUT"
        : error instanceof TypeError
          ? "NETWORK_ERROR"
          : "UNCLASSIFIED",
    );
    throw error;
  }
  const status = response?.status;
  diagnostics.exchange(status, "INVALID_RESPONSE");
  assert(Number.isInteger(status) && status >= 100 && status <= 599);
  diagnostics.exchange(status, "HTTP_REJECTED");
  assert.equal(
    status,
    201,
    "npm OIDC exchange failed; no credential fallback permitted",
  );
  diagnostics.exchange(status, "INVALID_RESPONSE");
  assert.equal(typeof response.json, "function");
  let exchanged;
  try {
    exchanged = await response.json();
  } catch (error) {
    if (signal.aborted || error?.name === "TimeoutError")
      diagnostics.exchange(status, "TIMEOUT");
    else if (error instanceof TypeError)
      diagnostics.exchange(status, "NETWORK_ERROR");
    throw error;
  }
  assert(
    exchanged && typeof exchanged === "object" && !Array.isArray(exchanged),
  );
  diagnostics.exchange(status, "TOKEN_TYPE_INVALID");
  assert.equal(exchanged.token_type, "oidc", "Unexpected OIDC credential type");
  diagnostics.exchange(status, "TOKEN_MISSING");
  assert(
    typeof exchanged.token === "string" && exchanged.token.length > 0,
    "OIDC exchange credential missing",
  );
  diagnostics.exchange(status, "EXPIRATION_MISSING");
  assert(Object.hasOwn(exchanged, "expires"), "OIDC expiration missing");
  diagnostics.exchange(status, "EXPIRATION_INVALID", "TYPE");
  assert.equal(typeof exchanged.expires, "string", "Invalid OIDC expiration");
  diagnostics.exchange(status, "EXPIRATION_INVALID", "EMPTY");
  assert(exchanged.expires.length > 0, "Invalid OIDC expiration");
  // npm specifies a required RFC 3339 date-time, not a duration or epoch.
  // Date.parse alone coerces arrays/numbers and accepts ambiguous local dates.
  diagnostics.exchange(status, "EXPIRATION_INVALID", "SYNTAX");
  const expiration =
    /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])[Tt](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:[Zz]|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(
      exchanged.expires,
    );
  assert(expiration, "Invalid OIDC expiration");
  diagnostics.exchange(status, "EXPIRATION_INVALID", "CALENDAR");
  const year = Number(expiration[1]);
  const month = Number(expiration[2]);
  const day = Number(expiration[3]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  assert(day <= monthDays[month - 1], "Invalid OIDC expiration");
  diagnostics.exchange(status, "EXPIRATION_INVALID", "PARSE");
  const expiresAt = Date.parse(exchanged.expires);
  assert(Number.isFinite(expiresAt), "Invalid OIDC expiration");
  diagnostics.exchange(status, "TOKEN_EXPIRED");
  assert(expiresAt > Date.now(), "Expired OIDC exchange credential");
  diagnostics.exchange(status, "UNCLASSIFIED");
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
