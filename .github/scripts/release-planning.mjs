import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  mkdtempSync,
  mkdirSync,
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  recordFromStatus,
  shaPattern,
  repository,
  validateAncestry,
  validateProtectedInputs,
  validateDistribution,
  snapshotChanges,
  digest,
  names as publicPackageNames,
} from "./release-core.mjs";

export const workspaceGroups = [
  "packages",
  "tooling",
  "examples",
  "tests",
  "apps",
];

// Accept the historical layout only when recalculating an immutable old base.
export function validateWorkspaceLayout(bytes, { historical = false } = {}) {
  const stanza = bytes.toString().split("\n\n")[0].trimEnd();
  const layout = (groups) =>
    `packages:\n${groups.map((group) => `  - ${group}/*`).join("\n")}`;
  assert(
    stanza === layout(workspaceGroups) ||
      (historical && stanza === layout(workspaceGroups.slice(0, -1))),
    "Unexpected planning-base workspaces",
  );
}

export function workspaceKind(path) {
  if (path === ".") return "root";
  const [group, name, ...rest] = path.split("/");
  assert(workspaceGroups.includes(group), "Unknown workspace group");
  assert(
    name && ![".", ".."].includes(name) && rest.length === 0,
    "Invalid workspace component path",
  );
  if (group === "apps" || group === "examples") return "application";
  if (group === "tooling") return "tooling";
  if (group === "tests") return "test";
  return "package";
}

export function workspaceManifests(directory = ".") {
  validateWorkspaceLayout(readFileSync(join(directory, "pnpm-workspace.yaml")));
  const read = (path) => {
    const file = join(directory, path, "package.json");
    assert(
      lstatSync(file).isFile(),
      "Workspace manifest must be a regular file",
    );
    return { path, pkg: JSON.parse(readFileSync(file, "utf8")) };
  };
  const result = [read(".")];
  for (const group of workspaceGroups) {
    const folder = join(directory, group);
    if (!existsSync(folder)) continue;
    assert(
      lstatSync(folder).isDirectory(),
      "Workspace group must be a directory",
    );
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      assert(!entry.isSymbolicLink(), "Workspace symlinks are unsupported");
      const path = `${group}/${entry.name}`;
      if (
        entry.isDirectory() &&
        existsSync(join(directory, path, "package.json"))
      )
        result.push(read(path));
    }
  }
  const names = result.map(({ pkg }) => pkg.name);
  assert(names.every((name) => typeof name === "string" && name.length > 0));
  assert.equal(new Set(names).size, names.length, "Duplicate workspace name");
  assert(
    result.every(
      ({ pkg }) =>
        pkg.private === true || publicPackageNames.includes(pkg.name),
    ),
    "Unexpected public workspace",
  );
  return result;
}

export async function treeAtCommit(sha, request) {
  assert(shaPattern.test(sha));
  const root = `https://api.github.com/repos/${repository}`;
  const commit = await request(`${root}/git/commits/${sha}`);
  assert.equal(commit.sha, sha, "Git commit lookup mismatch");
  assert(shaPattern.test(commit.tree?.sha), "Git commit tree missing");
  const tree = await request(
    `${root}/git/trees/${commit.tree.sha}?recursive=1`,
  );
  assert.equal(tree.sha, commit.tree.sha, "Git tree lookup mismatch");
  return tree;
}

export async function contentBinding(
  releaseSha,
  executionSha,
  request,
  context = { distribution: "release" },
  record,
) {
  const root = `https://api.github.com/repos/${repository}`;
  assert(shaPattern.test(releaseSha) && shaPattern.test(executionSha));
  validateAncestry(
    await request(`${root}/compare/${releaseSha}...${executionSha}`),
    releaseSha,
    executionSha,
  );
  const releaseTree = await treeAtCommit(releaseSha, request);
  const executionTree =
    executionSha === releaseSha
      ? releaseTree
      : await treeAtCommit(executionSha, request);
  validateDistribution(context, record);
  const changes = snapshotChanges(releaseTree, executionTree);
  return {
    releaseTree,
    // Bootstrap audit is a proposal, not authorization. The separate owner approval
    // binds this new immutable snapshot and all reviewed historical differences.
    protectedInputsDigest: validateProtectedInputs(
      context.distribution === "bootstrap" ? executionTree : releaseTree,
      executionTree,
    ),
    changes,
    changesDigest: digest({ releaseSha, snapshotSha: executionSha, changes }),
  };
}

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
    /^(package\.json|pnpm-workspace\.yaml|\.changeset\/(config\.json|[a-zA-Z0-9_-]+\.md)|(?:packages|tooling|examples|tests|apps)\/[^/]+\/package\.json)$/.test(
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
    validateWorkspaceLayout(
      readFileSync(join(directory, "pnpm-workspace.yaml")),
      {
        historical: true,
      },
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
