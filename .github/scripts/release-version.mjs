import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import {
  canonical,
  recordFromStatus,
  repository,
  shaPattern,
} from "./release-core.mjs";

// Invoked ONLY by the Changesets Action version-script. Tests do not invoke
// version, and publish/audit never call this script.
const require = createRequire(import.meta.url);
const cliVersion = require("@changesets/cli/package.json").version;
assert.equal(
  process.env.GITHUB_EVENT_NAME,
  "push",
  "Version script is only for the Changesets Action push job",
);
assert.equal(process.env.GITHUB_REF, "refs/heads/master");
assert.equal(process.env.GITHUB_REPOSITORY, repository);
assert(shaPattern.test(process.env.GITHUB_SHA ?? ""));
assert.equal(
  execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  process.env.GITHUB_SHA,
);

const temporary = mkdtempSync(join(tmpdir(), "foundation-version-plan-"));
try {
  const output = join(temporary, "status.json");
  execFileSync("pnpm", ["exec", "changeset", "status", "--output", output], {
    stdio: "inherit",
  });
  const status = JSON.parse(readFileSync(output, "utf8"));
  const record = recordFromStatus(status, {
    baseSha: process.env.GITHUB_SHA,
    cliVersion,
    changesetBytes: (id) => readFileSync(`.changeset/${id}.md`),
    manifestByName: (name) =>
      JSON.parse(
        readFileSync(`packages/${name.split("/")[1]}/package.json`, "utf8"),
      ),
  });
  execFileSync("pnpm", ["exec", "changeset", "version"], { stdio: "inherit" });
  writeFileSync(".changeset/release-plan.json", canonical(record) + "\n");
  execFileSync(
    "pnpm",
    ["exec", "prettier", "--write", ".changeset/release-plan.json"],
    { stdio: "inherit" },
  );
  // Update workspace dependency ranges in the lockfile without unrelated upgrades.
  execFileSync("pnpm", ["install", "--lockfile-only", "--offline"], {
    stdio: "inherit",
  });
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
