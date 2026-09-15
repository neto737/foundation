import { defineConfig } from "@t00ls-dev/config";

export default defineConfig({
  app: {
    environment: "local",
    name: "basic-d1",
  },
  auth: {
    emailPassword: true,
    magicLink: true,
    oauth: [],
  },
  database: {
    binding: "DB",
    dialect: "d1",
  },
  tenancy: false,
});
