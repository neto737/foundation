# Estado do projeto

Este documento é a fonte de verdade sobre o que existe no
`t00ls-dev/foundation`, o que falta para concluir a v0.1 operacional e o que foi
deliberadamente adiado. Ele descreve o código atual, não uma arquitetura
hipotética.

Última revisão de código: incorporação do Levi e CI conjunta em 25 de outubro de
2026; publicação npm em 22 de outubro de 2026. Registros operacionais históricos
permanecem identificados nas respectivas seções e runbooks.

O repositório é público. `master` possui proteção clássica com pull request
obrigatório e status check `checks` do GitHub Actions, sem aprovação humana
obrigatória e com possibilidade de bypass administrativo. O único Environment
existente no GitHub é `dev`; não há Environment nem operação PROD no Foundation.

## Objetivo e escopo

O foundation fornece pacotes, convenções e ferramentas reutilizáveis para apps
da `t00ls-dev` e será a base principal do monorepo. O workspace está preparado
para `apps/*`, incluindo o Levi em `apps/levi`, sob MIT com histórico subtree
sem squash e preservação das atribuições. Links permanece em `examples/links`. A
incorporação não transfere o deploy do Levi; o repositório original permanece
independente e operacionalmente inalterado. Aplicações mantêm versões, deploys,
bancos e recursos próprios, compartilhando contratos públicos dos pacotes via
workspace.

A v0.1 valida um caminho completo e pequeno:

- monorepo TypeScript com qualidade automatizada;
- React SPA e API Hono no mesmo Cloudflare Worker;
- D1 como preset inicial e PostgreSQL como adapter suportado;
- Better Auth, e-mail, segurança, tenancy e autorização;
- gerador de projeto e diagnóstico básico;
- desenvolvimento local, CI e fluxo de deploy manual do exemplo somente em DEV,
  com reativação e execução ainda não autorizadas nesta preparação.

O projeto é Cloudflare-first e internal-first, sem regras de negócio de um
produto específico. Providers e capabilities sem consumidor real não fazem parte
da primeira entrega.

## Entregue

### Fundação e tooling

- Levi privado em `apps/levi`, com sete dependências workspace, build ordenado,
  validação PG/ACLs/Worker/E2E em CI e domínio/schema/recursos independentes.
  Origem, SHAs e limites operacionais estão no [README](../apps/levi/README.md).
  Publicador manual Levi preparado, bloqueado pelo interruptor ausente e pela
  configuração `levi-dev` ainda não provisionada; o original continua único
  publicador autorizado. Versionamento privado e transferência seguem pendentes.

- Workspace pnpm com Turborepo e Node.js `>=22.22.0`.
- TypeScript strict compartilhado em `@t00ls-dev/typescript-config`.
- ESLint compartilhado em `@t00ls-dev/eslint-config`.
- Formatação com Prettier.
- Builds ordenados pelos limites de dependência do workspace.
- Descoberta de `apps/*` nos validadores de manifests e planejamento de release,
  preservando a leitura das bases históricas e a allowlist npm de nove pacotes.
- Planejamento de versões privadas separado do plano npm, sem ativação de
  `privatePackages`, criação de tags ou mudanças nas versões atuais. O fluxo
  público continua bloqueando planos privados até sua ativação futura revisada.
- Correções locais de dependências: Zod `4.6.7` somente nas cadeias Better Auth
  e Core `1.7.10`, e Undici `7.30.1` na cadeia Miniflare. Overrides de raiz não
  corrigem lockfiles de consumidores externos; a cópia Levi incorporada usa os
  overrides raiz, preservando o lockfile do repositório original.
- CI integral e gates existentes preservados; testes de contrato exercitam
  aplicativos sintéticos, componentes privados e dependências transitivas com
  `^build`, sem seleção agressiva ou mudança de publicador.

