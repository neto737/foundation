import {
  acceptInvitation,
  createInvitation,
  InvalidInvitationError,
} from "@t00ls-dev/tenant";
import { describe, expect, it } from "vitest";
import { audit, MemoryInvitations } from "./fixtures.js";

describe("tenant invitations", () => {
  it("stores only a hash and creates one membership on acceptance", async () => {
    const repository = new MemoryInvitations();
    const { invitation, token } = await createInvitation({
      actorId: "owner-1",
      audit,
      email: " New@Example.COM ",
      expiresAt: new Date(Date.now() + 60_000),
      repository,
      role: "member",
      tenantId: "tenant-a",
    });
    expect(invitation.email).toBe("new@example.com");
    expect(invitation.tokenHash).not.toBe(token);
    await acceptInvitation({
      audit,
      email: "new@example.com",
      repository,
      token,
      userId: "user-new",
    });
    expect(repository.createdMemberships).toHaveLength(1);
    await expect(
      acceptInvitation({
        audit,
        email: "new@example.com",
        repository,
        token,
        userId: "user-new",
      }),
    ).rejects.toBeInstanceOf(InvalidInvitationError);
  });
});
