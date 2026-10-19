import { serve } from "@hono/node-server";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createApp } from "./app.js";
import { mountWeb } from "./web.js";

const databaseUrl = process.env.LEVI_DATABASE_URL;
const secret = process.env.LEVI_AUTH_SECRET;
const port = Number(process.env.LEVI_PORT ?? "3000");
const publicOrigin =
  process.env.LEVI_PUBLIC_ORIGIN ?? `http://localhost:${port}`;
if (
  !databaseUrl ||
  !["127.0.0.1", "localhost", "[::1]"].includes(
    new URL(databaseUrl).hostname,
  ) ||
  !secret ||
  !["localhost", "127.0.0.1"].includes(new URL(publicOrigin).hostname) ||
  new URL(publicOrigin).origin !== publicOrigin ||
  new URL(publicOrigin).protocol !== "http:" ||
  !Number.isInteger(port) ||
  port < 1024 ||
  port > 65535
) {
  throw new Error(
    "Configure LEVI_DATABASE_URL local, LEVI_AUTH_SECRET e uma LEVI_PORT válida (padrão 3000).",
  );
}
const app = createApp({
  databaseUrl,
  baseURL: publicOrigin,
  onboardingReturnPath: "/onboarding",
  secret,
  email: {
    async send(message) {
      // Transporte de desenvolvimento: arquivos privados, sem endpoint de leitura.
      await mkdir(".local/mail", { recursive: true, mode: 0o700 });
      await writeFile(
        `.local/mail/${randomUUID()}.json`,
        JSON.stringify(message, null, 2),
        { mode: 0o600, flag: "wx" },
      );
    },
  },
});
mountWeb(app);
serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, () =>
  console.info(
    `Levi em ${publicOrigin}. API local na porta ${port}. E-mails capturados em .local/mail.`,
  ),
);
