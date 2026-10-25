import assert from "node:assert/strict";
import { test } from "node:test";
import { createFoundationAuth } from "@t00ls-dev/auth";
import { createPostgresDatabase } from "@t00ls-dev/db/postgres";
import { createAuditEvent } from "@t00ls-dev/audit";
import { createPostgresAuditStore } from "@t00ls-dev/audit/postgres";
import { resolveTenantContext } from "@t00ls-dev/tenant";
import {
  createPostgresTenantRepository,
  createPostgresTenantSessionStore,
} from "@t00ls-dev/tenant/postgres";
import { readObject } from "../src/contracts.js";

test("entrypoints públicos necessários resolvem fora do workspace Foundation", () => {
  for (const fn of [
    createFoundationAuth,
    createPostgresDatabase,
    createAuditEvent,
    createPostgresAuditStore,
    resolveTenantContext,
    createPostgresTenantRepository,
    createPostgresTenantSessionStore,
  ])
    assert.equal(typeof fn, "function");
});

test("entrada rejeita campos inesperados e JSON malformado", async () => {
  for (const body of [
    '{"email":"test@example.com","role":"admin"}',
    "null",
    "[]",
    "{",
  ]) {
    await assert.rejects(
      readObject(
        new Request("http://localhost", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        }),
        ["email"],
      ),
    );
  }
});
