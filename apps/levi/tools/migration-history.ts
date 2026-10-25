import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { getPostgresMigrationStatus } from "@t00ls-dev/db/postgres-migrations";

type Executor = Parameters<typeof getPostgresMigrationStatus>[0];

// Adapta a verificação de hashes/prefixo do coordenador Foundation ao journal
// PostgreSQL existente. Sem tabela auxiliar, policy D1 ou reparação automática.
export async function inspectMigrationHistory(
  client: Executor,
  folder = "migrations",
) {
  const journal = JSON.parse(
    await readFile(join(folder, "meta/_journal.json"), "utf8"),
  ) as { entries: { tag: string; when: number; idx: number }[] };
  assert.ok(Array.isArray(journal.entries));
  const migrations = readMigrationFiles({ migrationsFolder: folder });
  assert.equal(migrations.length, journal.entries.length);
  const tags = new Set<string>();
  let previous = -1;
  for (const [index, entry] of journal.entries.entries()) {
    assert.match(entry.tag, /^\d{4}_[a-z0-9_-]+$/);
    assert.equal(entry.idx, index);
    assert.ok(Number.isSafeInteger(entry.when) && entry.when > previous);
    assert.ok(!tags.has(entry.tag));
    tags.add(entry.tag);
    previous = entry.when;
    assert.equal(migrations[index]!.folderMillis, entry.when);
  }
  // Evita provocar erro de tabela ausente dentro de BEGIN READ ONLY: um erro
  // SQL abortaria a transação, inclusive a consulta posterior do Foundation.
  const relation = await client.query<{ relation: string | null }>(
    "SELECT to_regclass('drizzle.__drizzle_migrations')::text AS relation",
  );
  if (relation.rows[0]?.relation === null)
    return { applied: [], pending: journal.entries.map((entry) => entry.tag) };
  assert.equal(relation.rows[0]?.relation, "drizzle.__drizzle_migrations");
  const { rows } = await client.query<{
    id: number;
    hash: string;
    created_at: string | null;
  }>(
    "SELECT id, hash, created_at::text FROM drizzle.__drizzle_migrations ORDER BY id",
  );
  assert.ok(rows.length <= migrations.length);
  for (const [index, row] of rows.entries()) {
    assert.equal(row.created_at, String(journal.entries[index]!.when));
    assert.equal(row.hash, migrations[index]!.hash);
  }
  // Mantém o contrato público Foundation; acrescenta as garantias que ele não dá.
  const status = await getPostgresMigrationStatus(client, folder);
  assert.deepEqual(
    status.applied,
    journal.entries.slice(0, rows.length).map((entry) => entry.tag),
  );
  assert.deepEqual(
    status.pending,
    journal.entries.slice(rows.length).map((entry) => entry.tag),
  );
  return status;
}
