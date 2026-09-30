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

## Perfil TypeScript de D1

`@t00ls-dev/db/d1` é específico de **Cloudflare Workers/D1**. A distribuição
corretiva declara os tipos oficiais necessários e preserva sua referência global
nesse entrypoint porque `drizzle-orm/d1` usa `D1Database`,
`D1PreparedStatement`, `D1Result` e `D1Response` como globais. Nenhum import
JavaScript de Workers Types é emitido.

Um consumidor mínimo desse entrypoint usa libs ES e não carrega os globais de
Node ou `lib.dom`, por exemplo:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023"],
    "types": [],
    "strict": true,
    "skipLibCheck": false
  }
}
```

Misturar esse ambiente com DOM/Node não é um perfil suportado: a referência
Workers introduz conflitos globais e pode tornar `process.env` do tipo `any`.
Isso é um efeito da integração, não apenas um defeito independente de terceiros.
As entradas raiz e `/postgres` não carregam esses globais. A biblioteca Drizzle
ainda possui erros estritos de suas próprias declarações; os testes de
distribuição distinguem esses erros dos novos diagnósticos Foundation.

## Limitações, segurança e migrações

Postgres usa `prepare: false`; o consumidor gerencia ciclo de vida, schema e
transações. Não registre connection strings e conceda ao usuário do banco apenas
os privilégios necessários. O pacote não executa migrações: o app gera e aplica
o histórico com Drizzle Kit fora do caminho de requisição. O helper de status é
read-only e compara o client PostgreSQL recebido com o journal versionado pelo
app.
