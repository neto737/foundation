import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, realpathSync, existsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { test } from "node:test";
import ts from "typescript";
import { parse } from "yaml";
import { workspaceManifests } from "./release-planning.mjs";
import { names } from "./release-core.mjs";

const root = resolve(import.meta.dirname, "../..");
const application = join(root, "apps/levi");
const source = "b2c892e27e3a8988f0be554692ffea43d35fcd61";
const shared = ["access", "audit", "auth", "db", "email", "security", "tenant"];
const json = (file) => JSON.parse(readFileSync(file, "utf8"));
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const files = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });

test("Levi privado resolve os sete pacotes locais sem ampliar o plano npm", () => {
  const manifests = workspaceManifests(root);
  assert.deepEqual(
    manifests
      .filter(({ pkg }) => !pkg.private)
      .map(({ pkg }) => pkg.name)
      .sort(),
    [...names].sort(),
  );
  const { pkg } = manifests.find(({ path }) => path === "apps/levi");
  assert.equal(pkg.name, "levi");
  assert.equal(pkg.version, "0.1.0");
  assert.equal(pkg.private, true);
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.packageManager, undefined);
  assert.equal(pkg.overrides, undefined);
  assert.equal(existsSync(join(application, "package-lock.json")), false);
  assert.deepEqual(
    Object.keys(pkg.dependencies)
      .filter((name) => name.startsWith("@t00ls-dev/"))
      .sort(),
    shared.map((name) => `@t00ls-dev/${name}`).sort(),
  );
  for (const name of shared) {
    assert.equal(pkg.dependencies[`@t00ls-dev/${name}`], "workspace:*");
    assert.equal(
      realpathSync(join(application, "node_modules/@t00ls-dev", name)),
      realpathSync(join(root, "packages", name)),
    );
  }
  assert.equal(
    json(join(application, "node_modules/better-auth/package.json")).version,
    json(join(root, "packages/auth/node_modules/better-auth/package.json"))
      .version,
  );
  assert.deepEqual(json(join(root, ".changeset/config.json")).privatePackages, {
    tag: false,
    version: false,
  });
});

test("build do Levi depende dos exports compilados dos sete pacotes", () => {
  const graph = JSON.parse(
    execFileSync(
      process.execPath,
      [
        join(root, "node_modules/turbo/bin/turbo"),
        "run",
        "build",
        "--filter=levi",
        "--dry=json",
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          TURBO_TELEMETRY_DISABLED: "1",
          TURBO_NO_UPDATE_NOTIFIER: "1",
        },
      },
    ),
  );
  const task = graph.tasks.find(({ taskId }) => taskId === "levi#build");
  for (const name of shared)
    assert(task.dependencies.includes(`@t00ls-dev/${name}#build`));
  assert.equal(
    graph.tasks.some(
      ({ package: name }) => name === "@t00ls-dev/example-links",
    ),
    false,
  );
});

test("subtree preserva os 35 commits e a árvore original sem squash", () => {
  const incorporation = "dfd1192b7b5e509878f65bec09228cb269d9cd82";
  assert.equal(git("rev-list", "--count", source), "35");
  git("merge-base", "--is-ancestor", incorporation, "HEAD");
  assert.equal(
    git("rev-parse", `${incorporation}^1`),
    "3f892412a3f223df7ea394720b3bfe5b149c01c6",
  );
  assert.equal(git("rev-parse", `${incorporation}^2`), source);
  assert.equal(
    git("rev-parse", `${incorporation}:apps/levi`),
    git("rev-parse", `${source}^{tree}`),
  );
});

test("imports de runtime do Levi ficam na aplicação ou nos exports públicos", () => {
  for (const file of [
    ...files(join(application, "src")),
    ...files(join(application, "web")),
  ]) {
    if (!/\.tsx?$/.test(file)) continue;
    const tree = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const inspect = (specifier) => {
      if (specifier.startsWith(".")) {
        assert(
          resolve(dirname(file), specifier).startsWith(application + sep),
          `Import fora do Levi: ${file}`,
        );
      } else if (specifier.startsWith("@t00ls-dev/")) {
        const [, name, ...parts] = specifier.split("/");
        assert(shared.includes(name));
        const manifest = json(join(root, "packages", name, "package.json"));
        assert(
          Object.hasOwn(
            manifest.exports,
            parts.length ? `./${parts.join("/")}` : ".",
          ),
        );
      }
      assert.equal(specifier.includes("examples/links"), false);
    };
    const visit = (node) => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        inspect(node.moduleSpecifier.text);
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      ) {
        assert.equal(node.arguments.length, 1);
        assert(
          ts.isStringLiteral(node.arguments[0]),
          "Import dinâmico precisa de fronteira verificável",
        );
        inspect(node.arguments[0].text);
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
});

test("CI do Levi não recebe Environment, secrets ou entrada operacional", () => {
  const ci = parse(
    readFileSync(join(root, ".github/workflows/ci.yml"), "utf8"),
  );
  for (const name of ["levi-tests", "levi-e2e"]) {
    const job = ci.jobs[name];
    assert.equal(job.environment, undefined);
    assert.equal(JSON.stringify(job).includes("secrets."), false);
    assert.equal(JSON.stringify(job).includes("deploy:dev"), false);
    assert.equal(JSON.stringify(job).includes("db:migrate:dev"), false);
    assert(ci.jobs.checks.needs.includes(name));
  }
  const deploy = parse(
    readFileSync(join(root, ".github/workflows/deploy-dev.yml"), "utf8"),
  );
  assert.deepEqual(Object.keys(deploy.on), ["workflow_dispatch"]);
  assert.equal(
    existsSync(join(root, ".github/workflows/levi-deploy-dev.yml")),
    false,
  );
});
