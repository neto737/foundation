# **PROJECT_NAME**

React SPA, Hono API, Workers Assets, Better Auth, and Cloudflare D1 in one
Worker. This starter deliberately does not include tenancy.

## Setup

1. Install dependencies with `pnpm install`.
2. Copy `.dev.vars.example` to `.dev.vars` and set `AUTH_SECRET` to at least 32
   random characters. Configure Resend credentials to deliver auth email.
3. Create the database with `pnpm wrangler d1 create __PROJECT_NAME__`, then
   replace `REPLACE_WITH_D1_DATABASE_ID` in `wrangler.jsonc` with its ID.
4. Apply the local migration with `pnpm db:migrate:local`.
5. Start the application with `pnpm dev`.

`GET /health` reports service health. The SPA and auth API share the same
origin; Better Auth stores accounts and sessions in D1. Google OAuth is enabled
only when both Google credentials are configured.
