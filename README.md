<h1 align="center">Foundation</h1>

<p align="center">
  Base modular em TypeScript para aplicações web Cloudflare-first da t00ls-dev.<br>
  Autenticação, dados, isolamento por tenant e segurança em pacotes reutilizáveis.
</p>

<p align="center">
  <a href="https://github.com/t00ls-dev/foundation/actions/workflows/ci.yml"><img src="https://github.com/t00ls-dev/foundation/actions/workflows/ci.yml/badge.svg?branch=master" alt="CI da branch master"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/Node.js-%3E%3D22.22.0-339933" alt="Node.js 22.22.0 ou superior"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/licen%C3%A7a-MIT-blue" alt="Licença MIT"></a>
</p>

<p align="center">
  <a href="#pacotes-oficiais">Pacotes</a> ·
  <a href="#início-rápido">Início rápido</a> ·
  <a href="#documentação">Documentação</a> ·
  <a href="CONTRIBUTING.md">Contribuição</a>
</p>

---

O Foundation reúne infraestrutura de aplicação sem regras de negócio de um
produto específico. Combina **React SPA e API Hono no mesmo Cloudflare Worker**,
com D1 como preset inicial e suporte a PostgreSQL via Drizzle.

Os **nove pacotes oficiais estão publicados no npm**. O repositório inclui
[Links](examples/links/README.md), uma biblioteca privada de bookmarks que
demonstra a integração dos pacotes. Inclui também o [Levi](apps/levi/README.md),
aplicação privada de gestão de igrejas com domínio e banco próprios. O projeto
está em evolução; consulte o [estado atual](docs/project-status.md) para
entregas e pendências. O exemplo possui fluxo de deploy manual somente em DEV;
cada execução exige autorização específica, conforme o
[runbook](docs/runbooks/deployment.md). Aplicações consumidoras definem seus
próprios ambientes e controladores de deploy.

