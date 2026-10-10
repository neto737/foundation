import { createServer } from "node:net";

function listen(port) {
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => socket.destroy());
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.removeListener("error", reject);
      resolve(server);
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

// Every invocation scans the same deterministic pool. The third TCP port is
// held for the entire Playwright process: the kernel releases it even on crash.
// Probing both app ports avoids external listeners; strict server binding still
// fails closed if an uncoordinated process takes an app port after the probe.
export async function leasePorts() {
  for (let slot = 0; slot < 64; slot++) {
    const port = 17100 + slot * 3;
    const held = [];
    try {
      held.push(await listen(port + 2));
      held.push(await listen(port));
      held.push(await listen(port + 1));
      await Promise.all(held.slice(1).map(close));
      return {
        port,
        assetsPort: port + 1,
        slot,
        release: () => close(held[0]),
      };
    } catch (error) {
      await Promise.all(held.map(close));
      if (error.code !== "EADDRINUSE") throw error;
    }
  }
  throw new Error("No free coordinated Playwright port pair (64 slots)");
}
