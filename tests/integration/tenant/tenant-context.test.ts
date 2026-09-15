import {
  resolveTenantContext,
  TenantContextRequiredError,
} from "@t00ls-dev/tenant";
import { describe, expect, it } from "vitest";
import { MemoryTenantRepository } from "./fixtures.js";

describe("tenant context", () => {
  it("resolves the membership role for the active tenant", async () => {
    const context = await resolveTenantContext({
      activeTenantId: "tenant-b",
      repository: new MemoryTenantRepository(),
      userId: "user-1",
    });
    expect(context.role).toBe("viewer");
  });

  it("rejects tenant-owned operations without an active tenant", async () => {
    await expect(
      resolveTenantContext({
        activeTenantId: null,
        repository: new MemoryTenantRepository(),
        userId: "user-1",
      }),
    ).rejects.toBeInstanceOf(TenantContextRequiredError);
  });
});
