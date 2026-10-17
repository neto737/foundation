import type { Hyperdrive } from "@cloudflare/workers-types";
import { createPostgresDatabase } from "@t00ls-dev/db/postgres";
import { createPostgresAuditStore } from "@t00ls-dev/audit/postgres";
import { createAuditEvent } from "@t00ls-dev/audit";
import { tenants } from "@t00ls-dev/tenant/schema/postgres";
import { eq } from "drizzle-orm";

// Local Miniflare binding to a disposable PostgreSQL, not a deployed service.
export default {
  async fetch(request: Request, env: { HYPERDRIVE: Hyperdrive }) {
    const { client, db } = await createPostgresDatabase(
      env.HYPERDRIVE.connectionString,
    );
    try {
      const rollback = new URL(request.url).pathname === "/rollback";
      const id = rollback ? "worker-rollback" : crypto.randomUUID();
      await db.transaction(async (tx) => {
        await tx
          .insert(tenants)
          .values({ id, name: "Worker test", createdAt: new Date() });
        await createPostgresAuditStore(client).append(
          createAuditEvent({
            actor: "worker",
            action: "worker.probe",
            target: id,
            tenant: id,
            timestamp: new Date(),
            metadata: { local: true },
            requestId: null,
            result: "success",
          }),
        );
        if (rollback) throw new Error("synthetic rollback");
      });
      const rows = await db.select().from(tenants).where(eq(tenants.id, id));
      const result = await client.query<{ value: string; pid: number }>(
        "SELECT $1::text AS value, pg_backend_pid() AS pid",
        ["worker'parameter"],
      );
      return Response.json({
        id: rows[0]?.id,
        value: result.rows[0]?.value,
        pid: result.rows[0]?.pid,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "synthetic rollback") {
        return Response.json({ rolledBack: true });
      }
      throw error;
    } finally {
      await client.end();
    }
  },
};
