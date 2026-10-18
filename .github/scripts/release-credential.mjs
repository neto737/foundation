import assert from "node:assert/strict";
import {
  authenticationMethod,
  npmVersion,
  registry,
  repository,
  validatePublisherEnvironment,
} from "./release-core.mjs";

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
