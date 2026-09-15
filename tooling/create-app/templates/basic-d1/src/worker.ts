import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { schema } from "./schema.js";

interface Env {
  ASSETS: Fetcher;
  AUTH_SECRET: string;
  BASE_URL: string;
  DB: D1Database;
  EMAIL_FROM: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  RESEND_API_KEY: string;
}

const app = new Hono<{ Bindings: Env }>();
app.use("*", secureHeaders());
app.get("/health", (context) => context.json({ status: "ok" }));

app.on(["GET", "POST"], "/api/auth/**", async (context) => {
  const email = async (to: string, subject: string, text: string) => {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${context.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: context.env.EMAIL_FROM,
        to: [to],
        subject,
        text,
      }),
    });
    if (!response.ok)
      throw new Error(
        `Email provider rejected the request with status ${response.status}`,
      );
  };
  const google =
    context.env.GOOGLE_CLIENT_ID && context.env.GOOGLE_CLIENT_SECRET
      ? {
          clientId: context.env.GOOGLE_CLIENT_ID,
          clientSecret: context.env.GOOGLE_CLIENT_SECRET,
        }
      : undefined;
  const auth = betterAuth({
    baseURL: context.env.BASE_URL,
    database: drizzleAdapter(drizzle(context.env.DB), {
      provider: "sqlite",
      schema,
    }),
    secret: context.env.AUTH_SECRET,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: ({ user, url }) =>
        email(user.email, "Reset your password", url),
    },
    emailVerification: {
      sendVerificationEmail: ({ user, url }) =>
        email(user.email, "Verify your email", url),
    },
    plugins: [
      magicLink({
        sendMagicLink: ({ email: address, url }) =>
          email(address, "Sign in", url),
      }),
    ],
    ...(google ? { socialProviders: { google } } : {}),
  });
  return auth.handler(context.req.raw);
});

app.notFound((context) => {
  if (context.req.path.startsWith("/api/"))
    return context.json({ error: "Not found" }, 404);
  return context.env.ASSETS.fetch(context.req.raw);
});

export default app;
