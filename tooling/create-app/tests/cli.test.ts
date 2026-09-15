import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";

function capture() {
  const errors: string[] = [];
  const logs: string[] = [];
  return {
    errors,
    io: {
      error: (message: string) => errors.push(message),
      log: (message: string) => logs.push(message),
    },
    logs,
  };
}

describe("runCli", () => {
  it("prints help without requiring a target", async () => {
    const output = capture();

    await expect(runCli(["--help"], output.io)).resolves.toBe(0);
    expect(output.logs.join("\n")).toContain("Usage: create-app <target>");
    expect(output.errors).toEqual([]);
  });

  it("rejects a missing target", async () => {
    const output = capture();

    await expect(runCli([], output.io)).resolves.toBe(1);
    expect(output.errors[0]).toContain("target directory is required");
  });

  it("rejects unknown presets", async () => {
    const output = capture();

    await expect(runCli(["app", "--preset", "other"], output.io)).resolves.toBe(
      1,
    );
    expect(output.errors).toEqual([
      "Unknown preset: other. Available preset: basic-d1.",
    ]);
  });

  it("rejects unknown options and multiple targets", async () => {
    const unknown = capture();
    const multiple = capture();

    await expect(runCli(["--yes"], unknown.io)).resolves.toBe(1);
    await expect(runCli(["one", "two"], multiple.io)).resolves.toBe(1);
    expect(unknown.errors[0]).toContain("Unknown option: --yes");
    expect(multiple.errors[0]).toContain("Only one target directory");
  });
});
