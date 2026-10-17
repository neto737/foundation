# `@t00ls-dev/db`

Factories mínimas do Drizzle ORM para Cloudflare D1 e PostgreSQL via `pg`
(node-postgres).

## Quando usar

Use para padronizar a criação de clientes nos dialetos suportados. Não use como
camada de repositório, definição de schema, pool genérico ou executor de
migrações.

## Instalação

Destino oficial: npmjs.com público no scope do usuário `t00ls-dev`. No
Foundation use `workspace:*`; fora dele, use uma versão publicada que ofereça a
API desejada. A migração descrita abaixo exige uma nova release explicitamente
autorizada.

```sh
pnpm --filter <app> add '@t00ls-dev/db@workspace:*'
```

## API

- `@t00ls-dev/db`: tipos `DatabaseDialect` e `MigrationStatus`.
- `@t00ls-dev/db/d1`: `createD1Database(binding)` retorna uma instância Drizzle.
- `@t00ls-dev/db/postgres`: `createPostgresDatabase(connectionString)` retorna
  `Promise<{ client, db }>`, com `pg.Client` já conectado e Drizzle
  `NodePgDatabase` associado ao mesmo cliente, sem criar um pool.
- `@t00ls-dev/db/postgres-migrations`: consulta o status do journal oficial de
  migrations Drizzle no PostgreSQL.

## Exemplo

```ts
import { createPostgresDatabase } from "@t00ls-dev/db/postgres";

const { client, db } = await createPostgresDatabase(process.env.DATABASE_URL!);
try {
  const rows = await db.select().from(users);
} finally {
  await client.end();
}
```

## Migração incompatível de Postgres.js

Os entrypoints e o formato `{ client, db }` foram preservados, mas agora é
necessário aguardar a factory. `client` é `pg.Client`: substitua tagged
templates e `.unsafe()` por `client.query(text, values)` com parâmetros `$1`,
`$2`, etc. Resultados raw estão em `result.rows`; `db.execute()` também usa o
resultado do driver node-postgres. Não existe `client.begin()`; utilize
`db.transaction()`. Os adapters PostgreSQL de tenant/audit e o helper de status
recebem um executor `Pick<Client, "query">`, não `postgres.Sql`. Os tipos `pg`
são distribuídos como dependência, sem exigir hoisting do workspace.

Para compartilhar uma transação com repositories e auditoria, use o **mesmo
Client** da factory dentro de `db.transaction()`. Queries Drizzle adicionais
usam o `tx` do callback. Os adapters não abrem conexão nem fazem commit. Veja a
[composição de convites e auditoria](../../packages/tenant/README.md#transações-postgresql).
Não use `pool.query()` nem um segundo cliente na operação. Não execute unidades
transacionais concorrentes no mesmo Client.

## Workers e Hyperdrive

Crie a factory dentro de cada invocação, usando
`env.HYPERDRIVE.connectionString`. Não retenha clientes, pools ou instâncias de
auth que fechem sobre uma conexão em escopo global. A implementação usa
`drizzle-orm/node-postgres` com um Client explícito, evitando a sobrecarga de
Drizzle por URL que cria um Pool implicitamente.

O consumidor deve habilitar a compatibilidade Node adequada à sua data/runtime e
fazer o bundle com a condição `workerd`, usada por `pg-cloudflare`. O harness
local usa a data `2025-09-01` e `nodejs_compat`, como Links. Em Node, encerre o
cliente em `finally`; uma falha na factory também libera o cliente criado. A
Cloudflare documenta limpeza automática da conexão Worker→Hyperdrive ao terminar
a invocação, sem exigir `client.end()` nesse cenário. Encerramento explícito só
deve ocorrer depois de terminar todo o trabalho do cliente; commit/rollback
devem ser aguardados antes de responder sucesso.

Use uma configuração Hyperdrive com **query caching desabilitado** para sessões,
permissões, convites e dados que exigem leitura atual. O pool de origem continua
disponível. Consulte a
[política de cache](../../docs/runbooks/cache.md#postgresql-e-query-cache-do-hyperdrive).

`pg` é o driver recomendado pela
[Cloudflare para Drizzle/Hyperdrive](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/drizzle-orm/).
O caminho é testado em PostgreSQL 17 e Workers local com dados descartáveis;
isso **não comprova compatibilidade remota com Hyperdrive**, cujo pooling/cache
não são reproduzidos pela conexão local do Miniflare.

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
Workers introduz conflitos globais. O tipo de `process.env` depende da ordem de
carregamento: a referência Node de `pg` preserva `ProcessEnv` no controle atual
de distribuição, mas outras ordens podem produzir `any`. Isso não remove os
conflitos nem torna o perfil misto suportado. É um efeito da integração, não
apenas um defeito independente de terceiros. As entradas raiz e `/postgres` não
carregam esses globais. A biblioteca Drizzle ainda possui erros estritos de suas
próprias declarações; os testes de distribuição distinguem esses erros dos novos
diagnósticos Foundation.

## Limitações, segurança e migrações

O consumidor gerencia ciclo de vida, schema e transações. Não registre
connection strings e conceda ao usuário do banco apenas os privilégios
necessários. O pacote não executa migrações: o app gera e aplica o histórico com
Drizzle Kit fora do caminho de requisição. O helper de status é read-only,
específico de Node/filesystem, e compara o client PostgreSQL recebido com o
journal versionado pelo app. Não o importe no Worker nem aplique migrations no
caminho de requisição. Trocar o driver não altera SQL, snapshots ou journals.
