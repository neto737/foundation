import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const packageNames = [
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
const expected = packageNames.map((name) => `@t00ls-dev/${name}@0.1.0`);
const registry = "https://npm.pkg.github.com";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function manifest(directory) {
  return JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
}

function verifyManifests() {
  const dirs = readdirSync("packages", { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert(
    JSON.stringify(dirs) === JSON.stringify(packageNames.toSorted()),
    "Unexpected packages/* workspace; review the bootstrap allowlist",
  );

  for (const name of packageNames) {
    const pkg = manifest(join("packages", name));
    assert(pkg.name === `@t00ls-dev/${name}`, `Invalid name: ${name}`);
    assert(
      pkg.version === "0.1.0" && !pkg.private,
      `Invalid version/privacy: ${name}`,
    );
    assert(pkg.license === "UNLICENSED", `Invalid license: ${name}`);
    assert(
      pkg.repository === "https://github.com/t00ls-dev/foundation",
      `Invalid repository: ${name}`,
    );
    assert(
      pkg.publishConfig?.registry === registry &&
        pkg.publishConfig.access === "restricted",
      `Invalid publishConfig: ${name}`,
    );
    assert(
      JSON.stringify(pkg.files) === JSON.stringify(["dist", "README.md"]),
      `Invalid files: ${name}`,
    );
    assert(
      pkg.exports && Object.keys(pkg.exports).length > 0,
      `Missing exports: ${name}`,
    );
    for (const [subpath, entry] of Object.entries(pkg.exports)) {
      assert(
        entry.types?.startsWith("./dist/") &&
          entry.default?.startsWith("./dist/"),
        `Invalid export: ${name}/${subpath}`,
      );
      assert(
        existsSync(join("packages", name, entry.types)) &&
          existsSync(join("packages", name, entry.default)),
        `Missing build output: ${name}/${subpath}`,
      );
    }
    for (const [dependency, range] of Object.entries({
      ...pkg.dependencies,
      ...pkg.optionalDependencies,
      ...pkg.peerDependencies,
    })) {
      assert(
        !dependency.startsWith("@t00ls-dev/") &&
          !range.startsWith("workspace:"),
        `Unpublishable runtime dependency: ${name}/${dependency}`,
      );
    }
  }

  for (const group of ["tooling", "examples", "tests"]) {
    for (const entry of readdirSync(group, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      assert(
        manifest(join(group, entry.name)).private === true,
        `Public workspace: ${group}/${entry.name}`,
      );
    }
  }
  assert(manifest(".").private === true, "Repository root must stay private");
  assert(
    readdirSync(".changeset").every((name) => !name.endsWith(".md")),
    "Pending changesets block bootstrap",
  );
  console.log(
    "Manifests: exactly nine public 0.1.0 packages; all other workspaces private; no changesets",
  );
}

async function fetchJson(url, token) {
  const response = await fetch(url, {
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "User-Agent": "foundation-bootstrap-audit",
    },
  });
  return { status: response.status, data: await response.json() };
}

async function verifyContext() {
  assert(
    process.env.GITHUB_EVENT_NAME === "workflow_dispatch",
    "Bootstrap requires workflow_dispatch",
  );
  assert(
    process.env.GITHUB_REF === "refs/heads/master",
    "Bootstrap requires master",
  );
  assert(
    process.env.GITHUB_REPOSITORY === "t00ls-dev/foundation",
    "Unexpected repository",
  );
  assert(
    process.env.BOOTSTRAP_CONFIRMATION ===
      "PUBLISH_NINE_PRIVATE_PACKAGES_0.1.0",
    "Incorrect bootstrap confirmation",
  );
  const sha = process.env.BOOTSTRAP_EXPECTED_SHA;
  assert(
    /^[0-9a-f]{40}$/.test(sha ?? ""),
    "Expected master SHA must be a full 40-character commit SHA",
  );
  assert(
    sha === process.env.GITHUB_SHA,
    "Workflow SHA differs from expected master SHA",
  );
  const token = process.env.GITHUB_TOKEN;
  assert(token, "GITHUB_TOKEN required");
  const repo = await fetchJson(
    "https://api.github.com/repos/t00ls-dev/foundation",
    token,
  );
  assert(
    repo.status === 200 &&
      repo.data.private === true &&
      repo.data.default_branch === "master",
    "Repository token or privacy check failed",
  );
  const ref = await fetchJson(
    "https://api.github.com/repos/t00ls-dev/foundation/git/ref/heads/master",
    token,
  );
  assert(
    ref.status === 200 && ref.data.object?.sha === sha,
    "Master moved since dispatch; stop and audit again",
  );
  console.log(`Context: authenticated private repository, master at ${sha}`);
}

async function verifyRegistry() {
  const token = process.env.NODE_AUTH_TOKEN;
  assert(token, "NODE_AUTH_TOKEN required for authenticated registry checks");
  for (const name of packageNames) {
    const { status, data } = await fetchJson(
      `${registry}/@t00ls-dev%2F${name}`,
      token,
    );
    assert(
      status === 404 &&
        data.error ===
          `npm package "${name}" does not exist under owner "t00ls-dev"`,
      `Registry did not confirm absence of @t00ls-dev/${name} (HTTP ${status})`,
    );
  }
  console.log(
    "Registry: authenticated queries report all nine packages absent",
  );
}

function verifyPlan(filename) {
  const { version, plan } = JSON.parse(readFileSync(filename, "utf8"));
  assert(
    version === 1 && Array.isArray(plan),
    "Unexpected Changesets plan format",
  );
  const entries = plan.flat();
  assert(
    entries.length === 9,
    `Expected nine plan entries, got ${entries.length}`,
  );
  const names = entries.map((entry) => {
    assert(
      entry.kind === "publish" &&
        entry.access === "restricted" &&
        entry.tag === "latest",
      `Unexpected plan entry: ${entry.name}`,
    );
    return `${entry.name}@${entry.version}`;
  });
  assert(
    JSON.stringify(names.sort()) === JSON.stringify(expected.toSorted()),
    "Publish plan does not match exactly the nine 0.1.0 packages",
  );
  console.log(
    "Changesets publish plan: exactly nine first-time 0.1.0 releases",
  );
}

function verifyTarballs(directory) {
  const tarballs = readdirSync(directory).sort();
  assert(
    tarballs.length === 9,
    `Expected nine tarballs, got ${tarballs.length}`,
  );
  for (const name of packageNames) {
    const filename = join(directory, `t00ls-dev-${name}-0.1.0.tgz`);
    assert(existsSync(filename), `Missing tarball: ${name}`);
    const paths = execFileSync("tar", ["-tzf", filename], { encoding: "utf8" })
      .trim()
      .split("\n")
      .map((path) => path.replace(/^package\//, ""));
    const files = new Set(paths);
    const packed = JSON.parse(
      execFileSync("tar", ["-xOzf", filename, "package/package.json"], {
        encoding: "utf8",
      }),
    );
    assert(
      packed.name === `@t00ls-dev/${name}` &&
        packed.version === "0.1.0" &&
        !packed.private &&
        packed.license === "UNLICENSED",
      `Invalid packed manifest: ${name}`,
    );
    assert(
      packed.publishConfig?.registry === registry &&
        packed.publishConfig.access === "restricted",
      `Invalid packed registry: ${name}`,
    );
    for (const [subpath, entry] of Object.entries(packed.exports)) {
      assert(
        files.has(entry.types.slice(2)) && files.has(entry.default.slice(2)),
        `Missing tarball export: ${name}/${subpath}`,
      );
    }
    for (const range of Object.values(packed.dependencies ?? {}))
      assert(
        !range.startsWith("workspace:"),
        `Runtime workspace dependency: ${name}`,
      );
    for (const file of paths)
      assert(
        /^(dist\/.*\.(js|d\.ts|d\.ts\.map)|README\.md|package\.json)$/.test(
          file,
        ),
        `Unexpected tarball file: ${name}/${file}`,
      );
  }
  console.log(
    "Tarballs: exactly nine 0.1.0 packages with valid JS/TS exports and no extra files",
  );
}

try {
  const [mode, argument] = process.argv.slice(2);
  if (mode === "context") await verifyContext();
  else if (mode === "manifests") verifyManifests();
  else if (mode === "registry") await verifyRegistry();
  else if (mode === "plan") verifyPlan(argument);
  else if (mode === "tarballs") verifyTarballs(argument);
  else
    throw new Error("Expected context, manifests, registry, plan or tarballs");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
