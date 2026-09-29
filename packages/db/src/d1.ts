/// <reference types="@cloudflare/workers-types" preserve="true" />

import { drizzle } from "drizzle-orm/d1";
import type { D1Database } from "@cloudflare/workers-types";

export function createD1Database(binding: D1Database) {
  return drizzle(binding);
}
