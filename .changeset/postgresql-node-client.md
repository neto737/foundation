---
"@t00ls-dev/db": major
"@t00ls-dev/tenant": major
"@t00ls-dev/audit": major
---

Substitui integralmente Postgres.js por `pg` no caminho PostgreSQL, mantendo
Drizzle ORM e os entrypoints públicos. Mudança incompatível: aguarde
`createPostgresDatabase(connectionString)`, que retorna `{ client, db }` com
`pg.Client` conectado e `NodePgDatabase`; consultas raw usam `client.query()` e
`result.rows`, sem tagged templates, `.unsafe()` ou `.begin()`.

Os adapters de tenant/audit e o helper de status recebem executor `query` de
`pg`, com tipos distribuídos ao consumidor. Convite+membership são consumidos em
uma única instrução atômica, sem commit interno; composição explícita no mesmo
Client de `db.transaction()` permite rollback conjunto com domínio e auditoria,
preservando o uso standalone e os contratos independentes do driver.

Schemas, migrations, snapshots e journals existentes são preservados. Os testes
usam PostgreSQL descartável, Better Auth com IDs textuais e workerd local; não
comprovam compatibilidade remota com Hyperdrive. Dados sensíveis devem usar
binding Hyperdrive com query caching desabilitado. D1 e seus consumidores mantêm
seus contratos.
