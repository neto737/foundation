import { describe, expect, it } from "vitest";
import { memberships } from "./fixtures.js";

describe("memberships", () => {
  it("allows a user to belong to multiple tenants with contextual roles", () => {
    const userMemberships = memberships.filter(
      (item) => item.userId === "user-1",
    );
    expect(userMemberships.map((item) => item.tenantId)).toEqual([
      "tenant-a",
      "tenant-b",
    ]);
    expect(userMemberships.map((item) => item.role)).toEqual([
      "owner",
      "viewer",
    ]);
  });
});
