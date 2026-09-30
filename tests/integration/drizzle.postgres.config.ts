import nodeProcess from "node:process";
import { defineConfig } from "drizzle-kit";

// Workers Types declares a global process:any; this script runs in Node.
const process = nodeProcess as NodeJS.Process;
const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  dialect: "postgresql",
  out: "./postgres/migrations",
  schema: "./postgres/schema.ts",
  ...(databaseUrl ? { dbCredentials: { url: databaseUrl } } : {}),
});
