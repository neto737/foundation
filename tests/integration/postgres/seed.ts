import { readFile } from "node:fs/promises";
import postgres from "postgres";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

const client = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
try {
  const sql = await readFile(
    new URL("./seeds/development.sql", import.meta.url),
    "utf8",
  );
  await client.unsafe(sql);
} finally {
  await client.end();
}
