import { describe, expect, it, vi } from "vitest";

import { createD1AuditStore } from "../src/d1.js";
import {
  parseAuditMetadata,
  serializeAuditMetadata,
  type AuditEvent,
} from "../src/index.js";
import { createPostgresAuditStore } from "../src/postgres.js";

const event: AuditEvent = {
  actor: "user:user-1",
  action: "document.publish",
  target: "document:doc-1",
  tenant: "tenant-1",
  timestamp: new Date("2026-09-15T12:00:00.000Z"),
  metadata: { attempt: 1, flags: [true, null], source: "dashboard" },
  requestId: "request-1",
  result: "success",
};

describe("audit metadata", () => {
  it("round-trips JSON objects without retaining mutable references", () => {
    const parsed = parseAuditMetadata(serializeAuditMetadata(event.metadata));

    expect(parsed).toEqual(event.metadata);
    expect(parsed).not.toBe(event.metadata);
  });

  it("rejects values that JSON would silently omit or coerce", () => {
    expect(() => serializeAuditMetadata({ value: undefined } as never)).toThrow(
      "not JSON-compatible",
    );
    expect(() => serializeAuditMetadata({ value: Number.NaN })).toThrow(
      "finite number",
    );
    expect(() =>
      serializeAuditMetadata({ value: new Date() } as never),
    ).toThrow("plain object");

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => serializeAuditMetadata(cyclic as never)).toThrow(
      "contains a cycle",
    );
  });
});

describe("createD1AuditStore", () => {
  it("only exposes append and persists every canonical field", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const bind = vi.fn(() => ({ run }));
    const prepare = vi.fn(() => ({ bind }));
    const store = createD1AuditStore({ prepare } as unknown as D1Database);

    await store.append(event);

    expect(Object.keys(store)).toEqual(["append"]);
    expect(prepare).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO audit_events"),
    );
    expect(bind).toHaveBeenCalledWith(
      event.actor,
      event.action,
      event.target,
      event.tenant,
      event.timestamp.getTime(),
      serializeAuditMetadata(event.metadata),
      event.requestId,
      event.result,
    );
    expect(run).toHaveBeenCalledOnce();
  });
});

describe("createPostgresAuditStore", () => {
  it("only exposes append and parameterizes every canonical field", async () => {
    const query = vi.fn().mockResolvedValue([]);
    const store = createPostgresAuditStore(query as never);

    await store.append(event);

    expect(Object.keys(store)).toEqual(["append"]);
    expect(query).toHaveBeenCalledOnce();
    const values = query.mock.calls[0]?.slice(1);
    expect(values).toEqual([
      event.actor,
      event.action,
      event.target,
      event.tenant,
      event.timestamp.toISOString(),
      serializeAuditMetadata(event.metadata),
      event.requestId,
      event.result,
    ]);
  });
});
