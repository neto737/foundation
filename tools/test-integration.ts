import { execFileSync, spawnSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Somente este container recém-criado é usado e removido. Sem banco externo.
const image =
  "postgres:17-alpine@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73";
const container = execFileSync(
  "docker",
  [
    "run",
    "--rm",
    "--detach",
    "--label",
    "levi.integration=true",
    "--publish",
    "127.0.0.1::5432",
    "--env",
    "POSTGRES_DB=levi_test",
    "--env",
    "POSTGRES_USER=levi_test",
    "--env",
    "POSTGRES_PASSWORD=synthetic-only",
    image,
  ],
  { encoding: "utf8" },
).trim();
let mailDirectory: string | undefined;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = spawnSync(
      "docker",
      ["exec", container, "pg_isready", "-U", "levi_test", "-d", "levi_test"],
      { stdio: "ignore" },
    );
    if (result.status === 0) {
      ready = true;
      break;
    }
    await setTimeout(100);
  }
  if (!ready) throw new Error("O PostgreSQL descartável não ficou disponível.");
  const mapping = execFileSync("docker", ["port", container, "5432/tcp"], {
    encoding: "utf8",
  }).trim();
  const port = mapping.split(":").at(-1);
  const env = {
    ...process.env,
    NODE_ENV: "test",
    LEVI_DATABASE_URL: `postgresql://levi_test:synthetic-only@127.0.0.1:${port}/levi_test`,
    LEVI_LOCAL_DATABASE: "1",
  };
  function run(args: string[]) {
    const result = spawnSync(process.execPath, ["--import", "tsx", ...args], {
      env,
      stdio: "inherit",
    });
    if (result.status !== 0)
      throw new Error("A validação de integração falhou.");
  }
  run(["tools/migrate.ts"]);
  run(["tools/migrate.ts"]); // reaplicação do journal deve ser inócua
  if (process.argv.includes("--browser")) {
    mailDirectory = await mkdtemp(join(tmpdir(), "levi-browser-"));
    const result = spawnSync(
      process.execPath,
      [
        "node_modules/@playwright/test/cli.js",
        "test",
        ...process.argv.slice(process.argv.indexOf("--browser") + 1),
      ],
      {
        env: { ...env, LEVI_TEST_MAIL_DIR: mailDirectory },
        stdio: "inherit",
      },
    );
    if (result.status !== 0)
      throw new Error("A validação no navegador falhou.");
  } else run(["--test", "--test-concurrency=1", "test/integration.test.ts"]);
} finally {
  execFileSync("docker", ["stop", container], { stdio: "ignore" });
  if (mailDirectory) await rm(mailDirectory, { recursive: true, force: true });
}
