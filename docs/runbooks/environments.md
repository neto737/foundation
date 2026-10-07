# Ambientes

O Foundation usa apenas os ambientes `local` e `dev` para a aplicação de
referência. Aplicações consumidoras são responsáveis pelos próprios ambientes
DEV e PROD, com recursos e secrets separados.

## Local

O fluxo local deve funcionar depois de `pnpm install` e da criação de
`.dev.vars` a partir de `.dev.vars.example`.

```bash
pnpm --filter @t00ls-dev/example-links db:migrate:local
pnpm dev
```

Use apenas credenciais de desenvolvimento. Arquivos `.dev.vars`, `.env` e
equivalentes com valores reais nunca devem ser versionados.

## DEV

DEV recebe deploy automático depois de uma CI verde em `master`. Ele possui
Worker, D1 e secrets próprios e usa `foundation.t00ls.dev` como Custom Domain. O
endereço `*.workers.dev` e as Preview URLs estão desabilitados. A configuração
mínima é:

- GitHub: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` (deploy),
  `CLOUDFLARE_D1_MIGRATION_TOKEN` (D1 Edit), `CLOUDFLARE_D1_READ_TOKEN` (D1
  Read), `CLOUDFLARE_WORKER_READ_TOKEN` (Workers Scripts Read) e
  `DEV_HEALTH_URL`;
- Worker: `AUTH_SECRET`, `BASE_URL`, `EMAIL_FROM` e `RESEND_API_KEY`;
- opcionais: `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`.

`DEV_HEALTH_URL` deve apontar para `https://foundation.t00ls.dev` (sem
`/health`); o workflow acrescenta o caminho e valida também a conectividade D1.
`BASE_URL` do Worker deve ser `https://foundation.t00ls.dev`. `AUTH_SECRET` deve
ter pelo menos 32 caracteres e não deve ser reutilizado em aplicações
consumidoras.

Para publicar o Custom Domain, a zona `t00ls.dev` deve estar ativa na conta
Cloudflare e o hostname não pode ter um CNAME conflitante. Configure uma Cache
Rule para bypass de `/health` e das rotas dinâmicas conforme [Cache](cache.md).

Os três tokens novos precisam de provisionamento administrativo antes da
ativação do ciclo DEV. Restrinja recursos/conta e quem pode acessar credenciais
conforme suporte Cloudflare; D1 pode exigir escopo de conta, não presumir
restrição por banco que o provider não ofereça. Token de deploy publica Worker e
consulta bindings, não aplica SQL. Não há fallback entre credenciais.

CI de PR/fork não recebe esses secrets. Migration/recuperação recebe D1 Edit
somente no step autorizado; deploy usa D1 Read na pré-condição. Pós-deploy usa
Workers Read para provar deployment/versão. O `production` atual sem regras não
é gate: Environment só protege jobs que o referenciam com regras efetivas.
Origem/SHA/serialização são verificados pelo código; revisão e controle de
escrita continuam necessários.

## Aplicações consumidoras

Cada aplicação consumidora define seus próprios ambientes e procedimentos de
deploy. Não existe Worker, banco ou workflow PROD no Foundation.
