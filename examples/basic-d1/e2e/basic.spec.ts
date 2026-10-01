import {
  expect,
  test,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { z } from "zod";

const password = "correct-horse-battery-staple";
function email() {
  return `links-${crypto.randomUUID()}@example.com`;
}

async function verify(request: APIRequestContext, address: string) {
  const response = await request.get(
    `/__test/mail?email=${encodeURIComponent(address)}`,
  );
  expect(response.ok()).toBe(true);
  const message = z
    .object({ text: z.string().url() })
    .parse(await response.json());
  return message.text;
}

async function signUp(page: Page, address: string) {
  await page.goto("/signup");
  await page.getByLabel("Name", { exact: true }).fill("Links Reader");
  await page.getByLabel("Email", { exact: true }).fill(address);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Check your email" }),
  ).toBeVisible();
  await page.goto(await verify(page.request, address));
  await expect(
    page.getByRole("heading", { name: "Email verified" }),
  ).toBeVisible();
  await signIn(page, address);
}
async function signIn(page: Page, address: string) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(address);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your bookmarks" }),
  ).toBeVisible();
}
async function addBookmark(page: Page, title: string) {
  await page.getByRole("link", { name: "Add link", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page
    .getByLabel("URL", { exact: true })
    .fill("https://example.com/reference");
  await page
    .getByLabel("Description (optional)", { exact: true })
    .fill("Private reference");
  await page
    .getByLabel("Tags (comma-separated)", { exact: true })
    .fill("Docs, Work");
  await page.getByRole("button", { name: "Save bookmark" }).click();
  await expect(
    page.getByRole("article", { name: title, exact: true }),
  ).toBeVisible();
}

test("verifies email, persists session and performs CRUD with filters", async ({
  page,
}) => {
  const address = email();
  await signUp(page, address);
  await expect(
    page.getByRole("heading", { name: "No bookmarks yet" }),
  ).toBeVisible();
  await addBookmark(page, "Foundation reference");
  await page.reload();
  const article = page.getByRole("article", {
    name: "Foundation reference",
    exact: true,
  });
  await expect(article).toBeVisible();
  await article.getByRole("link", { name: "Edit", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Updated reference");
  await page.getByLabel("Description (optional)").fill("Updated description");
  await page.getByLabel("Tags (comma-separated)").fill("Personal");
  await page.getByRole("button", { name: "Save bookmark" }).click();
  await expect(
    page.getByRole("article", { name: "Updated reference", exact: true }),
  ).toContainText("Updated description");
  await page.getByLabel("Filter by tag", { exact: true }).fill("docs");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No matching bookmarks" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByLabel("Search", { exact: true }).fill("Updated");
  await page.getByLabel("Filter by tag", { exact: true }).fill("PERSONAL");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const updated = page.getByRole("article", {
    name: "Updated reference",
    exact: true,
  });
  await expect(updated).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept());
  await updated.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No matching bookmarks" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await page.goto("/bookmarks/new");
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get("/api/bookmarks")).status()).toBe(401);
  await signIn(page, address);
  await expect(
    page.getByRole("heading", { name: "No bookmarks yet" }),
  ).toBeVisible();
});

test("isolates two browser users and refuses direct access to another user's bookmark", async ({
  page,
  browser,
}) => {
  await signUp(page, email());
  await addBookmark(page, "Only for A");
  const editLink = await page
    .getByRole("article", { name: "Only for A" })
    .getByRole("link", { name: "Edit" })
    .getAttribute("href");
  const id = editLink!.split("/")[2]!;
  const contextB = await browser.newContext({
    baseURL: "http://127.0.0.1:5174",
  });
  try {
    const b = await contextB.newPage();
    await signUp(b, email());
    await expect(
      b.getByRole("heading", { name: "No bookmarks yet" }),
    ).toBeVisible();
    for (const response of [
      await b.request.get(`/api/bookmarks/${id}`),
      await b.request.patch(`/api/bookmarks/${id}`, {
        data: { title: "Stolen" },
        headers: { Origin: "http://127.0.0.1:5174" },
      }),
      await b.request.delete(`/api/bookmarks/${id}`, {
        headers: { Origin: "http://127.0.0.1:5174" },
      }),
    ])
      expect(response.status()).toBe(404);
    await b.goto(editLink!);
    await expect(b.getByRole("alert")).toHaveText("Bookmark not found");
    await page.reload();
    await expect(
      page.getByRole("article", { name: "Only for A" }),
    ).toBeVisible();
  } finally {
    await contextB.close();
  }
});

test("announces auth pending, server errors and focused field validation", async ({
  page,
}) => {
  await page.goto("/reference/route");
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill("not-an-email");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Email", { exact: true })).toBeFocused();
  await expect(page.getByRole("alert")).toHaveText(
    "Enter a valid email address",
  );
  await page.route("**/api/auth/sign-in/email", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ message: "Invalid credentials" }),
    });
  });
  await page.getByLabel("Email", { exact: true }).fill("person@example.com");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Signing in..." }),
  ).toBeDisabled();
  await expect(page.getByRole("alert")).toHaveText("Invalid credentials");
});

