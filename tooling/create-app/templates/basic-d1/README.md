# **PROJECT_NAME**

React SPA, API Hono, Workers Assets, Better Auth e Cloudflare D1 no mesmo
Worker. Este starter não inclui tenancy.

## Configuração

1. Instale dependências com `pnpm install`.
2. Copie `.dev.vars.example` para `.dev.vars` e defina `AUTH_SECRET` com pelo
   menos 32 caracteres aleatórios. Configure Resend para entregar e-mails auth.
3. Crie o banco com `pnpm wrangler d1 create __PROJECT_NAME__` e substitua
   `REPLACE_WITH_D1_DATABASE_ID` em `wrangler.jsonc` pelo ID.
4. Aplique a migration local com `pnpm db:migrate:local`.
5. Inicie com `pnpm dev`.

## Migrations e deploy

Migrations são operações próprias, desacopladas de CI, deploy e inicialização.
Use `pnpm db:generate` após alterar `src/schema.ts` e revise
SQL/snapshots/journal. `pnpm db:migrate` e `pnpm db:status` usam banco
**local**; `pnpm db:status:remote` consulta explicitamente o banco remoto
configurado. Seed local fica em `seeds/local.sql` e roda com `pnpm db:seed`.

O starter não oferece atalho de escrita remota desprotegido. Antes de operar
banco persistente, defina workflow de migration próprio com identidade do
commit, aprovação conforme ambiente, credenciais limitadas, serialização e
resultado auditável. CI pode validar em banco descartável; `pnpm deploy` só
compila/publica.

Use `expand → deploy → [backfill] → contract`: mantenha a versão anterior
compatível durante expand, migre dados separadamente quando necessário e retire
compatibilidade só após provas atuais de deploy/saúde/backfill. Nunca edite SQL
aplicado: corrija com migration nova, forward-only. Falha incerta deve bloquear
avanço até diagnóstico/reconciliação humana; rollback de código não reverte
schema. Ambientes e política PROD pertencem ao app consumidor.

`GET /health` informa liveness; `GET /ready` consulta D1 e retorna 503 genérico
quando indisponível. Ambos usam `Cache-Control: no-store` para evitar resultados
obsoletos. `/api/auth/**` usa `Cache-Control: private, no-store`. SPA e auth
compartilham origem; Better Auth persiste contas/sessões em D1. Google OAuth só
habilita quando ambas as credenciais estão configuradas.

## Regra de cache Cloudflare

Em cada domínio DEV/PROD proxied, crie Cache Rule com ação `Bypass cache` para
`/api`, `/auth`, `/account`, `/webhooks`, `/health` e `/ready`. Headers são
defesa adicional, não substituem a regra quando existir uma política ampla de
cache.

Use esta expressão estrita:

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
