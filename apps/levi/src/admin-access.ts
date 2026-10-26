import type { FoundationSession } from "@t00ls-dev/auth";
import { and, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import type { Database } from "./auth.js";
import { RequestError } from "./contracts.js";
import { account, globalAdministrators, session, user } from "./data/schema.js";

export type AdministrativeTransaction = Parameters<
  Parameters<Database["db"]["transaction"]>[0]
>[0];
export const administrativeSessionAgeMs = 10 * 60 * 1000;

export function administrativeNotFound(): never {
  throw new RequestError(404, "NAO_ENCONTRADO", "Recurso não encontrado.");
}

// Mesmo mutex para bootstrap, concessões, revogações e políticas. Não é o lock de migrations.
export async function lockAdministrativeChanges(tx: AdministrativeTransaction) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(715463, 2)`);
}

export async function lockReadyUser(
  tx: AdministrativeTransaction,
  userId: string,
) {
  const [current] = await tx
    .select({ id: user.id, email: user.email, verified: user.emailVerified })
    .from(user)
    .where(eq(user.id, userId))
    .for("share");
  if (!current?.verified) administrativeNotFound();
  const credentials = await tx
    .select({ id: account.id })
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
    .for("share");
  if (!credentials.length) administrativeNotFound();
  return current;
}

export async function lockReadyIdentity(
  tx: AdministrativeTransaction,
  input: { userId: string; sessionId: string },
  recent: boolean,
) {
  const current = await lockReadyUser(tx, input.userId);
  const [currentSession] = await tx
    .select({
      id: session.id,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
    })
    .from(session)
    .where(
      and(eq(session.id, input.sessionId), eq(session.userId, input.userId)),
    )
    .for("share");
  // Clock após aguardar os locks; updatedAt não representa nova autenticação.
  const now = Date.now();
  if (
    !currentSession ||
    currentSession.expiresAt.getTime() <= now ||
    currentSession.createdAt.getTime() > now
  )
    administrativeNotFound();
  if (
    recent &&
    now - currentSession.createdAt.getTime() > administrativeSessionAgeMs
  )
    throw new RequestError(
      403,
      "REAUTENTICACAO_NECESSARIA",
      "Entre novamente para administrar concessões.",
    );
  return current;
}

async function authorize(
  tx: AdministrativeTransaction,
  identity: FoundationSession | null,
  recent: boolean,
) {
  if (!identity) administrativeNotFound();
  try {
    await lockReadyIdentity(
      tx,
      { userId: identity.user.id, sessionId: identity.session.id },
      false,
    );
    const [grant] = await tx
      .select({ userId: globalAdministrators.userId })
      .from(globalAdministrators)
      .where(
        and(
          eq(globalAdministrators.userId, identity.user.id),
          isNull(globalAdministrators.revokedAt),
        ),
      )
      .for("share");
    if (!grant) administrativeNotFound();
  } catch {
    // Não diferenciar inexistência, conta não pronta e armazenamento indisponível.
    administrativeNotFound();
  }
  if (recent)
    await lockReadyIdentity(
      tx,
      { userId: identity.user.id, sessionId: identity.session.id },
      true,
    );
  return identity.user.id;
}

/** identity vem exclusivamente de resolveSession; IDs de request não autenticam. */
export async function requireGlobalAdministrator(
  database: Database,
  identity: FoundationSession | null,
) {
  try {
    return await database.db.transaction((tx) =>
      authorize(tx, identity, false),
    );
  } catch {
    administrativeNotFound();
  }
}

export async function withGlobalAdministrator<T>(
  input: {
    database: Database;
    identity: FoundationSession | null;
    mutation: boolean;
    recent: boolean;
  },
  operation: (tx: AdministrativeTransaction, actor: string) => Promise<T>,
): Promise<T> {
  return input.database.db.transaction(async (tx) => {
    try {
      if (input.mutation) await lockAdministrativeChanges(tx);
    } catch {
      administrativeNotFound();
    }
    const actor = await authorize(tx, input.identity, input.recent);
    return operation(tx, actor);
  });
}
