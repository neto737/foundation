import type { Hyperdrive } from "@cloudflare/workers-types";
import { createResendEmail } from "@t00ls-dev/email";
import type { FoundationEmail } from "@t00ls-dev/auth";
import type { AppOptions } from "./auth.js";

export interface WorkerEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  HYPERDRIVE: Pick<Hyperdrive, "connectionString">;
  LEVI_PUBLIC_ORIGIN: string;
  LEVI_AUTH_SECRET: string;
  LEVI_EMAIL_FROM: string;
  RESEND_API_KEY: string;
  /** JSON privado com endereços exatos; nunca aceita curingas ou domínios. */
  LEVI_DEV_EMAIL_ALLOWLIST: string;
}

export function workerOptions(env: WorkerEnv): AppOptions {
  const origin = new URL(env.LEVI_PUBLIC_ORIGIN);
  const addresses: unknown = JSON.parse(env.LEVI_DEV_EMAIL_ALLOWLIST);
  if (
    origin.protocol !== "https:" ||
    origin.origin !== env.LEVI_PUBLIC_ORIGIN ||
    !env.LEVI_AUTH_SECRET ||
    env.LEVI_AUTH_SECRET.length < 32 ||
    !env.HYPERDRIVE?.connectionString ||
    !env.ASSETS?.fetch ||
    !env.RESEND_API_KEY?.trim() ||
    !env.LEVI_EMAIL_FROM?.trim() ||
    !Array.isArray(addresses) ||
    !addresses.length ||
    addresses.length > 50 ||
    !addresses.every(
      (value: unknown) =>
        typeof value === "string" &&
        /^[^\s@<>*,]+@[^\s@<>*,]+\.[^\s@<>*,]+$/.test(value),
    )
  )
    throw new Error("Configuração DEV incompleta ou inválida.");
  const allowed = new Set(
    (addresses as string[]).map((value) => value.toLowerCase()),
  );
  const provider = createResendEmail({
    apiKey: env.RESEND_API_KEY,
    defaultFrom: env.LEVI_EMAIL_FROM,
  });
  const email: FoundationEmail = {
    async send(input) {
      // Resposta genérica também para destinatário fora da lista: sem enumeração.
      if (!allowed.has(input.to.toLowerCase())) return;
      await provider.send(input);
    },
  };
  return {
    databaseUrl: env.HYPERDRIVE.connectionString,
    baseURL: origin.origin,
    onboardingReturnPath: "/onboarding",
    secret: env.LEVI_AUTH_SECRET,
    email,
  };
}
