# ADR-005: Publicação workspace-first

- Status: aceito
- Escopo: v0.1

## Contexto

Publicar cedo demais congela APIs imaturas e depende da disponibilidade e
configuração do scope npm `@t00ls-dev`.

## Decisão

O consumo inicial entre exemplos, tooling e pacotes usa dependências
`workspace:` no monorepo. Publicação npm não é requisito para validar a v0.1.
Antes da primeira publicação pública, o scope e as permissões no npm devem ser
confirmados.

Quando publicada, cada unidade tecnicamente justificada usa `@t00ls-dev/*`,
Changesets, Semantic Versioning, GitHub Releases e release automatizado. Pacotes
permanecem versionáveis independentemente e apps consumidores escolhem quando
atualizar.

## Consequências

- A v0.1 pode ajustar boundaries sem releases artificiais.
- Testes workspace devem usar exports públicos para representar o consumo
  externo.
- Nem todo diretório se torna pacote npm.
- Breaking changes futuras exigem major version e não forçam atualização dos
  produtos.
