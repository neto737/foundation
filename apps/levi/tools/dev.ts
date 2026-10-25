import { spawn } from "node:child_process";

const env = { ...process.env, LEVI_PUBLIC_ORIGIN: "http://localhost:5173" };
const api = spawn(process.execPath, ["--import", "tsx", "src/local.ts"], {
  env,
  stdio: "inherit",
});
const web = spawn(process.execPath, ["node_modules/vite/bin/vite.js"], {
  env,
  stdio: "inherit",
});
let stopping = false;
function stop(code: number) {
  if (stopping) return;
  stopping = true;
  api.kill("SIGTERM");
  web.kill("SIGTERM");
  process.exitCode = code;
}
for (const child of [api, web]) {
  child.on("error", () => stop(1));
  child.on("exit", (code) => stop(code ?? 1));
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