O desacoplamento operacional das migrations persistentes permanece bloqueado
nesta preparação. O coordenador atual ainda executa fases D1 no ciclo de deploy;
a política aprovada e o motivo para não alterar parcialmente esse ciclo estão em
[Migrations](runbooks/migrations.md#política-aprovada-e-desacoplamento-pendente).

### Automação de manutenção existente

- Dependabot semanal, segunda-feira às 03:00 UTC, com limite de dez PRs de
  versão por ecossistema. Atualizações minor/patch agrupadas por frontend,
  tooling/testes e GitHub Actions; majors permanecem individuais.
- Dependabot alerts e atualizações automáticas de segurança habilitados no
  GitHub (verificado em 13/10/2026). Os grupos se aplicam somente a atualizações
  de versão, cujo limite não restringe PRs de segurança.
- `@types/node` mantido na major 22 enquanto esse for o runtime mínimo
  suportado.

### Pacotes

| Pacote                     | Estado atual                                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@t00ls-dev/config`        | Configuração tipada para ambiente, D1/PostgreSQL, Better Auth, tenancy e flags de telemetria.                                                                       |
| `@t00ls-dev/db`            | Factories Drizzle para D1 e PostgreSQL via `pg.Client` conectado e status read-only do journal PostgreSQL, sem esconder recursos específicos dos bancos.            |
| `@t00ls-dev/auth`          | Configuração Better Auth para senha, verificação de e-mail, recuperação, magic link e Google OAuth opcional. Emite JavaScript e declarações TypeScript consumíveis. |
| `@t00ls-dev/tenant`        | Contexto de tenant, memberships, troca de tenant ativo, convites e repositories D1/PostgreSQL.                                                                      |
| `@t00ls-dev/access`        | Roles configuráveis como conjuntos de permissões, separadas da autenticação.                                                                                        |
| `@t00ls-dev/security`      | Headers, CSP, CORS, CSRF, Turnstile e rate limiting com storage injetável.                                                                                          |
| `@t00ls-dev/email`         | Contrato substituível de e-mail e implementação Resend sem espalhar chamadas do provider.                                                                           |
| `@t00ls-dev/observability` | Logging JSON estruturado com contexto de request, usuário e tenant.                                                                                                 |
| `@t00ls-dev/audit`         | Eventos append-only para D1/PostgreSQL, com validação recursiva que rejeita chaves sensíveis na metadata.                                                           |

Os nove pacotes tiveram as versões históricas `0.1.0` e `0.1.1` privadas no
GitHub Packages; esses pacotes duplicados foram excluídos em **15/10/2026**.
Internamente são consumidos com `workspace:*`. Os nove pacotes oficiais têm
acesso público no npmjs.com, no scope do usuário `t00ls-dev`, sem
organização/publicação dupla: audit/db/tenant `1.0.1`, auth `0.3.1`, config
`0.1.3`, security `0.2.0` e access/email/observability `0.1.2`.

Em **22/10/2026**, a recuperação do PR #136 concluiu os cinco alvos com OIDC,
bytes, assinaturas e proveniência verificados; o freeze operacional dessa
recuperação foi encerrado por autorização do mantenedor. O
[runbook de pacotes](runbooks/packages.md#roteiro-operacional-para-próximas-releases)
registra o fluxo normal e as evidências históricas. Isso não autoriza novo envio
nem dispensa a conferência atual dos Trusted Publishers de cada alvo. Release
permanece manual e explicitamente autorizado. Os demais workspaces com
`private: true` não são publicados no registry, embora seu código esteja
público.

Os nove registros adicionais `0.0.0-stage` são placeholders de staging do npm,
sem a API operacional Foundation. A decisão de 16/10/2026 é mantê-los, sem
impacto operacional demonstrado no consumo normal ou no inventário atual;
`latest` continua nas versões oficiais. A operação exata que os criou não foi
determinada. Veja a decisão e seus limites no
[runbook de pacotes](runbooks/packages.md#audit-não-autoriza-publicação).

### Aplicação de referência

`examples/links` apresenta **Links**, uma biblioteca privada de bookmarks. O
package é `@t00ls-dev/example-links`. Demonstra:

- React, React Router, React Hook Form, Zod e Tailwind CSS;
- base UI v1 privada em `packages/ui`: tokens semânticos, primitives shadcn
  incrementais, PageProgress/feedback e Sonner único; shell preservado no
  refetch da mesma identidade, com limites de sessão mantidos. Veja o
  [ADR-008](decisions/008-foundation-ui-v1.md) e os
  [padrões](../packages/ui/README.md);
- Hono no mesmo Worker que serve os assets da SPA;
- D1 e Drizzle;
- Better Auth por meio dos pacotes do foundation;
- senha, verificação, recuperação, magic link e Google opcional;
- envio de e-mail via Resend;
- `/health` para saúde do Worker e do D1 e fallback de rotas da SPA;
- configuração local e DEV, com Custom Domain `foundation.t00ls.dev`, sem
  `*.workers.dev` nem Preview URLs e com Workers Logs habilitados;
- migration inicial e journal Drizzle do schema de autenticação;
- comandos padronizados de geração, migration, seed e status;
- formulários com labels, erros associados, foco inválido e estados de envio;
- CRUD de bookmarks, tags JSON, busca simples, filtro exato e paginação
  limit/offset;
- Bookmarks usa Skeleton inicial, refresh que mantém resultados e feedback
  local, PendingButton e AlertDialog de exclusão com foco acessível. Filtros e
  página aplicada acompanham o retorno de add/edit; sucessos breves usam Sonner,
  falhas recuperáveis permanecem inline;
- isolamento por usuário em todas as queries e mutações, sem tenancy/RBAC;
- sessão tipada no servidor pela API mínima `resolveSession` de
  `@t00ls-dev/auth`, com propagação de cookies e verificação de e-mail
  obrigatória;
- headers privados e CSRF nas mutações autenticadas por cookie;
- 15 testes unitários e 11 testes D1 reais do exemplo, incluindo falhas de
  revogação/confirmação, logs sanitizados e gerações de sessão;
- nove cenários Playwright em desktop e mobile (18 execuções), incluindo
  cadastro/verificação/login/logout, persistência, isolamento e respostas
  atrasadas;
- harness E2E com banco temporário e e-mails capturados, sem providers externos.
- TOTP password-only: Account oferece senha → QR/key local → confirmação e
  desativação com senha; login por senha passa por `/two-factor` antes de
  concluir sessão/retorno privado. Magic Link/Google continuam alternativas sem
  TOTP. Backend opt-in, schema D1 e limiter database já existentes; sem backup
  codes, OTP ou trusted devices. Veja o [fluxo](runbooks/links-totp.md).
- Account usa seções Profile/Security, edição explícita e uma tarefa por vez;
  Auth/Password usam Input/PendingButton/feedback Foundation. TOTP usa Dialog
  responsivo, QR primário, key sob demanda e Copy local; recuperação aparece
  somente após exceção observada, preservando reconciliação e limites de sessão.
- Turnstile V1 opt-in protege somente pedidos públicos de cadastro/login por
  senha, Magic Link e reset, usando plugin oficial Better Auth, actions
  distintas e CSP mínimo. Google/TOTP/ações autenticadas ficam excluídos;
  Account encaminha a primeira senha ao formulário público. Limitação
  truthy-success 1.7.7 aceita/documentada; DEV ainda depende de configuração de
  chaves. Veja [Turnstile](runbooks/links-turnstile.md).

O ambiente local usa `.dev.vars.example` como contrato de nomes de secrets, sem
versionar valores reais.

### Create App

`@t00ls-dev/create-app` gera o preset não interativo `basic-d1` em um diretório
novo ou vazio. O projeto gerado:

- é autônomo e não contém dependências `workspace:*`;
- usa React, React Router, Hono, D1, Drizzle e Better Auth;
- inclui Resend, Google OAuth opcional e recuperação de senha;
- inclui React Hook Form, validação Zod e estados acessíveis de formulário;
- inclui configurações Wrangler/Drizzle, migration, seed local e documentação
  inicial;
- instala, passa no typecheck e compila fora do monorepo.

O gerador recusa sobrescrever diretórios não vazios e preserva a causa de erros
de filesystem.

### Doctor

`@t00ls-dev/doctor` realiza diagnóstico read-only de projetos Node e Cloudflare
D1. Atualmente verifica:

- versão do Node contra `package.json#engines`;
- manifesto e configuração Wrangler;
- nomes obrigatórios em `.dev.vars.example`;
- bindings D1, presença de migrations SQL e scripts de banco padronizados;
- arquivos de secrets ou chaves indevidamente rastreados pelo Git;
- saída humana ou JSON e códigos de saída previsíveis.

Valores de secrets nunca são incluídos no relatório.

### Qualidade

O comando `pnpm check` executa, nesta ordem:

1. verificação de formatação;
2. lint;
3. typecheck;
4. testes unitários;
5. testes de integração;
6. builds;
7. testes E2E;
8. testes de distribuição dos packages;
9. testes de release;
10. contratos de migrations e execução D1 descartável.

A cobertura atual inclui:

- testes unitários de config, db, auth, tenant, access, security, email,
  observability, audit, create-app e Doctor;
- testes de tenancy, permissões, memberships, isolamento, troca de tenant e
  convites;
- D1 real local por Miniflare;
- PostgreSQL 17 real por Testcontainers;
- integração PostgreSQL com `pg`, migrations/seed pelo histórico Drizzle,
  isolamento, concorrência de convites e rollback conjunto com audit;
- Better Auth PostgreSQL com IDs textuais e e-mails capturados, mais execução
  `pg`/Drizzle/audit em Workers local; Hyperdrive remoto não comprovado;
- integrações de Links com isolamento por usuário em D1;
- nove cenários Playwright em desktop e mobile, totalizando 18 execuções;
- geração, instalação, typecheck e build do starter fora do workspace.

Pacotes sem testes próprios não executam Vitest vazio. A CI usa o reporter
normal do Vitest para evitar dezenas de summaries fragmentados no GitHub.

### Automação

- `CI`: executa o gate completo em PRs e pushes para `master`; execuções antigas
  da mesma ref são canceladas.
- Version Packages é um job isolado da CI de push/master, dependente de
  `checks`, sem repetir o gate. Compartilha a serialização global com Release
  manual.
- `Release`: somente manual; audit/approve/preflight/publisher verificam pela
  API a CI aprovada do SHA exato, preservando autorização, provenance e checks
  de registry.
- `Deploy DEV`: aceita somente `workflow_dispatch`, com SHA atual de master e CI
  push/master aprovada; não recebe mais eventos `workflow_run`. Permanece
  `disabled_manually` até autorização posterior. A reativação não autoriza um
  dispatch. Faz checkout do SHA validado e coordena
  expand/deploy/backfill/contract em jobs independentes. Migration DEV é
  workflow reutilizável; deploy não aplica SQL e verifica `/health` com SHA/D1
  obrigatórios. Verifica evento push/master, repositório de origem, identidade
  do workflow e job aprovado na mesma tentativa. Não repete a suíte de testes.
  Como registro histórico anterior ao modo manual, em 16/10/2026 a execução
  automática
  [38788787384](https://github.com/t00ls-dev/foundation/actions/runs/38788787384)
  concluiu com sucesso para o SHA `abe0483d8ef6366b81e5b8d0da0dcd086559451e`,
  após a
  [CI aprovada](https://github.com/t00ls-dev/foundation/actions/runs/38788305767)
  do mesmo SHA.
- O Foundation não possui ambiente ou workflow PROD. Aplicações consumidoras
  definem seus próprios ambientes e processos de deploy.
- Operações D1/recuperação compartilham serialização sem cancelar mutation
  iniciada. Dirty persiste no banco e bloqueia avanço; Recovery DEV exige
  diagnóstico versionado e confirmação humana. Ativação exige tokens segregados
  descritos em [Ambientes](runbooks/environments.md).
- `Smoke Hyperdrive`: execução manual contra um endpoint configurado. É apenas
  um smoke remoto; não implementa um binding Hyperdrive dentro deste
  repositório.
- Migrations são app-owned: Drizzle Kit gera os históricos por dialeto, Wrangler
  aplica e consulta D1, e Drizzle Kit aplica PostgreSQL. Seeds são separados e
  migrations aplicadas recebem somente correções forward-only. O procedimento
  está em [Migrations](runbooks/migrations.md).
- Respostas operacionais e auth usam headers conservadores, e os domínios devem
  aplicar o bypass descrito em [Cache](runbooks/cache.md).

## Pendências para a v0.1 operacional

### Infraestrutura externa

DEV possui banco, secrets, envio de e-mail e histórico de deploy validado. O
Custom Domain `foundation.t00ls.dev` responde ao smoke em `/health` com o Worker
e o D1 operacionais. `DEV_HEALTH_URL` está configurado no GitHub; `BASE_URL` e
`EMAIL_FROM` estão declarados em `env.dev.vars`. O bypass de cache no domínio
foi configurado e as respostas verificadas não apresentaram
`CF-Cache-Status: HIT`. O envio do e-mail de Magic Link foi validado manualmente
em DEV; o acesso pelo link ainda não foi testado.

Ainda faltam para a operação completa:

- configurar `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` apenas se OAuth Google
  for usado;
- concluir a validação manual de cadastro com um endereço não cadastrado,
  verificação de e-mail, login, logout e acesso pelo Magic Link em DEV.

### Fechamento operacional

Links possui cobertura determinística local de autenticação e bookmarks. Após
publicação, registrar a validação manual dos fluxos restantes em DEV e do CRUD
com duas contas, conforme `examples/links/README.md`. A validação local não
substitui entrega de e-mail e inspeção de cache/cookies no domínio real. O PROD
de aplicações consumidoras não pertence ao Foundation.

Os runbooks vigentes cobrem [ambientes](runbooks/environments.md),
[deploy](runbooks/deployment.md), [segurança](runbooks/security.md),
[testes](runbooks/testing.md), [cache](runbooks/cache.md),
[migrations](runbooks/migrations.md), [LGPD](runbooks/lgpd.md) e
[criação de apps](runbooks/creating-an-app.md).

### Evolução após a v0.1

Estes itens dependem de necessidade concreta ou de um segundo preset/consumidor:

- opções interativas no create-app para PostgreSQL, auth, tenancy e telemetria;
- ampliação de `t00ls.config.ts` para email, audit, storage, images e billing;
- diagnóstico Doctor para PostgreSQL/Hyperdrive, R2, Images, providers, backups
  e endpoints remotos;
- validação remota real de Hyperdrive (o harness local usa conexão direta, sem
  testar pooling/cache do serviço);
- alternativa de autenticação por Cloudflare Access;
- contratos compartilhados de request/response preparados para futura adoção de
  OpenAPI;
- taxonomia de eventos, consentimento, PII scrubbing e integrações Sentry,
  PostHog, GA4 e Hitmetrica;
- padrões de exportação, exclusão, retenção e consentimento para LGPD.

## Deliberadamente adiado

Não serão implementados sem consumidor real:

- billing e roteamento entre gateways;
- webhooks genéricos e infraestrutura ampla de idempotência;
- Cloudflare Images e R2;
- backups automatizados e testes de restore;
- Queues, Workflows e Cron além de casos concretos;
- feature flags próprias;
- design system completo;
- staging, GraphQL, microservices, Kubernetes, SMS e Web Push.

## Publicação e releases

Changesets prepara releases independentes dos nove pacotes reutilizáveis em
`packages/*` para npmjs.com público no scope do usuário `t00ls-dev`. O job
Version Packages da CI de push/master cria ou atualiza o PR de versionamento;
não publica pacotes. Release é manual e requer CI aprovada do SHA exato, audit,
aprovação do owner por identidade/permissão verificadas na API, preflight e
autorização explícita. As versões `0.1.0` e `0.1.1` pertencem ao histórico dos
pacotes privados excluídos do GitHub Packages; abertura do código não autoriza
uma nova publicação. Veja o [runbook de pacotes](runbooks/packages.md). Nesse
fluxo:

- APIs podem amadurecer sem releases artificiais;
- cada pacote mantém versão própria;
- consumidores de teste usam exports públicos;
- breaking changes futuras exigirão major version.

## Decisões vigentes

As decisões arquiteturais permanecem registradas em `docs/decisions`:

- [SPA e API no mesmo Worker](decisions/001-spa-api-same-worker.md);
- [tenancy, access e convites](decisions/002-tenancy-access-invitations.md);
- [Better Auth](decisions/003-better-auth.md);
- [bancos e testes de integração](decisions/004-databases-and-integration-tests.md);
- [publicação workspace-first](decisions/005-workspace-first-publication.md);
- [Foundation DEV-only](decisions/006-deployment-environments.md);
- [escopo da v0.1](decisions/007-v01-scope.md).

Mudanças que contradigam essas decisões devem atualizar ou substituir o ADR
correspondente, sem alterações arquiteturais silenciosas.

## Comandos úteis

```bash
pnpm install
pnpm check
pnpm format:check
pnpm dev
pnpm --filter @t00ls-dev/create-app build
pnpm --filter @t00ls-dev/doctor exec doctor ./examples/links
```

Requisitos locais: Node.js 22, Corepack/pnpm e Docker para os testes PostgreSQL.
