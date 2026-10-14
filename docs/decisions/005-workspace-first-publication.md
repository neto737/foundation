# ADR-005: Publicação workspace-first

- Status: aceito
- Escopo: v0.1

## Contexto

Publicar cedo demais congela APIs imaturas. Distribuição externa exige
versionamento e autorização verificável, sem acoplar o ciclo dos produtos ao
workspace do Foundation.

## Decisão

O consumo entre exemplos, tooling e pacotes usa dependências `workspace:` no
monorepo. Os nove pacotes reutilizáveis em `packages/*` são preparados para
npmjs.com público no scope do **usuário `t00ls-dev`**, sem organização npm,
publicação dupla ou agregador. O histórico privado GitHub permanece intacto. A
preparação não altera o deploy DEV nem o gerador existente.

Quando publicados, esses pacotes usam `@t00ls-dev/*`, Changesets e Semantic
Versioning, sem GitHub Releases automáticos. Pacotes permanecem versionáveis
independentemente e apps consumidores escolhem quando atualizar. O fluxo manual
mantém audit, aprovação explícita do owner com identidade/permissão verificadas
pela API, preflight, artifacts exatos e reconciliação/resume. Bootstrap do #30
preserva seu record histórico e exige aprovação nova do snapshot/destino/bytes.
Não usa ausência de package como autorização de criação. Após bootstrap, a
continuidade é comprovada pelas versões realmente publicadas no npm.

Trusted Publishing é preparado com npm compatível e sem token persistente como
padrão. Titularidade npm, primeiro registro e OIDC remoto continuam
pré-requisitos operacionais; a preparação local não comprova sua conclusão. Veja
o [runbook](../runbooks/packages.md).

## Consequências

- A v0.1 pode ajustar boundaries sem releases artificiais.
- Testes workspace devem usar exports públicos para representar o consumo
  externo.
- Nem todo diretório se torna pacote npm.
- Breaking changes futuras exigem major version e não forçam atualização dos
  produtos.
