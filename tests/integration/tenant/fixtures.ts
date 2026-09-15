import type {
  InvitationRepository,
  Membership,
  TenantContext,
  TenantInvitation,
  TenantOwnedRepository,
  TenantRepository,
  TenantSessionStore,
} from "@t00ls-dev/tenant";

export type Role = "owner" | "admin" | "member" | "viewer";

export const memberships: Membership<Role>[] = [
  { id: "m1", tenantId: "tenant-a", userId: "user-1", role: "owner" },
  { id: "m2", tenantId: "tenant-b", userId: "user-1", role: "viewer" },
  { id: "m3", tenantId: "tenant-b", userId: "user-2", role: "admin" },
];

export class MemoryTenantRepository implements TenantRepository<Role> {
  findMembership(userId: string, tenantId: string) {
    return Promise.resolve(
      memberships.find(
        (item) => item.userId === userId && item.tenantId === tenantId,
      ) ?? null,
    );
  }
}

export class MemorySessions implements TenantSessionStore {
  readonly active = new Map<string, string>();
  setActiveTenant(sessionId: string, tenantId: string) {
    this.active.set(sessionId, tenantId);
    return Promise.resolve();
  }
}

interface Note {
  id: string;
  tenantId: string;
  body: string;
}

export class MemoryNotes implements TenantOwnedRepository<Note> {
  readonly notes: Note[] = [
    { id: "same-id", tenantId: "tenant-a", body: "A secret" },
    { id: "same-id", tenantId: "tenant-b", body: "B secret" },
  ];
  findById(context: TenantContext, id: string) {
    return Promise.resolve(
      this.notes.find(
        (note) => note.id === id && note.tenantId === context.tenantId,
      ) ?? null,
    );
  }
}

export class MemoryInvitations implements InvitationRepository<Role> {
  readonly invitations: TenantInvitation<Role>[] = [];
  readonly createdMemberships: Membership<Role>[] = [];

  create(invitation: TenantInvitation<Role>) {
    this.invitations.push(invitation);
    return Promise.resolve();
  }

  consume(input: {
    email: string;
    tokenHash: string;
    userId: string;
    now: Date;
  }) {
    const invitation = this.invitations.find(
      (item) =>
        item.email === input.email &&
        item.tokenHash === input.tokenHash &&
        item.acceptedAt === null &&
        item.expiresAt > input.now,
    );
    if (!invitation) return Promise.resolve(null);
    invitation.acceptedAt = input.now;
    this.createdMemberships.push({
      id: `membership-${invitation.id}`,
      role: invitation.role,
      tenantId: invitation.tenantId,
      userId: input.userId,
    });
    return Promise.resolve(invitation);
  }
}

export const audit = { record: () => Promise.resolve() };
