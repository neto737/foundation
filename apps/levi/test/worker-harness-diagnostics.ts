const transportCodes = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "EPIPE",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ERR_RUNTIME_FAILURE",
  "ERR_DISPOSED",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_ABORTED",
]);

// Only fixed test routes are printable. Never emit query strings or identifiers.
const diagnosticPaths = new Set([
  "/admin",
  "/admin/",
  "/admin/outro",
  "/api/admin",
  "/api/admin/features",
  "/%61dmin",
  "/api/%61dmin",
  "/api/admin%2ffeatures",
  "/api/admin/session",
  "/api/admin/accounts/find",
  "/api/onboarding",
  "/api/onboarding/email",
  "/api/onboarding/password",
  "/api/onboarding/password-email",
  "/api/organizations",
  "/api/churches",
  "/api/context",
  "/api/members",
]);

export function workerRequestContext(url: string, method: string) {
  let path = "[redacted]";
  try {
    const pathname = new URL(url).pathname;
    if (diagnosticPaths.has(pathname)) path = pathname;
  } catch {
    // Diagnostics must not replace the original dispatch validation error.
  }
  return {
    method: [
      "GET",
      "HEAD",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ].includes(method.toUpperCase())
      ? method.toUpperCase()
      : "[redacted]",
    path,
  };
}

type Operation =
  | { phase: "create" | "ready" | "dispose"; runtimeId: number }
  | {
      phase: "dispatch";
      runtimeId: number;
      requestId: number;
      request: ReturnType<typeof workerRequestContext>;
    }
  | {
      phase: "cleanup";
      resource: "runtime" | "observer" | "fixture" | "restore-fixture";
    };

export async function workerOperation<T>(
  context: Operation,
  operation: () => T | Promise<T>,
): Promise<T> {
  const start = performance.now();
  try {
    return await operation();
  } catch (error) {
    // Neither arbitrary error messages/stacks nor request headers/bodies are safe.
    // Rethrow the exact original value; diagnostics are supplementary only.
    try {
      const codes: string[] = [];
      const visited = new Set<unknown>();
      let cause: unknown = error;
      while (
        cause &&
        typeof cause === "object" &&
        !visited.has(cause) &&
        codes.length < 5
      ) {
        visited.add(cause);
        codes.push(
          "code" in cause &&
            typeof cause.code === "string" &&
            transportCodes.has(cause.code)
            ? cause.code
            : "unknown",
        );
        cause = "cause" in cause ? cause.cause : undefined;
      }
      console.error(
        JSON.stringify({
          event: "levi.worker-harness.failure",
          ...context,
          durationMs: Math.round(performance.now() - start),
          codes,
        }),
      );
    } catch {
      // Even a diagnostic write failure must preserve the operation's error.
    }
    throw error;
  }
}

type Cleanup = {
  resource: Extract<Operation, { phase: "cleanup" }>["resource"];
  close: () => unknown;
};

export async function withWorkerCleanup<T>(
  operation: () => T | Promise<T>,
  resources: Cleanup[],
): Promise<T> {
  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    outcome = { ok: true, value: await operation() };
  } catch (error) {
    outcome = { ok: false, error };
  }
  // Start every cleanup, including when another close rejects or stays pending.
  const results = await Promise.allSettled(
    resources.map(({ resource, close }) =>
      workerOperation({ phase: "cleanup", resource }, close),
    ),
  );
  if (!outcome.ok) throw outcome.error;
  const failures: unknown[] = [];
  for (const result of results) {
    if (result.status === "rejected") failures.push(result.reason);
  }
  if (failures.length)
    throw new AggregateError(failures, "Falha na limpeza do harness Worker.");
  return outcome.value;
}
