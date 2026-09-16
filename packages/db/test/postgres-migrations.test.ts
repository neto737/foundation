import { readFile } from "node:fs/promises";
import type { Sql } from "postgres";
import { describe, expect, it, vi } from "vitest";

import { getPostgresMigrationStatus } from "../src/postgres-migrations.js";

vi.mock("node:fs/promises", () => ({ readFile: vi.fn() }));

const journal = JSON.stringify({
  entries: [
    { tag: "0001_users", when: 1_000 },
    { tag: "0002_sessions", when: 2_000 },
  ],
});

describe("getPostgresMigrationStatus", () => {
  it("classifies journal entries using applied migration timestamps", async () => {
    vi.mocked(readFile).mockResolvedValue(journal);
    const client = vi.fn().mockResolvedValue([{ created_at: "1000" }]);

    await expect(
      getPostgresMigrationStatus(client as unknown as Sql, "/migrations"),
    ).resolves.toEqual({
      applied: ["0001_users"],
      pending: ["0002_sessions"],
    });
    expect(readFile).toHaveBeenCalledWith(
      "/migrations/meta/_journal.json",
      "utf8",
    );
    expect(client).toHaveBeenCalledOnce();
  });

  it("treats a missing migration table as no applied migrations", async () => {
    vi.mocked(readFile).mockResolvedValue(journal);
    const missingTable = Object.assign(new Error("missing table"), {
      code: "42P01",
    });
    const client = vi.fn().mockRejectedValue(missingTable);

    await expect(
      getPostgresMigrationStatus(client as unknown as Sql, "/migrations"),
    ).resolves.toEqual({
      applied: [],
      pending: ["0001_users", "0002_sessions"],
    });
  });

  it("rejects malformed journals and unexpected database failures", async () => {
    vi.mocked(readFile).mockResolvedValue('{"entries":[{"tag":"0001"}]}');
    const client = vi.fn();

    await expect(
      getPostgresMigrationStatus(client as unknown as Sql, "/migrations"),
    ).rejects.toThrow("Invalid Drizzle migration journal");
    expect(client).not.toHaveBeenCalled();

    vi.mocked(readFile).mockResolvedValue(journal);
    const databaseError = new Error("connection lost");
    const failingClient = vi.fn().mockRejectedValue(databaseError);
    await expect(
      getPostgresMigrationStatus(
        failingClient as unknown as Sql,
        "/migrations",
      ),
    ).rejects.toBe(databaseError);
  });
});
