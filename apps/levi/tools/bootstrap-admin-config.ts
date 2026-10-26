/** Não cria roles, não migra e não aceita pooler/Hyperdrive. */
export function bootstrapTarget(env: NodeJS.ProcessEnv): string {
  try {
    const raw = env.LEVI_ADMIN_DATABASE_URL;
    if (!raw) throw new Error();
    const url = new URL(raw);
    const database = decodeURIComponent(url.pathname.slice(1));
    const localTest =
      env.NODE_ENV === "test" &&
      env.LEVI_LOCAL_DATABASE === "1" &&
      url.hostname === "127.0.0.1" &&
      database === "levi_test" &&
      url.port !== "" &&
      url.search === "";
    const neonDev =
      /^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(url.hostname) &&
      !url.hostname.split(".")[0]?.includes("-pooler") &&
      (url.port === "" || url.port === "5432") &&
      /^levi_dev(?:_[a-z0-9_]+)?$/.test(database) &&
      url.searchParams.getAll("sslmode").length === 1 &&
      url.searchParams.get("sslmode") === "verify-full" &&
      [...url.searchParams.keys()].every((key) => key === "sslmode");
    if (
      (!localTest && !neonDev) ||
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      url.hash ||
      url.hostname !== env.LEVI_ADMIN_DATABASE_HOST ||
      database !== env.LEVI_ADMIN_DATABASE_NAME ||
      decodeURIComponent(url.username) !== "levi_dev_bootstrap" ||
      !url.password ||
      env.LEVI_ADMIN_TARGET_CONFIRMATION !==
        `BOOTSTRAP:${url.hostname}/${database}`
    )
      throw new Error();
    return raw;
  } catch {
    throw new Error(
      "Bootstrap recusado. Confira alvo direto, role bootstrap, TLS e confirmação explícita.",
    );
  }
}
