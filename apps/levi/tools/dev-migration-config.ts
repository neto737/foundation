export function devMigrationTarget(
  env: NodeJS.ProcessEnv,
  operation: "apply" | "status" = "apply",
): string {
  try {
    const raw = env.LEVI_DEV_DATABASE_URL;
    if (!raw) throw new Error();
    const url = new URL(raw);
    const database = decodeURIComponent(url.pathname.slice(1));
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !/^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(url.hostname) ||
      url.hostname.split(".")[0]!.includes("-pooler") ||
      (url.port !== "" && url.port !== "5432") ||
      url.hash ||
      url.hostname !== env.LEVI_DEV_DATABASE_HOST ||
      database !== env.LEVI_DEV_DATABASE_NAME ||
      !/^levi_dev(?:_[a-z0-9_]+)?$/.test(database) ||
      decodeURIComponent(url.username) !== "levi_dev_migrator" ||
      !url.password ||
      url.searchParams.get("sslmode") !== "verify-full" ||
      [...url.searchParams.keys()].some((key) => key !== "sslmode") ||
      url.searchParams.getAll("sslmode").length !== 1 ||
      env.LEVI_DEV_MIGRATION_CONFIRMATION !==
        `${operation === "status" ? "CONSULTAR" : "APLICAR"}:${url.hostname}/${database}`
    )
      throw new Error();
    return raw;
  } catch {
    throw new Error(
      "Migração DEV recusada. Confira alvo Neon direto, banco levi_dev, role migrator, TLS e confirmação explícita.",
    );
  }
}
