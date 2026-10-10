import { spawn } from "node:child_process";
import { log } from "node:console";
import { createRequire } from "node:module";
import process from "node:process";
import { leasePorts } from "./ports.mjs";

const require = createRequire(import.meta.url);
const lease = await leasePorts();
log(
  `Playwright port lease: slot=${lease.slot}, app=${lease.port}, assets=${lease.assetsPort}`,
);
try {
  const child = spawn(
    process.execPath,
    [require.resolve("@playwright/test/cli"), "test", ...process.argv.slice(2)],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        LINKS_E2E_PORT: String(lease.port),
        LINKS_E2E_ASSETS_PORT: String(lease.assetsPort),
      },
    },
  );
  const forward = (signal) => child.kill(signal);
  const term = () => forward("SIGTERM");
  const interrupt = () => forward("SIGINT");
  process.on("SIGTERM", term);
  process.on("SIGINT", interrupt);
  try {
    process.exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) =>
        resolve(code ?? (signal === "SIGINT" ? 130 : 143)),
      );
    });
  } finally {
    process.off("SIGTERM", term);
    process.off("SIGINT", interrupt);
  }
} finally {
  await lease.release();
}
