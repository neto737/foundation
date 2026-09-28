# basic-d1

Referência mínima: SPA React, Hono, Workers Assets, Better Auth e D1 no mesmo
Worker. Este exemplo deliberadamente não inclui tenancy.

1. Copie os valores de `.dev.vars.example` para `.dev.vars` e use credenciais
   Resend de desenvolvimento.
2. Execute `pnpm db:migrate:local`.
3. Execute `pnpm dev`.

O schema em `src/schema.ts` é a fonte para `pnpm db:generate`. Revise o SQL
gerado antes de aplicar. `pnpm db:migrate` e `pnpm db:status` usam o D1 local;
as variantes `:dev` operam remotamente no ambiente DEV. `pnpm db:seed` executa
somente `seeds/local.sql` e nunca faz parte da migration.

Os testes E2E usam Chromium em layouts desktop e mobile:

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

`GET /health` verifica o Worker e a conectividade D1; retorna `503` sem detalhes
internos quando o banco não está disponível e envia `Cache-Control: no-store`
para impedir resultados operacionais obsoletos. As respostas de `/api/auth/**`
enviam `Cache-Control: private, no-store`.

O DEV remoto usa `foundation.t00ls.dev` como Custom Domain e o D1
`basic-d1-dev`. Cadastre os segredos com `wrangler secret put --env dev`. Não
edite uma migration já aplicada; corrija mudanças com uma nova migration
forward-only.

No domínio Cloudflare DEV, configure uma Cache Rule com ação `Bypass cache` para
`/api`, `/auth`, `/account`, `/webhooks` e `/health`. Os headers da aplicação
são uma defesa adicional, mas não substituem essa regra quando existe uma
política ampla de cache. Consulte `docs/runbooks/cache.md` no repositório do
foundation para a expressão recomendada e o procedimento de validação.

Google OAuth é ativado somente quando `GOOGLE_CLIENT_ID` e
`GOOGLE_CLIENT_SECRET` estão presentes. Os demais provedores não fazem parte da
v0.1.
