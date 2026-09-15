export type RoleMap<
  TRole extends string,
  TPermission extends string,
> = Readonly<Record<TRole, readonly TPermission[]>>;

export function createAccessControl<
  TRole extends string,
  TPermission extends string,
>(roles: RoleMap<TRole, TPermission>) {
  return {
    can(role: TRole, permission: TPermission): boolean {
      return roles[role].includes(permission);
    },
    assert(role: TRole, permission: TPermission): void {
      if (!roles[role].includes(permission)) {
        throw new AccessDeniedError(role, permission);
      }
    },
  };
}

export class AccessDeniedError extends Error {
  constructor(role: string, permission: string) {
    super(`Role ${role} does not grant ${permission}`);
    this.name = "AccessDeniedError";
  }
}
