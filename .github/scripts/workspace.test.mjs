import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { createRequire } from "node:module";
import {
  workspaceGroups,
  workspaceKind,
  workspaceManifests,
  validateWorkspaceLayout,
} from "./release-planning.mjs";
import {
  componentPlanFromStatus,
  npmRecordFromComponentPlan,
  recordFromStatus,
  validateComponentPlan,
  validateManifests,
  names,
} from "./release-core.mjs";

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

test("descoberta aceita apps privados ausentes ou presentes sem mudar os publicáveis", async () => {
  await fixture((root) => {
    assert.equal(workspaceManifests(root).length, 1);
    write(root, "apps/pilot/package.json", {
      name: "pilot",
      version: "0.1.0",
      private: true,
    });
    write(root, "packages/shared/package.json", {
      name: "shared",
      version: "0.1.0",
      private: true,
    });
    const manifests = workspaceManifests(root);
    assert.deepEqual(
      manifests.map(({ path }) => workspaceKind(path)),
      ["root", "package", "application"],
    );
    const current = workspaceManifests();
    const record = JSON.parse(
      readFileSync(".changeset/release-plan.json", "utf8"),
    );
    validateManifests([...current, manifests.at(-1)], record);
    assert.deepEqual(
      current
        .filter(({ pkg }) => !pkg.private)
        .map(({ pkg }) => pkg.name)
        .sort(),
      [...names].sort(),
    );
    assert.throws(
      () =>
        validateManifests(
          [...current, { ...manifests.at(-1), pkg: { name: "pilot" } }],
          record,
        ),
      /Unexpected public workspace/,
    );
    write(root, "apps/duplicate/package.json", {
      name: "shared",
      private: true,
    });
    assert.throws(() => workspaceManifests(root), /Duplicate workspace name/);
    rmSync(join(root, "apps/duplicate"), { recursive: true });
    write(root, "apps/public/package.json", {
      name: "unexpected-public",
      version: "0.1.0",
    });
    assert.throws(
      () => workspaceManifests(root),
      /Unexpected public workspace/,
    );
  });
});

test("descoberta rejeita symlinks e globs não aprovados; bases antigas continuam legíveis", async () => {
  validateWorkspaceLayout(layout());
  const legacy = layout(workspaceGroups.slice(0, -1));
  assert.throws(() => validateWorkspaceLayout(legacy));
  validateWorkspaceLayout(legacy, { historical: true });
  for (const groups of [
    [...workspaceGroups, "other"],
    ["packages"],
    [...workspaceGroups, "apps/**"],
  ])
    assert.throws(() =>
      validateWorkspaceLayout(layout(groups), { historical: true }),
    );
  await fixture((root) => {
    mkdirSync(join(root, "apps"));
    symlinkSync("../packages", join(root, "apps/link"));
    assert.throws(() => workspaceManifests(root), /symlinks/);
  });
});

const status = (privateOnly = false) => ({
  changesets: [{ id: "release-components" }],
  releases: [
    ...(!privateOnly
      ? [
          {
            name: names[0],
            type: "patch",
            oldVersion: "0.1.0",
            newVersion: "0.1.1",
            changesets: ["release-components"],
          },
        ]
      : []),
    {
      name: "pilot",
      type: "minor",
      oldVersion: "0.1.0",
      newVersion: "0.2.0",
      changesets: ["release-components"],
    },
    {
      name: "private-library",
      type: "patch",
      oldVersion: "0.1.0",
      newVersion: "0.1.1",
      changesets: ["release-components"],
    },
  ],
});
const input = {
  baseSha: "a".repeat(40),
  cliVersion: "3.0.3",
  changesetBytes: () => Buffer.from("release fixture"),
  manifestByName: (name) => ({
    name,
    version: "0.1.0",
    ...(names.includes(name) ? {} : { private: true }),
  }),
};
test("plano de componentes mantém versões/tags privadas e plano npm só inclui a allowlist", () => {
  const plan = componentPlanFromStatus(status(), input);
  assert.equal(plan.components.length, 3);
  assert.equal(
    plan.components.find((item) => item.name === "pilot").tag,
    "pilot@0.2.0",
  );
  assert.deepEqual(
    npmRecordFromComponentPlan(plan).packages.map((item) => item.name),
    [names[0]],
  );
  assert.equal(
    npmRecordFromComponentPlan(componentPlanFromStatus(status(true), input)),
    null,
  );
  assert.throws(
    () => recordFromStatus(status(), input),
    /separate reviewed component release flow/,
  );
  for (const mutate of [
    (p) => {
      p.components[0].private = true;
    },
    (p) => {
      p.components.at(-1).tag = "wrong@0.1.1";
    },
    (p) => {
      p.components.at(-1).version = "9.0.0";
    },
    (p) => {
      p.components.at(-1).private = false;
    },
    (p) => {
      p.components.push(p.components.at(-1));
    },
  ]) {
    const changed = structuredClone(plan);
    mutate(changed);
    assert.throws(() => validateComponentPlan(changed));
  }
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

test("Changesets real planeja app e biblioteca privados sem executar versionamento", async () => {
  await fixture(async (root) => {
    write(root, "apps/pilot/package.json", {
      name: "pilot",
      private: true,
      version: "0.1.0",
    });
    write(root, "packages/private-library/package.json", {
      name: "private-library",
      private: true,
      version: "0.1.0",
    });
    write(root, ".changeset/config.json", {
      access: "public",
      baseBranch: "master",
      commit: false,
      fixed: [],
      linked: [],
      ignore: [],
      privatePackages: { version: true, tag: false },
      updateInternalDependencies: "patch",
    });
    write(
      root,
      ".changeset/release-components.md",
      '---\n"pilot": minor\n"private-library": patch\n---\nFixture de versões independentes.\n',
    );
    const require = createRequire(import.meta.url);
    const cli = createRequire(require.resolve("@changesets/cli/package.json"));
    const { getPackages } = await import(cli.resolve("@manypkg/get-packages"));
    const { readConfig } = await import(cli.resolve("@changesets/config"));
    const { readChangesets } = await import(cli.resolve("@changesets/read"));
    const { assembleReleasePlan } = await import(
      cli.resolve("@changesets/assemble-release-plan")
    );
    const packages = await getPackages(root);
    const { config, errors } = await readConfig(root, packages);
    assert.equal(errors, undefined);
    const status = assembleReleasePlan(
      await readChangesets(root),
      packages,
      config,
    );
    const plan = componentPlanFromStatus(status, {
      ...input,
      manifestByName: (name) =>
        packages.packages.find((pkg) => pkg.packageJson.name === name)
          .packageJson,
      changesetBytes: (id) =>
        readFileSync(join(root, ".changeset", `${id}.md`)),
    });
    assert.deepEqual(
      plan.components.map(({ tag }) => tag),
      ["pilot@0.2.0", "private-library@0.1.1"],
    );
    assert.equal(npmRecordFromComponentPlan(plan), null);
    for (const pkg of packages.packages)
      assert.equal(
        JSON.parse(readFileSync(join(pkg.dir, "package.json"), "utf8")).version,
        "0.1.0",
      );
  });
});
