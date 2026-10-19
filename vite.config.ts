import { defineConfig, createLogger } from "vite";
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
    plugins: [react()],
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
        "/api": {
          target: `http://127.0.0.1:${process.env.LEVI_PORT ?? "3000"}`,
          changeOrigin: false,
        },
      },
    },
    build: { outDir: "../dist/web", emptyOutDir: true, sourcemap: false },
  };
});
