# `@t00ls-dev/tenant`

Primitivas para resolver e trocar tenant ativo e para criar e aceitar convites
com token.

## Quando usar

Use em aplicações multi-tenant com membership persistida e sessões externas. Não
use sem implementar isolamento de dados, consumo atômico de convites e auditoria
durável nos adaptadores.

## Instalação

Destino oficial: npmjs.com público no scope do usuário `t00ls-dev`. No
Foundation use `workspace:*`; consumidores externos usam uma versão publicada
com a API desejada. A migração para `pg` exige uma nova release autorizada.

```sh
pnpm --filter <app> add '@t00ls-dev/tenant@workspace:*'
```

## API

- `resolveTenantContext(input)`: valida o tenant ativo e retorna membership
  tipada.
- `switchTenant(input)`: valida a membership antes de atualizar a sessão.
- `createInvitation(input)` e `acceptInvitation(input)`: fluxo de convite com
  token aleatório e hash SHA-256.
- `normalizeInvitationEmail` e `hashInvitationToken`: helpers usados pelo fluxo.
- Interfaces de repositório, sessão e auditoria; erros
  `TenantContextRequiredError`, `TenantAccessDeniedError` e
  `InvalidInvitationError`.

## Exemplo

```ts
import { resolveTenantContext } from "@t00ls-dev/tenant";

const tenant = await resolveTenantContext({
  activeTenantId: session.tenantId,
  repository: memberships,
  userId: session.userId,
});

const invoice = await invoices.findById(tenant, invoiceId);
```

## Transações PostgreSQL

As factories de `@t00ls-dev/tenant/postgres` recebem
`Pick<import("pg").Client, "query">`, substituindo o antigo `postgres.Sql`.
`createPostgresInvitationRepository` consome o convite e cria a membership em
uma única instrução SQL atômica. O UPDATE bloqueia a linha e reavalia
validade/uso após esperar por concorrência. Uma falha ao inserir a membership
desfaz também o consumo. Membership já existente não tem sua role substituída.

Não há BEGIN/COMMIT interno: a mesma factory funciona standalone e dentro de uma
transação externa. Standalone protege convite+membership, mas **não inclui
automaticamente a auditoria** executada por
`createInvitation`/`acceptInvitation`. Para obter atomicidade conjunta, a
aplicação deve vincular os dois adapters ao mesmo Client e mapear
`InvitationAudit.record` para `AuditStore.append`:

```ts
import { createPostgresDatabase } from "@t00ls-dev/db/postgres";
import { createPostgresAuditStore } from "@t00ls-dev/audit/postgres";
import { createAuditEvent } from "@t00ls-dev/audit";
import { acceptInvitation, type InvitationAudit } from "@t00ls-dev/tenant";
import { createPostgresInvitationRepository } from "@t00ls-dev/tenant/postgres";

export async function accept(
  connectionString: string,
  input: { email: string; token: string; userId: string },
) {
  const { client, db } = await createPostgresDatabase(connectionString);
  try {
    return await db.transaction(async () => {
      const store = createPostgresAuditStore(client);
      const audit: InvitationAudit = {
        record: (event) =>
          store.append(
            createAuditEvent({
              actor: event.actorId,
              action: event.action,
              target: event.targetId,
              tenant: event.tenantId,
              timestamp: new Date(),
              metadata: {},
              requestId: null,
              result: "success",
            }),
          ),
      };
      return acceptInvitation({
        ...input,
        audit,
        repository: createPostgresInvitationRepository(client),
      });
    });
  } finally {
    await client.end();
  }
}
```

Queries de domínio Drizzle adicionais usam o `tx` do callback de
`db.transaction`. Esse exemplo depende de `db` ter sido criado sobre o mesmo
Client explícito: não substitua o Client por `pool.query()` ou outra conexão,
nem use esse padrão com um Drizzle criado sobre Pool. Não execute transações
concorrentes no mesmo Client. Falhas devem escapar do callback para causar
rollback; envio de e-mail e resposta de sucesso ficam depois do commit. Leituras
sensíveis usam o binding Hyperdrive sem query cache conforme a
[política de cache](../../docs/runbooks/cache.md#postgresql-e-query-cache-do-hyperdrive).

## Limitações, segurança e migrações

Depende de Web Crypto, `btoa` e UUID globais. O repositório deve filtrar toda
consulta por tenant e consumir convites de forma atômica, conferindo hash,
e-mail, expiração e uso único. Envie apenas o token bruto ao convidado e
persista somente `tokenHash`. Migrações da aplicação devem criar memberships e
convites com unicidade e índices adequados. Os schemas exportados nas entradas
`/schema/d1` e `/schema/postgres` são compostos pela aplicação, dona do
histórico; o pacote não aplica migrations no banco consumidor.
