# Ambientes

O foundation usa tres ambientes: `local`, `dev` e `prod`. Recursos e secrets nao
podem ser compartilhados entre DEV e PROD.

## Local

O fluxo local deve funcionar depois de `pnpm install` e da criacao de
`.dev.vars` a partir de `.dev.vars.example`.

```bash
pnpm --filter @t00ls-dev/example-basic-d1 db:migrate:local
pnpm dev
```

Use apenas credenciais de desenvolvimento. Arquivos `.dev.vars`, `.env` e
equivalentes com valores reais nunca devem ser versionados.

## DEV

DEV recebe deploy automatico depois de uma CI verde em `master`. Ele possui
Worker, D1 e secrets proprios. A configuracao minima e:

- GitHub: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` e `DEV_HEALTH_URL`;
- Worker: `AUTH_SECRET`, `BASE_URL`, `EMAIL_FROM` e `RESEND_API_KEY`;
- opcionais: `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`.

`AUTH_SECRET` deve ter pelo menos 32 caracteres e nao pode ser reutilizado em
PROD.

## PROD

PROD usa recursos e secrets distintos. Antes do primeiro deploy:

1. configure o GitHub Environment `production`; use required reviewers quando o
   plano do repositorio privado oferecer essa protection rule;
2. configure os secrets Cloudflare e `PROD_HEALTH_URL` no environment;
3. configure os secrets do Worker PROD;
4. configure a Cache Rule descrita em [Cache](cache.md);
5. conclua a validacao dos fluxos de autenticacao em DEV;
6. execute o workflow manual com ref explicito e confirmacao `DEPLOY PROD`.

No plano atual, o GitHub recusou required reviewers e wait timer para este
repositorio privado. A barreira disponivel e o Environment separado combinado
com alvo, confirmacao textual, gate completo e SHA imutavel.

Staging nao faz parte da v0.1. Ele so deve ser criado quando houver uma
necessidade operacional concreta.
