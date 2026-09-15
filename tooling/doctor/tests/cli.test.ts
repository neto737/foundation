import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";

const sandbox = join(import.meta.dirname, ".cli-sandbox");

function capture() {
  const errors: string[] = [];
  const logs: string[] = [];
  return {
    errors,
    logs,
    io: {
      error: (message: string) => errors.push(message),
      log: (message: string) => logs.push(message),
    },
  };
}

beforeEach(async () => {
  await rm(sandbox, { force: true, recursive: true });
  await mkdir(sandbox, { recursive: true });
});

afterEach(async () => {
  await rm(sandbox, { force: true, recursive: true });
});

describe("runCli", () => {
  it("prints help", async () => {
    const output = capture();
    await expect(runCli(["--help"], output.io)).resolves.toBe(0);
    expect(output.logs[0]).toContain("Usage: doctor [project-path]");
  });

  it("returns nonzero when the report contains errors", async () => {
    const output = capture();
    await expect(runCli([sandbox, "--json"], output.io)).resolves.toBe(1);
    const report = JSON.parse(output.logs[0] ?? "") as {
      summary: { errors: number };
    };
    expect(report.summary.errors).toBeGreaterThan(0);
  });

  it("rejects invalid required variable names", async () => {
    const output = capture();
    await expect(
      runCli([sandbox, "--required", "bad-name"], output.io),
    ).resolves.toBe(2);
    expect(output.errors[0]).toContain("uppercase letters");
  });
});
