import nodeProcess from "node:process";
import { readFile } from "node:fs/promises";
import { createPostgresDatabase } from "@t00ls-dev/db/postgres";

const process = nodeProcess as NodeJS.Process;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

const { client } = await createPostgresDatabase(process.env.DATABASE_URL);
try {
  const sql = await readFile(
    new URL("./seeds/development.sql", import.meta.url),
    "utf8",
  );
  await client.query(sql);
} finally {
  await client.end();
}
