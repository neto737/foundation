import { switchTenant, TenantAccessDeniedError } from "@t00ls-dev/tenant";
import { describe, expect, it } from "vitest";
import { MemorySessions, MemoryTenantRepository } from "./fixtures.js";

describe("tenant switching", () => {
  it("updates the session only after validating membership", async () => {
    const sessions = new MemorySessions();
    await switchTenant({
      repository: new MemoryTenantRepository(),
      sessionId: "session-1",
      sessions,
      tenantId: "tenant-b",
      userId: "user-1",
    });
    expect(sessions.active.get("session-1")).toBe("tenant-b");
    await expect(
      switchTenant({
        repository: new MemoryTenantRepository(),
        sessionId: "session-1",
        sessions,
        tenantId: "tenant-x",
        userId: "user-1",
      }),
    ).rejects.toBeInstanceOf(TenantAccessDeniedError);
    expect(sessions.active.get("session-1")).toBe("tenant-b");
  });
});
