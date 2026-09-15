import { betterAuth } from "better-auth";
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
}

export function createFoundationAuth(
  options: FoundationAuthOptions,
): FoundationAuth {
  return betterAuth({
    baseURL: options.baseURL,
    // Better Auth intentionally accepts several unrelated database adapter shapes.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    database: options.database,
    secret: options.secret,
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
}
