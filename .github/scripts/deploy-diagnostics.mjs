import { types } from "node:util";

const phases = new Set(["health", "ci", "migrations"]);
const checks = new Set([
  "configuration",
  "health-read",
  "health-json",
  "health-sha",
  "health-database",
  "ci-sha",
  "ci-workflow-read",
  "ci-workflow",
  "ci-runs-read",
  "ci-runs",
  "ci-run-id",
  "ci-run-read",
  "ci-run",
  "ci-origin",
  "ci-attempt",
  "ci-jobs-read",
  "ci-jobs",
  "ci-evidence",
  "ci-current-read",
  "ci-current",
  "ci-latest-read",
  "ci-latest",
  "ci-event-read",
  "ci-event-json",
  "ci-event",
  "master-read",
  "master-sha",
  "output-write",
  "migration-plan",
  "local-head",
  "local-clean",
  "migration-context",
  "migration-bindings",
  "migration-state",
  "migration-execution",
  "d1-query",
  "d1-result",
  "migration-apply",
  "deployment-run-read",
  "deployment-run",
  "deployment-jobs-read",
  "deployment-jobs",
  "deployments-read",
  "deployment-shape",
  "version-read",
  "deployment-validation",
  "recovery-run-read",
  "recovery-run",
]);
const categories = new Set([
  "http",
  "unexpected-response",
  "configuration",
  "network",
  "local-operation",
]);
const codes = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "EACCES",
  "EPERM",
  "ENOENT",
  "ENOSPC",
]);

// Same boundary as release classification: own data descriptors, no accessors,
// coercion, prototype traversal or proxy traps. Causes are bounded and cyclic-safe.
export function classifyDeployError(error) {
  try {
    const seen = new Set();
    for (let depth = 0; depth < 8; depth++) {
      if (
        !error ||
        typeof error !== "object" ||
        types.isProxy(error) ||
        seen.has(error)
      )
        break;
      seen.add(error);
      const own = (key) => Object.getOwnPropertyDescriptor(error, key)?.value;
      const code = own("code");
      if (typeof code === "string" && codes.has(code)) return code;
      if (own("name") === "TimeoutError") return "TIMEOUT";
      error = own("cause");
    }
  } catch {
    /* Diagnostic inspection must never affect the operation. */
  }
  return "UNKNOWN";
}

export function createDeployDiagnostics(phase, log = console.error) {
  const safePhase = phases.has(phase) ? phase : "migrations";
  let check = "configuration";
  let category = "configuration";
  let status = null;
  const reported = new WeakSet();
  return {
    start(next, kind = "configuration") {
      check = checks.has(next) ? next : "configuration";
      category = categories.has(kind) ? kind : "configuration";
      status = null;
    },
    inspect(next, kind = "configuration") {
      check = checks.has(next) ? next : "configuration";
      category = categories.has(kind) ? kind : "configuration";
    },
    received(value) {
      status =
        Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
    },
    failure(error) {
      return {
        code: "FOUNDATION_DEPLOY_DIAGNOSTIC",
        phase: safePhase,
        check,
        category,
        http_status: status,
        reason: classifyDeployError(error),
      };
    },
    report(error) {
      try {
        const trackable =
          error !== null &&
          (typeof error === "object" || typeof error === "function");
        if (trackable && reported.has(error)) return;
        log(JSON.stringify(this.failure(error)));
        if (trackable) reported.add(error);
      } catch {
        /* Best effort only. */
      }
    },
  };
}

// A new request clears HTTP context. Only its response supplies a status; error
// properties (status/statusCode/message) are never evidence of an HTTP response.
export function observeFetch(
  diagnostics,
  check,
  fetcher = fetch,
  expectedStatus,
) {
  return async (...args) => {
    diagnostics.start(check, "network");
    const response = await fetcher(...args);
    diagnostics.received(response.status);
    diagnostics.inspect(
      check,
      response.ok &&
        (expectedStatus === undefined || response.status === expectedStatus)
        ? "unexpected-response"
        : "http",
    );
    return response;
  };
}
