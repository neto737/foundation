import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse } from "yaml";
import { runInNewContext } from "node:vm";
import {
  authenticatedJson,
  confirmation,
  digest,
  envelopeDigest,
  hash,
  names,
  reconcile,
  remainingPlan,
  validateContext,
  validateManifests,
  validatePacket,
  validatePr,
  validateRecord,
  validatePublishPlan,
  recordFromStatus,
} from "./release-core.mjs";

const sha = "a".repeat(40);
const record = () => ({
  format: 1,
  repository: "t00ls-dev/foundation",
  cliVersion: "3.0.3",
  baseSha: "b".repeat(40),
  changesets: [{ id: "patch-access", hash: "c".repeat(64) }],
  packages: [
    {
      name: names[0],
      oldVersion: "0.1.0",
      version: "0.1.1",
      type: "patch",
      changesets: ["patch-access"],
      reason: "changeset",
      dependencies: [],
    },
  ],
});
const context = () => ({
  event: "workflow_dispatch",
  ref: "refs/heads/master",
  repository: "t00ls-dev/foundation",
  sha,
  expectedSha: sha,
  masterSha: sha,
  mode: "publish",
  releasePr: 25,
  confirmation,
  planDigest: "d".repeat(64),
  auditRun: 100,
});
const pr = () => ({
  number: 25,
  state: "closed",
  merged: true,
  base: { ref: "master", repo: { full_name: "t00ls-dev/foundation" } },
  head: {
    ref: "changeset-release/master",
    repo: { full_name: "t00ls-dev/foundation" },
  },
  merge_commit_sha: sha,
  user: { login: "github-actions[bot]" },
});
const artifacts = () => [
  {
    name: names[0],
    version: "0.1.1",
    path: "packages/access.tgz",
    hash: "f".repeat(64),
    integrity: "sha512-YWJj",
    packIntegrity: "sha256-YWJj",
  },
];
const packet = () => ({
  format: 1,
  repository: "t00ls-dev/foundation",
  releasePr: 25,
  sha,
  record: record(),
  auditRun: 100,
  artifacts: artifacts(),
});
const registry = (versions = ["0.1.0"], latest = versions.at(-1)) => ({
  [names[0]]: {
    visibility: "private",
    repository: "t00ls-dev/foundation",
    versions,
    latest,
    integrities: { "0.1.1": "sha512-YWJj" },
  },
});
const invalid = (name, fn) => test(name, () => assert.throws(fn));

test("record generation from Changesets status is deterministic, without versioning", () => {
  const status = {
    changesets: [{ id: "patch-access" }],
    releases: [
      {
        name: names[0],
        type: "patch",
        oldVersion: "0.1.0",
        newVersion: "0.1.1",
        changesets: ["patch-access"],
      },
      {
        name: names[1],
        type: "patch",
        oldVersion: "0.1.0",
        newVersion: "0.1.1",
        changesets: [],
      },
      { name: "@t00ls-dev/integration-tests", type: "none" },
    ],
  };
  const input = {
    baseSha: sha,
    cliVersion: "3.0.3",
    changesetBytes: () => Buffer.from("fixture changeset"),
    manifestByName: (name) => ({
      version: "0.1.0",
      dependencies: name === names[1] ? { [names[0]]: "workspace:*" } : {},
    }),
  };
  const first = recordFromStatus(status, input);
  assert.equal(first.packages.length, 2);
  assert.equal(first.packages[1].reason, "internal-dependency");
  assert.equal(
    first.changesets[0].hash,
    hash(Buffer.from("fixture changeset")),
  );
  assert.deepEqual(
    recordFromStatus(
      { ...status, releases: [...status.releases].reverse() },
      input,
    ),
    first,
  );
});

test("valid manual authorization and stable deterministic digest", () => {
  validateContext(context(), true);
  validatePr(pr(), context(), record());
  assert.equal(digest({ b: 2, a: 1 }), digest({ a: 1, b: 2 }));
  const p = packet(),
    c = context();
  c.planDigest = envelopeDigest(p);
  validatePacket(p, c, record());
});
for (const [field, value] of [
  ["event", "push"],
  ["event", "pull_request"],
  ["ref", "refs/heads/feature"],
  ["sha", "c".repeat(40)],
  ["masterSha", "c".repeat(40)],
  ["expectedSha", "short"],
  ["confirmation", "wrong"],
  ["mode", "automatic"],
  ["auditRun", 0],
])
  invalid(`reject context ${field}=${value}`, () =>
    validateContext({ ...context(), [field]: value }, true),
  );
