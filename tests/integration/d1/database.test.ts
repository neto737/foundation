import { createD1Database } from "@t00ls-dev/db/d1";
import { sql } from "drizzle-orm";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("D1 adapter", () => {
  let miniflare: Miniflare;

  beforeAll(() => {
    miniflare = new Miniflare(
      convertV4MiniflareOptions({
        d1Databases: ["DB"],
        modules: true,
        script: "export default { fetch() { return new Response('ok') } }",
      }),
    );
  });
  afterAll(async () => miniflare.dispose());

  it("executes queries through Drizzle against a real local D1", async () => {
    const binding = await miniflare.getD1Database("DB");
    const database = createD1Database(binding);
    const result = await database.run(sql`SELECT 1 AS value`);
    expect(result.success).toBe(true);
  });
});
