import { createPostgresDatabase } from "@t00ls-dev/db/postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const databaseUrl = process.env.LEVI_DATABASE_URL;
if (
  !databaseUrl ||
  process.env.LEVI_LOCAL_DATABASE !== "1" ||
  !["127.0.0.1", "localhost", "[::1]"].includes(new URL(databaseUrl).hostname)
) {
  throw new Error(
    "A execução explícita exige LEVI_DATABASE_URL local e LEVI_LOCAL_DATABASE=1.",
  );
}
const { client, db } = await createPostgresDatabase(databaseUrl);
try {
  await migrate(db, { migrationsFolder: "migrations" });
  console.info("Histórico aplicado explicitamente ao PostgreSQL local.");
} finally {
  await client.end();
}
