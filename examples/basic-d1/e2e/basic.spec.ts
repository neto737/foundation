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
  const createAccount = page
    .getByRole("heading", { name: "Create account" })
    .locator("..");
  await expect(createAccount.getByLabel("Name")).toBeVisible();
  await expect(createAccount.getByLabel("Email")).toBeVisible();
  await expect(createAccount.getByLabel("Password")).toBeVisible();
});

test("exposes pending and error states for authentication forms", async ({
  page,
}) => {
  await page.route("**/api/auth/sign-in/email", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      contentType: "application/json",
      status: 401,
      body: JSON.stringify({ message: "Invalid credentials" }),
    });
  });
  await page.goto("/");

  const signIn = page.getByRole("heading", { name: "Sign in" }).locator("..");
  await signIn.getByLabel("Email").fill("person@example.com");
  await signIn.getByLabel("Password").fill("not-the-password");
  await signIn.getByRole("button", { name: "Sign in" }).click();

  const pendingButton = signIn.getByRole("button", { name: "Signing in..." });
  await expect(pendingButton).toBeDisabled();
  await expect(signIn).toHaveAttribute("aria-busy", "true");
  await expect(signIn.getByRole("alert")).toContainText("Invalid credentials");
});

test("announces Zod field errors and focuses the invalid field", async ({
  page,
}) => {
  await page.goto("/");

  const magicLink = page
    .getByRole("heading", { name: "Magic link" })
    .locator("..");
  const email = magicLink.getByLabel("Email");
  await email.fill("not-an-email");
  await magicLink.getByRole("button", { name: "Send link" }).click();

  await expect(email).toBeFocused();
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await expect(magicLink.getByRole("alert")).toHaveText(
    "Enter a valid email address",
  );
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

  const session = await request.get("/api/auth/get-session");
  expect(session.ok()).toBe(true);
  expect(session.headers()["cache-control"]).toBe("private, no-store");

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
