import { drizzle } from "drizzle-orm/d1";

export function createD1Database(binding: D1Database) {
  return drizzle(binding);
}
