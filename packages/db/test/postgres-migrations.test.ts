import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getPostgresMigrationStatus } from "../src/postgres-migrations.js";

vi.mock("node:fs/promises", () => ({ readFile: vi.fn() }));

const journal = JSON.stringify({
  entries: [
    { tag: "0001_users", when: 1_000 },
    { tag: "0002_sessions", when: 2_000 },
  ],
});

describe("getPostgresMigrationStatus", () => {
  afterEach(() => vi.restoreAllMocks());

  // The successful query/result contract is exercised against real PostgreSQL.
  it.each(["3F000", "42P01"])(
    "treats missing schema/table (%s) as no applied migrations",
    async (code) => {
      vi.mocked(readFile).mockResolvedValue(journal);
      const missingTable = Object.assign(new Error("missing table"), {
        code,
      });
      const client = new Client();
      const query = vi.spyOn(client, "query").mockRejectedValue(missingTable);

      await expect(
        getPostgresMigrationStatus(client, "/migrations"),
      ).resolves.toEqual({
        applied: [],
        pending: ["0001_users", "0002_sessions"],
      });
      expect(readFile).toHaveBeenCalledWith(
        "/migrations/meta/_journal.json",
        "utf8",
      );
      expect(query).toHaveBeenCalledExactlyOnceWith(
        "SELECT created_at FROM drizzle.__drizzle_migrations",
      );
    },
  );

  it("rejects malformed journals and unexpected database failures", async () => {
    vi.mocked(readFile).mockResolvedValue('{"entries":[{"tag":"0001"}]}');
    const client = new Client();
    const query = vi.spyOn(client, "query");

    await expect(
      getPostgresMigrationStatus(client, "/migrations"),
    ).rejects.toThrow("Invalid Drizzle migration journal");
    expect(query).not.toHaveBeenCalled();

    vi.mocked(readFile).mockResolvedValue(journal);
    const databaseError = new Error("connection lost");
    query.mockRejectedValue(databaseError);
    await expect(
      getPostgresMigrationStatus(client, "/migrations"),
    ).rejects.toBe(databaseError);
  });
});
