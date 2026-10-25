# Testes

O gate oficial é:

```bash
pnpm check
```

Ele verifica a formatação e executa lint, typecheck, testes unitários,
integrações, builds e Playwright. O Docker deve estar disponível para PostgreSQL
por Testcontainers. O Playwright requer Chromium instalado.

Inclui `pnpm test:migrations`: fases/metadata, SQL conservador, guards
CI/deploy, dirty/retry/recuperação e evidências de contract, com ciclo em D1
Miniflare descartável. Não usa credenciais remotas. CI obtém histórico Git
completo para conferir imutabilidade dos SQL versionados.

Em Actions, o gate completo é dividido entre `static`, `tests`, quatro shards
`e2e` (com Chromium e ambiente próprios) e duas instalações `distribution`. O
Levi possui jobs próprios `levi-tests` e `levi-e2e`, sem secrets ou Environment.
O agregador obrigatório `checks` exige sucesso de todos esses jobs, inclusive de
todas as entradas das matrizes; falha, cancelamento ou skip bloqueiam o gate.
Version Packages depende desse job; Release manual e sua aprovação separada do
owner validam pela API a CI aprovada do `execution_sha` exato, sem repetir a
suíte. Não se substituem testes por cache de resultados. Reexecuções explícitas
da CI e SHAs distintos (PR/merge) continuam sendo validados integralmente. Veja
[Pacotes](packages.md) para os requisitos da evidência reutilizada.

### Resumos no GitHub Actions

Os testes Vitest exibem um resumo compacto por pacote e suíte em
`GITHUB_STEP_SUMMARY`, usando os resultados e diagnósticos da API do framework.
Incluem Passed, Failed, Skipped (também `todo`), Flaky e duração desde a
inicialização do reporter. No Vitest, Flaky é subconjunto de Passed.

Cada shard Playwright apresenta sua identificação `N/4`, as contagens finais
obtidas por `TestCase.outcome()` e a duração nativa. Passed significa resultado
esperado, incluindo falhas esperadas; Flaky é separado de Passed. Erros de
coleta/setup são destacados sem transformá-los em falhas de testes fictícias. O
reporter `github`, os retries e os traces existentes continuam ativos.

