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

Use `pnpm db:generate` after changing `src/schema.ts`, then review the generated
SQL. `pnpm db:migrate` and `pnpm db:status` target the local database; use the
`:remote` variants explicitly for the configured remote database. Local seed
data belongs in `seeds/local.sql` and runs with `pnpm db:seed`. Never edit an
applied migration; ship a new forward-only migration instead.

`GET /health` reports liveness. `GET /ready` checks D1 and returns a generic 503
when the database is unavailable. Both send `Cache-Control: no-store` to prevent
stale operational results. Responses under `/api/auth/**` send
`Cache-Control: private, no-store`. The SPA and auth API share the same origin;
Better Auth stores accounts and sessions in D1. Google OAuth is enabled only
when both Google credentials are configured.

## Cloudflare cache rule

On every proxied DEV and PROD domain, create a Cache Rule with the
`Bypass cache` action for `/api`, `/auth`, `/account`, `/webhooks`, `/health`,
and `/ready`. Application response headers are defense in depth and do not
replace this rule when a broad cache policy exists.

Use this strict expression:

```text
(http.request.uri.path eq "/api") or
(starts_with(http.request.uri.path, "/api/")) or
(http.request.uri.path eq "/auth") or
(starts_with(http.request.uri.path, "/auth/")) or
(http.request.uri.path eq "/account") or
(starts_with(http.request.uri.path, "/account/")) or
(http.request.uri.path eq "/webhooks") or
(starts_with(http.request.uri.path, "/webhooks/")) or
(http.request.uri.path eq "/health") or
(http.request.uri.path eq "/ready")
```
