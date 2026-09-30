# `@t00ls-dev/auth`

Configuração opinativa do Better Auth para senha, verificação de e-mail,
recuperação, magic link e Google OAuth opcional.

## Quando usar

Use em aplicações Foundation que possam fornecer banco e envio de e-mail
compatíveis. Não use quando precisar controlar diretamente plugins, textos,
callbacks ou outras opções do Better Auth.

## Instalação

Pacote privado do workspace; não é publicado em registry.

```sh
pnpm --filter <app> add '@t00ls-dev/auth@workspace:*'
```

## API

- `createFoundationAuth(options)`: cria
  `{ handler(request), resolveSession(headers) }`.
- `resolveSession(headers)`: retorna `{ data, headers }`. `data` é uma
  `FoundationSession` tipada (`user` e `session`) ou `null`. Falhas de banco não
  são convertidas em sessão anônima. Encaminhe os headers retornados, incluindo
  cada `Set-Cookie`, para preservar renovação e limpeza de cookies.
- `FoundationAuthOptions`: exige `baseURL`, adaptador `database`, `email` e
  `secret`; aceita credenciais `google`.
- `FoundationEmail`: contrato mínimo de envio usado pelos fluxos de
  autenticação.

## Exemplo

```ts
import { createFoundationAuth } from "@t00ls-dev/auth";

const auth = createFoundationAuth({
  baseURL: "https://app.example.com",
  database,
  email,
  secret: process.env.AUTH_SECRET!,
});

export default { fetch: (request: Request) => auth.handler(request) };
```

## Limitações, segurança e migrações

O pacote não expõe a API completa do Better Auth nem cria rotas. A resolução de
sessão no servidor reutiliza a validação do Better Auth; não interprete cookies
manualmente. E-mails são texto simples e têm assuntos fixos em inglês. Guarde
`secret` e credenciais fora do código, use HTTPS, valide `baseURL` e não
registre links ou tokens. O schema e as migrações exigidos pelo Better Auth
devem ser gerados e aplicados pela aplicação conforme a versão instalada.
