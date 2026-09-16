# Estado do projeto

Este documento é a fonte de verdade sobre o que existe no
`t00ls-dev/foundation`, o que falta para concluir a v0.1 operacional e o que foi
deliberadamente adiado. Ele descreve o código atual, não uma arquitetura
hipotética.

Última revisão: 16 de setembro de 2026.

## Objetivo e escopo

O foundation fornece pacotes, convenções e ferramentas reutilizáveis para apps
da organização `t00ls-dev`. Os produtos finais vivem em repositórios próprios e
podem atualizar os pacotes de forma independente.

A v0.1 valida um caminho completo e pequeno:

- monorepo TypeScript com qualidade automatizada;
- React SPA e API Hono no mesmo Cloudflare Worker;
- D1 como preset inicial e PostgreSQL como adapter suportado;
- Better Auth, e-mail, segurança, tenancy e autorização;
- gerador de projeto e diagnóstico básico;
- desenvolvimento local, CI e workflows de deploy separados por ambiente.

O projeto é Cloudflare-first e internal-first, sem regras de negócio de um
produto específico. Providers e capabilities sem consumidor real não fazem parte
da primeira entrega.

## Entregue

### Fundação e tooling

- Workspace pnpm com Turborepo e Node.js `>=22.22.0`.
- TypeScript strict compartilhado em `@t00ls-dev/typescript-config`.
- ESLint compartilhado em `@t00ls-dev/eslint-config`.
- Formatação com Prettier.
- Builds ordenados pelos limites de dependência do workspace.
- Dependabot semanal, segunda-feira às 03:00 UTC, com limite de cinco PRs por
  ecossistema.
- `@types/node` mantido na major 22 enquanto esse for o runtime mínimo
  suportado.

### Pacotes

| Pacote                     | Estado atual                                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@t00ls-dev/config`        | Configuração tipada para ambiente, D1/PostgreSQL, Better Auth, tenancy e flags de telemetria.                                                                       |
| `@t00ls-dev/db`            | Factories Drizzle para D1 e PostgreSQL e status read-only do journal PostgreSQL, sem esconder recursos específicos dos bancos.                                      |
| `@t00ls-dev/auth`          | Configuração Better Auth para senha, verificação de e-mail, recuperação, magic link e Google OAuth opcional. Emite JavaScript e declarações TypeScript consumíveis. |
| `@t00ls-dev/tenant`        | Contexto de tenant, memberships, troca de tenant ativo, convites e repositories D1/PostgreSQL.                                                                      |
| `@t00ls-dev/access`        | Roles configuráveis como conjuntos de permissões, separadas da autenticação.                                                                                        |
| `@t00ls-dev/security`      | Headers, CSP, CORS, CSRF, Turnstile e rate limiting com storage injetável.                                                                                          |
| `@t00ls-dev/email`         | Contrato substituível de e-mail e implementação Resend sem espalhar chamadas do provider.                                                                           |
| `@t00ls-dev/observability` | Logging JSON estruturado com contexto de request, usuário e tenant.                                                                                                 |
| `@t00ls-dev/audit`         | Eventos append-only para D1/PostgreSQL, com validação recursiva que rejeita chaves sensíveis na metadata.                                                           |

Os pacotes continuam privados e consumidos com `workspace:*`. Publicação no npm
não é necessária para validar a v0.1.

### Aplicação de referência

`examples/basic-d1` demonstra:

- React, React Router, React Hook Form, Zod e Tailwind CSS;
- Hono no mesmo Worker que serve os assets da SPA;
- D1 e Drizzle;
- Better Auth por meio dos pacotes do foundation;
- senha, verificação, recuperação, magic link e Google opcional;
- envio de e-mail via Resend;
- `/health` para liveness, `/ready` para readiness do D1 e fallback de rotas da
  SPA;
- configuração separada para local, DEV e PROD;
- migration inicial e journal Drizzle do schema de autenticação;
- comandos padronizados de geração, migration, seed e status;
- formulários com labels, erros associados, foco inválido e estados de envio;
- cinco cenários Playwright executados em desktop e mobile.

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
7. testes E2E.

A cobertura atual inclui:

- testes unitários de config, db, auth, tenant, access, security, email,
  observability, audit, create-app e Doctor;
- testes de tenancy, permissões, memberships, isolamento, troca de tenant e
  convites;
- D1 real local por Miniflare;
- PostgreSQL 17 real por Testcontainers;
- 14 testes no gate de integração completo, incluindo migration e seed
  PostgreSQL pelo histórico Drizzle;
- cinco cenários Playwright em desktop e mobile, totalizando dez execuções;
- geração, instalação, typecheck e build do starter fora do workspace.

Pacotes sem testes próprios não executam Vitest vazio. A CI usa o reporter
normal do Vitest para evitar dezenas de summaries fragmentados no GitHub.

### Automação

- `CI`: executa o gate completo em PRs e pushes para `master`; execuções antigas
  da mesma ref são canceladas.
- `Deploy DEV`: inicia após uma CI verde em `master`, faz checkout do SHA
  validado, aplica migrations D1, implanta e consulta `/ready` quando uma URL
  foi configurada. Não repete a suíte de testes.
- `Deploy PROD`: execução manual com alvo e confirmação explícitos; resolve o
  ref uma vez, usa o mesmo SHA imutável no gate e deploy, passa pelo GitHub
  Environment `production`, aplica migration e executa readiness opcional.
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

DEV possui banco, secrets, envio de e-mail e deploy automático validados. Ainda
faltam para a operação completa:

- configurar `PROD_HEALTH_URL`;
- configurar secrets no GitHub Environment `production`; required reviewers e
  wait timer nao estao disponiveis no plano atual do repositorio privado;
- configurar no Worker PROD `AUTH_SECRET`, `BASE_URL`, `EMAIL_FROM` e
  `RESEND_API_KEY`, com secret de autenticação distinto de DEV;
- configurar `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` apenas se OAuth Google
  for usado;
- configurar domínio ou rota Cloudflare quando o endereço definitivo existir;
- concluir a validação manual de cadastro, verificação, login, logout e magic
  link em DEV;
- executar o primeiro deploy PROD somente depois da validação de DEV.

O gate de CI, a migration, o deploy, o envio de recuperação de senha e o smoke
DEV estão validados.

### Fechamento operacional

O código necessário para a v0.1 está implementado. O fechamento depende agora de
configuração externa e validação operacional:

1. configurar os secrets do GitHub Environment `production`;
2. concluir os fluxos manuais de autenticação em DEV;
3. configurar os recursos/secrets PROD e executar o primeiro deploy deliberado.

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
- adapter e teste real de Hyperdrive;
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

Changesets, Semantic Versioning, GitHub Releases e publicação pública serão
ativados quando houver um consumidor externo ao workspace e depois de confirmar
o ownership do scope npm `@t00ls-dev`. Até lá:

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
- [deploy DEV automático e PROD manual](decisions/006-deployment-environments.md);
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
pnpm --filter @t00ls-dev/doctor exec doctor ./examples/basic-d1
```

Requisitos locais: Node.js 22, Corepack/pnpm e Docker para os testes PostgreSQL.
