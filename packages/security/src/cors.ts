import type { Context, MiddlewareHandler } from "hono";
import { cors } from "hono/cors";

export interface FoundationCorsOptions {
  origin?:
    | string
    | string[]
    | ((
        origin: string,
        context: Context,
      ) => Promise<string | null | undefined> | string | null | undefined);
  allowMethods?:
    | string[]
    | ((origin: string, context: Context) => Promise<string[]> | string[]);
  allowHeaders?: string[];
  exposeHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
}

export function foundationCors(
  options: FoundationCorsOptions = {},
): MiddlewareHandler {
  return cors(options);
}
