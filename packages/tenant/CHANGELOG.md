# @t00ls-dev/tenant

## 1.0.0

### Major Changes

- 4b9be86: Substitui integralmente Postgres.js por `pg` no caminho PostgreSQL,
  mantendo Drizzle ORM e os entrypoints públicos. Mudança incompatível: aguarde
  `createPostgresDatabase(connectionString)`, que retorna `{ client, db }` com
  `pg.Client` conectado e `NodePgDatabase`; consultas raw usam `client.query()`
  e `result.rows`, sem tagged templates, `.unsafe()` ou `.begin()`.

  Os adapters de tenant/audit e o helper de status recebem executor `query` de
  `pg`, com tipos distribuídos ao consumidor. Convite+membership são consumidos
  em uma única instrução atômica, sem commit interno; composição explícita no
  mesmo Client de `db.transaction()` permite rollback conjunto com domínio e
  auditoria, preservando o uso standalone e os contratos independentes do
  driver.

  Schemas, migrations, snapshots e journals existentes são preservados. Os
  testes usam PostgreSQL descartável, Better Auth com IDs textuais e workerd
  local; não comprovam compatibilidade remota com Hyperdrive. Dados sensíveis
  devem usar binding Hyperdrive com query caching desabilitado. D1 e seus
  consumidores mantêm seus contratos.

## 0.1.2

### Patch Changes

- ab27036: Adota a licença MIT aprovada e inclui seu texto na distribuição, com
  o aviso `Copyright (c) 2026 t00ls-dev` confirmado pelo mantenedor.

## 0.1.1

### Patch Changes

- 8d448c4: Remove declaration maps referencing unpublished sources and
  references to private TypeScript tooling from packed manifests. Make D1
  declaration dependencies explicit using the official Cloudflare types,
  including the ambient types required by Drizzle's D1 declarations, without
  changing runtime behavior or public exports.
