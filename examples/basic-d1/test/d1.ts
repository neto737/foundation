import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";

export async function createTestDatabase() {
  const miniflare = new Miniflare({
    d1Databases: ["DB"],
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
  });
  const binding = await miniflare.getD1Database("DB");
  return { miniflare, binding };
}

export async function applyMigrations(binding: D1Database, only?: string) {
  const directory = new URL("../migrations/", import.meta.url);
  const files = (await readdir(directory))
    .filter((file) => file.endsWith(".sql") && (!only || file === only))
    .sort();
  for (const file of files) {
    const sql = await readFile(new URL(file, directory), "utf8");
    const statements = sql
      .replaceAll("--> statement-breakpoint", "")
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean);
    await binding.batch(
      statements.map((statement) => binding.prepare(statement)),
    );
  }
}