invalid("PR missing", () => validatePr(null, context(), record()));
invalid("PR nonexistent/different", () =>
  validatePr({ ...pr(), number: 26 }, context(), record()),
);
invalid("PR not merged", () =>
  validatePr({ ...pr(), merged: false }, context(), record()),
);
invalid("wrong PR base", () => {
  const p = pr();
  p.base.ref = "feature";
  validatePr(p, context(), record());
});
invalid("wrong merge SHA", () =>
  validatePr(
    { ...pr(), merge_commit_sha: "c".repeat(40) },
    context(),
    record(),
  ),
);
invalid("unexpected package", () => {
  const r = record();
  r.packages[0].name = "@t00ls-dev/unexpected";
  validateRecord(r);
});
invalid("private tooling in plan", () => {
  const r = record();
  r.packages[0].name = "@t00ls-dev/typescript-config";
  validateRecord(r);
});
invalid("version not authorized by bump", () => {
  const r = record();
  r.packages[0].version = "0.2.0";
  validateRecord(r);
});
invalid("unexplained derived bump", () => {
  const r = record();
  r.packages[0].reason = "internal-dependency";
  r.packages[0].changesets = [];
  validateRecord(r);
});
test("valid internal dependency propagation", () => {
  const r = record();
  r.packages.push({
    ...r.packages[0],
    name: names[1],
    reason: "internal-dependency",
    changesets: [],
    dependencies: [names[0]],
  });
  validateRecord(r);
});
invalid("digest divergent", () =>
  validatePacket(packet(), context(), record()),
);
invalid("computed Changesets plan differs", () =>
  validatePublishPlan(
    {
      version: 1,
      plan: [
        [
          {
            name: names[1],
            version: "0.1.1",
            kind: "publish",
            access: "restricted",
            tag: "latest",
          },
        ],
      ],
    },
    record().packages,
  ),
);
invalid("resume different plan", () => {
  const p = packet(),
    c = context();
  c.planDigest = envelopeDigest(p);
  const r = record();
  r.packages[0].version = "0.1.2";
  validatePacket(p, c, r);
});
invalid("different audit run", () => {
  const p = packet(),
    c = context();
  c.planDigest = envelopeDigest(p);
  c.auditRun++;
  validatePacket(p, c, record());
});
invalid("unsafe artifact path", () => {
  const p = packet(),
    c = context();
  p.artifacts[0].path = "../secret.tgz";
  c.planDigest = envelopeDigest(p);
  validatePacket(p, c, record());
});
invalid("registry inaccessible", () => reconcile(record(), {}));
invalid("registry malformed/auth failure", () =>
  reconcile(record(), { [names[0]]: { error: "unauthorized" } }),
);
test("HTTP/auth/network failures are never absence", async () => {
  for (const status of [401, 403, 404, 500])
    await assert.rejects(
      authenticatedJson(
        "https://example.invalid/registry",
        "fake-test-token",
        async () => ({ ok: false, status, json: async () => ({}) }),
      ),
    );
  await assert.rejects(
    authenticatedJson(
      "https://example.invalid/registry",
      "fake-test-token",
      async () => {
        throw new Error("network unavailable");
      },
    ),
  );
  await assert.rejects(
    authenticatedJson("https://example.invalid/registry", "", async () => {
      throw new Error("must not fetch");
    }),
  );
});
invalid("package public", () => {
  const i = registry();
  i[names[0]].visibility = "public";
  reconcile(record(), i);
});
invalid("downgrade", () =>
  remainingPlan(
    record(),
    reconcile(record(), registry(["0.1.0", "0.2.0"]), artifacts()),
    "resume",
  ),
);
invalid("already published in normal audit", () =>
  remainingPlan(
    record(),
    reconcile(record(), registry(["0.1.0", "0.1.1"]), artifacts()),
    "audit",
  ),
);
invalid("already published in initial publish", () =>
  remainingPlan(
    record(),
    reconcile(record(), registry(["0.1.0", "0.1.1"]), artifacts()),
    "publish",
  ),
);
invalid("published bytes differ", () => {
  const i = registry(["0.1.0", "0.1.1"]);
  i[names[0]].integrities["0.1.1"] = "sha512-other";
  remainingPlan(record(), reconcile(record(), i, artifacts()), "resume");
});
test("resume complete is reconciliation only", () =>
  assert.deepEqual(
    remainingPlan(
      record(),
      reconcile(record(), registry(["0.1.0", "0.1.1"]), artifacts()),
      "resume",
    ),
    [],
  ));