O Foundation é a base principal da consolidação em monorepo. O workspace já
aceita `apps/*`; o Levi está incorporado em `apps/levi` com histórico
preservado, sem transferência operacional. Links permanece em `examples/links`.
Aplicações consomem pacotes com `workspace:*`, mantendo versões, deploys e
recursos próprios. Publicar no npm continua sendo uma operação opcional e
separada do consumo interno; consulte
[versionamento e publicação](docs/runbooks/packages.md#planos-de-componentes-e-publicação).

## Principais funcionalidades

- **Autenticação self-hosted:** Better Auth com senha, verificação de e-mail,
  recuperação, magic link e Google OAuth opcional.
- **Multi-tenancy e autorização:** contexto de tenant, memberships e convites,
  com permissões separadas da autenticação.
- **Dados com limites explícitos:** adapters Drizzle para D1 e PostgreSQL,
  migrations sob responsabilidade de cada aplicação e testes reais de banco.
- **Segurança configurável:** headers, CSP, CORS, CSRF, Turnstile e rate
  limiting.
- **E-mail, logs e auditoria:** integração Resend, logging JSON contextual e
  eventos de auditoria append-only.
- **Qualidade automatizada:** TypeScript strict, Vitest, Miniflare,
  Testcontainers e Playwright, incluindo cenários desktop e mobile.
- **Ferramentas no workspace:** gerador `basic-d1`, diagnóstico read-only com
  Doctor e base UI compartilhada usada pelo exemplo Links.

## Pacotes oficiais

Disponíveis publicamente no [npm](https://www.npmjs.com/~t00ls-dev), no scope
`@t00ls-dev`, com versões independentes:

- [**@t00ls-dev/config**](https://www.npmjs.com/package/@t00ls-dev/config) —
  configuração tipada de ambiente, bancos e capabilities.
- [**@t00ls-dev/db**](https://www.npmjs.com/package/@t00ls-dev/db) — factories
  Drizzle para D1 e PostgreSQL e consulta do journal PostgreSQL.
- [**@t00ls-dev/auth**](https://www.npmjs.com/package/@t00ls-dev/auth) —
  integração Better Auth e resolução tipada de sessão no servidor.
- [**@t00ls-dev/tenant**](https://www.npmjs.com/package/@t00ls-dev/tenant) —
  isolamento por tenant, memberships, troca de tenant ativo e convites.
- [**@t00ls-dev/access**](https://www.npmjs.com/package/@t00ls-dev/access) —
  autorização por permissões e roles configuráveis.
- [**@t00ls-dev/security**](https://www.npmjs.com/package/@t00ls-dev/security) —
  proteções HTTP, Turnstile e rate limiting com storage injetável.
- [**@t00ls-dev/email**](https://www.npmjs.com/package/@t00ls-dev/email) —
  contrato substituível de envio de e-mail com implementação Resend.
- [**@t00ls-dev/observability**](https://www.npmjs.com/package/@t00ls-dev/observability)
  — logs JSON estruturados com contexto de request, usuário e tenant.
- [**@t00ls-dev/audit**](https://www.npmjs.com/package/@t00ls-dev/audit) —
  eventos append-only em D1/PostgreSQL, com rejeição de chaves sensíveis na
  metadata.

Os antigos pacotes privados do GitHub Packages foram removidos; **npmjs.com é o
registry oficial**, sem publicação dupla. UI, create-app, Doctor e demais
workspaces privados não são publicados. Detalhes de consumo e publicação estão
no [runbook de pacotes](docs/runbooks/packages.md).

## Requisitos

Para desenvolver neste repositório:

- **Node.js 22.23.3**, patch validado pelo projeto; o mínimo declarado é
  `>=22.22.0`.
- **Corepack e pnpm 10.15.1**, fixado no `package.json`.
- **Docker**, para os testes PostgreSQL com Testcontainers.
- **Chromium e dependências de sistema**, para os testes E2E com Playwright.

## Instalação

### Consumir um pacote

Em uma aplicação existente, instale os pacotes necessários. Por exemplo:

```bash
pnpm add @t00ls-dev/config
```

Consulte os READMEs em [`packages/`](packages) para as APIs e requisitos de cada
pacote e o [guia de criação de aplicações](docs/runbooks/creating-an-app.md)
para montar um projeto consumidor.

### Preparar o repositório

```bash
git clone https://github.com/t00ls-dev/foundation.git
cd foundation
corepack enable
pnpm install --frozen-lockfile
pnpm build
```

O desenvolvimento local usa dependências `workspace:*` e não requer token
privado de registry.

## Início rápido

Com as dependências instaladas e compiladas, copie a configuração do exemplo:

```bash
cp examples/links/.dev.vars.example examples/links/.dev.vars
```

Edite `.dev.vars`: substitua `AUTH_SECRET` por um segredo local aleatório de
pelo menos 32 caracteres e ajuste `BASE_URL` para a origem usada pelo servidor.
Configure `EMAIL_FROM` e `RESEND_API_KEY` próprios para os fluxos de e-mail;
Google OAuth é opcional. Não versione esse arquivo nem use credenciais de DEV
nos testes.

Prepare o D1 local e inicie Links:

```bash
pnpm --filter @t00ls-dev/example-links db:migrate:local
pnpm dev
```

Abra a URL informada pelo servidor. A verificação de e-mail é obrigatória para
acessar a área privada. Veja o
[guia do exemplo](examples/links/README.md#desenvolvimento-local) para
configuração de origem, HMR e fluxos de autenticação.

Para executar o gate completo, com Docker disponível:

```bash
pnpm --filter @t00ls-dev/example-links exec playwright install --with-deps chromium
pnpm check
```

Os testes usam bancos descartáveis e e-mails capturados, sem credenciais de
deploy ou envio real. O [runbook de testes](docs/runbooks/testing.md) descreve
as suítes e os checks focados.

## Documentação

- **Visão do projeto:** [arquitetura](docs/architecture/overview.md),
  [decisões técnicas](docs/decisions) e [estado atual](docs/project-status.md).
- **Construir aplicações:** [criação de apps](docs/runbooks/creating-an-app.md),
  [exemplo Links](examples/links/README.md) e
  [pacotes e releases](docs/runbooks/packages.md).
- **Desenvolver e operar:** [testes](docs/runbooks/testing.md),
  [ambientes](docs/runbooks/environments.md),
  [deploy](docs/runbooks/deployment.md) e
  [migrations](docs/runbooks/migrations.md).
- **Proteção de dados:** [segurança](docs/runbooks/security.md),
  [bypass de cache obrigatório](docs/runbooks/cache.md) e
  [LGPD](docs/runbooks/lgpd.md).

## Contribuição

Issues e pull requests focados são bem-vindos. Leia
[CONTRIBUTING.md](CONTRIBUTING.md) para os padrões de contribuição, validação e
integração. Mudanças em pacotes distribuídos seguem o fluxo de Changesets.

## Segurança

Para comunicar vulnerabilidades, siga [SECURITY.md](SECURITY.md). Não exponha
detalhes exploráveis, credenciais ou dados pessoais em issues públicas.

## Licença

O código próprio é distribuído sob a [licença MIT](LICENSE), com copyright de
2026 da t00ls-dev. Licenças e avisos de terceiros permanecem vigentes; consulte
[licenças e distribuição](docs/runbooks/licensing.md).
