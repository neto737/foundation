import { createAccessControl } from "@t00ls-dev/access";
import { describe, expect, it } from "vitest";

describe("tenant permissions", () => {
  it("evaluates permissions against the role from the current membership", () => {
    const access = createAccessControl({
      owner: ["members.write", "notes.read"],
      viewer: ["notes.read"],
    } as const);
    expect(access.can("owner", "members.write")).toBe(true);
    expect(access.can("viewer", "members.write")).toBe(false);
  });
});
