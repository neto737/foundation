# ADR-005: Consumo interno pelo workspace

- Status: aceito; substitui a decisão anterior de distribuição npm.
- Escopo: Foundation e consumidores do monorepo.

## Contexto

Links e Levi consomem pacotes locais; a distribuição npm adicionava um ciclo de
release desnecessário ao desenvolvimento integrado.

## Decisão

Os pacotes Foundation são privados e consumidos exclusivamente no monorepo por
dependências `workspace:*`, resolvidas como links locais pelo pnpm. A
distribuição npm foi encerrada; não há automação de publicação ou versionamento
por Changesets. Versões e changelogs existentes são históricos. Builds, APIs,
testes e deploys das aplicações permanecem independentes.

## Consequências

Todos os workspaces permanecem privados. Dependências internas usam
`workspace:*`; consumidores usam exports públicos e builds ordenados pelo grafo.
Changesets e os workflows de publicação são removidos. Registros externos
existentes não são alterados. Deploy e migrations seguem seus gates.

Veja o [runbook de pacotes](../runbooks/packages.md).
