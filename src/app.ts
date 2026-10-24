import { membersAvailable } from "./member-access.js";
import { Hono } from "hono";
import {
  createMember,
  editMember,
  listMembers,
  findMember,
  findMemberRequest,
} from "./members.js";
import {
  readMember,
  readMemberEdit,
  readMemberFilters,
  readMemberRequestKey,
} from "./member-contracts.js";
import { createAbuseProtection } from "./abuse.js";
import { bodyLimit } from "hono/body-limit";
import { createPostgresDatabase } from "@t00ls-dev/db/postgres";
import {
  csrfProtection,
  foundationSecurityHeaders,
  privateResponseHeaders,
} from "@t00ls-dev/security";
import { and, eq } from "drizzle-orm";
import type { FoundationAuth, FoundationSession } from "@t00ls-dev/auth";
import {
  createAuth,
  authRequest,
  verifiedSession,
  readySession,
  hasPassword,
  type Database,
  type AppOptions,
} from "./auth.js";
import {
  readObject,
  readString,
  requireUuid,
  RequestError,
} from "./contracts.js";
import { verification } from "./data/schema.js";
import {
  findChurch,
  listChurches,
  listOrganizations,
  organizationContext,
  provisionOrganization,
  selectOrganization,
} from "./organizations.js";

type Environment = {
  Variables: {
    database: Database;
    auth: FoundationAuth;
    identity: FoundationSession | null;
    abuse: ReturnType<typeof createAbuseProtection> | null;
  };
};

