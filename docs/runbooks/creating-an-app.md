# Criacao de uma aplicacao

Na v0.1, `@t00ls-dev/create-app` gera apenas o preset autonomo `basic-d1`.

```bash
pnpm --filter @t00ls-dev/create-app build
pnpm exec create-app /caminho/para/meu-app --preset basic-d1
```

O destino deve ser novo ou vazio. O gerador nao sobrescreve arquivos.

## Depois da geracao

1. execute `pnpm install` no projeto gerado;
2. copie `.dev.vars.example` para `.dev.vars` e preencha valores locais;
3. crie o D1 e substitua `REPLACE_WITH_D1_DATABASE_ID`;
4. execute `pnpm db:migrate:local`;
5. execute `pnpm typecheck` e `pnpm build`;
6. configure ambientes, cache bypass e secrets antes do deploy remoto.

O preset inclui React, React Router, React Hook Form, Zod, Hono, D1, Drizzle,
Better Auth e Resend. Ele nao inclui tenancy, billing, storage ou telemetria.

## Decisoes no ponto zero

Antes de iniciar um produto real, registre pelo menos:

- D1 ou PostgreSQL;
- Better Auth, Cloudflare Access ou nenhuma auth;
- tenancy habilitada ou nao;
- e-mail e telemetria necessarios;
- imagens, storage e billing somente quando houver consumidor real.

PostgreSQL e preferivel para SaaS, multi-tenancy, crescimento e queries
avancadas. D1 permanece opcao de primeira classe para apps simples.
