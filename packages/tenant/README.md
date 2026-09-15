# `@t00ls-dev/tenant`

Primitivas para resolver e trocar tenant ativo e para criar e aceitar convites
com token.

## Quando usar

Use em aplicações multi-tenant com membership persistida e sessões externas. Não
use sem implementar isolamento de dados, consumo atômico de convites e auditoria
durável nos adaptadores.

## Instalação

Pacote privado do workspace; não é publicado em registry.

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

## Limitações, segurança e migrações

Depende de Web Crypto, `btoa` e UUID globais. O repositório deve filtrar toda
consulta por tenant e consumir convites de forma atômica, conferindo hash,
e-mail, expiração e uso único. Envie apenas o token bruto ao convidado e
persista somente `tokenHash`. Migrações da aplicação devem criar memberships e
convites com unicidade e índices adequados; este pacote não fornece schema nem
migrações.
