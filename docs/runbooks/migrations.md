# Migrations

Cada aplicação é dona do schema composto e do histórico aplicado ao seu banco.
Pacotes podem exportar schemas por dialeto, mas não aplicam migrations no banco
de um consumidor.

## Interface dos apps

Todo app com banco define estes comandos:

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm db:status
```

`db:migrate` e `db:status` devem apontar para o ambiente local por padrão. Ações
remotas usam nomes explícitos, como `db:migrate:dev`, `db:migrate:prod` ou
`db:migrate:remote`. Seeds são separados do histórico de schema e não são
executados pelos workflows de deploy.

## D1

Drizzle Kit gera SQL e mantém `migrations/meta`. Wrangler é o executor e a fonte
de status do banco:

```bash
drizzle-kit generate --config drizzle.config.ts
wrangler d1 migrations apply DB --local
wrangler d1 migrations list DB --local
wrangler d1 execute DB --local --file seeds/local.sql
```

Use sempre o nome do binding (`DB`), deixando Wrangler resolver o banco conforme
o ambiente. Antes do deploy, confira o SQL e execute `db:status` no alvo
correto.

## PostgreSQL

Drizzle Kit gera e aplica o histórico mantido pelo app. `DATABASE_URL` é
obrigatória para migrate, seed e status:

```bash
drizzle-kit generate --config drizzle.postgres.config.ts
drizzle-kit migrate --config drizzle.postgres.config.ts
node --experimental-strip-types postgres/status.ts
node --experimental-strip-types postgres/seed.ts
```

`tests/integration` contém uma configuração executável com schema composto,
migration, seed idempotente e validação contra PostgreSQL 17 real.

## Procedimento

1. Altere o schema Drizzle do app.
2. Execute `db:generate` e revise SQL, snapshot e journal.
3. Valide a migration em um banco descartável ou local.
4. Execute `db:status` no ambiente alvo.
5. Aplique `db:migrate` antes de implantar código que dependa do novo schema.
6. Execute seeds apenas quando necessários e no ambiente explicitamente correto.

Migrations aplicadas são imutáveis. Erros são corrigidos por uma nova migration
forward-only; não renomeie, remova ou edite entradas já registradas. Mudanças
destrutivas devem usar expand/contract em deploys separados.
