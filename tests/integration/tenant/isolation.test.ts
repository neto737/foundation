import { describe, expect, it } from "vitest";
import { MemoryNotes } from "./fixtures.js";

describe("tenant isolation", () => {
  it("scopes colliding resource ids to the explicit tenant context", async () => {
    const notes = new MemoryNotes();
    const tenantA = await notes.findById(
      {
        tenantId: "tenant-a",
        userId: "user-1",
        membershipId: "m1",
        role: "owner",
      },
      "same-id",
    );
    const tenantB = await notes.findById(
      {
        tenantId: "tenant-b",
        userId: "user-1",
        membershipId: "m2",
        role: "viewer",
      },
      "same-id",
    );
    expect(tenantA?.body).toBe("A secret");
    expect(tenantB?.body).toBe("B secret");
  });
});
