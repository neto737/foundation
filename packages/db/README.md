# `@t00ls-dev/db`

Factories mínimas do Drizzle ORM para Cloudflare D1 e PostgreSQL via
`postgres.js`.

## Quando usar

Use para padronizar a criação de clientes nos dialetos suportados. Não use como
camada de repositório, definição de schema, pool genérico ou executor de
migrações.

## Instalação

Pacote privado do workspace; não é publicado em registry.

```sh
pnpm --filter <app> add '@t00ls-dev/db@workspace:*'
```

## API

- `@t00ls-dev/db`: tipos `DatabaseDialect` e `MigrationStatus`.
- `@t00ls-dev/db/d1`: `createD1Database(binding)` retorna uma instância Drizzle.
- `@t00ls-dev/db/postgres`: `createPostgresDatabase(connectionString)` retorna
  `{ client, db }`.
- `@t00ls-dev/db/postgres-migrations`: consulta o status do journal oficial de
  migrations Drizzle no PostgreSQL.

## Exemplo

```ts
import { createPostgresDatabase } from "@t00ls-dev/db/postgres";

const { client, db } = createPostgresDatabase(process.env.DATABASE_URL!);
const rows = await db.select().from(users);
await client.end();
```

## Limitações, segurança e migrações

Postgres usa `prepare: false`; o consumidor gerencia ciclo de vida, schema e
transações. Não registre connection strings e conceda ao usuário do banco apenas
os privilégios necessários. O pacote não executa migrações: o app gera e aplica
o histórico com Drizzle Kit fora do caminho de requisição. O helper de status é
read-only e compara o client PostgreSQL recebido com o journal versionado pelo
app.
