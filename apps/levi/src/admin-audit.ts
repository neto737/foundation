import type { AdministrativeTransaction } from "./admin-access.js";
import { auditEvents } from "./data/schema.js";

type AdministrativeEvent =
  | {
      action:
        | "admin.bootstrapped"
        | "admin.granted"
        | "admin.revoked"
        | "feature_flag.all"
        | "feature_flag.selected"
        | "feature_flag.disabled";
      tenant: null;
    }
  | {
      action:
        "feature_flag.organization_added" | "feature_flag.organization_removed";
      tenant: string;
    };

// Adaptação local: o contrato público Foundation exige tenant string.
export async function appendAdministrativeAudit(
  tx: AdministrativeTransaction,
  event: AdministrativeEvent & {
    actor: string;
    target: string;
    operationId: string;
  },
) {
  await tx.insert(auditEvents).values({
    actor: event.actor,
    action: event.action,
    target: event.target,
    tenant: event.tenant,
    timestamp: new Date(),
    metadata: {},
    requestId: event.operationId,
    result: "success",
  });
}
