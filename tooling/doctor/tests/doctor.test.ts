import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { diagnoseProject } from "../src/index.js";

const execFileAsync = promisify(execFile);
const sandbox = join(import.meta.dirname, ".sandbox");

async function createValidProject(): Promise<void> {
  await writeFile(
    join(sandbox, "package.json"),
    JSON.stringify({
      name: "test-project",
      version: "1.0.0",
      engines: { node: ">=22" },
    }),
  );
  await writeFile(
    join(sandbox, "wrangler.jsonc"),
    `{
      // Comments and trailing commas are supported.
      "name": "test-project",
      "main": "src/index.ts",
      "compatibility_date": "2026-01-01",
      "d1_databases": [{ "binding": "DB", "migrations_dir": "migrations", }],
    }`,
  );
  await writeFile(
    join(sandbox, ".dev.vars.example"),
    "AUTH_SECRET=placeholder\nBASE_URL=http://example.test\nEMAIL_FROM=test@example.test\nRESEND_API_KEY=placeholder\n",
  );
  await mkdir(join(sandbox, "migrations"));
  await writeFile(
    join(sandbox, "migrations", "0001_initial.sql"),
    "SELECT 1;\n",
  );
}

beforeEach(async () => {
  await rm(sandbox, { force: true, recursive: true });
  await mkdir(sandbox, { recursive: true });
});

afterEach(async () => {
  await rm(sandbox, { force: true, recursive: true });
});

describe("diagnoseProject", () => {
  it("passes a valid Node and D1 project", async () => {
    await createValidProject();
    const report = await diagnoseProject(sandbox, { nodeVersion: "v22.3.0" });

    expect(report.summary.errors).toBe(0);
    expect(report.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ check: "manifest", severity: "info" }),
        expect.objectContaining({ check: "wrangler", severity: "info" }),
        expect.objectContaining({ check: "variables", severity: "info" }),
        expect.objectContaining({ check: "migrations", severity: "info" }),
      ]),
    );
  });

  it("reports missing configuration with structured errors", async () => {
    const report = await diagnoseProject(sandbox);

    expect(report.summary.errors).toBeGreaterThan(0);
    expect(
      report.results
        .filter(({ severity }) => severity === "error")
        .map(({ check }) => check),
    ).toEqual(
      expect.arrayContaining([
        "manifest",
        "wrangler",
        "variables",
        "migrations",
      ]),
    );
  });

  it("reports names but never values from the variable example", async () => {
    await createValidProject();
    await writeFile(
      join(sandbox, ".dev.vars.example"),
      "AUTH_SECRET=do-not-print-this\n",
    );
    const report = await diagnoseProject(sandbox);
    const serialized = JSON.stringify(report);

    expect(serialized).toContain("BASE_URL");
    expect(serialized).not.toContain("do-not-print-this");
  });

  it("does not reflect invalid required-name input", async () => {
    await createValidProject();
    const report = await diagnoseProject(sandbox, {
      requiredVariables: ["AUTH_SECRET", "TOKEN=do-not-print-this"],
    });

    expect(report.results).toContainEqual(
      expect.objectContaining({ check: "variables", severity: "error" }),
    );
    expect(JSON.stringify(report)).not.toContain("do-not-print-this");
  });

  it("fails incompatible Node versions", async () => {
    await createValidProject();
    const report = await diagnoseProject(sandbox, { nodeVersion: "v20.0.0" });

    expect(report.results).toContainEqual(
      expect.objectContaining({ check: "node", severity: "error" }),
    );
  });

  it("detects forbidden files tracked by Git without reading their values", async () => {
    await createValidProject();
    await writeFile(
      join(sandbox, ".env.production"),
      "TOKEN=do-not-print-this\n",
    );
    await execFileAsync("git", ["init"], { cwd: sandbox });
    await execFileAsync("git", ["add", "-f", ".env.production"], {
      cwd: sandbox,
    });

    const report = await diagnoseProject(sandbox);
    const secret = report.results.find(({ check }) => check === "secrets");
    expect(secret).toMatchObject({
      severity: "error",
      path: ".env.production",
    });
    expect(JSON.stringify(report)).not.toContain("do-not-print-this");
  });

  it("rejects migrations directories outside the project", async () => {
    await createValidProject();
    await writeFile(
      join(sandbox, "wrangler.jsonc"),
      JSON.stringify({
        name: "test-project",
        main: "src/index.ts",
        compatibility_date: "2026-01-01",
        d1_databases: [{ binding: "DB", migrations_dir: "../outside" }],
      }),
    );

    const report = await diagnoseProject(sandbox);
    expect(report.results).toContainEqual(
      expect.objectContaining({ check: "migrations", severity: "error" }),
    );
  });
});
