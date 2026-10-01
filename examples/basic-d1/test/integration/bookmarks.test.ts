import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import type { Env } from "../../src/server/auth.js";
import {
  bookmarkListSchema,
  bookmarkResponseSchema,
} from "../../src/shared/bookmarks.js";
import { applyMigrations, createTestDatabase } from "../d1.js";

describe("Links API with Better Auth and real D1", () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let env: Env;
  const sent: Array<{ to: string; text: string; subject: string }> = [];
  const emailFactory = () => ({
    send(input: { to: string; text: string; subject: string }) {
      sent.push(input);
      return Promise.resolve();
    },
  });
  let app: ReturnType<typeof createApp>;
  const origin = "http://localhost:3000";
  const input = {
    title: "Foundation 100%",
    url: "https://example.com/docs",
    description: "Private reference",
    tags: [" Docs ", "work"],
  };

  beforeEach(async () => {
    database = await createTestDatabase();
    await applyMigrations(database.binding);
    sent.splice(0);
    env = {
      DB: database.binding,
      BASE_URL: origin,
      AUTH_SECRET: "test-secret-with-at-least-thirty-two-characters",
      EMAIL_FROM: "test@example.com",
      RESEND_API_KEY: "not-used",
      ASSETS: { fetch: () => Promise.resolve(new Response("SPA")) },
    };
    app = createApp(emailFactory);
  });
  afterEach(async () => database.miniflare.dispose());

  function request(
    path: string,
    method = "GET",
    cookie = "",
    body?: unknown,
    requestOrigin: string | null = origin,
  ) {
    const headers = new Headers({ "Content-Type": "application/json" });
    if (cookie) headers.set("Cookie", cookie);
    if (requestOrigin) headers.set("Origin", requestOrigin);
    return app.request(
      `${origin}${path}`,
      {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      },
      env,
    );
  }
  async function register(email: string) {
    const credentials = { email, password: "correct-horse-battery-staple" };
    expect(
      (
        await request("/api/auth/sign-up/email", "POST", "", {
          ...credentials,
          name: "Person",
        })
      ).status,
    ).toBe(200);
    expect(
      (await request("/api/auth/sign-in/email", "POST", "", credentials))
        .status,
    ).toBe(403);
    const verification = sent.find(
      (message) =>
        message.to === email && message.subject === "Verify your email",
    );
    expect(verification).toBeDefined();
    const verified = await app.request(verification!.text, undefined, env);
    expect([200, 302]).toContain(verified.status);
    const login = await request(
      "/api/auth/sign-in/email",
      "POST",
      "",
      credentials,
    );
    expect(login.status).toBe(200);
    expect(login.headers.getSetCookie().join(";")).toContain("HttpOnly");
    expect(login.headers.getSetCookie().join(";").toLowerCase()).toContain(
      "samesite=lax",
    );
    return login.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; ");
  }
  async function create(cookie: string, value = input) {
    const response = await request("/api/bookmarks", "POST", cookie, value);
    expect(response.status).toBe(201);
    return bookmarkResponseSchema.parse(await response.json());
  }

  it("persists CRUD, normalizes tags, filters literal search and paginates", async () => {
    const cookie = await register("a@example.com");
    const first = await create(cookie);
    expect(first.tags).toEqual(["docs", "work"]);
    await create(cookie, { ...input, title: "Other", tags: ["personal"] });
    const list = bookmarkListSchema.parse(
      await (await request("/api/bookmarks?limit=1", "GET", cookie)).json(),
    );
    expect(list.items).toHaveLength(1);
    expect(list.hasMore).toBe(true);
    const secondPage = bookmarkListSchema.parse(
      await (
        await request("/api/bookmarks?limit=1&offset=1", "GET", cookie)
      ).json(),
    );
    expect(secondPage.items[0]?.id).not.toBe(list.items[0]?.id);
    expect(secondPage.hasMore).toBe(false);
    for (const query of ["q=100%25", "tag=DOCS", "q=reference&tag=docs"]) {
      const filtered = bookmarkListSchema.parse(
        await (await request(`/api/bookmarks?${query}`, "GET", cookie)).json(),
      );
      expect(filtered.items.map((item) => item.id)).toEqual([first.id]);
    }
    expect(
      bookmarkListSchema.parse(
        await (await request("/api/bookmarks?q=_", "GET", cookie)).json(),
      ).items,
    ).toEqual([]);
    const updated = bookmarkResponseSchema.parse(
      await (
        await request(`/api/bookmarks/${first.id}`, "PATCH", cookie, {
          title: "Edited",
          description: null,
          tags: ["New"],
        })
      ).json(),
    );
    expect(updated).toMatchObject({
      title: "Edited",
      description: null,
      tags: ["new"],
    });
    app = createApp(emailFactory);
    expect(
      bookmarkResponseSchema.parse(
        await (
          await request(`/api/bookmarks/${first.id}`, "GET", cookie)
        ).json(),
      ).title,
    ).toBe("Edited");
    expect(
      (await request(`/api/bookmarks/${first.id}`, "DELETE", cookie)).status,
    ).toBe(204);
    expect(
      (await request(`/api/bookmarks/${first.id}`, "GET", cookie)).status,
    ).toBe(404);
  });

  it("isolates every operation and filter between A and B", async () => {
    const a = await register("a@example.com");
    const b = await register("b@example.com");
    const item = await create(a);
    for (const query of [
      "",
      "?q=Private",
      "?tag=docs",
      "?q=Foundation&tag=docs&limit=1&offset=0",
    ]) {
      const response = await request(`/api/bookmarks${query}`, "GET", b);
      expect(response.status).toBe(200);
      expect(bookmarkListSchema.parse(await response.json())).toEqual({
        items: [],
        hasMore: false,
      });
    }
    for (const method of ["GET", "PATCH", "DELETE"]) {
      const response = await request(
        `/api/bookmarks/${item.id}`,
        method,
        b,
        method === "PATCH" ? { title: "Stolen" } : undefined,
      );
      const missing = await request(
        `/api/bookmarks/${crypto.randomUUID()}`,
        method,
        b,
        method === "PATCH" ? { title: "Stolen" } : undefined,
      );
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual(await missing.json());
    }
    expect(
      (await request("/api/bookmarks", "POST", b, { ...input, userId: "a" }))
        .status,
    ).toBe(400);
    expect(
      (await request(`/api/bookmarks/${item.id}`, "PATCH", a, { userId: "b" }))
        .status,
    ).toBe(400);
    expect((await request("/api/bookmarks?userId=a", "GET", b)).status).toBe(
      400,
    );
    expect(
      bookmarkResponseSchema.parse(
        await (await request(`/api/bookmarks/${item.id}`, "GET", a)).json(),
      ),
    ).toEqual(item);
    expect(
      await database.binding
        .prepare("SELECT count(*) AS total FROM bookmark")
        .first(),
    ).toEqual({ total: 1 });
  });

  it("rejects missing, invalid, expired and revoked sessions on every route", async () => {
    const cookie = await register("a@example.com");
    const item = await create(cookie);
    const operations = [
      ["/api/bookmarks", "GET", undefined],
      ["/api/bookmarks", "POST", input],
      [`/api/bookmarks/${item.id}`, "GET", undefined],
      [`/api/bookmarks/${item.id}`, "PATCH", { title: "Forbidden" }],
      [`/api/bookmarks/${item.id}`, "DELETE", undefined],
    ] as const;
    for (const invalidCookie of ["", "better-auth.session_token=invalid"]) {
      for (const [path, method, body] of operations)
        expect((await request(path, method, invalidCookie, body)).status).toBe(
          401,
        );
    }
    await database.binding
      .prepare("UPDATE session SET expires_at = ?")
      .bind(Math.floor(Date.now() / 1000) - 10)
      .run();
    for (const [path, method, body] of operations)
      expect((await request(path, method, cookie, body)).status).toBe(401);
    const fresh = await register("b@example.com");
    expect(
      (await request("/api/auth/sign-out", "POST", fresh, {})).status,
    ).toBe(200);
    for (const [path, method, body] of operations)
      expect((await request(path, method, fresh, body)).status).toBe(401);
  });

  it("rejects cross-origin and missing-origin mutations without changing data", async () => {
    const cookie = await register("a@example.com");
    const item = await create(cookie);
    for (const requestOrigin of ["https://attacker.example", null]) {
      for (const [path, method, body] of [
        ["/api/bookmarks", "POST", input],
        [`/api/bookmarks/${item.id}`, "PATCH", { title: "Forbidden" }],
        [`/api/bookmarks/${item.id}`, "DELETE", undefined],
      ] as const) {
        const response = await request(
          path,
          method,
          cookie,
          body,
          requestOrigin,
        );
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({
          error: { code: "FORBIDDEN" },
        });
        expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      }
    }
    expect(
      bookmarkResponseSchema.parse(
        await (
          await request(`/api/bookmarks/${item.id}`, "GET", cookie)
        ).json(),
      ),
    ).toEqual(item);
    expect(
      (
        await request(
          "/api/auth/sign-out",
          "POST",
          cookie,
          {},
          "https://attacker.example",
        )
      ).status,
    ).toBe(403);
  });

  it("propagates session refresh and cleanup cookies and private headers", async () => {
    const cookie = await register("a@example.com");
    const now = Math.floor(Date.now() / 1000);
    await database.binding
      .prepare("UPDATE session SET expires_at = ?, updated_at = ?")
      .bind(now + 5 * 86400, now - 2 * 86400)
      .run();
    const response = await request("/api/bookmarks", "GET", cookie);
    expect(response.status).toBe(200);
    expect(
      response.headers
        .getSetCookie()
        .some(
          (value) =>
            value.includes("session_token=") && value.includes("Max-Age="),
        ),
    ).toBe(true);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Vary")).toBe("Cookie, Authorization");
    await database.binding
      .prepare("UPDATE session SET expires_at = ?")
      .bind(now - 1)
      .run();
    const expired = await request("/api/bookmarks", "GET", cookie);
    expect(expired.status).toBe(401);
    expect(
      expired.headers
        .getSetCookie()
        .some((value) => value.includes("Max-Age=0")),
    ).toBe(true);
    expect(expired.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("validates payloads and preserves health and API fallback contracts", async () => {
    const cookie = await register("a@example.com");
    expect(
      (
        await request("/api/bookmarks", "POST", cookie, {
          ...input,
          url: "javascript:alert(1)",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/api/bookmarks", "POST", cookie, {
          ...input,
          description: "x".repeat(17000),
        })
      ).status,
    ).toBe(413);
    expect(
      (await request("/api/bookmarks?limit=101", "GET", cookie)).status,
    ).toBe(400);
    const malformed = await app.request(
      `${origin}/api/bookmarks`,
      {
        method: "POST",
        headers: {
          "Cookie": cookie,
          "Origin": origin,
          "Content-Type": "application/json",
        },
        body: "{",
      },
      env,
    );
    expect(malformed.status).toBe(400);
    expect((await request("/api/missing")).status).toBe(404);
    expect((await request("/health")).headers.get("Cache-Control")).toBe(
      "no-store",
    );
    const broken = {
      ...env,
      DB: {
        prepare() {
          throw new Error("internal database secret");
        },
      } as unknown as D1Database,
    };
    const health = await app.request(`${origin}/health`, undefined, broken);
    expect(health.status).toBe(503);
    expect(await health.text()).not.toContain("internal database secret");
    const failure = await app.request(
      `${origin}/api/bookmarks`,
      { headers: { Cookie: cookie } },
      broken,
    );
    expect(failure.status).toBe(500);
    expect(await failure.text()).not.toContain("internal database secret");
    expect(failure.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
