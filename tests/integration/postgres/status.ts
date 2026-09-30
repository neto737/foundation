import nodeProcess from "node:process";
import { createPostgresDatabase } from "@t00ls-dev/db/postgres";
import { getPostgresMigrationStatus } from "@t00ls-dev/db/postgres-migrations";

const process = nodeProcess as NodeJS.Process;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

const { client } = createPostgresDatabase(process.env.DATABASE_URL);
try {
  const status = await getPostgresMigrationStatus(
    client,
    new URL("./migrations", import.meta.url).pathname,
  );
  for (const migration of status.applied) console.log(`applied  ${migration}`);
  for (const migration of status.pending) console.log(`pending  ${migration}`);
  console.log(
    `${status.applied.length} applied, ${status.pending.length} pending`,
  );
  if (status.pending.length > 0) process.exitCode = 1;
} finally {
  await client.end();
}
