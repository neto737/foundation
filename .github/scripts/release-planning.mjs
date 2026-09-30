import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { recordFromStatus, shaPattern } from "./release-core.mjs";

// Resolve planning libraries from the frozen CLI installation, not incidental
// root dependencies. No install, version, pack, publish or Git commands here.
export async function recordFromBase({ baseSha, cliVersion, tree, content }) {
  assert(shaPattern.test(baseSha));
  assert.equal(tree.truncated, false, "Incomplete planning-base tree");
  assert(Array.isArray(tree.tree));
  assert(
    !tree.tree.some(
      (file) =>
        file.path === ".changeset/pre.json" ||
        file.path.startsWith(".changeset/pre/"),
    ),
    "Prerelease planning base unsupported",
  );
  const files = tree.tree.filter((file) =>
    /^(package\.json|pnpm-workspace\.yaml|\.changeset\/(config\.json|[a-zA-Z0-9_-]+\.md)|(?:packages|tooling|examples|tests)\/[^/]+\/package\.json)$/.test(
      file.path,
    ),
  );
  for (const required of [
    "package.json",
    "pnpm-workspace.yaml",
    ".changeset/config.json",
  ])
    assert(
      files.some((file) => file.path === required),
      `Missing planning input: ${required}`,
    );
  assert(
    tree.tree
      .filter((file) => /^\.changeset\/.*\.md$/.test(file.path))
      .every((file) => files.includes(file)),
    "Unsupported changeset path in planning base",
  );
  const directory = mkdtempSync(join(tmpdir(), "foundation-release-base-"));
  try {
    for (const file of files) {
      assert(
        file.path.split("/").every((part) => part !== "." && part !== ".."),
        "Unsafe planning input path",
      );
      assert(
        file.type === "blob" && ["100644", "100755"].includes(file.mode),
        "Planning input must be a regular Git blob",
      );
      const path = join(directory, file.path);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, await content(file.path, baseSha));
    }
    assert.equal(
      readFileSync(join(directory, "pnpm-workspace.yaml"), "utf8").split(
        "\n\n",
      )[0],
      "packages:\n  - packages/*\n  - tooling/*\n  - examples/*\n  - tests/*",
      "Unexpected planning-base workspaces",
    );
    const require = createRequire(import.meta.url);
    const cli = createRequire(require.resolve("@changesets/cli/package.json"));
    assert.equal(cli("./package.json").version, cliVersion);
    const { getPackages } = await import(cli.resolve("@manypkg/get-packages"));
    const { readConfig } = await import(cli.resolve("@changesets/config"));
    const { readChangesets } = await import(cli.resolve("@changesets/read"));
    const { assembleReleasePlan } = await import(
      cli.resolve("@changesets/assemble-release-plan")
    );
    const packages = await getPackages(directory);
    const { config, errors } = await readConfig(directory, packages);
    assert.equal(errors, undefined, "Invalid planning-base Changesets config");
    const status = assembleReleasePlan(
      await readChangesets(directory),
      packages,
      config,
    );
    return recordFromStatus(status, {
      baseSha,
      cliVersion,
      changesetBytes: (id) =>
        readFileSync(join(directory, ".changeset", `${id}.md`)),
      manifestByName: (name) =>
        packages.packages.find((pkg) => pkg.packageJson.name === name)
          .packageJson,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