test("partial release publishes only absent remainder", () => {
  const r = record();
  r.packages.push({ ...r.packages[0], name: names[1] });
  const i = {
    ...registry(["0.1.0", "0.1.1"]),
    [names[1]]: registry()[names[0]],
  };
  const states = reconcile(r, i, artifacts());
  assert.deepEqual(
    states.map((item) => item.state),
    ["published", "absent"],
  );
  assert.deepEqual(
    remainingPlan(r, states, "resume").map((item) => item.name),
    [names[1]],
  );
});
invalid("resume registry divergence", () =>
  remainingPlan(
    record(),
    [{ name: names[0], version: "0.1.1", state: "divergent" }],
    "resume",
  ),
);
test("workspace policy and unauthorized version checks", () => {
  const manifests = names.map((name) => ({
    path: `packages/${name.split("/")[1]}`,
    pkg: {
      name,
      version: name === names[0] ? "0.1.1" : "0.1.0",
      license: "UNLICENSED",
      repository: "https://github.com/t00ls-dev/foundation",
      publishConfig: {
        registry: "https://npm.pkg.github.com",
        access: "restricted",
      },
      files: ["dist", "README.md"],
    },
  }));
  manifests.push({
    path: ".",
    pkg: { name: "@t00ls-dev/foundation", private: true },
  });
  validateManifests(manifests, record());
  manifests[0].pkg.version = "0.1.2";
  assert.throws(() => validateManifests(manifests, record()));
  manifests[0].pkg.version = "0.1.1";
  manifests.push({
    path: "tooling/config",
    pkg: { name: "@t00ls-dev/config-private" },
  });
  assert.throws(() => validateManifests(manifests, record()));
});

test("actual Changesets 3.0.3 pack-directory format works offline without publishing", () => {
  const temp = mkdtempSync(join(tmpdir(), "foundation-release-pack-test-"));
  try {
    const pkg = JSON.parse(
      readFileSync("packages/access/package.json", "utf8"),
    );
    const input = join(temp, "plan.json"),
      out = join(temp, "packed");
    writeFileSync(
      input,
      JSON.stringify({
        version: 1,
        plan: [
          [
            {
              kind: "publish",
              name: pkg.name,
              version: pkg.version,
              access: "restricted",
              tag: "latest",
            },
          ],
        ],
      }),
    );
    execFileSync(
      "pnpm",
      [
        "exec",
        "changeset",
        "pack",
        "--from-publish-plan",
        input,
        "--out-dir",
        out,
      ],
      { encoding: "utf8" },
    );
    const plan = JSON.parse(readFileSync(join(out, "publish-plan.json")));
    const entry = plan.plan.flat()[0];
    assert.equal(entry.name, pkg.name);
    assert.equal(entry.version, pkg.version);
    const bytes = readFileSync(join(out, entry.tarball.path));
    assert.equal(
      entry.tarball.integrity,
      `sha256-${hash(bytes, "sha256", "base64")}`,
    );
    assert(entry.tarball.path.startsWith("packages/"));
    const help = execFileSync(
      "pnpm",
      ["exec", "changeset", "publish", "--help"],
      { encoding: "utf8" },
    );
    assert(help.includes("--from-pack-dir") && help.includes("--git-tag"));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("workflow cannot publish on push or audit; only publisher has packages:write", () => {
  const workflow = parse(readFileSync(".github/workflows/release.yml", "utf8"));
  assert.deepEqual(Object.keys(workflow.on).sort(), [
    "push",
    "workflow_dispatch",
  ]);
  assert.equal(workflow.on.workflow_dispatch.inputs.mode.default, "audit");
  assert.equal(workflow.jobs.audit.permissions.packages, "read");
  assert.equal(workflow.jobs.preflight.permissions.packages, "read");
  assert.deepEqual(
    Object.entries(workflow.jobs)
      .filter(([, job]) => job.permissions?.packages === "write")
      .map(([name]) => name),
    ["publish"],
  );
  const condition = workflow.jobs.publish.if.replace(/\s+/g, " ");
  assert(
    condition.includes("github.event_name == 'workflow_dispatch'") &&
      condition.includes("github.ref == 'refs/heads/master'") &&
      condition.includes("needs.preflight.result == 'success'") &&
      condition.includes("inputs.mode == 'publish' || inputs.mode == 'resume'"),
  );
  assert(
    !workflow.jobs.version.steps.some((step) => step.with?.["publish-script"]),
  );
  assert(
    workflow.jobs.version.steps.some(
      (step) =>
        step.with?.["version-script"] ===
        "node .github/scripts/release-version.mjs",
    ),
  );
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  assert(workflow.jobs.publish.steps.some((step) => step.if === "always()"));
  const expression = condition.slice(3, -2).trim();
  const valid = {
    github: { event_name: "workflow_dispatch", ref: "refs/heads/master", sha },
    inputs: { mode: "publish", confirmation, expected_sha: sha },
    needs: { preflight: { result: "success" } },
  };
  assert.equal(runInNewContext(expression, valid, { timeout: 1000 }), true);
  for (const candidate of [
    { ...valid, github: { ...valid.github, event_name: "push" } },
    { ...valid, github: { ...valid.github, ref: "refs/heads/feature" } },
    { ...valid, inputs: { ...valid.inputs, mode: "audit" } },
    { ...valid, inputs: { ...valid.inputs, confirmation: "wrong" } },
    { ...valid, inputs: { ...valid.inputs, expected_sha: "b".repeat(40) } },
    { ...valid, needs: { preflight: { result: "failure" } } },
    { ...valid, needs: { preflight: { result: "skipped" } } },
  ])
    assert.equal(
      runInNewContext(expression, candidate, { timeout: 1000 }),
      false,
    );
});