export function createApp(options: AppOptions) {
  const origin = new URL(options.baseURL).origin;
  const returnPath = options.onboardingReturnPath ?? "/api/onboarding";
  if (options.baseURL !== origin || options.secret.length < 32)
    throw new Error(
      "Configure a origem e um segredo de ao menos 32 caracteres.",
    );
  const app = new Hono<Environment>();
  app.use("*", async (c, next) => {
    await next();
    privateResponseHeaders(c.res.headers);
    c.header("Referrer-Policy", "no-referrer");
  });
  // Executa antes na volta do middleware; a política mais restrita fica por último.
  app.use("*", foundationSecurityHeaders());
  const csrf = csrfProtection({ trustedOrigins: [origin] });
  app.use("*", async (c, next) => {
    const denied = await csrf(c, next);
    if (denied)
      return c.json(
        {
          erro: "ORIGEM_INVALIDA",
          mensagem: "A origem da solicitação não é permitida.",
        },
        403,
      );
  });
  app.use(
    "*",
    bodyLimit({
      maxSize: 16_384,
      onError: (c) =>
        c.json(
          {
            erro: "ENTRADA_INVALIDA",
            mensagem: "A solicitação excede o tamanho permitido.",
          },
          413,
        ),
    }),
  );
  app.use("/api/*", async (c, next) => {
    const database = await createPostgresDatabase(options.databaseUrl);
    try {
      c.set("database", database);
      const abuse = options.publicAbuseProtection
        ? createAbuseProtection(database.client, options.secret)
        : null;
      c.set("abuse", abuse);
      c.set(
        "auth",
        createAuth(database, {
          ...options,
          email: abuse ? abuse.protectEmail(options.email) : options.email,
        }),
      );
      await next();
    } finally {
      await database.client.end();
    }
  });
  app.use("/api/*", async (c, next) => {
    const abuse = c.get("abuse");
    if (abuse) return abuse.beforeSession(c, next);
    await next();
  });
  // Resolve uma vez por request, inclusive para a quota autenticada de logout.
  app.use("/api/*", async (c, next) => {
    c.set("identity", null);
    if (
      (!c.req.path.startsWith("/api/auth/") ||
        c.req.path === "/api/auth/sign-out") &&
      c.req.header("cookie")
    ) {
      const resolved = await c.get("auth").resolveSession(c.req.raw.headers);
      c.set("identity", resolved.data);
      // No logout, só o handler nativo pode decidir limpar ou manter os cookies.
      // Cookies preliminares no Hono substituiriam os cookies da resposta nativa.
      if (!(c.req.method === "POST" && c.req.path === "/api/auth/sign-out")) {
        for (const cookie of resolved.headers.getSetCookie())
          c.header("Set-Cookie", cookie, { append: true });
      }
    }
    await next();
  });
  app.use("/api/*", async (c, next) => {
    const abuse = c.get("abuse");
    if (abuse) return abuse.middleware(c.get("identity"))(c, next);
    await next();
  });

  app.post("/api/onboarding/email", async (c) => {
    const input = await readObject(c.req.raw, ["email"]);
    const email = readString(input, "email", 3, 254);
    return authRequest(
      c.get("auth"),
      options,
      c.req.raw,
      "/sign-in/magic-link",
      { email, callbackURL: returnPath },
    );
  });
  app.get("/api/auth/magic-link/verify", (c) => {
    const token = c.req.query("token") ?? "";
    return authRequest(
      c.get("auth"),
      options,
      c.req.raw,
      `/magic-link/verify?${new URLSearchParams({ token, callbackURL: returnPath })}`,
    );
  });
  app.post("/api/onboarding/password-email", async (c) => {
    await readObject(c.req.raw, []);
    const identity = verifiedSession(c.get("identity"));
    return authRequest(
      c.get("auth"),
      options,
      c.req.raw,
      "/request-password-reset",
      { email: identity.user.email, redirectTo: returnPath },
    );
  });
  app.get("/api/auth/reset-password/:token", (c) => {
    const token = encodeURIComponent(c.req.param("token"));
    return authRequest(
      c.get("auth"),
      options,
      c.req.raw,
      `/reset-password/${token}?${new URLSearchParams({ callbackURL: returnPath })}`,
    );
  });
  app.post("/api/onboarding/password", async (c) => {
    const input = await readObject(c.req.raw, ["token", "newPassword"]);
    const token = readString(input, "token", 1, 512, false);
    const newPassword = readString(input, "newPassword", 8, 128, false);
    const identity = verifiedSession(c.get("identity"));
    // Associação à sessão é regra do Levi. Validade e consumo continuam nativos.
    const matches = await c
      .get("database")
      .db.select({ id: verification.id })
      .from(verification)
      .where(
        and(
          eq(verification.identifier, `reset-password:${token}`),
          eq(verification.value, identity.user.id),
        ),
      )
      .limit(1);
    if (!matches.length)
      throw new RequestError(
        400,
        "LINK_INVALIDO",
        "O link é inválido ou já foi utilizado. Solicite outro.",
      );
    return authRequest(c.get("auth"), options, c.req.raw, "/reset-password", {
      token,
      newPassword,
    });
  });
  app.post("/api/auth/sign-in/email", async (c) => {
    const input = await readObject(c.req.raw, ["email", "password"]);
    return authRequest(c.get("auth"), options, c.req.raw, "/sign-in/email", {
      email: readString(input, "email", 3, 254),
      password: readString(input, "password", 1, 128, false),
    });
  });
  app.post("/api/auth/sign-out", async (c) => {
    await readObject(c.req.raw, []);
    return authRequest(c.get("auth"), options, c.req.raw, "/sign-out", {});
  });
  app.get("/api/onboarding", async (c) => {
    if (c.req.query("error"))
      throw new RequestError(
        400,
        "LINK_INVALIDO",
        "O link é inválido, expirou ou já foi utilizado. Solicite outro.",
      );
    const identity = c.get("identity");
    if (!identity) return c.json({ etapa: "email" });
    if (!identity.user.emailVerified)
      return c.json({ etapa: "verificar-email" });
    if (!(await hasPassword(c.get("database").db, identity.user.id)))
      return c.json({ etapa: "senha" });
    return c.json({
      etapa: (await listOrganizations(c.get("database"), identity)).length
        ? "concluido"
        : "organizacao",
    });
  });
  app.post("/api/organizations", async (c) => {
    const database = c.get("database");
    const identity = await readySession(database, c.get("identity"));
    const body = await readObject(c.req.raw, [
      "organizationName",
      "churchName",
      "churchAddress",
      "churchPhone",
      "churchEmail",
    ]);
    const optional = (key: string, max: number) =>
      body[key] == null ? null : readString(body, key, 0, max) || null;
    const churchEmail = optional("churchEmail", 254);
    if (churchEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(churchEmail))
      throw new RequestError(
        400,
        "ENTRADA_INVALIDA",
        "Informe um e-mail válido para a igreja.",
      );
    const requestKey = c.req.header("Idempotency-Key") ?? "";
    if (!/^[a-zA-Z0-9_-]{16,128}$/.test(requestKey))
      throw new RequestError(
        400,
        "CHAVE_NECESSARIA",
        "Envie uma chave de idempotência de 16 a 128 caracteres.",
      );
    return c.json(
      await provisionOrganization(database, identity, {
        organizationName: readString(body, "organizationName", 1, 160),
        churchName: readString(body, "churchName", 1, 160),
        churchAddress: optional("churchAddress", 500),
        churchPhone: optional("churchPhone", 40),
        churchEmail,
        requestKey,
      }),
      201,
    );
  });
  app.get("/api/organizations", async (c) =>
    c.json({
      organizations: await listOrganizations(
        c.get("database"),
        await readySession(c.get("database"), c.get("identity")),
      ),
    }),
  );
  app.post("/api/tenant", async (c) => {
    const identity = await readySession(c.get("database"), c.get("identity"));
    const body = await readObject(c.req.raw, ["organizationId"]);
    return c.json(
      await selectOrganization(
        c.get("database"),
        identity,
        requireUuid(readString(body, "organizationId", 36, 36)),
      ),
    );
  });
  app.get("/api/context", async (c) => {
    const context = await organizationContext(
      c.get("database"),
      await readySession(c.get("database"), c.get("identity")),
    );
    return c.json({
      organizationId: context.tenantId,
      role: context.role,
      membersEnabled: membersAvailable(options, context.tenantId),
    });
  });
  app.get("/api/churches", async (c) =>
    c.json(
      await listChurches(
        c.get("database"),
        await readySession(c.get("database"), c.get("identity")),
      ),
    ),
  );
  app.get("/api/churches/:id", async (c) =>
    c.json(
      await findChurch(
        c.get("database"),
        await readySession(c.get("database"), c.get("identity")),
        requireUuid(c.req.param("id")),
      ),
    ),
  );
  app.use("/api/members*", async (c, next) => {
    if (
      options.membersEnabled !== true &&
      !options.membersDevOrganizations?.length
    )
      return c.notFound();
    const context = await organizationContext(
      c.get("database"),
      await readySession(c.get("database"), c.get("identity")),
    );
    if (!membersAvailable(options, context.tenantId)) return c.notFound();
    await next();
  });
  app.post("/api/members", async (c) => {
    const identity = await readySession(c.get("database"), c.get("identity"));
    return c.json(
      await createMember(
        c.get("database"),
        identity,
        await readMember(c.req.raw),
        readMemberRequestKey(c.req.raw),
        options,
      ),
      201,
    );
  });
  app.get("/api/members", async (c) => {
    const identity = await readySession(c.get("database"), c.get("identity"));
    return c.json(
      await listMembers(
        c.get("database"),
        identity,
        readMemberFilters(new URL(c.req.url)),
        options,
      ),
    );
  });
  app.get("/api/members/requests/:key", async (c) => {
    const identity = await readySession(c.get("database"), c.get("identity"));
    const key = c.req.param("key");
    if (!/^[a-zA-Z0-9_-]{16,128}$/.test(key))
      throw new RequestError(
        400,
        "ENTRADA_INVALIDA",
        "A tentativa informada é inválida.",
      );
    return c.json(
      await findMemberRequest(c.get("database"), identity, key, options),
    );
  });
  app.patch("/api/members/:id", async (c) => {
    const identity = await readySession(c.get("database"), c.get("identity"));
    return c.json(
      await editMember(
        c.get("database"),
        identity,
        requireUuid(c.req.param("id")),
        await readMemberEdit(c.req.raw),
        options,
      ),
    );
  });
  app.get("/api/members/:id", async (c) => {
    const identity = await readySession(c.get("database"), c.get("identity"));
    return c.json(
      await findMember(
        c.get("database"),
        identity,
        requireUuid(c.req.param("id")),
        options,
      ),
    );
  });
  // Allowlist exata: signup, mudança de e-mail/senha e novos plugins não vazam.
  app.all("/api/auth/*", (c) =>
    c.json(
      {
        erro: "ROTA_INDISPONIVEL",
        mensagem: "Esta operação de autenticação não está disponível.",
      },
      404,
    ),
  );
  app.notFound((c) =>
    c.json(
      { erro: "NAO_ENCONTRADO", mensagem: "Recurso não encontrado." },
      404,
    ),
  );
  app.onError((error, c) =>
    error instanceof RequestError
      ? c.json({ erro: error.code, mensagem: error.message }, error.status)
      : c.json(
          {
            erro: "INDISPONIVEL",
            mensagem:
              "Não foi possível confirmar a operação. Consulte o estado antes de tentar novamente.",
          },
          503,
        ),
  );
  return app;
}
