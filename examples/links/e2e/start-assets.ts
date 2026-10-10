// Exercise the built production Worker and real Workers Assets routing, not
// Vite's development HTML transform or the test-only authentication entrypoint.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import type * as Urls from "./urls.js";
// This entrypoint runs directly in Node's strip-types mode, without a bundler.
const { assetsPort } = (await import(
  new URL("./urls.ts", import.meta.url).href
)) as typeof Urls;

const state = await mkdtemp(join(tmpdir(), "links-assets-e2e-"));
const worker = spawn(
  "pnpm",
  [
    "exec",
    "wrangler",
    "dev",
    "--config",
    "dist/foundation/wrangler.json",
    "--port",
    String(assetsPort),
    "--ip",
    "127.0.0.1",
    "--inspector-port",
    "0",
    "--persist-to",
    state,
    "--var",
    "TURNSTILE_SITE_KEY:fixture-public",
    "--var",
    "TURNSTILE_SECRET_KEY:fixture-server-only",
  ],
  { stdio: "inherit" },
);
process.once("SIGTERM", () => worker.kill("SIGTERM"));
process.once("SIGINT", () => worker.kill("SIGINT"));
worker.once("exit", (code) => {
  void rm(state, { recursive: true, force: true }).then(() =>
    process.exit(code ?? 0),
  );
});
