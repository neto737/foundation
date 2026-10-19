import { serveStatic } from "@hono/node-server/serve-static";
import type { Env, Hono } from "hono";

// Somente rotas da SPA e assets. /api nunca recebe fallback HTML.
export function mountWeb<E extends Env>(app: Hono<E>) {
  app.get("/assets/*", serveStatic<E>({ root: "./dist/web" }));
  for (const path of [
    "/",
    "/onboarding",
    "/entrar",
    "/organizacoes",
    "/igrejas",
  ]) {
    app.get(path, serveStatic<E>({ root: "./dist/web", path: "index.html" }));
  }
}
