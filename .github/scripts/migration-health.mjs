import assert from "node:assert/strict";

const url = new URL(process.env.HEALTH_URL);
assert.equal(url.origin, "https://foundation.t00ls.dev");
let healthy = false;
for (let i = 0; i < 6 && !healthy; i++) {
  try {
    const response = await fetch(`${url.origin}/health`, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    healthy =
      response.ok &&
      response.headers.get("X-Foundation-SHA") === process.env.EXPECTED_SHA &&
      (await response.json()).checks?.database === "ok";
  } catch {
    /* Read-only smoke retry; never retries a mutation. */
  }
  if (!healthy) await new Promise((resolve) => setTimeout(resolve, 5000));
}
assert(healthy, "Expected DEV application SHA/database health not proven");
