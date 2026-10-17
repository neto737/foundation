import { describe, expect, it, vi } from "vitest";
import { Client } from "pg";

import { createD1AuditStore } from "../src/d1.js";
import {
  createAuditEvent,
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
  it("creates an event with a recursively detached metadata copy", () => {
    const metadata = {
      context: {
        changes: [{ field: "title", values: ["before", "after"] }],
      },
      requestedAt: "2026-09-15T12:00:00.000Z",
    };

    const created = createAuditEvent({ ...event, metadata });

    expect(created).not.toBe(event);
    expect(created.metadata).toEqual(metadata);
    expect(created.metadata).not.toBe(metadata);
    expect(created.metadata.context).not.toBe(metadata.context);
    expect(created.metadata.context).toEqual(metadata.context);

    metadata.context.changes[0]!.values[0] = "mutated";
    expect(created.metadata.context).toEqual({
      changes: [{ field: "title", values: ["before", "after"] }],
    });
  });

  it.each([
    ["exact", { password: "redacted" }],
    ["case-insensitive", { PASSWORD: "redacted" }],
    ["separator-tolerant", { access_token: "redacted" }],
    ["camel case", { clientSecret: "redacted" }],
    ["nested object", { context: { sessionCookie: "redacted" } }],
    ["nested array", { changes: [{ apiToken: "redacted" }] }],
    ["separated letters", { "client-s_e.c/r e t": "redacted" }],
  ])("rejects sensitive keys in %s metadata", (_case, metadata) => {
    expect(() => createAuditEvent({ ...event, metadata })).toThrow(
      "is sensitive",
    );
  });

  it("allows benign keys at every nesting level", () => {
    expect(() =>
      createAuditEvent({
        ...event,
        metadata: {
          attempts: 2,
          authorizationMethod: "passkey",
          context: [{ operation: "rotate", result: { status: "success" } }],
          source: "dashboard",
        },
      }),
    ).not.toThrow();
  });

  it("rejects non-JSON metadata while creating an event", () => {
    expect(() =>
      createAuditEvent({
        ...event,
        metadata: { context: [{ value: undefined }] } as never,
      }),
    ).toThrow("not JSON-compatible");

    const cyclic: Record<string, unknown> = {};
    cyclic.context = [cyclic];
    expect(() =>
      createAuditEvent({ ...event, metadata: cyclic as never }),
    ).toThrow("contains a cycle");
  });

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
    const client = new Client();
    const query = vi.spyOn(client, "query").mockReturnValue(undefined);
    const store = createPostgresAuditStore(client);

    await store.append(event);

    expect(Object.keys(store)).toEqual(["append"]);
    expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith(
      "INSERT INTO audit_events (actor, action, target, tenant, timestamp, metadata, request_id, result) VALUES ($1, $2, $3, $4, $5::timestamptz, $6::jsonb, $7, $8)",
      [
        event.actor,
        event.action,
        event.target,
        event.tenant,
        event.timestamp.toISOString(),
        serializeAuditMetadata(event.metadata),
        event.requestId,
        event.result,
      ],
    );
    query.mockRestore();
  });
});
