import { expect, test } from "@playwright/test";

test("serves the React shell and SPA fallback", async ({ page }) => {
  await page.goto("/reference/route");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "small path",
  );
  await expect(
    page.getByRole("region", { name: "Authentication" }),
  ).toBeVisible();
});

test("keeps health and missing API routes outside the SPA fallback", async ({
  request,
}) => {
  const health = await request.get("/health");
  expect(health.ok()).toBe(true);
  await expect(health.json()).resolves.toEqual({ status: "ok" });

  const missing = await request.get("/api/missing");
  expect(missing.status()).toBe(404);
  await expect(missing.json()).resolves.toEqual({ error: "Not found" });
});
