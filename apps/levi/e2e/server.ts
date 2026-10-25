import { serve } from "@hono/node-server";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import { mountWeb } from "../src/web.js";
import { applicationDatabaseUrl } from "../test/runtime-acl-fixture.js";

const databaseUrl = process.env.LEVI_DATABASE_URL;
const directory = process.env.LEVI_TEST_MAIL_DIR;
if (!databaseUrl || !directory || process.env.LEVI_LOCAL_DATABASE !== "1")
  throw new Error("Use a suíte descartável de navegador.");
const proxy = process.argv.includes("--proxy-api");
const port = proxy ? 4318 : 4317;
const app = createApp({
  membersEnabled: true,
  databaseUrl: applicationDatabaseUrl(databaseUrl),
  baseURL: `http://localhost:${proxy ? 5173 : port}`,
  onboardingReturnPath: "/onboarding",
  secret: "synthetic-test-secret-with-more-than-32-characters",
  email: {
    send: async (input) => {
      await writeFile(
        join(directory, `${randomUUID()}.json`),
        JSON.stringify(input),
        { mode: 0o600, flag: "wx" },
      );
    },
  },
});
mountWeb(app);
serve({ fetch: app.fetch, hostname: "127.0.0.1", port });
