import { describe, expect, it } from "vitest";

import { AccessDeniedError, createAccessControl } from "../src/index.js";

describe("createAccessControl", () => {
  const access = createAccessControl({
    admin: ["invoice:read", "invoice:write"],
    viewer: ["invoice:read"],
  } as const);

  it("answers permission checks from the configured role map", () => {
    expect(access.can("admin", "invoice:write")).toBe(true);
    expect(access.can("viewer", "invoice:write")).toBe(false);
  });

  it("asserts granted permissions and throws a specific denial error", () => {
    expect(() => access.assert("viewer", "invoice:read")).not.toThrow();

    expect(() => access.assert("viewer", "invoice:write")).toThrow(
      AccessDeniedError,
    );
    expect(() => access.assert("viewer", "invoice:write")).toThrow(
      "Role viewer does not grant invoice:write",
    );
  });
});
