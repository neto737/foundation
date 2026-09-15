# basic-d1

Referencia minima: React SPA, Hono, Workers Assets, Better Auth e D1 no mesmo
Worker. Este exemplo deliberadamente nao inclui tenancy.

1. Copie os valores de `.dev.vars.example` para `.dev.vars` e use credenciais
   Resend de desenvolvimento.
2. Execute `pnpm db:migrate:local`.
3. Execute `pnpm dev`.

Os testes E2E usam Chromium em layouts desktop e mobile:

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

Para DEV e PROD remotos, substitua os IDs D1 em `wrangler.jsonc` e cadastre os
secrets com `wrangler secret put --env <ambiente>`.

Google OAuth e ativado somente quando `GOOGLE_CLIENT_ID` e
`GOOGLE_CLIENT_SECRET` estao presentes. Os demais providers nao fazem parte da
v0.1.
