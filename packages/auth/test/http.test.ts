import { memoryAdapter } from "better-auth/adapters/memory";
import { beforeEach, describe, expect, it } from "vitest";
import { createFoundationAuth, type FoundationAuth } from "../src/index.js";

describe("foundation auth HTTP flows", () => {
  const sent: Array<{ subject: string; text: string; to: string }> = [];
  let auth: FoundationAuth;

  beforeEach(() => {
    sent.splice(0);
    auth = createFoundationAuth({
      baseURL: "http://localhost:3000",
      database: memoryAdapter({
        account: [],
        session: [],
        user: [],
        verification: [],
      }),
      email: {
        send(input) {
          sent.push(input);
          return Promise.resolve();
        },
      },
      secret: "test-secret-with-at-least-thirty-two-characters",
    });
  });

  it("registers and sends email verification without exposing credentials", async () => {
    const response = await post("/api/auth/sign-up/email", {
      email: "person@example.com",
      name: "Person",
      password: "correct-horse-battery-staple",
    });
    expect(response.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("person@example.com");
    expect(sent[0]?.subject).toBe("Verify your email");
  });

  it("accepts magic-link and password-reset requests without user enumeration", async () => {
    await post("/api/auth/sign-up/email", {
      email: "person@example.com",
      name: "Person",
      password: "correct-horse-battery-staple",
    });
    sent.splice(0);
    const magic = await post("/api/auth/sign-in/magic-link", {
      callbackURL: "/",
      email: "person@example.com",
    });
    const reset = await post("/api/auth/request-password-reset", {
      email: "person@example.com",
      redirectTo: "/reset-password",
    });
    expect(magic.status).toBe(200);
    expect(reset.status).toBe(200);
    expect(sent.map((email) => email.subject)).toEqual([
      "Sign in",
      "Reset your password",
    ]);
  });

  function post(path: string, body: Readonly<Record<string, string>>) {
    return auth.handler(
      new Request(`http://localhost:3000${path}`, {
        body: JSON.stringify(body),
        headers: {
          "Content-Type": "application/json",
          "Origin": "http://localhost:3000",
        },
        method: "POST",
      }),
    );
  }
});
