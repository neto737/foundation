# Deploy

Cada produto possui deploy independente. O Foundation valida somente o fluxo DEV
usando `examples/links`. O
[publicador manual Levi](../../.github/workflows/deploy-levi-dev.yml) é
independente, usa o Environment `levi-dev` e não chama o coordenador D1. A
transferência DEV já foi concluída. O gate canônico `LEVI_DEPLOY_READY` exige
migração administrativa do cadastro legado antes de usar esta revisão. Esta
alteração não muda gates reais nem autoriza dispatch; ver
[Deploy Levi DEV](../../apps/levi/docs/deploy-dev.md).

A política aprovada exige migrations persistentes em operação independente e
autorizada. O job deploy já verifica schema com D1 Read, sem credencial
migradora; o workflow completo ainda coordena fases modificadoras em outros
jobs. Esse desacoplamento operacional permanece pendente pelos motivos em
[Migrations](migrations.md#política-aprovada-e-desacoplamento-pendente). Os
workflows/publicadores não foram alterados na preparação de `apps/*`.

## DEV manual e reativação pendente

O workflow `Deploy DEV` aceita exclusivamente `workflow_dispatch`, com
`execution_sha` obrigatório igual ao SHA atual de master. A entrada
`workflow_run` foi removida, e o job `validate` rejeita eventos automáticos,
incluindo conclusões antigas da CI e suas reexecuções. Os jobs operacionais
dependem dessa validação e da cadeia de sucesso existente.

Como registro histórico, na conferência de 25/10/2026 o workflow remoto estava
`disabled_manually`. Na consulta via `gh api` de 27/10/2026, os publicadores
`deploy-dev.yml` e `deploy-levi-dev.yml` estavam `active`. Esse estado permite
receber eventos; suas definições exigem `workflow_dispatch`, sem deploy
automático por push. A consulta não determina quando ou por quem foram ativados
nem autoriza dispatch. Cada execução futura também exige autorização específica
para o ciclo completo, incluindo as fases persistentes. O modo manual não
implementa o desacoplamento permanente de migrations.

Como registro histórico anterior ao modo manual, em 16/10/2026 a execução
automática pós-reativação foi confirmada: o
[run 38788787384](https://github.com/t00ls-dev/foundation/actions/runs/38788787384)
concluiu com sucesso para o SHA `abe0483d8ef6366b81e5b8d0da0dcd086559451e`, após
a
[CI aprovada](https://github.com/t00ls-dev/foundation/actions/runs/38788305767)
do mesmo SHA. Esse registro não substitui os gates de execuções futuras.

Um push em `master` executa a CI completa, sem iniciar Deploy DEV. Um dispatch
autorizado recebe o SHA validado e coordena expand/deploy/backfill/contract em
jobs independentes. O job de deploy **não aplica migrations**: verifica schema
read-only, publica o Worker e consulta `/health` no Custom Domain
`foundation.t00ls.dev`. O endpoint verifica D1 e expõe `X-Foundation-SHA` quando
configurado; a versão Cloudflare também recebe tag do SHA. O deploy não repete
os testes.

A evidência da CI exige repositório e head repository `t00ls-dev/foundation`,
evento `push` e branch `master`; uma CI de PR não a substitui. A entrada do
deploy exige evento manual no próprio repositório, ref master e SHA exato. Antes
de instalar dependências do SHA alvo, um checkout do SHA confiável do workflow
fornece o validador; a API confirma identidade/path do workflow CI, run
concluído com `success` e job `checks` concluído com `success` no mesmo SHA e
tentativa. Reruns que alterem a tentativa durante a consulta bloqueiam o deploy.
O segundo checkout usa somente o SHA aprovado pelo validador. PRs/forks e
artifacts de CI não fornecem código para o deploy privilegiado. Exige master
atual no SHA autorizado e revalida cada fase. Credenciais Git não persistem nos
checkouts; secrets Cloudflare ficam apenas nos steps de migration e deploy, não
na instalação ou validação. O cache pnpm usa o escopo de master do GitHub, sem
recuperar caches das refs de PR.

O workflow aguarda a conclusão da CI, incluindo Version Packages. Falha no
versionamento bloqueia o deploy mesmo se `checks` passou; o SHA permanece
identificável para investigação. O ciclo manual usa `workflow_dispatch`, somente
master/SHA atual e CI aprovada; não é atalho para código de PR.

Uma falha de migration, deploy ou health check encerra o workflow com erro.
`DEV_HEALTH_URL` deve conter `https://foundation.t00ls.dev`; o smoke SHA/D1 é
obrigatório. Expand necessário com falha bloqueia deploy; contract inelegível é
adiado sem erro. Dirty bloqueia avanço, sem derrubar o Worker implantado. Veja
[Migrations](migrations.md) para metadata, serialização e recuperação.
Aplicações consumidoras implementam seus próprios deploys DEV e PROD.

## Resumos do Actions

Cada job apresenta sua própria operação em tabelas de duas colunas: `VALIDATE`,
`EXPAND`, `DEPLOY / VERIFY`, `BACKFILL` e `CONTRACT`. A visão do deploy inclui
DEV, SHA autorizado, run/tentativa, resultados independentes de publicação e
saúde SHA/D1 e links para os steps e artifacts da execução. O SHA curto é um
link para o commit completo. Não há versão/release nem duração total inventada:
os steps atuais não fornecem esses dados estruturados ao renderer. Migrations
mostram a duração entre `startedAt` e `finishedAt`, sem setup/upload.

Interprete os estados separadamente:

| Estado                 | Significado                                                                    |
| :--------------------- | :----------------------------------------------------------------------------- |
| Succeeded              | Step concluído com sucesso ou operação confirmada no JSON.                     |
| Failed                 | Falha operacional; `dirty` indica efeitos incertos que exigem diagnóstico.     |
| Already applied        | Journal e postcondição confirmados; SQL não executado nesta operação.          |
| No operations required | Fase concluída, sem operações registradas para essa fase.                      |
| Skipped                | Step não executado ou operação inelegível; não comprova execução bem-sucedida. |
| Cancelled              | Cancelamento informado pelo Actions; não comprova ausência de efeitos.         |
| Unknown / interrupted  | Evidência insuficiente, incompleta ou indisponível; não é sucesso.             |

`Job até o resumo` é o estado do job no momento do step informativo. Uma fase
CONTRACT pode encerrar seu job com sucesso e apresentar operações `Skipped`
porque são inelegíveis. A saúde é comprovada somente quando o smoke conclui com
`Succeeded`; iniciar o deploy ou o smoke não comprova sucesso. O resumo de
deploy não é uma conclusão global do ciclo: BACKFILL e CONTRACT ainda podem
falhar. O resultado final nativo do Actions, incluindo pós-steps, permanece
autoritativo.

Os detalhes recolhíveis mostram IDs numéricos das migrations e digest do plano
em duas linhas. Nomes completos, transições, evidências e SHA completo continuam
no JSON. As contagens refletem somente operações **registradas**: falhas de
autorização, probes ou setup podem interromper a fase antes de registrar todas
as migrations consideradas pelo executor. Falhas `dirty` não contam todas as
possíveis causas de falha do job. Recovery não possui contagem de SQL no formato
atual; seu resumo distingue `Reconciled` e `Already reconciled`.

Para investigar, abra os steps/logs pelo link do resumo, confira o JSON completo
emitido por `migrations.mjs` e baixe `migration-<fase>-<run>-<attempt>` na lista
de artifacts (retenção de 30 dias). VERIFY conserva seu JSON nos logs do step de
schema; Recovery mantém seu artifact existente. Compare SHA, tentativa e digest
antes de usar a evidência; consulte também os journals persistentes descritos em
[Migrations](migrations.md). Nenhum JSON, artifact ou histórico é substituído
pelo Markdown.

O resumo é derivado e **não autoriza deploy, SQL ou recovery**. Identidade,
provenance, CI e gates continuam sendo validados pelos scripts operacionais. O
renderer local não consulta APIs nem lê credenciais; seus steps dedicados não
recebem secrets. Exibe apenas campos permitidos e não inclui SQL, mensagens
arbitrárias de erro ou evidência aninhada. Falhas de renderização/escrita emitem
aviso seguro sem alterar exit codes operacionais; a indisponibilidade do próprio
script aparece no step informativo.

Jobs inteiramente skipped não executam steps de resumo. Cancelamento/perda do
runner pode impedir o step `always()` e a gravação do JSON. Nesse caso, use os
resultados nativos e a auditoria persistente; não deduza que uma mutation não
ocorreu. Tabelas estreitas e detalhes recolhíveis favorecem mobile, mas o app do
GitHub pode variar na renderização de `<details>` e links. Não há teste visual
automatizado do app GitHub mobile.

## Migrations e rollback

Siga [Migrations](migrations.md). O fluxo normal é forward-fix: uma migration já
aplicada não deve ser editada nem revertida destrutivamente. O rollback de
código só é seguro quando a versão anterior continua compatível com o schema
atual.

Em uma falha:

1. interrompa novas promoções;
2. preserve logs, SHA e resultado da migration;
3. corrija o schema com uma nova migration ou publique código compatível;
4. execute novamente o gate e o smoke;
5. registre a decisão quando houver impacto arquitetural.

## Secrets

Workflows recebem apenas nomes de secrets documentados. Valores nunca devem ser
impressos, gravados em summaries ou passados como inputs comuns de workflow.

Antes do merge/ativação, provisione as credenciais operacionais no **GitHub
Environment `dev`**, conforme [Ambientes](environments.md). Deploy, migration
reutilizável e recovery referenciam esse Environment; validate/CI não. O job do
workflow chamado resolve seus Environment Secrets, com repasse explícito de
nomes canônicos pelo caller. Não há aprovação manual nova para DEV nem
configuração automática dos secrets. Não há fallback para token de deploy em
migration. O inventário do GitHub confirmado em 11/10/2026 contém somente o
Environment `dev`; o Foundation não possui Environment nem operação PROD.

## Diagnósticos operacionais sanitizados

Os scripts internos de CI, smoke e migrations emitem uma linha JSON de falha com
`code: FOUNDATION_DEPLOY_DIAGNOSTIC`. `phase` identifica `ci`, `health` ou
`migrations`; `check` identifica a consulta ou validação definida no código. Por
exemplo, `health-read` indica a consulta, `health-json` a leitura do JSON,
`health-sha` o SHA e `health-database` a saúde do banco. Nas migrations,
`d1-query`/`d1-result` identificam consulta/resposta administrativa;
`deployments-read`, `version-read` e `deployment-validation` identificam as
etapas de comprovação do deployment. O relatório de migration continua
identificando a fase expand/backfill/contract/verify/recover.

| `category`            | Interpretação operacional                                           |
| --------------------- | ------------------------------------------------------------------- |
| `http`                | A resposta HTTP foi rejeitada pelo validador existente.             |
| `unexpected-response` | JSON ou estrutura/conteúdo da resposta não comprovou o esperado.    |
| `configuration`       | Contexto, identidade, SHA ou outra condição obrigatória divergente. |
| `network`             | A requisição falhou antes de fornecer uma resposta HTTP.            |
| `local-operation`     | Falha em leitura/escrita local, comando ou preparação da operação.  |

`http_status` pertence somente à consulta corrente e suas validações diretas. É
`null` antes de obter resposta, nas operações locais e nas validações que
combinam evidências de consultas distintas. Nunca é deduzido de propriedades do
erro. `reason` contém somente um código técnico permitido, `TIMEOUT` ou
`UNKNOWN`; não contém mensagens, URLs, corpos, stacks ou credenciais. Getters,
proxies e causas cíclicas não são executados/serializados para gerar a linha.
`UNKNOWN` significa que não há classificação segura disponível.

Use `phase`/`check` para localizar a operação no script e consulte os resultados
nativos e a evidência sanitizada existente. No smoke, a linha descreve a última
falha após esgotar as seis tentativas existentes, mantendo as esperas de cinco
segundos. O diagnóstico não aprova execução, não confirma ausência de efeitos e
não autoriza retries ou recovery. Uma falha ao escrever o diagnóstico preserva o
resultado operacional, inclusive o erro original nas funções internas.

Para adaptar em outro produto, mantenha um auxiliar interno independente de
npm/release, com fases, verificações, categorias e códigos técnicos fechados.
Inicie contexto novo antes de cada operação independente; preserve o status
somente ao inspecionar a resposta correspondente. Reutilize os validadores e as
políticas de tentativas/timeouts do produto. Teste erros hostis, ausência de
segredos, limpeza de contexto e preservação dos gates/resultados com dados
sintéticos. Não há pacote npm, API pública ou dependência com o Levi.