Distribuição resume os tarballs, imports públicos e instalações efetivamente
validados, além da duração. Não atribui contagens de testes a esses contratos.
As durações dos reporters não incluem setup de Node/dependências nem builds
anteriores. Release e checks estáticos mantêm os diagnósticos e estados de steps
nativos do Actions. Deploy/migrations apresentam os resultados estruturados e
outcomes dos steps conforme [Deploy](deployment.md#resumos-do-actions).
`pnpm test:migrations` inclui os contratos de renderização: execução,
reaplicação, no-op, falha/dirty, inelegibilidade, cancelamento, JSON incompleto,
proteção de informações sensíveis e falhas de escrita. Usa um JSON real
sanitizado do Deploy DEV #84 e variações no formato dos registros existentes,
sem mutation remota.

Os resumos são informativos: nenhuma contagem é extraída de logs, o estado e o
exit code dos frameworks determinam o gate, e falhas de escrita de resumo não
alteram os resultados. Nenhum serviço externo ou runner adicional é necessário.

## Durante o desenvolvimento

Execute primeiro o pacote alterado:

```bash
pnpm --filter <pacote> lint
pnpm --filter <pacote> typecheck
pnpm --filter <pacote> test
pnpm --filter <pacote> build
```

Antes de enviar uma mudança, execute `pnpm check` e `pnpm format:check`.

## Cobertura esperada

- primitivas públicas: testes unitários de contrato;
- D1/PostgreSQL e isolamento de tenant: testes de integração reais;
- gerador: conteúdo, segurança do destino e build fora do workspace;
- fluxos de usuário e acessibilidade: Playwright desktop e mobile;
- deploy: smoke test em `/health` no DEV publicado, incluindo conectividade D1.

Mocks não substituem os testes de banco existentes. Testes E2E não devem
depender de providers externos para permanecer deterministas.

## PostgreSQL (`pg`)

```bash
pnpm --filter @t00ls-dev/integration-tests test:integration
```

`postgres/database.test.ts` usa PostgreSQL 17 em Testcontainers e cobre o Client
conectado compartilhado com Drizzle, tipos de dados, parametrização,
encerramento e falha de conexão, migration/status/seed e reaplicação pelo
histórico existente. Também valida isolamento de tenant, concorrência e falha
standalone de convites, commit/rollback conjunto de domínio/convites/auditoria e
triggers append-only.

Better Auth é exercitado com fixture PostgreSQL de IDs textuais, verificação de
e-mail, login/sessão/logout, reset e magic link. Os e-mails são capturados em
memória, sem envio real ou alteração dos defaults de autenticação.

O Worker sintético é compilado em memória com a condição `workerd` (necessária
para `pg-cloudflare`) e executado em Miniflare com a data de compatibilidade
`2025-09-01` e `nodejs_compat`, como Links. Invocações distintas criam conexões
próprias, executam queries raw/Drizzle e testam commit/rollback de audit. O
binding Hyperdrive local aponta somente ao container descartável: não exercita o
pooling/cache do serviço nem comprova compatibilidade remota com Hyperdrive.

As fixtures de auth e o SQL audit existente são aplicados somente no container;
nenhuma migration de banco persistente é executada por esse harness. Os testes
de distribuição validam o novo contrato assíncrono e tipos públicos `pg` em
tarballs isolados, sem instalar Postgres.js como dependência do consumidor.

## Links (`examples/links`)

```bash
pnpm --filter @t00ls-dev/example-links test
pnpm --filter @t00ls-dev/example-links test:integration
pnpm --filter @t00ls-dev/example-links build
pnpm --filter @t00ls-dev/example-links test:e2e
```

Integração aplica as migrations reais em D1 Miniflare descartável e cobre auth,
CRUD, filtros, isolamento A/B, CSRF, expiração/revogação e múltiplos Set-Cookie.
Também injeta falhas na execução de queries para verificar confirmação de logout
sem renovação, retry após recuperação e ausência de tokens/parâmetros nos logs.
E2E usa um Worker/configuração próprios, captura e-mail em banco temporário e
valida nove cenários em desktop e mobile, incluindo `401` de mutação antiga após
login de outra identidade sem recarregar a página. Nenhum teste envia e-mail
real. A caixa `/__test/mail` pertence apenas a `e2e/worker.ts`, fora do bundle
DEV. O harness não reutiliza servidor ou estado de desenvolvimento e executa
migration duas vezes para conferir reaplicação idempotente pelo journal
Wrangler.

O E2E de security headers usa também o Worker de produção compilado e Workers
Assets reais em Wrangler local (porta 5175, D1 descartável e chaves Turnstile
fictícias). Por isso requer o build antes de `test:e2e`, já ordenado pelo gate
`pnpm check`. Verifica a resposta final de `/`, `/bookmarks`, um JavaScript
estático e `/health`, incluindo CSP, proteção contra framing e Referrer-Policy.

## Contratos de preparação do workspace

`pnpm test:release` também executa `workspace.test.mjs`: descoberta com `apps/*`
ausente ou com aplicativo privado sintético, rejeição de publicáveis
inesperados, nomes duplicados e symlinks, planejamento privado sem upload npm e
build real de um fecho transitivo pelo Turbo, inclusive através de pacote sem
script de build. As fixtures vivem em diretórios temporários; não criam
`apps/levi` no projeto. A suíte de release preserva a recomputação de planos nas
bases históricas sem `apps/*`. Esses contratos complementam o gate integral, sem
dispensar jobs ou aceitar `skipped` como sucesso.

## Levi (`apps/levi`)

A [aplicação](../../apps/levi/README.md) preserva `node:test` via tsx,
PostgreSQL sintético, ACLs restritas, Node/web, dry-run Worker e E2E
desktop/mobile/proxy. O build usa os exports públicos e `^build` dos pacotes
workspace; não depende de publicação npm. A CI separa o Levi dos comandos que
encaminham reporters Vitest e dos shards do Links para não duplicar ou omitir
sua cobertura.

`pnpm test:levi:runtime`, incluído no gate local, executa dry-run Worker,
integração/Worker e E2E com `--runtime-acls`. As tasks normais continuam
cobrindo o modo padrão. Os harnesses criam e removem seus containers,
aplicando/reaplicando migrations somente nesses bancos descartáveis, sem
credenciais persistentes. Nenhum teste ou build aciona o deploy do repositório
original.

`pnpm test:release` inclui os contratos de incorporação: árvore e histórico
subtree originais, exatamente nove publicáveis, sete links locais, grafo de
builds, imports públicos e ausência de Environment/deploy nos jobs Levi. Os
contratos estruturais existentes da CI exigem todos os comandos novos e recusam
falha, cancelamento, omissão, skip, jobs desligados ou gates mascarados.
