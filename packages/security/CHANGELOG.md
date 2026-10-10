# @t00ls-dev/security

## 0.2.0

### Minor Changes

- 8b72814: Add opt-in public-auth Turnstile protection using the official Better
  Auth CAPTCHA plugin, distinct actions and explicit pre-auth availability
  errors, plus minimal opt-in widget CSP. Preserve existing auth/rate-limit
  contracts and document the accepted Better Auth 1.7.7 truthy-success upstream
  payload limitation.

### Patch Changes

- 4368ceb: Add CSP frame-ancestors 'none' alongside X-Frame-Options DENY to
  prevent framing without changing the opt-in Turnstile script and frame
  allowances.
- ab27036: Adota a licença MIT aprovada e inclui seu texto na distribuição, com
  o aviso `Copyright (c) 2026 t00ls-dev` confirmado pelo mantenedor.

## 0.1.1

### Patch Changes

- 8d448c4: Remove declaration maps referencing unpublished sources and
  references to private TypeScript tooling from packed manifests. Make D1
  declaration dependencies explicit using the official Cloudflare types,
  including the ambient types required by Drizzle's D1 declarations, without
  changing runtime behavior or public exports.
