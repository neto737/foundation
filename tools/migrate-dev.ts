import { createPostgresDatabase } from "@t00ls-dev/db/postgres";
import { getPostgresMigrationStatus } from "@t00ls-dev/db/postgres-migrations";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { devMigrationTarget } from "./dev-migration-config.js";

// Nunca importado pela aplicação ou pelo build/deploy. Ação administrativa explícita.
try {
  const databaseUrl = devMigrationTarget(process.env);
  const { client, db } = await createPostgresDatabase(databaseUrl);
  try {
    const identity = await client.query<{ database: string; role: string }>(
      "SELECT current_database() AS database, current_user AS role",
    );
    if (
      identity.rows[0]?.database !== process.env.LEVI_DEV_DATABASE_NAME ||
      identity.rows[0]?.role !== "levi_dev_migrator"
    )
      throw new Error();
    const lock = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(715463, 1) AS locked",
    );
    if (!lock.rows[0]?.locked) throw new Error();
    const before = await getPostgresMigrationStatus(client, "migrations");
    console.info(
      JSON.stringify({
        operacao: "migration-dev",
        pendentes: before.pending.length,
      }),
    );
    await migrate(db, { migrationsFolder: "migrations" });
    const after = await getPostgresMigrationStatus(client, "migrations");
    if (after.pending.length) throw new Error();
    console.info(
      JSON.stringify({
        operacao: "migration-dev",
        pendentes: 0,
        aplicadas: after.applied.length,
      }),
    );
  } finally {
    // A conexão direta encerrada também libera o lock administrativo.
    await client.end();
  }
} catch {
  console.error(
    "Não foi possível confirmar a migração DEV. Verifique o alvo e o journal; nenhuma repetição será automática.",
  );
  process.exitCode = 1;
}
