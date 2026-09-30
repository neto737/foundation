/// <reference types="@cloudflare/workers-types" preserve="true" />

// Cloudflare Workers/D1 entrypoint: Drizzle's declarations require ambient D1
// types. This runtime profile must not be combined with Node/DOM globals.
import { drizzle } from "drizzle-orm/d1";
import type { D1Database } from "@cloudflare/workers-types";

export function createD1Database(binding: D1Database) {
  return drizzle(binding);
}
