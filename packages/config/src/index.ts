import { z } from "zod";

export const foundationConfigSchema = z.object({
  app: z.object({
    name: z.string().min(1),
    environment: z.enum(["local", "dev", "prod"]),
  }),
  database: z.discriminatedUnion("dialect", [
    z.object({ dialect: z.literal("d1"), binding: z.string().min(1) }),
    z.object({ dialect: z.literal("postgres"), connection: z.string().min(1) }),
  ]),
  auth: z.object({
    emailPassword: z.literal(true),
    magicLink: z.literal(true),
    oauth: z.array(z.literal("google")).default([]),
  }),
  tenancy: z.boolean().default(false),
  telemetry: z
    .object({
      sentry: z.boolean().default(false),
      posthog: z.boolean().default(false),
      ga4: z.boolean().default(false),
      hitmetrica: z.boolean().default(false),
    })
    .default({ sentry: false, posthog: false, ga4: false, hitmetrica: false }),
});

export type FoundationConfig = z.output<typeof foundationConfigSchema>;
export type FoundationConfigInput = z.input<typeof foundationConfigSchema>;

export function defineConfig(config: FoundationConfigInput): FoundationConfig {
  return foundationConfigSchema.parse(config);
}
