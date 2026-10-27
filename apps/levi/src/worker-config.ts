import type { Hyperdrive } from "@cloudflare/workers-types";
import { createResendEmail } from "@t00ls-dev/email";
import type { AppOptions } from "./auth.js";

export interface WorkerEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  HYPERDRIVE: Pick<Hyperdrive, "connectionString">;
  LEVI_PUBLIC_ORIGIN: string;
  LEVI_AUTH_SECRET: string;
  LEVI_EMAIL_FROM: string;
  RESEND_API_KEY: string;
}

export function workerOptions(env: WorkerEnv): AppOptions {
  const origin = new URL(env.LEVI_PUBLIC_ORIGIN);
  if (
    origin.protocol !== "https:" ||
    origin.origin !== env.LEVI_PUBLIC_ORIGIN ||
    !env.LEVI_AUTH_SECRET ||
    env.LEVI_AUTH_SECRET.length < 32 ||
    !env.HYPERDRIVE?.connectionString ||
    !env.ASSETS?.fetch ||
    !env.RESEND_API_KEY?.trim() ||
    !env.LEVI_EMAIL_FROM?.trim()
  )
    throw new Error("Configuração DEV incompleta ou inválida.");
  const email = createResendEmail({
    apiKey: env.RESEND_API_KEY,
    defaultFrom: env.LEVI_EMAIL_FROM,
  });
  return {
    databaseUrl: env.HYPERDRIVE.connectionString,
    baseURL: origin.origin,
    onboardingReturnPath: "/onboarding",
    secret: env.LEVI_AUTH_SECRET,
    email,
    publicAbuseProtection: true,
  };
}
