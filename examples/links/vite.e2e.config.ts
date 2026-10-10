import process from "node:process";
import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { appPort, origin } from "./e2e/urls.js";

export default defineConfig(() => {
  const path = process.env.LINKS_E2E_STATE;
  if (!path)
    throw new Error("Start this test configuration through e2e/start.ts");
  return {
    optimizeDeps: {
      extensions: [".tsx"],
      include: [
        "lucide-react",
        "@t00ls-dev/ui/components/skeleton",
        "@t00ls-dev/ui/components/alert-dialog",
        "@t00ls-dev/ui/components/dialog",
        "@t00ls-dev/ui/components/collapsible",
        "@t00ls-dev/ui/components/input",
        "@t00ls-dev/ui/patterns/settings",
        "@t00ls-dev/ui/patterns/page-progress",
        "@t00ls-dev/ui/patterns/pending-button",
        "@t00ls-dev/ui/patterns/inline-feedback",
        "@t00ls-dev/ui/patterns/feedback",
      ],
    },
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src/client", import.meta.url)) },
    },
    plugins: [
      react(),
      tailwindcss(),
      cloudflare({
        configPath: "e2e/wrangler.jsonc",
        config: (config) => ({ vars: { ...config.vars, BASE_URL: origin } }),
        persistState: { path },
        inspectorPort: false,
      }),
    ],
    server: { host: "127.0.0.1", port: appPort, strictPort: true },
  };
});
