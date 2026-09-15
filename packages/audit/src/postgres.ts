import type { Sql } from "postgres";

import type { AuditStore } from "./index.js";
import { serializeAuditMetadata } from "./index.js";

export function createPostgresAuditStore(database: Sql): AuditStore {
  return {
    async append(event) {
      const timestamp = event.timestamp.getTime();
      if (!Number.isFinite(timestamp))
        throw new TypeError("Audit event timestamp must be valid");
      const timestampIso = event.timestamp.toISOString();
      const metadata = serializeAuditMetadata(event.metadata);

      await database`INSERT INTO audit_events (actor, action, target, tenant, timestamp, metadata, request_id, result) VALUES (${event.actor}, ${event.action}, ${event.target}, ${event.tenant}, ${timestampIso}::timestamptz, ${metadata}::jsonb, ${event.requestId}, ${event.result})`;
    },
  };
}
