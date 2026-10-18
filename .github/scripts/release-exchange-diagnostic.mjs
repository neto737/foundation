import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  authenticatedJson,
  registry,
  repository,
  shaPattern,
  validateReleaseActor,
} from "./release-core.mjs";
import { approvedCi } from "./ci-evidence.mjs";
import {
  createConsumerDiagnostics,
  publicationCredential,
} from "./release-credential.mjs";

// Deliberately fixed: this entry point accepts no package, artifact or command.
export const diagnosticPackage = "@t00ls-dev/audit";
export const diagnosticConfirmation =
  "DIAGNOSE_NPM_EXCHANGE_WITHOUT_PUBLICATION";

export async function validateDiagnosticAuthority(env, checkoutSha, request) {
  assert.equal(env.RELEASE_MODE, "diagnose-exchange");
  assert.equal(env.DISTRIBUTION_MODE, "release");
  assert.equal(env.RELEASE_CONFIRMATION, diagnosticConfirmation);
  assert.equal(env.GITHUB_EVENT_NAME, "workflow_dispatch");
  assert.equal(env.GITHUB_REF, "refs/heads/master");
  assert.equal(env.GITHUB_REPOSITORY, repository);
  assert.equal(
    env.GITHUB_WORKFLOW_REF,
    `${repository}/.github/workflows/release.yml@refs/heads/master`,
  );
  assert(shaPattern.test(env.EXECUTION_SHA));
  assert.equal(env.GITHUB_SHA, env.EXECUTION_SHA);
  assert.equal(checkoutSha, env.EXECUTION_SHA);
  assert.equal(env.GITHUB_RUN_ATTEMPT, "1");
  const context = {
    executionSha: env.EXECUTION_SHA,
    runId: Number(env.GITHUB_RUN_ID),
  };
  const api = `https://api.github.com/repos/${repository}`;
  const authority = async () => {
    assert.equal(
      (await request(`${api}/git/ref/heads/master`)).object.sha,
      context.executionSha,
    );
    validateReleaseActor(
      await request(`${api}/actions/runs/${context.runId}`),
      await request(`${api}/actions/workflows/release.yml`),
      await request(`${api}/collaborators/t00ls-dev/permission`),
      context,
    );
  };
  await authority();
  await approvedCi(context.executionSha, { request, log: () => {} });
  await authority();
}

export async function diagnoseExchange({
  env,
  checkoutSha,
  githubRequest = (url) => authenticatedJson(url, env.GITHUB_TOKEN),
  request = fetch,
}) {
  const diagnostics = createConsumerDiagnostics();
  try {
    diagnostics.enter("authority");
    await validateDiagnosticAuthority(env, checkoutSha, githubRequest);
    const broker = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
    broker.searchParams.set("audience", "npm:registry.npmjs.org");
    const exchange = `${registry}/-/npm/v1/oidc/token/exchange/package/${encodeURIComponent(diagnosticPackage)}`;
    let calls = 0;
    // A closed two-request state machine: no upload endpoint, retry or callback.
    const credentialRequest = async (url, options) => {
      calls++;
      assert(calls <= 2);
      assert.equal(url, calls === 1 ? broker.href : exchange);
      assert.equal(options.method ?? "GET", calls === 1 ? "GET" : "POST");
      assert.equal(options.redirect, "error");
      assert.equal(options.body, undefined);
      return request(url, options);
    };
    // Discard the credential; there is no transport import or continuation.
    void (await publicationCredential(
      env,
      "release",
      diagnosticPackage,
      credentialRequest,
      diagnostics,
    ));
    assert.equal(calls, 2);
    return {
      stage: "npm-exchange",
      category: "authentication",
      http_status: 201,
      reason: "VALID",
      expiration_check: null,
    };
  } catch {
    const safe = diagnostics.failure().error;
    return {
      stage: safe.stage,
      category: safe.category,
      http_status: safe.http_status ?? null,
      reason: safe.reason ?? "UNCLASSIFIED",
      expiration_check: safe.expiration_check ?? null,
    };
  }
}

async function main() {
  // Only the fixed git command can execute; no shell or caller-provided args.
  let checkoutSha;
  try {
    assert.equal(process.argv.length, 2);
    checkoutSha = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    console.log(
      JSON.stringify({
        stage: "checkout",
        category: "snapshot",
        http_status: null,
        reason: "UNCLASSIFIED",
        expiration_check: null,
      }),
    );
    process.exitCode = 1;
    return;
  }
  const result = await diagnoseExchange({ env: process.env, checkoutSha });
  console.log(JSON.stringify(result));
  if (result.reason !== "VALID") process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
