import assert from "node:assert/strict";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const workspaceGroups = ["packages", "tooling", "tests", "apps"];

// Accept the historical layout only when recalculating an immutable old base.
export function validateWorkspaceLayout(bytes, { historical = false } = {}) {
  const stanza = bytes.toString().split("\n\n")[0].trimEnd();
  const layout = (groups) =>
    `packages:\n${groups.map((group) => `  - ${group}/*`).join("\n")}`;
  assert(
    stanza === layout(workspaceGroups) ||
      (historical &&
        [
          ["packages", "tooling", "examples", "tests"],
          ["packages", "tooling", "examples", "tests", "apps"],
        ].some((groups) => stanza === layout(groups))),
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
    result.every(({ pkg }) => pkg.private === true),
    "Unexpected public workspace",
  );
  return result;
}
