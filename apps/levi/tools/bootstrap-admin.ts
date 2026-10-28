import { createPostgresDatabase } from "@t00ls-dev/db/postgres";
import { bootstrapTarget } from "./bootstrap-admin-config.js";
import {
  bootstrapAdministrator,
  readBootstrapInput,
} from "./bootstrap-admin-operation.js";
import { inspectMigrationHistory } from "./migration-history.js";

// Execução explícita fora do Worker. Nunca importado por startup, build ou deploy.
try {
  const confirmation = readBootstrapInput(process.env);
  const database = await createPostgresDatabase(bootstrapTarget(process.env));
  try {
    const { rows } = await database.client.query<{
      database: string;
      role: string;
      login: string;
      schema: string;
    }>(
      "SELECT current_database() AS database, current_user AS role, session_user AS login, current_schema() AS schema",
    );
    const identity = rows[0];
    if (
      !identity ||
      identity.database !== process.env.LEVI_ADMIN_DATABASE_NAME ||
      identity.role !== "levi_dev_bootstrap" ||
      identity.login !== "levi_dev_bootstrap" ||
      identity.schema !== "public"
    )
      throw new Error();
    const status = await inspectMigrationHistory(database.client);
    if (status.pending.length) throw new Error();
    const result = await bootstrapAdministrator({ database, confirmation });
    console.info(
      JSON.stringify({
        operacao: "admin-bootstrap",
        resultado: result.kind,
        operationId: confirmation.operationId,
      }),
    );
  } finally {
    await database.client.end();
  }
} catch {
  // Nem e-mail, IDs de sessão, URL, SQL ou erro do driver no diagnóstico.
  console.error(
    "Bootstrap não confirmado. Consulte recibo e auditoria antes de qualquer nova operação.",
  );
  process.exitCode = 1;
}
