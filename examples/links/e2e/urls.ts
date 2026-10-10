import process from "node:process";

function port(value: string | undefined, fallback: number) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new Error("Invalid E2E port");
  const number = Number(value);
  if (number < 1024 || number > 65535) throw new Error("Invalid E2E port");
  return number;
}

if (
  (process.env.LINKS_E2E_PORT === undefined) !==
  (process.env.LINKS_E2E_ASSETS_PORT === undefined)
)
  throw new Error("Both E2E ports must be set together");

// The supported pnpm test:e2e entrypoint supplies a coordinated pair. Defaults
// retain compatibility with a single direct local Playwright invocation.
export const appPort = port(process.env.LINKS_E2E_PORT, 5174);
export const assetsPort = port(process.env.LINKS_E2E_ASSETS_PORT, 5175);
if (appPort === assetsPort) throw new Error("E2E servers need distinct ports");
export const origin = `http://127.0.0.1:${appPort}`;
export const assetsOrigin = `http://127.0.0.1:${assetsPort}`;
