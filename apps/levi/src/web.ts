import { serveStatic } from "@hono/node-server/serve-static";
import type { Env, Hono } from "hono";
import { spaPaths } from "./web-paths.js";

// Somente rotas da SPA e assets. /api nunca recebe fallback HTML.
export function mountWeb<E extends Env>(app: Hono<E>) {
  app.get("/assets/*", serveStatic<E>({ root: "./dist/web" }));
  app.get("/admin", serveStatic<E>({ root: "./dist/web", path: "index.html" }));
  for (const path of spaPaths) {
    app.get(path, serveStatic<E>({ root: "./dist/web", path: "index.html" }));
  }
}