test("handles library loading, errors, retries, mutation failures and session expiry", async ({
  page,
  request,
}) => {
  await signUp(page, email());
  await addBookmark(page, "Error states");
  let failList = true;
  await page.route("**/api/bookmarks?**", async (route) => {
    if (failList) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: { message: "Unavailable" } }),
      });
    } else await route.continue();
  });
  await page.reload();
  await expect(page.getByRole("status")).toHaveText("Loading bookmarks...");
  await expect(page.getByRole("alert")).toContainText(
    "Could not load your bookmarks",
  );
  failList = false;
  await page.getByRole("button", { name: "Try again" }).click();
  const item = page.getByRole("article", { name: "Error states" });
  await expect(item).toBeVisible();
  await item.getByRole("link", { name: "Edit", exact: true }).click();
  await page.route("**/api/bookmarks/*", async (route) => {
    if (route.request().method() === "PATCH") {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: { message: "Could not save" } }),
      });
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Save bookmark" }).click();
  await expect(page.getByRole("button", { name: "Saving..." })).toBeDisabled();
  await expect(page.getByRole("alert")).toHaveText("Could not save");
  await page.unroute("**/api/bookmarks/*");
  await page.getByRole("link", { name: "Cancel", exact: true }).click();
  await expect(item).toBeVisible();
  const cookie = (await page.context().cookies())
    .map((value) => `${value.name}=${value.value}`)
    .join("; ");
  await request.post("/api/auth/sign-out", {
    data: {},
    headers: { Origin: "http://127.0.0.1:5174", Cookie: cookie },
  });
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
});

test("requires email verification and keeps service routes outside the SPA", async ({
  page,
  request,
}) => {
  const address = email();
  const credentials = { email: address, password };
  const signup = await request.post("/api/auth/sign-up/email", {
    data: { ...credentials, name: "Unverified" },
    headers: { Origin: "http://127.0.0.1:5174" },
  });
  expect(signup.ok()).toBe(true);
  expect(
    (
      await request.post("/api/auth/sign-in/email", {
        data: credentials,
        headers: { Origin: "http://127.0.0.1:5174" },
      })
    ).status(),
  ).toBe(403);
  await page.goto("/verify-email?error=TOKEN_EXPIRED");
  await expect(page.getByRole("alert")).toContainText("invalid or expired");
  const health = await request.get("/health");
  expect(health.ok()).toBe(true);
  expect(health.headers()["cache-control"]).toBe("no-store");
  expect(await health.json()).toEqual({
    status: "ok",
    checks: { worker: "ok", database: "ok" },
  });
  const session = await request.get("/api/auth/get-session");
  expect(session.headers()["cache-control"]).toBe("private, no-store");
  const missing = await request.get("/api/missing");
  expect(missing.status()).toBe(404);
  expect(await missing.json()).toEqual({ error: "Not found" });
});

test("discards delayed private responses after logout and account switching", async ({
  page,
}) => {
  await signUp(page, email());
  await addBookmark(page, "A secret bookmark");
  let release!: () => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route("**/api/bookmarks?**", async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    started();
    await pending;
    // The browser may already have aborted this request on logout.
    await route.fulfill({ response, body }).catch(() => undefined);
  });
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await ready;
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  release();
  await page.unrouteAll({ behavior: "wait" });
  await expect(
    page.getByText("A secret bookmark", { exact: true }),
  ).toHaveCount(0);
  await signUp(page, email());
  await expect(
    page.getByRole("heading", { name: "No bookmarks yet" }),
  ).toBeVisible();
  await expect(
    page.getByText("A secret bookmark", { exact: true }),
  ).toHaveCount(0);
});

test("shows session loading and recoverable session errors", async ({
  page,
}) => {
  await page.route("**/api/auth/get-session", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ message: "Unavailable" }),
    });
  });
  await page.goto("/");
  await expect(page.getByRole("status")).toHaveText("Loading your session...");
  await expect(
    page.getByRole("heading", { name: "Unable to load your session" }),
  ).toBeVisible();
  await page.unroute("**/api/auth/get-session");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
});

test("paginates a private library with limit and offset", async ({ page }) => {
  await signUp(page, email());
  for (let index = 0; index < 21; index++) {
    const response = await page.request.post("/api/bookmarks", {
      data: { title: `Bookmark ${index}`, url: `https://example.com/${index}` },
      headers: { Origin: "http://127.0.0.1:5174" },
    });
    expect(response.status()).toBe(201);
  }
  await page.reload();
  await expect(page.getByRole("article")).toHaveCount(20);
  await expect(
    page.getByRole("button", { name: "Previous", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByText("Page 2", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Next", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(20);
});

test("keeps B authenticated when A's pending mutation returns 401", async ({
  page,
  request,
}) => {
  const b = email();
  expect(
    (
      await request.post("/api/auth/sign-up/email", {
        data: { email: b, password, name: "User B" },
        headers: { Origin: "http://127.0.0.1:5174" },
      })
    ).ok(),
  ).toBe(true);
  expect((await request.get(await verify(request, b))).ok()).toBe(true);
  await signUp(page, email());
  await addBookmark(page, "Only A");
  await page
    .getByRole("article", { name: "Only A" })
    .getByRole("link", { name: "Edit", exact: true })
    .click();
  let release!: () => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route("**/api/bookmarks/*", async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }
    started();
    await pending;
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "Expired A" } }),
    });
  });
  await page.getByRole("button", { name: "Save bookmark" }).click();
  await ready;
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  // SPA navigation only: a page reload would cancel A's pending fetch and mask the race.
  await page.getByLabel("Email", { exact: true }).fill(b);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your bookmarks" }),
  ).toBeVisible();
  await expect(page.getByText("User B", { exact: true })).toBeVisible();
  const oldResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" && response.status() === 401,
  );
  release();
  await oldResponse;
  await page.unrouteAll({ behavior: "wait" });
  // A fresh B request confirms the session and screen remain usable after the old response.
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No bookmarks yet" }),
  ).toBeVisible();
  await expect(page.getByText("User B", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toHaveCount(0);
  expect((await page.request.get("/api/bookmarks")).status()).toBe(200);
});
