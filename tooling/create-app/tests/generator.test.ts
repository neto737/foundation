import {
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateApp } from "../src/index.js";

const sandbox = join(import.meta.dirname, ".sandbox");

beforeEach(async () => {
  await rm(sandbox, { force: true, recursive: true });
  await mkdir(sandbox, { recursive: true });
});

afterEach(async () => {
  await rm(sandbox, { force: true, recursive: true });
});

describe("generateApp", () => {
  it("generates the basic D1 preset into a new target", async () => {
    const result = await generateApp("My D1 App", { cwd: sandbox });
    const manifest = JSON.parse(
      await readFile(join(result.target, "package.json"), "utf8"),
    ) as { name: string; private: boolean };
    const wrangler = await readFile(
      join(result.target, "wrangler.jsonc"),
      "utf8",
    );

    expect(result.name).toBe("my-d1-app");
    expect(manifest).toMatchObject({ name: "my-d1-app", private: true });
    expect(wrangler).toContain('"binding": "DB"');
    await expect(
      readFile(join(result.target, "src/worker.ts"), "utf8"),
    ).resolves.toContain("betterAuth");
    await expect(
      readFile(join(result.target, "src/client/app.tsx"), "utf8"),
    ).resolves.toContain("requestPasswordReset");
    await expect(
      readFile(join(result.target, "migrations/0001_better_auth.sql"), "utf8"),
    ).resolves.toContain("CREATE TABLE user");
    await expect(
      readFile(join(result.target, ".gitignore"), "utf8"),
    ).resolves.toContain("node_modules");
    expect(
      await Promise.all(
        [
          "README.md",
          "package.json",
          "src/client/app.tsx",
          "wrangler.jsonc",
        ].map((file) => readFile(join(result.target, file), "utf8")),
      ),
    ).not.toContainEqual(expect.stringContaining("__PROJECT_NAME__"));
  });

  it("generates into an existing empty directory", async () => {
    const target = join(sandbox, "empty");
    await mkdir(target);

    await expect(generateApp(target)).resolves.toMatchObject({ target });
  });

  it("creates missing parent directories without leaving staging files", async () => {
    const target = join(sandbox, "nested", "app");

    await expect(generateApp(target)).resolves.toMatchObject({ target });
    await expect(readdir(join(sandbox, "nested"))).resolves.toEqual(["app"]);
  });

  it("does not overwrite a non-empty directory", async () => {
    const target = join(sandbox, "occupied");
    await mkdir(target);
    await writeFile(join(target, "keep.txt"), "keep");

    await expect(generateApp(target)).rejects.toThrow("not empty");
    await expect(readFile(join(target, "keep.txt"), "utf8")).resolves.toBe(
      "keep",
    );
  });

  it("rejects files and symbolic links as targets", async () => {
    const file = join(sandbox, "file");
    const link = join(sandbox, "link");
    await writeFile(file, "keep");
    await symlink(sandbox, link, "dir");

    await expect(generateApp(file)).rejects.toThrow("not a directory");
    await expect(generateApp(link)).rejects.toThrow("symbolic link");
  });

  it("rejects a filesystem root", async () => {
    await expect(generateApp("/")).rejects.toThrow("filesystem root");
  });
});
