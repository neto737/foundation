import { fileURLToPath, URL } from "node:url";
import config from "../../eslint.config.js";

const tsconfigRootDir = fileURLToPath(new URL(".", import.meta.url));

export default [
  ...config,
  {
    files: ["src/**/*.ts", "drizzle.config.ts", "vite.config.ts"],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: "./tsconfig.json",
        tsconfigRootDir,
      },
    },
  },
  {
    files: ["web/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: "./tsconfig.web.json",
        tsconfigRootDir,
      },
    },
  },
];
