import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import {
  createDeployDiagnostics,
  observeFetch,
} from "./deploy-diagnostics.mjs";

export async function migrationHealth({
  env = process.env,
  request = fetch,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  diagnostics = createDeployDiagnostics("health"),
} = {}) {
  let healthy = false;
  let lastError;
  try {
    diagnostics.start("configuration");
    const url = new URL(env.HEALTH_URL);
    assert.equal(url.origin, "https://foundation.t00ls.dev");
    for (let i = 0; i < 6 && !healthy; i++) {
      try {
        const response = await observeFetch(
          diagnostics,
          "health-read",
          request,
        )(`${url.origin}/health`, {
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
        });
        assert(response.ok);
        diagnostics.inspect("health-sha", "configuration");
        assert.equal(
          response.headers.get("X-Foundation-SHA"),
          env.EXPECTED_SHA,
        );
        diagnostics.inspect("health-json", "unexpected-response");
        const body = await response.json();
        diagnostics.inspect("health-database", "unexpected-response");
        assert.equal(body.checks?.database, "ok");
        healthy = true;
      } catch (error) {
        lastError = error;
        /* Read-only smoke retry; never retries a mutation. */
      }
      if (!healthy) await wait(5000);
    }
    assert(healthy, "Expected DEV application SHA/database health not proven");
  } catch (error) {
    diagnostics.report(lastError ?? error);
    throw error;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await migrationHealth();
  } catch {
    process.exitCode = 1;
  }
}
