export type Stage =
  "email" | "verificar-email" | "senha" | "organizacao" | "concluido";
export interface NamedItem {
  id: string;
  nome: string;
}
export interface ProvisionInput {
  organizationName: string;
  churchName: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
function contractError(): never {
  throw new ApiError(
    502,
    "RESPOSTA_INVALIDA",
    "Não foi possível confirmar os dados. Tente atualizar novamente.",
  );
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return contractError();
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      value,
    )
  )
    return contractError();
  return value;
}
async function request(
  path: string,
  body?: object,
  key?: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: body ? "POST" : "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(
      0,
      "REDE",
      "Não foi possível confirmar a operação. Verifique sua conexão e consulte o estado antes de tentar novamente.",
    );
  }
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const data =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    throw new ApiError(
      response.status,
      typeof data.erro === "string" ? data.erro : "INDISPONIVEL",
      typeof data.mensagem === "string" && data.mensagem.length < 500
        ? data.mensagem
        : "Não foi possível concluir a solicitação. Tente novamente.",
    );
  }
  return record(value);
}
function namedItems(list: unknown): NamedItem[] {
  if (!Array.isArray(list)) return contractError();
  return list.map((value: unknown) => {
    const item = record(value);
    if (
      typeof item.nome !== "string" ||
      !item.nome.trim() ||
      item.nome.length > 160
    )
      return contractError();
    return { id: id(item.id), nome: item.nome };
  });
}
export const api = {
  async stage(): Promise<Stage> {
    const { etapa } = record(await request("/api/onboarding"));
    if (
      etapa !== "email" &&
      etapa !== "verificar-email" &&
      etapa !== "senha" &&
      etapa !== "organizacao" &&
      etapa !== "concluido"
    )
      return contractError();
    return etapa;
  },
  email: (email: string) => request("/api/onboarding/email", { email }),
  passwordEmail: () => request("/api/onboarding/password-email", {}),
  password: (token: string, newPassword: string) =>
    request("/api/onboarding/password", { token, newPassword }),
  login: (email: string, password: string) =>
    request("/api/auth/sign-in/email", { email, password }),
  logout: () => request("/api/auth/sign-out", {}),
  async organizations() {
    return namedItems(
      record(await request("/api/organizations")).organizations,
    );
  },
  async provision(input: ProvisionInput, key: string) {
    const result = record(await request("/api/organizations", input, key));
    return {
      organizationId: id(result.organizationId),
      churchId: id(result.churchId),
    };
  },
  select: (organizationId: string) =>
    request("/api/tenant", { organizationId }),
  async context() {
    const data = record(await request("/api/context"));
    if (data.role !== "admin") return contractError();
    return { organizationId: id(data.organizationId) };
  },
  async churches() {
    const data = record(await request("/api/churches"));
    return {
      organizationId: id(data.organizationId),
      churches: namedItems(data.churches),
    };
  },
};
