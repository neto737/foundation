# basic-d1

Referencia minima: React SPA, Hono, Workers Assets, Better Auth e D1 no mesmo
Worker. Este exemplo deliberadamente nao inclui tenancy.

1. Copie os valores de `.dev.vars.example` para `.dev.vars` e use credenciais
   Resend de desenvolvimento.
2. Execute `pnpm db:migrate:local`.
3. Execute `pnpm dev`.

O schema em `src/schema.ts` e a fonte para `pnpm db:generate`. Revise o SQL
gerado antes de aplicar. `pnpm db:migrate` e `pnpm db:status` usam o D1 local;
as variantes `:dev` e `:prod` operam remotamente no ambiente correspondente.
`pnpm db:seed` executa somente `seeds/local.sql` e nunca faz parte da migration.

Os testes E2E usam Chromium em layouts desktop e mobile:

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

Para DEV e PROD remotos, substitua os IDs D1 em `wrangler.jsonc` e cadastre os
secrets com `wrangler secret put --env <ambiente>`. Nao edite uma migration ja
aplicada; corrija mudancas com uma nova migration forward-only.

Google OAuth e ativado somente quando `GOOGLE_CLIENT_ID` e
`GOOGLE_CLIENT_SECRET` estao presentes. Os demais providers nao fazem parte da
v0.1.
