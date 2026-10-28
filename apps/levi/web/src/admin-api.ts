import { ApiError } from "./api.js";

export type Organization = { id: string; name: string };
export type Feature = {
  key: "members";
  policy: "all" | "selected" | "disabled";
  version: number;
  organizationIds: string[];
};
export type AdministrativeSession = { userId: string; sessionId: string };

function invalid(): never {
  throw new ApiError(
    502,
    "RESPOSTA_INVALIDA",
    "Não foi possível confirmar os dados administrativos.",
  );
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string") return invalid();
  return value;
}
function id(value: unknown): string {
  const result = text(value);
  if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(result))
    return invalid();
  return result;
}
function version(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    return invalid();
  return value;
}
function list<T>(value: unknown, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) return invalid();
  return value.map(parse);
}
function feature(value: unknown): Feature {
  const row = record(value);
  if (
    row.key !== "members" ||
    (row.policy !== "all" &&
      row.policy !== "disabled" &&
      row.policy !== "selected")
  )
    return invalid();
  const organizationIds = list(row.organizationIds, id);
  if (
    (row.policy === "selected" && !organizationIds.length) ||
    (row.policy !== "selected" && organizationIds.length)
  )
    return invalid();
  return {
    key: row.key,
    policy: row.policy,
    version: version(row.version),
    organizationIds,
  };
}
async function request(
  path: string,
  signal: AbortSignal,
  body?: object,
  method = "POST",
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`/api/admin/${path}`, {
      method: body ? method : "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      ...(body
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    });
  } catch {
    throw new ApiError(
      0,
      "REDE",
      "Não foi possível confirmar a operação. Atualize o estado antes de tentar novamente.",
    );
  }
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const data = value && typeof value === "object" ? record(value) : {};
    throw new ApiError(
      response.status,
      typeof data.erro === "string" ? data.erro : "INDISPONIVEL",
      typeof data.mensagem === "string"
        ? data.mensagem
        : "Não foi possível confirmar o acesso administrativo.",
    );
  }
  return record(value);
}
export const adminApi = {
  async session(signal: AbortSignal): Promise<AdministrativeSession> {
    const row = await request("session", signal);
    return { userId: id(row.userId), sessionId: id(row.sessionId) };
  },
  async organizations(signal: AbortSignal, after: string | null = null) {
    const row = await request(
      `organizations${after ? `?after=${encodeURIComponent(after)}` : ""}`,
      signal,
    );
    return {
      items: list(row.items, (item): Organization => {
        const org = record(item);
        return { id: id(org.id), name: text(org.name) };
      }),
      next: row.next === null ? null : id(row.next),
    };
  },
  async features(signal: AbortSignal) {
    return list((await request("features", signal)).features, feature);
  },
  async update(flag: Feature, signal: AbortSignal) {
    await request(
      `features/${flag.key}`,
      signal,
      {
        expectedVersion: flag.version,
        policy:
          flag.policy === "selected"
            ? { kind: flag.policy, organizationIds: flag.organizationIds }
            : { kind: flag.policy },
        ...(flag.policy === "all" ? { confirmAll: true } : {}),
      },
      "PUT",
    );
  },
};
