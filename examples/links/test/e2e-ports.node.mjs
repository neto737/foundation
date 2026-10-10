import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import process from "node:process";
import { URL } from "node:url";
import test from "node:test";
import { leasePorts } from "../e2e/ports.mjs";

test("concurrent leases never share an app, assets or coordination port", async () => {
  const leases = await Promise.all([leasePorts(), leasePorts(), leasePorts()]);
  try {
    const ports = leases.flatMap((lease) => [
      lease.port,
      lease.assetsPort,
      lease.port + 2,
    ]);
    assert.equal(new Set(ports).size, 9);
  } finally {
    await Promise.all(leases.map((lease) => lease.release()));
  }
});

test("an external listener makes the allocator skip the whole pair", async () => {
  const initial = await leasePorts();
  const occupiedPort = initial.port;
  await initial.release();
  const external = createServer();
  external.listen(occupiedPort, "127.0.0.1");
  await once(external, "listening");
  try {
    const lease = await leasePorts();
    assert.notEqual(lease.port, occupiedPort);
    await lease.release();
  } finally {
    await new Promise((resolve) => external.close(resolve));
  }
});

test("SIGKILL releases the kernel lease without stale lock cleanup", async () => {
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import {leasePorts} from ${JSON.stringify(new URL("../e2e/ports.mjs", import.meta.url).href)}; const lease=await leasePorts(); console.log(lease.port);`,
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  try {
    const [output] = await once(child.stdout, "data");
    const port = Number(output.toString().trim());
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
    const lease = await leasePorts();
    assert.equal(lease.port, port);
    await lease.release();
  } finally {
    child.kill("SIGKILL");
  }
});
