import {
  createFoundationAuth,
  type FoundationEmail,
  type FoundationAuth,
  type FoundationSession,
} from "@t00ls-dev/auth";
import type { createPostgresDatabase } from "@t00ls-dev/db/postgres";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import { account, session, user, verification } from "./data/schema.js";
import type { MemberAccessOptions } from "./member-access.js";
import { RequestError } from "./contracts.js";

export type Database = Awaited<ReturnType<typeof createPostgresDatabase>>;
export interface AppOptions extends MemberAccessOptions {
  databaseUrl: string;
  secret: string;
  email: FoundationEmail;
  /** Destino fixo de apresentação; não vem da requisição do usuário. */
  onboardingReturnPath?: "/onboarding";
  /** Somente a entrada Worker confia no header de IP da Cloudflare. */
  publicAbuseProtection?: boolean;
}

export function createAuth(database: Database, options: AppOptions) {
  return createFoundationAuth({
    baseURL: options.baseURL,
    database: drizzleAdapter(database.db, {
      provider: "pg",
      schema: { user, session, account, verification },
      transaction: true,
    }),
    secret: options.secret,
    generateId: "uuid",
    email: {
      send: (input) =>
        options.email.send({
          ...input,
          subject:
            input.subject === "Sign in"
              ? "Verifique seu e-mail no Levi"
              : "Defina sua senha no Levi",
          text: `Use o link para continuar no Levi. Não compartilhe este link.\n\n${input.text}\n\nSe você não solicitou esta mensagem, ignore-a.`,
        }),
    },
  });
}

export function verifiedSession(
  identity: FoundationSession | null,
): FoundationSession {
  if (!identity)
    throw new RequestError(
      401,
      "SESSAO_NECESSARIA",
      "Entre na sua conta para continuar.",
    );
  if (!identity.user.emailVerified)
    throw new RequestError(
      403,
      "EMAIL_NAO_VERIFICADO",
      "Verifique seu e-mail para continuar.",
    );
  return identity;
}

export async function hasPassword(
  db: Pick<Database["db"], "select">,
  userId: string,
): Promise<boolean> {
  const rows = await db
    .select({ present: sql<number>`1` })
    .from(account)
    .where(
      and(
        eq(account.userId, userId),
        eq(account.providerId, "credential"),
        eq(account.accountId, userId),
        isNotNull(account.password),
        ne(account.password, ""),
      ),
    )
    .limit(1);
  return rows.length === 1;
}

export async function readySession(
  database: Database,
  resolved: FoundationSession | null,
) {
  const identity = verifiedSession(resolved);
  if (!(await hasPassword(database.db, identity.user.id))) {
    throw new RequestError(
      403,
      "SENHA_NECESSARIA",
      "Defina sua senha antes de continuar.",
    );
  }
  return identity;
}

// Chama somente o handler HTTP público. A instância Better Auth não é acessada.
export async function authRequest(
  auth: FoundationAuth,
  options: AppOptions,
  original: Request,
  path: string,
  body?: object,
) {
  const headers = new Headers(original.headers);
  headers.delete("host");
  headers.delete("content-length");
  if (body) headers.set("content-type", "application/json");
  const response = await auth.handler(
    new Request(new URL(`/api/auth${path}`, options.baseURL), {
      method: body ? "POST" : "GET",
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  );
  if (response.status >= 300 && response.status < 400) return response;
  const responseHeaders = new Headers(response.headers);
  if (response.status === 429 && !responseHeaders.has("Retry-After")) {
    const retry = responseHeaders.get("X-Retry-After");
    if (retry && /^\d+$/.test(retry)) responseHeaders.set("Retry-After", retry);
  }
  // Preserva todos os cookies nativos; não devolve tokens de sessão no JSON.
  return new Response(
    JSON.stringify(
      response.ok
        ? {
            ok: true,
            mensagem: "Solicitação concluída. Consulte a etapa do onboarding.",
          }
        : {
            erro: "AUTENTICACAO_NAO_CONCLUIDA",
            mensagem:
              "Não foi possível concluir a autenticação. Solicite um novo link ou tente entrar novamente.",
          },
    ),
    {
      status:
        path === "/sign-in/email" && [400, 401, 403].includes(response.status)
          ? 401
          : response.status,
      headers: responseHeaders,
    },
  );
}
