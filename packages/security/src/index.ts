import { secureHeaders } from "hono/secure-headers";

export { foundationCors } from "./cors.js";
export type { FoundationCorsOptions } from "./cors.js";
export { csrfProtection } from "./csrf.js";
export type { CsrfProtectionOptions } from "./csrf.js";
export { fixedWindowRateLimit } from "./rate-limit.js";
export type {
  FixedWindowRateLimitOptions,
  FixedWindowRateLimitStore,
} from "./rate-limit.js";
export { verifyTurnstile } from "./turnstile.js";
export type {
  TurnstileVerification,
  VerifyTurnstileOptions,
} from "./turnstile.js";

export function foundationSecurityHeaders() {
  return secureHeaders({
    contentSecurityPolicy: {
      connectSrc: ["'self'"],
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
    crossOriginResourcePolicy: "same-origin",
    referrerPolicy: "strict-origin-when-cross-origin",
    xFrameOptions: "DENY",
  });
}

export function privateResponseHeaders(headers: Headers): Headers {
  headers.set("Cache-Control", "private, no-store");
  headers.set("Vary", "Cookie, Authorization");
  return headers;
}
