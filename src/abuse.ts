import { fixedWindowRateLimit } from "@t00ls-dev/security";
import type { FoundationEmail } from "@t00ls-dev/auth";
import type { MiddlewareHandler } from "hono";
import type { Database } from "./auth.js";

// Limites conservadores do DEV público; não são quotas comerciais do produto.
export const publicAbuseLimits = {
  emailPerMinute: 5,
  loginPerMinute: 10,
  apiPerMinute: 60,
  recipientPerQuarterHour: 3,
  emailAttemptsPerDay: 90,
} as const;

export function createAbuseProtection(
  client: Pick<Database["client"], "query">,
  secret: string,
) {
  const hmac = crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  async function digest(value: string) {
    const bytes = await crypto.subtle.sign(
      "HMAC",
      await hmac,
      new TextEncoder().encode(value),
    );
    return Array.from(new Uint8Array(bytes), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  }
  const store = {
    async increment(key: string, expiresAt: number): Promise<number> {
      // Limpeza limitada e indexada, sem cron ou crescimento por janelas antigas.
      await client.query(
        `DELETE FROM abuse_counters WHERE key IN
         (SELECT key FROM abuse_counters WHERE expires_at <= now() LIMIT 100)`,
      );
      const result = await client.query<{ count: number }>(
        `INSERT INTO abuse_counters(key, count, expires_at) VALUES ($1, 1, $2)
         ON CONFLICT (key) DO UPDATE SET count = abuse_counters.count + 1
         RETURNING count`,
        [key, new Date(expiresAt)],
      );
      if (!result.rows[0]) throw new Error("Limite indisponível.");
      return result.rows[0].count;
    },
  };
  const limiter = (prefix: string, limit: number) =>
    fixedWindowRateLimit({
      prefix,
      store,
      limit,
      windowMs: 60_000,
      // Somente Worker habilita esta composição. Nunca confia em X-Forwarded-For.
      // Sem o header garantido pela Cloudflare, usa um bucket compartilhado.
      key: (request) =>
        digest(request.headers.get("cf-connecting-ip") ?? "unknown-client"),
    });
  const general = limiter("api", publicAbuseLimits.apiPerMinute);
  const emailRequests = limiter("email", publicAbuseLimits.emailPerMinute);
  const login = limiter("login", publicAbuseLimits.loginPerMinute);
  const middleware: MiddlewareHandler = async (c, next) => {
    const path = c.req.path;
    const limited =
      c.req.method === "POST" &&
      ["/api/onboarding/email", "/api/onboarding/password-email"].includes(path)
        ? emailRequests
        : path === "/api/auth/sign-in/email"
          ? login
          : general;
    const response = await limited(c, async () => {
      // Respostas nativas do handler auth podem substituir os headers preparados do Hono.
      const quotaHeaders = [
        "RateLimit-Limit",
        "RateLimit-Remaining",
        "RateLimit-Reset",
      ].map((name) => [name, c.res.headers.get(name)] as const);
      await next();
      for (const [name, value] of quotaHeaders)
        if (value) c.header(name, value);
    });
    if (response?.status === 429)
      return c.json(
        {
          erro: "LIMITE_DE_SOLICITACOES",
          mensagem: "Muitas solicitações. Aguarde antes de tentar novamente.",
        },
        429,
      );
    return response;
  };
  async function consume(prefix: string, windowMs: number, limit: number) {
    const start = Math.floor(Date.now() / windowMs) * windowMs;
    return (
      (await store.increment(`${prefix}:${start}`, start + windowMs)) <= limit
    );
  }
  function protectEmail(provider: FoundationEmail): FoundationEmail {
    return {
      async send(input) {
        const recipient = await digest(input.to.trim().toLowerCase());
        if (
          !(await consume(
            `recipient:${recipient}`,
            15 * 60_000,
            publicAbuseLimits.recipientPerQuarterHour,
          )) ||
          !(await consume(
            "email-day",
            24 * 60 * 60_000,
            publicAbuseLimits.emailAttemptsPerDay,
          ))
        )
          return; // Mesma resposta por destinatário, exista conta ou não.
        // Falha/timeout também consome orçamento; sem retry nem envio transacional.
        await provider.send(input);
      },
    };
  }
  return { middleware, protectEmail, store };
}
