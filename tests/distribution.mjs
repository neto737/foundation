import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";

// This test never publishes. Foundation is installed exclusively from tarballs,
// outside the workspace, with no paths/baseUrl or workspace dependency resolution.
const root = resolve(import.meta.dirname, "..");
const temporary = mkdtempSync(join(tmpdir(), "foundation-distribution-"));
const artifacts = join(temporary, "artifacts");
mkdirSync(artifacts);
const names = [
  "access",
  "audit",
  "auth",
  "config",
  "db",
  "email",
  "observability",
  "security",
  "tenant",
];
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const run = (command, args, cwd = root) =>
  execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
const save = (directory, name, value) =>
  writeFileSync(join(directory, name), value);

function diagnostics(directory, file, emit = false) {
  return JSON.parse(
    run(process.execPath, [
      join(root, "tests/distribution-typecheck.mjs"),
      directory,
      file,
      ...(emit ? ["emit"] : []),
    ]),
  );
}

function fingerprint(diagnostic) {
  const file = realpathSync(diagnostic.file);
  // Diagnostic text can order/truncate union members differently depending on
  // import order. Require the same upstream file, exact position and error code.
  return `${file}:${diagnostic.start}:${diagnostic.code}`;
}

try {
  const pnpm = process.env.npm_execpath;
  assert(pnpm, "Run this test using pnpm test:distribution");
  run(process.execPath, [
    pnpm,
    "--filter",
    "./packages/*",
    "-r",
    "pack",
    "--pack-destination",
    artifacts,
  ]);
  assert.equal(readdirSync(artifacts).length, 9);
  const manifests = names.map((name) => {
    const source = json(join(root, "packages", name, "package.json"));
    const tarball = join(artifacts, `t00ls-dev-${name}-${source.version}.tgz`);
    const entries = run("tar", ["-tvzf", tarball]);
    assert(
      !entries.split("\n").some((line) => /^[lh]/.test(line)),
      "No symlinks/hardlinks in tarballs",
    );
    const files = new Set(
      run("tar", ["-tzf", tarball])
        .trim()
        .split("\n")
        .map((file) => file.replace(/^package\//, "")),
    );
    const packed = JSON.parse(
      run("tar", ["-xOzf", tarball, "package/package.json"]),
    );
    assert.equal(packed.name, source.name);
    assert.equal(packed.version, source.version);
    assert.equal(packed.license, "UNLICENSED");
    for (const field of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ]) {
      assert(!packed[field]?.["@t00ls-dev/typescript-config"]);
      for (const range of Object.values(packed[field] ?? {}))
        assert(
          !/^(workspace:|file:|link:)/.test(range),
          `${name}: invalid ${field}`,
        );
    }
    for (const entry of Object.values(packed.exports)) {
      assert(
        files.has(entry.types.slice(2)) && files.has(entry.default.slice(2)),
      );
    }
    for (const file of files) {
      assert(
        /^(dist\/.*\.(js|d\.ts)|README\.md|package\.json)$/.test(file),
        `${name}: unexpected file ${file}`,
      );
      if (file.endsWith(".d.ts")) {
        const declaration = run("tar", ["-xOzf", tarball, `package/${file}`]);
        assert(
          !declaration.includes("sourceMappingURL") &&
            !declaration.includes(root),
        );
      }
    }
    console.log(
      `${source.name}@${source.version}: ${files.size} files; metadata/exports/maps OK`,
    );
    return { source, tarball };
  });

  const entrypoints = manifests.flatMap(({ source }) =>
    Object.keys(source.exports).map(
      (subpath) => source.name + (subpath === "." ? "" : subpath.slice(1)),
    ),
  );
  for (let attempt = 1; attempt <= 2; attempt++) {
    const consumer = join(temporary, `consumer-${attempt}`);
    mkdirSync(consumer);
    // Pin the tested dependency versions, not patched copies. No third-party
    // declarations are changed; their diagnostics are compared to direct imports.
    const dependencies = Object.fromEntries(
      manifests.map(({ source, tarball }) => [source.name, tarball]),
    );
    save(
      consumer,
      "package.json",
      JSON.stringify({
        private: true,
        type: "module",
        dependencies,
        devDependencies: { "typescript": ts.version, "@types/node": "22.20.4" },
        overrides: {
          "drizzle-orm": "0.45.2",
          "better-auth": "1.7.6",
          "@cloudflare/workers-types": "5.20260922.1",
        },
      }),
    );
    run(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--registry=https://registry.npmjs.org",
      ],
      consumer,
    );
    const require = createRequire(join(consumer, "package.json"));
    for (const entry of entrypoints)
      assert(
        realpathSync(require.resolve(entry)).startsWith(consumer + "/"),
        `Workspace leak: ${entry}`,
      );
    assert.throws(() => require.resolve("@t00ls-dev/typescript-config"));

    // These entrypoints must pass genuinely strict tsc with zero diagnostics,
    // without loading Cloudflare ambient globals in the consumer tsconfig.
    const core = [
      "@t00ls-dev/access",
      "@t00ls-dev/audit",
      "@t00ls-dev/audit/d1",
      "@t00ls-dev/audit/postgres",
      "@t00ls-dev/db",
      "@t00ls-dev/email",
      "@t00ls-dev/observability",
      "@t00ls-dev/tenant",
      "@t00ls-dev/tenant/d1",
      "@t00ls-dev/tenant/postgres",
      "@t00ls-dev/security",
      "@t00ls-dev/config",
    ];
    save(
      consumer,
      "core.ts",
      core
        .map(
          (entry, index) =>
            `import * as p${index} from ${JSON.stringify(entry)};\nexport { p${index} };`,
        )
        .join("\n"),
    );
    const strict = diagnostics(consumer, "core.ts");
    assert.equal(strict.length, 0, JSON.stringify(strict, null, 2));
    console.log(
      `Clean installation ${attempt}: core + audit/tenant D1 strict typecheck PASS (skipLibCheck:false)`,
    );

    save(
      consumer,
      "all.ts",
      entrypoints
        .map(
          (entry, index) =>
            `import * as p${index} from ${JSON.stringify(entry)};\nexport { p${index} };`,
        )
        .join("\n") +
        '\nimport type { D1Database } from "@cloudflare/workers-types";\n' +
        'import { createD1Database } from "@t00ls-dev/db/d1";\n' +
        'import { createD1AuditStore } from "@t00ls-dev/audit/d1";\n' +
        'import { createD1TenantRepository } from "@t00ls-dev/tenant/d1";\n' +
        "export function publicD1Calls(binding: D1Database) { return [createD1Database(binding), createD1AuditStore(binding), createD1TenantRepository(binding)]; }\n",
    );
    save(
      consumer,
      "upstream.ts",
      '/// <reference types="@cloudflare/workers-types" />\nimport * as d1 from "drizzle-orm/d1";\nimport * as pg from "drizzle-orm/postgres-js";\nimport * as sqlite from "drizzle-orm/sqlite-core";\nimport * as schema from "drizzle-orm/pg-core";\nimport * as auth from "better-auth";\nexport { d1, pg, sqlite, schema, auth };\n',
    );
    const complete = diagnostics(consumer, "all.ts");
    const upstream = diagnostics(consumer, "upstream.ts");
    const baseline = new Set(upstream.filter((d) => d.file).map(fingerprint));
    for (const error of complete) {
      assert(error.file, "No unresolved compiler configuration diagnostics");
      assert(
        !error.file.includes("@t00ls-dev/"),
        `Foundation declaration error: ${error.message}`,
      );
      assert(
        !/Cannot find name 'D1/.test(error.message),
        "D1 globals must be self-contained even through Drizzle",
      );
      assert(
        baseline.has(fingerprint(error)),
        `Diagnostic not reproduced by direct third-party imports: ${fingerprint(error)}`,
      );
    }
    console.log(
      `All entrypoints: ${complete.length} upstream-only diagnostics reproduced by direct dependency imports (skipLibCheck:false); zero Foundation/D1 missing-global errors`,
    );
    save(consumer, "diagnostics.json", JSON.stringify(complete, null, 2));
    // Emit without suppressing declaration checks; tsc may return diagnostics
    // already proved upstream-only. Runtime remains tested from the real output.
    const emitted = diagnostics(consumer, "all.ts", true);
    assert.deepEqual(emitted, complete);
    run(process.execPath, [join(consumer, "dist", "all.js")], consumer);
    save(
      consumer,
      "runtime.mjs",
      'import assert from "node:assert/strict";\nimport { createD1AuditStore } from "@t00ls-dev/audit/d1";\nimport { createD1Database } from "@t00ls-dev/db/d1";\nimport { createD1TenantRepository } from "@t00ls-dev/tenant/d1";\nconst db = { prepare: () => ({ bind() { return this; }, run: async () => ({ success: true }), first: async () => null }) };\nassert.equal(createD1Database(db).$client, db);\nassert.equal(await createD1TenantRepository(db).findMembership("u", "t"), null);\nassert.equal(typeof createD1AuditStore(db).append, "function");\n',
    );
    run(process.execPath, [join(consumer, "runtime.mjs")], consumer);
    console.log(
      `Clean installation ${attempt}: build, all ${entrypoints.length} public imports and D1 runtime PASS`,
    );
  }
  console.log(`Artifacts and diagnostic evidence: ${temporary}`);
} catch (error) {
  console.error(`Distribution test failed; evidence retained at ${temporary}`);
  if (error.stderr) console.error(error.stderr.toString());
  throw error;
}
