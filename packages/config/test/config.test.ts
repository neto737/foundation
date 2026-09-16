import { describe, expect, it } from "vitest";

import { defineConfig, foundationConfigSchema } from "../src/index.js";

describe("foundation config", () => {
  it("validates supported settings and supplies optional defaults", () => {
    const config = defineConfig({
      app: { environment: "prod", name: "billing" },
      auth: { emailPassword: true, magicLink: true },
      database: { connection: "postgres://database", dialect: "postgres" },
    });

    expect(config).toEqual({
      app: { environment: "prod", name: "billing" },
      auth: { emailPassword: true, magicLink: true, oauth: [] },
      database: { connection: "postgres://database", dialect: "postgres" },
      telemetry: {
        ga4: false,
        hitmetrica: false,
        posthog: false,
        sentry: false,
      },
      tenancy: false,
    });
  });

  it("rejects invalid discriminators and required values", () => {
    expect(
      foundationConfigSchema.safeParse({
        app: { environment: "staging", name: "" },
        auth: { emailPassword: true, magicLink: true },
        database: { dialect: "sqlite" },
      }).success,
    ).toBe(false);
  });
});
