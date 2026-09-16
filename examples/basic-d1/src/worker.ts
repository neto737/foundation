import { createFoundationAuth } from "@t00ls-dev/auth";
import { createD1Database } from "@t00ls-dev/db/d1";
import { createResendEmail } from "@t00ls-dev/email";
import { foundationSecurityHeaders } from "@t00ls-dev/security";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { Hono } from "hono";
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
app.use("*", foundationSecurityHeaders());

app.get("/health", (context) => {
  context.header("Cache-Control", "no-store");
  return context.json({ status: "ok" });
});
app.get("/ready", async (context) => {
  context.header("Cache-Control", "no-store");
  try {
    await context.env.DB.prepare("SELECT 1").first();
    return context.json({ status: "ready" });
  } catch {
    return context.json({ status: "unavailable" }, 503);
  }
});

app.use("/api/auth/**", async (context, next) => {
  await next();
  context.header("Cache-Control", "private, no-store");
});

app.on(["GET", "POST"], "/api/auth/**", (context) => {
  const database = createD1Database(context.env.DB);
  const email = createResendEmail({
    apiKey: context.env.RESEND_API_KEY,
    defaultFrom: context.env.EMAIL_FROM,
  });
  const google =
    context.env.GOOGLE_CLIENT_ID && context.env.GOOGLE_CLIENT_SECRET
      ? {
          clientId: context.env.GOOGLE_CLIENT_ID,
          clientSecret: context.env.GOOGLE_CLIENT_SECRET,
        }
      : undefined;
  const auth = createFoundationAuth({
    baseURL: context.env.BASE_URL,
    database: drizzleAdapter(database, { provider: "sqlite", schema }),
    email,
    ...(google ? { google } : {}),
    secret: context.env.AUTH_SECRET,
  });
  return auth.handler(context.req.raw);
});

app.notFound((context) => {
  if (context.req.path.startsWith("/api/")) {
    return context.json({ error: "Not found" }, 404);
  }
  return context.env.ASSETS.fetch(context.req.raw);
});

export default app;
