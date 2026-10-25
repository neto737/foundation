import { readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import type { Miniflare } from "miniflare";

// Somente o host de testes lê /proc e o inspector. Nada é importado pelo Worker.
export async function resourceProbe(mf: Miniflare) {
  let pid: string | undefined;
  for (const name of await readdir("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const status = await readFile(`/proc/${name}/status`, "utf8");
      if (
        /^Name:\s+workerd$/m.test(status) &&
        status.match(/^PPid:\s+(\d+)$/m)?.[1] === String(process.pid)
      ) {
        if (pid) throw new Error("Mais de um runtime; medição ambígua.");
        pid = name;
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Mais de um runtime; medição ambígua."
      )
        throw error;
    }
  }
  if (!pid) throw new Error("Processo workerd não localizado para a medição.");
  const hz = Number(
    execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).trim(),
  );
  const inspector = await mf.getInspectorURL();
  if (inspector.protocol === "ws:") inspector.protocol = "http:";
  if (inspector.protocol === "wss:") inspector.protocol = "https:";
  const targets = (await (
    await fetch(new URL("/json/list", inspector))
  ).json()) as Array<{
    title: string;
    url: string;
    webSocketDebuggerUrl: string;
  }>;
  const target = targets.find((item) =>
    (item.title + item.url).includes("levi-worker-test"),
  );
  if (!target) throw new Error("Inspector do Worker não localizado.");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener(
      "error",
      () => reject(new Error("Inspector indisponível.")),
      { once: true },
    );
  });
  let sequence = 0;
  const pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  socket.addEventListener("message", (event) => {
    const value = JSON.parse(String(event.data)) as {
      id?: number;
      result?: unknown;
      error?: unknown;
    };
    if (value.id) {
      const handler = pending.get(value.id);
      if (value.error)
        handler?.reject(new Error("Métrica do inspector indisponível."));
      else handler?.resolve(value.result);
      pending.delete(value.id);
    }
  });
  const command = (method: string) =>
    new Promise<unknown>((resolve, reject) => {
      const id = ++sequence;
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error("Tempo limite do inspector."));
      }, 10_000);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      socket.send(JSON.stringify({ id, method }));
    });
  const stats = async () => {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const status = await readFile(`/proc/${pid}/status`, "utf8");
    return {
      cpuMs: ((Number(fields[11]) + Number(fields[12])) * 1000) / hz,
      rssKiB: Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1]),
      peakRssKiB: Number(status.match(/^VmHWM:\s+(\d+)/m)?.[1]),
    };
  };
  return {
    close: () => socket.close(),
    async measure(operation: string, run: () => Promise<Response>) {
      const heapBefore = (await command("Runtime.getHeapUsage")) as {
        usedSize: number;
        totalSize: number;
      };
      const before = await stats();
      const start = performance.now();
      const response = await run();
      await response.arrayBuffer();
      const latency = performance.now() - start;
      const after = await stats();
      const heapAfter = (await command("Runtime.getHeapUsage")) as {
        usedSize: number;
        totalSize: number;
      };
      if (response.status !== 200)
        throw new Error("A operação de senha medida falhou.");
      return {
        operation,
        status: response.status,
        latencyMs: Math.round(latency * 100) / 100,
        workerdProcessCpuMs: after.cpuMs - before.cpuMs,
        cpuResolutionMs: 1000 / hz,
        heapBeforeBytes: heapBefore.usedSize,
        heapAfterBytes: heapAfter.usedSize,
        heapCapacityBytes: heapAfter.totalSize,
        rssKiB: after.rssKiB,
        processPeakRssKiB: after.peakRssKiB,
      };
    },
  };
}
