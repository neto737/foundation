/** Configuração de rollout; não substitui sessão nem vínculo administrativo. */
export interface MemberAccessOptions {
  /** Exclusivo dos executáveis/harnesses sintéticos locais; nunca lido de bindings. */
  membersEnabled?: boolean;
  membersDevOrganizations?: readonly string[];
  baseURL: string;
}

/** CSV de UUIDs; um único item inválido desabilita o conjunto inteiro. */
export function readMembersDevOrganizations(value: unknown): readonly string[] {
  if (typeof value !== "string" || !value.trim() || value.length > 4096)
    return [];
  const ids = value.split(",").map((id) => id.trim().toLowerCase());
  if (
    ids.some(
      (id) =>
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          id,
        ),
    )
  )
    return [];
  return [...new Set(ids)];
}

/** Chamar somente após validar sessão pronta, tenant ativo e membership admin. */
export function membersAvailable(
  options: MemberAccessOptions,
  organizationId: string,
): boolean {
  return (
    options.membersEnabled === true ||
    (options.baseURL === "https://levi.t00ls.dev" &&
      options.membersDevOrganizations?.includes(
        organizationId.toLowerCase(),
      ) === true)
  );
}
