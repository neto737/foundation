# @t00ls-dev/auth

## 0.3.1

### Patch Changes

- b8c39a4: Atualiza Better Auth para ^1.7.10. A troca de senha revoga as sessões
  antes de gravar a nova senha: falha na revogação preserva a senha anterior.
  Falhas posteriores ainda podem produzir efeitos parciais em adapters sem
  transações.

## 0.3.0

### Minor Changes

- f5ffee2: Expõe `generateId: "uuid"` como opção nativa do Better Auth,
  preservando a geração atual quando omitida. Adapters PostgreSQL que delegam a
  geração ao banco exigem defaults UUID no schema da aplicação; tokens e
  identificadores de providers mantêm sua semântica original.

## 0.2.0

### Minor Changes

- f58976d: Add opt-in password-login TOTP using public Better Auth APIs, with
  explicit enrollment activation, no backup codes/OTP/trusted devices, typed
  session state and indeterminate failure responses. Add optional
  database-backed rate limiting with consumer-selected trusted IP headers;
  existing consumers retain their default behavior.
- 8b72814: Add opt-in public-auth Turnstile protection using the official Better
  Auth CAPTCHA plugin, distinct actions and explicit pre-auth availability
  errors, plus minimal opt-in widget CSP. Preserve existing auth/rate-limit
  contracts and document the accepted Better Auth 1.7.7 truthy-success upstream
  payload limitation.
- a1e32b4: Add typed `resolveSession(headers)` for server-side session
  resolution, including response headers needed to propagate session refresh
  cookies. Keep the Better Auth API internal and preserve mandatory email
  verification.

### Patch Changes

- ab27036: Adota a licença MIT aprovada e inclui seu texto na distribuição, com
  o aviso `Copyright (c) 2026 t00ls-dev` confirmado pelo mantenedor.
- bd335a8: Upgrade Better Auth to 1.7.7 to fix GHSA-965c-763c-88jm, isolating
  OAuth state from Magic Link verification. Upgrade servers sharing verification
  storage together, request new Magic Links, and restart pending OAuth sign-ins;
  no database migration is required.

## 0.1.1

### Patch Changes

- 8d448c4: Remove declaration maps referencing unpublished sources and
  references to private TypeScript tooling from packed manifests. Make D1
  declaration dependencies explicit using the official Cloudflare types,
  including the ambient types required by Drizzle's D1 declarations, without
  changing runtime behavior or public exports.
