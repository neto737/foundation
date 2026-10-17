# @t00ls-dev/audit

Contrato append-only para eventos de auditoria e adaptadores D1/PostgreSQL. O
pacote não expõe operações de atualização ou exclusão.

Destino oficial: npmjs.com público no scope do usuário `t00ls-dev`. No
Foundation use `workspace:*`; fora dele, use uma versão publicada com a API
desejada. A migração para `pg` exige uma nova release autorizada.

Use `createAuditEvent` para validar metadados e `AuditStore.append` para
persisti-los. Chaves sensíveis como `password`, `token`, `cookie` e `secret` são
rejeitadas recursivamente antes da escrita, sem distinção entre maiúsculas e
minúsculas ou entre separadores. O evento retornado contém uma cópia profunda
dos metadados validados.

## PostgreSQL e transações

`createPostgresAuditStore` de `@t00ls-dev/audit/postgres` agora recebe
`Pick<import("pg").Client, "query">`, não `postgres.Sql`. Todos os campos são
parametrizados, mantendo timestamp `TIMESTAMPTZ`, metadata `JSONB` e `requestId`
nullable. O store não abre conexões nem inicia/encerra transações.

Para rollback conjunto com domínio/convites, injete o mesmo Client explícito
usado pelo Drizzle em `db.transaction()`, e propague falhas de `append` até o
callback. Uma escrita por outro cliente ou `pool.query()` pode escapar da
transação. Consulte o
[exemplo de composição](../tenant/README.md#transações-postgresql). Em
standalone, cada append é uma escrita independente. Validar com
`createAuditEvent` continua responsabilidade do chamador; a troca do driver não
adiciona políticas novas de metadados.

As migrations ficam em `migrations/d1` e `migrations/postgres`. Garantias fortes
contra alteração direta exigem credenciais e permissões de banco separadas no
produto consumidor.
