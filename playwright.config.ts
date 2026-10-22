import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: "./e2e/reporter.ts",
  outputDir: ".local/playwright",
  preserveOutput: "never",
  use: { trace: "off", video: "off", screenshot: "off" },
  projects: [
    {
      name: "desktop",
      testMatch: /(?:onboarding|members)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:4317" },
    },
    {
      name: "mobile",
      testMatch: /(?:onboarding|members)\.spec\.ts/,
      use: { ...devices["Pixel 7"], baseURL: "http://localhost:4317" },
    },
    {
      name: "vite-proxy",
      testMatch: "proxy.spec.ts",
      use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:5173" },
    },
  ],
  webServer: [
    {
      command: "node --import tsx e2e/server.ts",
      url: "http://localhost:4317/",
      reuseExistingServer: false,
    },
    {
      command: "node --import tsx e2e/server.ts --proxy-api",
      url: "http://localhost:4318/",
      reuseExistingServer: false,
    },
    {
      command: "node node_modules/vite/bin/vite.js",
      env: { LEVI_PORT: "4318" },
      url: "http://localhost:5173/",
      reuseExistingServer: false,
    },
  ],
});
