# ADR-006: Ambientes por aplicação

- Status: aceito; atualizado após remoção do exemplo D1
- Escopo: operação do monorepo

## Contexto

A fundação fornece pacotes compartilhados. O exemplo e suas automações DEV foram
removidos; o Levi mantém recursos e operação próprios.

## Decisão

Cada aplicação define ambientes, secrets e políticas de promoção. O deploy do
Levi permanece manual, condicionado à CI aprovada do SHA exato e aos gates
existentes. CI usa bancos descartáveis sem credenciais persistentes. Migrations
persistentes exigem operação independente e autorizada, sem execução automática
em CI, deploy ou startup. Nenhum recurso remoto foi excluído nesta remoção.

## Consequências

- Criar um PR não autoriza merge, deploy ou publicação.
- Rollback de código não presume rollback destrutivo de migration.
- Infraestrutura remota antiga exige inventário e autorização separados.
- O [runbook de migrations](../runbooks/migrations.md) mantém os contratos de
  evolução.
