# `@t00ls-dev/access`

Controle de acesso por papéis e permissões, pequeno e tipado.

## Quando usar

Use para regras estáticas de autorização no processo. Não use como fonte de
papéis, sistema de políticas dinâmicas ou substituto da validação de identidade
e tenant.

## Instalação

Pacote privado do workspace; não é publicado em registry.

```sh
pnpm --filter <app> add '@t00ls-dev/access@workspace:*'
```

## API

- `createAccessControl(roles)`: retorna `can(role, permission)` e
  `assert(role, permission)`.
- `AccessDeniedError`: erro lançado por `assert` quando a permissão não existe.
- `RoleMap`: mapa somente leitura de papéis para permissões.

## Exemplo

```ts
import { createAccessControl } from "@t00ls-dev/access";

const access = createAccessControl({
  admin: ["invoice:read", "invoice:write"],
  viewer: ["invoice:read"],
} as const);

access.assert("viewer", "invoice:read");
```

## Limitações e segurança

As regras vivem apenas em memória e não têm hierarquia, condições ou curingas.
Use `assert` no servidor, com papel obtido de uma fonte confiável; verificações
no cliente não protegem recursos.
