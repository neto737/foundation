import type { AuditStore } from "./index.js";
import { serializeAuditMetadata } from "./index.js";
import type { D1Database } from "@cloudflare/workers-types";

export function createD1AuditStore(database: D1Database): AuditStore {
  return {
    async append(event) {
      const timestamp = event.timestamp.getTime();
      if (!Number.isFinite(timestamp))
        throw new TypeError("Audit event timestamp must be valid");

      await database
        .prepare(
          "INSERT INTO audit_events (actor, action, target, tenant, timestamp, metadata, request_id, result) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          event.actor,
          event.action,
          event.target,
          event.tenant,
          timestamp,
          serializeAuditMetadata(event.metadata),
          event.requestId,
          event.result,
        )
        .run();
    },
  };
}
