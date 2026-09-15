import type { MiddlewareHandler } from "hono";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);

export interface CsrfProtectionOptions {
  trustedOrigins?:
    | readonly string[]
    | ((origin: string, request: Request) => boolean | Promise<boolean>);
  allowMissingOrigin?: boolean;
}

export function csrfProtection(
  options: CsrfProtectionOptions = {},
): MiddlewareHandler {
  const configuredOrigins = Array.isArray(options.trustedOrigins)
    ? new Set(
        options.trustedOrigins
          .map(normalizeOrigin)
          .filter((origin) => origin !== null),
      )
    : undefined;

  return async (context, next) => {
    const request = context.req.raw;
    if (
      SAFE_METHODS.has(request.method.toUpperCase()) ||
      !request.headers.get("Cookie")
    ) {
      await next();
      return;
    }

    const origin = request.headers.get("Origin");
    if (!origin) {
      if (options.allowMissingOrigin) {
        await next();
        return;
      }
      return context.text("Forbidden", 403);
    }

    let trusted: boolean;
    if (typeof options.trustedOrigins === "function") {
      trusted = await options.trustedOrigins(origin, request);
    } else if (configuredOrigins) {
      const normalizedOrigin = normalizeOrigin(origin);
      trusted =
        normalizedOrigin !== null && configuredOrigins.has(normalizedOrigin);
    } else {
      trusted = normalizeOrigin(origin) === new URL(request.url).origin;
    }

    if (!trusted) {
      return context.text("Forbidden", 403);
    }

    await next();
  };
}

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}
