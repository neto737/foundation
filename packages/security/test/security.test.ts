import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import {
  csrfProtection,
  fixedWindowRateLimit,
  foundationCors,
  verifyTurnstile,
} from "../src/index.js";

describe("foundationCors", () => {
  it("handles an allowed credentialed preflight request", async () => {
    const app = new Hono();
    app.use(
      "*",
      foundationCors({
        allowHeaders: ["Content-Type"],
        allowMethods: ["POST"],
        credentials: true,
        origin: ["https://app.example"],
      }),
    );
    app.post("/", (context) => context.text("ok"));

    const response = await app.request("/", {
      headers: {
        "Access-Control-Request-Headers": "Content-Type",
        "Access-Control-Request-Method": "POST",
        "Origin": "https://app.example",
      },
      method: "OPTIONS",
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://app.example",
    );
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe(
      "true",
    );
  });

  it("does not grant an unconfigured origin", async () => {
    const app = new Hono();
    app.use("*", foundationCors({ origin: ["https://app.example"] }));
    app.get("/", (context) => context.text("ok"));

    const response = await app.request("/", {
      headers: { Origin: "https://attacker.example" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
  });
});

describe("csrfProtection", () => {
  it("rejects an unsafe cookie-authenticated cross-origin request", async () => {
    const app = new Hono();
    app.use("*", csrfProtection());
    app.post("/", (context) => context.text("ok"));

    const response = await app.request("http://service.example/", {
      headers: { Cookie: "session=1", Origin: "https://attacker.example" },
      method: "POST",
    });

    expect(response.status).toBe(403);
  });

  it("allows same-origin and non-cookie requests", async () => {
    const app = new Hono();
    app.use("*", csrfProtection());
    app.post("/", (context) => context.text("ok"));

    const sameOrigin = await app.request("http://service.example/", {
      headers: { Cookie: "session=1", Origin: "http://service.example" },
      method: "POST",
    });
    const bearerOnly = await app.request("http://service.example/", {
      method: "POST",
    });

    expect(sameOrigin.status).toBe(200);
    expect(bearerOnly.status).toBe(200);
  });

  it("allows configured origins and safe methods", async () => {
    const app = new Hono();
    app.use(
      "*",
      csrfProtection({ trustedOrigins: ["https://app.example/path"] }),
    );
    app.get("/", (context) => context.text("ok"));
    app.post("/", (context) => context.text("ok"));

    const configured = await app.request("http://service.example/", {
      headers: { Cookie: "session=1", Origin: "https://app.example" },
      method: "POST",
    });
    const safe = await app.request("http://service.example/", {
      headers: { Cookie: "session=1" },
    });

    expect(configured.status).toBe(200);
    expect(safe.status).toBe(200);
  });

  it("rejects missing or malformed origins by default", async () => {
    const app = new Hono();
    app.use("*", csrfProtection({ trustedOrigins: ["not an origin"] }));
    app.post("/", (context) => context.text("ok"));

    const missing = await app.request("http://service.example/", {
      headers: { Cookie: "session=1" },
      method: "POST",
    });
    const malformed = await app.request("http://service.example/", {
      headers: { Cookie: "session=1", Origin: "not an origin" },
      method: "POST",
    });

    expect(missing.status).toBe(403);
    expect(malformed.status).toBe(403);
  });

  it("can explicitly allow requests without an Origin header", async () => {
    const app = new Hono();
    app.use("*", csrfProtection({ allowMissingOrigin: true }));
    app.post("/", (context) => context.text("ok"));

    const response = await app.request("/", {
      headers: { Cookie: "session=1" },
      method: "POST",
    });

    expect(response.status).toBe(200);
  });
});

describe("fixedWindowRateLimit", () => {
  it("limits within a window and resets at its boundary", async () => {
    let now = 12_345;
    const counts = new Map<string, number>();
    const increment = vi.fn((key: string) => {
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return count;
    });
    const app = new Hono();
    app.use(
      "*",
      fixedWindowRateLimit({
        key: () => "client",
        limit: 2,
        now: () => now,
        store: { increment },
        windowMs: 1_000,
      }),
    );
    app.get("/", (context) => context.text("ok"));

    expect((await app.request("/")).status).toBe(200);
    const second = await app.request("/");
    expect(second.headers.get("RateLimit-Remaining")).toBe("0");
    const limited = await app.request("/");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("1");

    now = 13_000;
    expect((await app.request("/")).status).toBe(200);
    expect(increment).toHaveBeenLastCalledWith(
      "rate-limit:client:13000",
      14_000,
    );
  });

  it("bypasses the store when no key is available", async () => {
    const increment = vi.fn();
    const app = new Hono();
    app.use(
      "*",
      fixedWindowRateLimit({
        key: () => null,
        limit: 1,
        store: { increment },
        windowMs: 1_000,
      }),
    );
    app.get("/", (context) => context.text("ok"));

    const response = await app.request("/");

    expect(response.status).toBe(200);
    expect(response.headers.has("RateLimit-Limit")).toBe(false);
    expect(increment).not.toHaveBeenCalled();
  });

  it("validates the window and request limit", () => {
    const options = {
      key: () => "client",
      limit: 1,
      store: { increment: () => 1 },
      windowMs: 1_000,
    };

    expect(() => fixedWindowRateLimit({ ...options, limit: 0 })).toThrow(
      RangeError,
    );
    expect(() => fixedWindowRateLimit({ ...options, windowMs: 0 })).toThrow(
      RangeError,
    );
  });
});

describe("verifyTurnstile", () => {
  it("posts verification fields and returns Cloudflare's result", async () => {
    const fetch = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) => {
        const body = init?.body as URLSearchParams;
        expect(body.get("secret")).toBe("secret");
        expect(body.get("response")).toBe("token");
        expect(body.get("remoteip")).toBe("203.0.113.1");
        return Promise.resolve(
          Response.json({ hostname: "app.example", success: true }),
        );
      },
    );

    const result = await verifyTurnstile({
      fetch,
      remoteIp: "203.0.113.1",
      secret: "secret",
      token: "token",
    });

    expect(result).toEqual({ hostname: "app.example", success: true });
    expect(fetch).toHaveBeenCalledWith(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("sends an idempotency key and rejects HTTP errors", async () => {
    const fetch = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) => {
        expect((init?.body as URLSearchParams).get("idempotency_key")).toBe(
          "request-id",
        );
        return Promise.resolve(new Response(null, { status: 503 }));
      },
    );

    await expect(
      verifyTurnstile({
        fetch,
        idempotencyKey: "request-id",
        secret: "secret",
        token: "token",
      }),
    ).rejects.toThrow("Turnstile verification failed with HTTP 503");
  });
});
