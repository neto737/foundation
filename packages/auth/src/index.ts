import { betterAuth, type Auth } from "better-auth";
import { magicLink } from "better-auth/plugins";

export interface FoundationEmail {
  send(input: { to: string; subject: string; text: string }): Promise<void>;
}

type BetterAuthDatabase = NonNullable<
  Parameters<typeof betterAuth>[0]
>["database"];

export interface FoundationAuthOptions {
  baseURL: string;
  database: BetterAuthDatabase;
  email: FoundationEmail;
  google?: { clientId: string; clientSecret: string };
  secret: string;
}

export interface FoundationAuth {
  handler(request: Request): Promise<Response>;
  resolveSession(headers: Headers): Promise<{
    data: FoundationSession | null;
    headers: Headers;
  }>;
}

export type FoundationSession = Auth["$Infer"]["Session"];

export function createFoundationAuth(
  options: FoundationAuthOptions,
): FoundationAuth {
  const auth = betterAuth({
    baseURL: options.baseURL,
    // Better Auth intentionally accepts several unrelated database adapter shapes.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    database: options.database,
    secret: options.secret,
    // Better Auth otherwise skips origin checks automatically under NODE_ENV=test.
    // Keep the same protection in tests and deployed applications.
    advanced: { disableOriginCheck: false },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }) => {
        await options.email.send({
          to: user.email,
          subject: "Reset your password",
          text: url,
        });
      },
    },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        await options.email.send({
          to: user.email,
          subject: "Verify your email",
          text: url,
        });
      },
    },
    plugins: [
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          await options.email.send({
            to: email,
            subject: "Sign in",
            text: url,
          });
        },
      }),
    ],
    ...(options.google ? { socialProviders: { google: options.google } } : {}),
  });
  return {
    async handler(request) {
      const response = await auth.handler(request);
      if (request.method !== "POST" || !response.ok) return response;
      const basePath = new URL((await auth.$context).baseURL).pathname.replace(
        /\/+$/,
        "",
      );
      if (
        new URL(request.url).pathname.replace(/\/+$/, "") !==
        `${basePath}/sign-out`
      )
        return response;

      try {
        // Check the original credential against durable storage. Do not renew it
        // or trust a cookie cache after Better Auth's best-effort deletion.
        const remaining = await auth.api.getSession({
          headers: request.headers,
          query: { disableRefresh: true, disableCookieCache: true },
        });
        if (!remaining) return response;
      } catch {
        // An unavailable authoritative store cannot confirm revocation.
      }
      // Do not forward success/clearing cookies on failure: retain the original
      // credential in the browser so a retry can actually revoke it.
      return Response.json(
        {
          code: "LOGOUT_UNCONFIRMED",
          message: "Could not confirm sign out. Please try again.",
        },
        { status: 503, headers: { "Cache-Control": "private, no-store" } },
      );
    },
    async resolveSession(headers) {
      const result = await auth.api.getSession({
        headers,
        returnHeaders: true,
      });
      return { data: result.response, headers: result.headers };
    },
  };
}
