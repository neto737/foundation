import { createApp } from "./app.js";
import { workerOptions, type WorkerEnv } from "./worker-config.js";
import { spaPaths } from "./web-paths.js";

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    try {
      // Uma composição por invocação: nenhum Client/auth compartilhado entre requests.
      const app = createApp(workerOptions(env));
      app.get("/assets/*", async (c) => {
        const response = await env.ASSETS.fetch(c.req.raw);
        return new Response(response.body, response);
      });
      for (const path of spaPaths)
        app.get(path, async (c) => {
          const response = await env.ASSETS.fetch(
            new Request(new URL("/", c.req.url), c.req.raw),
          );
          return new Response(response.body, response);
        });
      return await app.fetch(request);
    } catch {
      // Não inclui URL, erro original, bindings ou valores de configuração.
      return Response.json(
        {
          erro: "INDISPONIVEL",
          mensagem:
            "Não foi possível confirmar a operação. Tente novamente mais tarde.",
        },
        {
          status: 503,
          headers: {
            "Cache-Control": "private, no-store",
            "Referrer-Policy": "no-referrer",
            "Content-Type": "application/json; charset=UTF-8",
            "Content-Security-Policy":
              "default-src 'none'; frame-ancestors 'none'",
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
          },
        },
      );
    }
  },
};
