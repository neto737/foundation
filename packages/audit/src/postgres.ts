import type { Client } from "pg";

import type { AuditStore } from "./index.js";
import { serializeAuditMetadata } from "./index.js";

export function createPostgresAuditStore(
  database: Pick<Client, "query">,
): AuditStore {
  return {
    async append(event) {
      const timestamp = event.timestamp.getTime();
      if (!Number.isFinite(timestamp))
        throw new TypeError("Audit event timestamp must be valid");
      const timestampIso = event.timestamp.toISOString();
      const metadata = serializeAuditMetadata(event.metadata);

      await database.query(
        "INSERT INTO audit_events (actor, action, target, tenant, timestamp, metadata, request_id, result) VALUES ($1, $2, $3, $4, $5::timestamptz, $6::jsonb, $7, $8)",
        [
          event.actor,
          event.action,
          event.target,
          event.tenant,
          timestampIso,
          metadata,
          event.requestId,
          event.result,
        ],
      );
    },
  };
}
