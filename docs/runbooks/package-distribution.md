# Contratos de consumo local

Os pacotes Foundation são privados e consumidos exclusivamente no monorepo por
dependências `workspace:*`, resolvidas como links locais pelo pnpm. A
distribuição npm foi encerrada; não há automação de publicação ou versionamento
por Changesets. Versões e changelogs existentes são históricos. Builds, APIs,
testes e deploys das aplicações permanecem independentes.

Execute `pnpm test:workspace` para conferir manifests, lockfile e links reais
dos consumidores, incluindo Levi, Links e ferramentas. Build, typecheck e testes
usam os exports dos pacotes locais.

Os adaptadores D1 preservam seus tipos oficiais e o perfil Workers de `db/d1`;
veja o [README do db](../../packages/db/README.md).
