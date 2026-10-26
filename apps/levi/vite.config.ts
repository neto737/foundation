import { defineConfig, createLogger } from "vite";
import { administrativePath } from "./src/admin-paths.js";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig(({ command }) => {
  const logger = createLogger();
  // Erros do proxy podem incluir URLs de links de autenticação.
  if (command === "serve") {
    logger.error = () =>
      process.stderr.write("Falha no servidor de desenvolvimento.\n");
    logger.warn = () =>
      process.stderr.write("Aviso do servidor de desenvolvimento.\n");
    logger.warnOnce = logger.warn;
  }
  return {
    root: fileURLToPath(new URL("./web", import.meta.url)),
    plugins: [
      react(),
      {
        name: "administrative-no-spa-fallback",
        configureServer(server) {
          server.middlewares.use((request, response, next) => {
            const path = (request.url ?? "/").split("?")[0] ?? "/";
            if (
              !administrativePath(path) ||
              path === "/admin" ||
              path === "/api/admin" ||
              path.startsWith("/api/admin/")
            )
              return next();
            response.writeHead(404, {
              "Content-Type": "application/json",
              "Cache-Control": "private, no-store",
              "Referrer-Policy": "no-referrer",
              "Content-Security-Policy":
                "default-src 'none'; frame-ancestors 'none'",
              "X-Content-Type-Options": "nosniff",
              "X-Frame-Options": "DENY",
            });
            response.end(
              JSON.stringify({
                erro: "NAO_ENCONTRADO",
                mensagem: "Recurso não encontrado.",
              }),
            );
          });
        },
      },
    ],
    customLogger: logger,
    server: {
      host: "localhost",
      port: 5173,
      strictPort: true,
      cors: false,
      forwardConsole: false,
      headers: {
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "no-store",
      },
      proxy: {
        // /admin usa o HTML compilado protegido pelo Node, inclusive no DEV.
        "^/admin": {
          target: `http://127.0.0.1:${process.env.LEVI_PORT ?? "3000"}`,
          changeOrigin: false,
        },
        "/assets": {
          target: `http://127.0.0.1:${process.env.LEVI_PORT ?? "3000"}`,
          changeOrigin: false,
        },
        "/api": {
          target: `http://127.0.0.1:${process.env.LEVI_PORT ?? "3000"}`,
          changeOrigin: false,
        },
      },
    },
    build: { outDir: "../dist/web", emptyOutDir: true, sourcemap: false },
  };
});
