import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  dialect: "postgresql",
  out: "./postgres/migrations",
  schema: "./postgres/schema.ts",
  ...(databaseUrl ? { dbCredentials: { url: databaseUrl } } : {}),
});
