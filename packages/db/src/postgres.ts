import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

export function createPostgresDatabase(connectionString: string) {
  const client = postgres(connectionString, { prepare: false });
  return { client, db: drizzle(client) };
}
