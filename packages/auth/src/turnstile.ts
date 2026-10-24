import type { BetterAuthPlugin } from "better-auth";
import { getIP } from "better-auth/api";
import { verifyTurnstile } from "@t00ls-dev/security";

export type TurnstileOperation =
  "signIn" | "signUp" | "magicLink" | "passwordReset";
export type TurnstileActions = Record<TurnstileOperation, string>;
export type FoundationTurnstileOptions =
  | {
      secretKey: string;
      allowedHostnames: readonly string[];
      actions?: TurnstileActions;
    }
  | { unavailable: true };

const paths: Record<string, TurnstileOperation> = {
  "/sign-in/email": "signIn",
  "/sign-up/email": "signUp",
  "/sign-in/magic-link": "magicLink",
  "/request-password-reset": "passwordReset",
};
const defaults: TurnstileActions = {
  signIn: "sign-in",
  signUp: "sign-up",
  magicLink: "magic-link",
  passwordReset: "password-reset",
};

export const turnstileUnavailableCode = "TURNSTILE_UNAVAILABLE";
function unavailable() {
  return {
    response: Response.json(
      {
        code: turnstileUnavailableCode,
        message: "Verification is temporarily unavailable. Please try again.",
      },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    ),
  };
}

/** Aceita somente provas booleanas e metadados com os tipos documentados. */
function acceptedVerification(
  value: unknown,
): value is { success: true; hostname: string; action: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return (
    result.success === true &&
    typeof result.hostname === "string" &&
    typeof result.action === "string" &&
    ["challenge_ts", "cdata"].every(
      (key) => result[key] === undefined || typeof result[key] === "string",
    ) &&
    (result["error-codes"] === undefined ||
      (Array.isArray(result["error-codes"]) &&
        result["error-codes"].every(
          (code: unknown) => typeof code === "string",
        )))
  );
}

function rejected() {
  return {
    response: Response.json(
      { code: "VERIFICATION_FAILED", message: "Captcha verification failed" },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    ),
  };
}

/** O helper público security é o único transporte Siteverify deste hook. */
export function turnstilePlugin(
  options: FoundationTurnstileOptions,
): BetterAuthPlugin {
  const configured = "unavailable" in options ? null : options;
  const actions = configured?.actions ?? defaults;
  const valid =
    configured &&
    configured.secretKey.trim() &&
    configured.allowedHostnames.length > 0 &&
    configured.allowedHostnames.every(
      (host) => host.trim() === host && host.length > 0,
    ) &&
    Object.values(paths).every(
      (operation) =>
        typeof actions[operation] === "string" &&
        /^[A-Za-z0-9_-]{1,32}$/.test(actions[operation]),
    );
  // Captura a configuração por operação sem depender de mutações posteriores.
  const hostnames = [...(configured?.allowedHostnames ?? [])];
  const operationActions = { ...actions };
  const secret = configured?.secretKey ?? "";
  return {
    id: "foundation-turnstile",
    async onRequest(request, context) {
      if (request.method !== "POST") return;
      const base = context.options.basePath ?? "/api/auth";
      let path = new URL(request.url).pathname;
      if (path.startsWith(base)) path = path.slice(base.length);
      path = path.replace(/\/{2,}/g, "/");
      if (!path.startsWith("/")) path = `/${path}`;
      if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
      if (!Object.hasOwn(paths, path)) return;
      if (!valid) return unavailable();
      const token = request.headers.get("x-captcha-response");
      if (!token)
        return {
          response: Response.json(
            { code: "MISSING_RESPONSE", message: "Missing CAPTCHA response" },
            { status: 400, headers: { "Cache-Control": "private, no-store" } },
          ),
        };
      const reject = () => {
        context.logger.warn("Cloudflare Turnstile verification failed");
        return rejected();
      };
      // Timeout cobre transporte e leitura do corpo; nenhuma repetição automática.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const remoteIp = getIP(request, context.options);
        const verification: unknown = await verifyTurnstile({
          secret,
          token,
          ...(remoteIp ? { remoteIp } : {}),
          fetch: (input, init) =>
            globalThis.fetch(input, { ...init, signal: controller.signal }),
        });
        // Preserva a classificação de resposta nula/vazia do contrato anterior.
        if (!verification) return unavailable();
        if (
          !acceptedVerification(verification) ||
          !hostnames.includes(verification.hostname) ||
          verification.action !== operationActions[paths[path]!]
        )
          return reject();
      } catch (error) {
        if (error instanceof SyntaxError) return reject();
        // Não registra erro, URL, token, segredo ou payload do provedor.
        context.logger.error("CAPTCHA service unavailable");
        return unavailable();
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
