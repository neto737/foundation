import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { workspaceGroups, workspaceManifests } from "./workspace.mjs";
import { realpathSync } from "node:fs";
import { parse } from "yaml";
const layout = (groups = workspaceGroups) =>
  `packages:\n${groups.map((group) => `  - ${group}/*`).join("\n")}\n`;
const write = (root, path, value) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(
    join(root, path),
    typeof value === "string" ? value : JSON.stringify(value),
  );
};
async function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "foundation-workspace-test-"));
  try {
    write(root, "package.json", {
      name: "fixture",
      private: true,
      packageManager: "pnpm@10.15.1",
    });
    write(root, "pnpm-workspace.yaml", layout());
    return await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("todos os consumidores Foundation usam links locais e pacotes privados", () => {
  const root = resolve(import.meta.dirname, "../..");
  const manifests = workspaceManifests(root);
  const names = new Set(manifests.map(({ pkg }) => pkg.name));
  const lock = parse(readFileSync(join(root, "pnpm-lock.yaml"), "utf8"));
  for (const { path, pkg } of manifests) {
    assert.equal(pkg.private, true);
    assert.equal(pkg.publishConfig, undefined);
    for (const section of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ]) {
      for (const [name, version] of Object.entries(pkg[section] ?? {})) {
        if (!name.startsWith("@t00ls-dev/")) continue;
        assert(names.has(name), `Unknown internal package: ${name}`);
        assert.equal(version, "workspace:*", `${path}: ${name}`);
        if (section === "peerDependencies") continue;
        const entry = lock.importers[path][section][name];
        assert.equal(entry.specifier, "workspace:*");
        assert(entry.version.startsWith("link:"));
        const target = manifests.find(({ pkg }) => pkg.name === name);
        assert.equal(
          realpathSync(join(root, path, "node_modules", name)),
          realpathSync(join(root, target.path)),
        );
      }
    }
  }
  for (const name of Object.keys(lock.packages ?? {}))
    assert(!name.startsWith("@t00ls-dev/"), `Registry package: ${name}`);
});
test("Turbo reconhece dependência transitiva e ^build através de pacote sem build", async () => {
  await fixture((root) => {
    const script = (name) =>
      `node -e "require('node:fs').appendFileSync('../../order.log', '${name}\\n')"`;
    write(root, "packages/base/package.json", {
      name: "@fixture/base",
      version: "0.1.0",
      private: true,
      scripts: { build: script("base") },
    });
    write(root, "packages/bridge/package.json", {
      name: "@fixture/bridge",
      version: "0.1.0",
      private: true,
      dependencies: { "@fixture/base": "workspace:*" },
    });
    write(root, "apps/pilot/package.json", {
      name: "@fixture/pilot",
      version: "0.1.0",
      private: true,
      dependencies: { "@fixture/bridge": "workspace:*" },
      scripts: { build: script("pilot") },
    });
    write(root, "turbo.json", readFileSync("turbo.json", "utf8"));
    write(
      root,
      "pnpm-lock.yaml",
      `lockfileVersion: '9.0'\nimporters:\n  .: {}\n  packages/base: {}\n  packages/bridge:\n    dependencies:\n      '@fixture/base':\n        specifier: workspace:*\n        version: link:../base\n  apps/pilot:\n    dependencies:\n      '@fixture/bridge':\n        specifier: workspace:*\n        version: link:../../packages/bridge\n`,
    );
    const turbo = resolve("node_modules/turbo/bin/turbo");
    const options = {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        TURBO_TELEMETRY_DISABLED: "1",
        TURBO_NO_UPDATE_NOTIFIER: "1",
      },
    };
    const args = [turbo, "run", "build", "--filter=@fixture/pilot..."];
    const graph = JSON.parse(
      execFileSync(process.execPath, [...args, "--dry=json"], options),
    );
    assert(graph.packages.includes("@fixture/base"));
    assert(graph.packages.includes("@fixture/bridge"));
    assert(graph.packages.includes("@fixture/pilot"));
    execFileSync(process.execPath, [...args, "--cache=local:"], options);
    assert.deepEqual(
      readFileSync(join(root, "order.log"), "utf8").trim().split("\n"),
      ["base", "pilot"],
    );
  });
});
