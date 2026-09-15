# @t00ls-dev/audit

Contrato append-only para eventos de auditoria e adapters D1/PostgreSQL. O
pacote nao expoe operacoes de update ou delete.

Use `createAuditEvent` para validar metadata e `AuditStore.append` para
persistir. Chaves sensiveis como `password`, `token`, `cookie` e `secret` sao
rejeitadas antes da escrita.

As migrations ficam em `migrations/d1` e `migrations/postgres`. Garantias fortes
contra alteracao direta exigem credenciais e permissoes de banco separadas no
produto consumidor.
