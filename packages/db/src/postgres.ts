import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";

export async function createPostgresDatabase(connectionString: string) {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    return { client, db: drizzle(client) };
  } catch (error) {
    // Preserve the original failure, including when connection setup failed.
    await client.end().catch(() => undefined);
    throw error;
  }
}
