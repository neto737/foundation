import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Client } from "pg";

import type { MigrationStatus } from "./index.js";

interface JournalEntry {
  tag: string;
  when: number;
}

interface MigrationJournal {
  entries: JournalEntry[];
}

function isMissingMigrationTable(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    ["3F000", "42P01"].includes(String(error.code))
  );
}

export async function getPostgresMigrationStatus(
  client: Pick<Client, "query">,
  migrationsFolder: string,
): Promise<MigrationStatus> {
  const journalPath = resolve(migrationsFolder, "meta/_journal.json");
  const value: unknown = JSON.parse(await readFile(journalPath, "utf8"));
  const entries =
    typeof value === "object" &&
    value !== null &&
    "entries" in value &&
    Array.isArray(value.entries)
      ? (value.entries as unknown[])
      : undefined;

  if (
    !entries ||
    !entries.every(
      (entry: unknown) =>
        typeof entry === "object" &&
        entry !== null &&
        "tag" in entry &&
        typeof entry.tag === "string" &&
        "when" in entry &&
        typeof entry.when === "number",
    )
  ) {
    throw new Error(`Invalid Drizzle migration journal: ${journalPath}`);
  }

  const journal = { entries } as MigrationJournal;
  let rows: { created_at: string | null }[] = [];
  try {
    const result = await client.query<{ created_at: string | null }>(
      "SELECT created_at FROM drizzle.__drizzle_migrations",
    );
    rows = result.rows;
  } catch (error) {
    if (!isMissingMigrationTable(error)) throw error;
  }

  const timestamps = new Set(rows.map(({ created_at }) => created_at));
  const applied: string[] = [];
  const pending: string[] = [];
  for (const entry of journal.entries) {
    (timestamps.has(String(entry.when)) ? applied : pending).push(entry.tag);
  }

  return { applied, pending };
}
