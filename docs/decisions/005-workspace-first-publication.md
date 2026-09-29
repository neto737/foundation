# ADR-005: Publicação workspace-first

- Status: aceito
- Escopo: v0.1

## Contexto

Publicar cedo demais congela APIs imaturas e depende da configuração do GitHub
Packages para o scope `@t00ls-dev`.

## Decisão

O consumo entre exemplos, tooling e pacotes usa dependências `workspace:` no
monorepo. A preparação de nove pacotes reutilizáveis em `packages/*` para GitHub
Packages privado não altera o deploy DEV. A publicação permanece bloqueada até
revisão explícita do acesso e da automação.

Quando publicados, esses pacotes usam `@t00ls-dev/*`, Changesets e Semantic
Versioning, sem GitHub Releases automáticos. Pacotes permanecem versionáveis
independentemente e apps consumidores escolhem quando atualizar.

## Consequências

- A v0.1 pode ajustar boundaries sem releases artificiais.
- Testes workspace devem usar exports públicos para representar o consumo
  externo.
- Nem todo diretório se torna pacote npm.
- Breaking changes futuras exigem major version e não forçam atualização dos
  produtos.
