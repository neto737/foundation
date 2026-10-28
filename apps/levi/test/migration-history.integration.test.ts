import assert from "node:assert/strict";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { test } from "node:test";
import { createPostgresDatabase } from "@t00ls-dev/db/postgres";
import { inspectMigrationHistory } from "../tools/migration-history.js";

const databaseUrl = process.env.LEVI_DATABASE_URL;
if (
  !databaseUrl ||
  process.env.LEVI_LOCAL_DATABASE !== "1" ||
  new URL(databaseUrl).hostname !== "127.0.0.1" ||
  new URL(databaseUrl).pathname !== "/levi_test"
)
  throw new Error("Use o harness PostgreSQL descartável.");

void test("journal PostgreSQL: leitura sem alterações e divergências bloqueadas antes de migrar", async () => {
  const observer = await createPostgresDatabase(databaseUrl);
  try {
    const before = (
      await observer.client.query<Record<string, unknown>>(
        "SELECT * FROM drizzle.__drizzle_migrations ORDER BY id",
      )
    ).rows;
    await observer.client.query("BEGIN READ ONLY");
    try {
      const status = await inspectMigrationHistory(observer.client);
      assert.equal(
        status.applied.length,
        readMigrationFiles({ migrationsFolder: "migrations" }).length,
      );
      assert.deepEqual(status.pending, []);
      assert.equal(
        (
          await observer.client.query<Record<string, unknown>>(
            "SHOW transaction_read_only",
          )
        ).rows[0]?.transaction_read_only,
        "on",
      );
    } finally {
      await observer.client.query("ROLLBACK");
    }
    for (const sql of [
      "UPDATE drizzle.__drizzle_migrations SET hash = 'invalid' WHERE id = (SELECT min(id) FROM drizzle.__drizzle_migrations)",
      "DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT min(id) FROM drizzle.__drizzle_migrations)",
      "INSERT INTO drizzle.__drizzle_migrations(hash, created_at) SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1",
    ]) {
      await observer.client.query("BEGIN");
      try {
        await observer.client.query(sql);
        await assert.rejects(inspectMigrationHistory(observer.client));
      } finally {
        await observer.client.query("ROLLBACK");
      }
    }
    assert.deepEqual(
      (
        await observer.client.query<Record<string, unknown>>(
          "SELECT * FROM drizzle.__drizzle_migrations ORDER BY id",
        )
      ).rows,
      before,
    );

    // Banco vazio no mesmo cluster descartável: status não cria schema/journal.
    await observer.client.query("CREATE DATABASE levi_history_empty");
    const emptyUrl = new URL(databaseUrl);
    emptyUrl.pathname = "/levi_history_empty";
    const empty = await createPostgresDatabase(emptyUrl.toString());
    try {
      await empty.client.query("BEGIN READ ONLY");
      const status = await inspectMigrationHistory(empty.client);
      assert.equal(
        status.pending.length,
        readMigrationFiles({ migrationsFolder: "migrations" }).length,
      );
      assert.deepEqual(status.applied, []);
      assert.equal(
        (
          await empty.client.query<Record<string, unknown>>(
            "SELECT to_regclass('drizzle.__drizzle_migrations') AS relation",
          )
        ).rows[0]?.relation,
        null,
      );
    } finally {
      await empty.client.query("ROLLBACK");
      await empty.client.end();
    }
    await observer.client.query("DROP DATABASE levi_history_empty");
  } finally {
    await observer.client.end();
  }
});
