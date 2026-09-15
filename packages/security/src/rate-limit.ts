import type { MiddlewareHandler } from "hono";

export interface FixedWindowRateLimitStore {
  /** Atomically increments key and returns its new count. */
  increment(key: string, expiresAt: number): number | Promise<number>;
}

export interface FixedWindowRateLimitOptions {
  store: FixedWindowRateLimitStore;
  limit: number;
  windowMs: number;
  key: (request: Request) => null | string | Promise<null | string>;
  prefix?: string;
  now?: () => number;
}

export function fixedWindowRateLimit(
  options: FixedWindowRateLimitOptions,
): MiddlewareHandler {
  if (!Number.isInteger(options.limit) || options.limit < 1) {
    throw new RangeError("limit must be a positive integer");
  }
  if (!Number.isInteger(options.windowMs) || options.windowMs < 1) {
    throw new RangeError("windowMs must be a positive integer");
  }

  const prefix = options.prefix ?? "rate-limit";
  const now = options.now ?? Date.now;

  return async (context, next) => {
    const identity = await options.key(context.req.raw);
    if (identity === null) {
      await next();
      return;
    }

    const timestamp = now();
    const windowStart =
      Math.floor(timestamp / options.windowMs) * options.windowMs;
    const expiresAt = windowStart + options.windowMs;
    const count = await options.store.increment(
      `${prefix}:${identity}:${windowStart}`,
      expiresAt,
    );
    const remaining = Math.max(0, options.limit - count);
    const reset = Math.ceil(expiresAt / 1000);

    context.header("RateLimit-Limit", String(options.limit));
    context.header("RateLimit-Remaining", String(remaining));
    context.header("RateLimit-Reset", String(reset));

    if (count > options.limit) {
      context.header(
        "Retry-After",
        String(Math.max(1, Math.ceil((expiresAt - timestamp) / 1000))),
      );
      return context.text("Too Many Requests", 429);
    }

    await next();
  };
}
