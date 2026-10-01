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

O handler só confirma `POST /api/auth/sign-out` após uma leitura autoritativa
sem renovação nem cache de cookie. Se a exclusão falhar ou não puder ser
confirmada, retorna `503` sanitizado, sem encaminhar os cookies de limpeza da
resposta de sucesso; isso preserva a credencial para uma nova tentativa. Logout
confirmado preserva todos os `Set-Cookie` originais do Better Auth.

Logging usa registros JSON com componente, nível e eventos estáticos (por
exemplo, `auth.internal_error` e `auth.session_revocation_failed`). Mensagens,
erros e argumentos recebidos do Better Auth/Drizzle não são serializados; isso
evita incluir SQL, parâmetros, tokens e links nos logs, inclusive no fallback de
erro HTTP.

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
