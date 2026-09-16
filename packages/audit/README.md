# @t00ls-dev/audit

Contrato append-only para eventos de auditoria e adaptadores D1/PostgreSQL. O
pacote não expõe operações de atualização ou exclusão.

Use `createAuditEvent` para validar metadados e `AuditStore.append` para
persisti-los. Chaves sensíveis como `password`, `token`, `cookie` e `secret` são
rejeitadas recursivamente antes da escrita, sem distinção entre maiúsculas e
minúsculas ou entre separadores. O evento retornado contém uma cópia profunda
dos metadados validados.

As migrations ficam em `migrations/d1` e `migrations/postgres`. Garantias fortes
contra alteração direta exigem credenciais e permissões de banco separadas no
produto consumidor.
