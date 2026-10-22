import {
  Miniflare,
  convertV4MiniflareOptions,
  Log,
  LogLevel,
  Response as LocalResponse,
} from "miniflare";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { randomUUID } from "node:crypto";

export const workerOrigin = "https://levi.t00ls.dev";
export const password = "synthetic-worker-password";
export interface CapturedEmail {
  to: string[];
  subject: string;
  text: string;
  from: string;
}

export async function workerHarness(
  databaseUrl: string,
  options: { membersDevOrganizations?: string; publicOrigin?: string } = {},
) {
  const origin = options.publicOrigin ?? workerOrigin;
  const url = new URL(databaseUrl);
  if (
    process.env.LEVI_LOCAL_DATABASE !== "1" ||
    url.hostname !== "127.0.0.1" ||
    !["/levi_test", "/levi_worker_empty", "/levi_worker_previous"].includes(
      url.pathname,
    )
  )
    throw new Error("Use o PostgreSQL descartável.");
  const parsed = ts.parseConfigFileTextToJson(
    "wrangler.jsonc",
    await readFile("wrangler.jsonc", "utf8"),
  );
  if (parsed.error) throw new Error("Configuração Wrangler inválida.");
  const config = parsed.config as {
    compatibility_date: string;
    compatibility_flags: string[];
    assets: { directory: string; binding: string; run_worker_first: boolean };
  };
  const addresses = Array.from(
    { length: 40 },
    () => `${randomUUID()}@example.test`,
  );
  let next = 0;
  const sent: CapturedEmail[] = [];
  let providerStatus = 200;
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      name: "levi-worker-test",
      modules: true,
      scriptPath: "dist/worker/worker.js",
      compatibilityDate: config.compatibility_date,
      compatibilityFlags: config.compatibility_flags,
      cf: false,
      log: new Log(LogLevel.NONE),
      inspectorPort: 0,
      assets: { ...config.assets, routerConfig: { has_user_worker: true } },
      bindings: {
        LEVI_PUBLIC_ORIGIN: origin,
        ...(options.membersDevOrganizations !== undefined
          ? { LEVI_MEMBERS_DEV_ORGANIZATIONS: options.membersDevOrganizations }
          : {}),
        LEVI_AUTH_SECRET: "synthetic-only-secret-with-more-than-32-characters",
        RESEND_API_KEY: "synthetic-only-not-a-real-api-key",
        LEVI_EMAIL_FROM: "Levi <levi@example.test>",
      },
      hyperdrives: { HYPERDRIVE: databaseUrl },
      outboundService: async (request) => {
        if (
          request.url !== "https://api.resend.com/emails" ||
          request.method !== "POST"
        )
          throw new Error("Saída de rede não autorizada no teste.");
        const input = (await request.json()) as CapturedEmail;
        if (providerStatus === 200) sent.push(input);
        return LocalResponse.json(
          { id: "synthetic" },
          { status: providerStatus },
        );
      },
    }),
  );
  await mf.ready;
  let clientNumber = 0;
  const send = async (
    path: string,
    body?: object,
    cookie = "",
    headers: Record<string, string> = {},
  ) => {
    const response = await mf.dispatchFetch(new URL(path, origin).toString(), {
      method: body ? "POST" : "GET",
      redirect: "manual",
      headers: {
        origin,
        "cf-connecting-ip": `192.0.2.${(++clientNumber % 250) + 1}`,
        cookie,
        "content-type": "application/json",
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    // Normaliza para a API Web do Node sem expor valores em logs.
    return new Response(response.body as unknown as BodyInit, {
      status: response.status,
      headers: [...response.headers],
    });
  };
  const email = () => {
    const value = addresses[next++];
    if (!value) throw new Error("Caixa sintética esgotada.");
    return value;
  };
  const link = (address: string) => {
    const message = sent.findLast((item) => item.to[0] === address);
    const value = message?.text.match(/https?:\/\/\S+/)?.[0];
    if (!value) throw new Error("Mensagem sintética não recebida.");
    return new URL(value);
  };
  return {
    mf,
    send,
    email,
    link,
    sent,
    provider: (status: number) => {
      providerStatus = status;
    },
  };
}

export function cookieFrom(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}
