import { expect, test } from "@playwright/test";
import app from "../src/worker.js";

test("serves the React shell and SPA fallback", async ({ page }) => {
  await page.goto("/reference/route");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "small path",
  );
  await expect(
    page.getByRole("region", { name: "Authentication" }),
  ).toBeVisible();
});

test("keeps service and missing API routes outside the SPA fallback", async ({
  request,
}) => {
  const health = await request.get("/health");
  expect(health.ok()).toBe(true);
  expect(health.headers()["cache-control"]).toBe("no-store");
  await expect(health.json()).resolves.toEqual({ status: "ok" });

  const ready = await request.get("/ready");
  expect(ready.ok()).toBe(true);
  expect(ready.headers()["cache-control"]).toBe("no-store");
  await expect(ready.json()).resolves.toEqual({ status: "ready" });

  const missing = await request.get("/api/missing");
  expect(missing.status()).toBe(404);
  await expect(missing.json()).resolves.toEqual({ error: "Not found" });
});

test("reports unavailable without exposing D1 failures", async () => {
  const response = await app.request("/ready", undefined, {
    DB: {
      prepare() {
        throw new Error("internal database details");
      },
    },
  });

  expect(response.status).toBe(503);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  await expect(response.json()).resolves.toEqual({ status: "unavailable" });
});
