---
"@t00ls-dev/access": patch
"@t00ls-dev/audit": patch
"@t00ls-dev/auth": patch
"@t00ls-dev/config": patch
"@t00ls-dev/db": patch
"@t00ls-dev/email": patch
"@t00ls-dev/observability": patch
"@t00ls-dev/security": patch
"@t00ls-dev/tenant": patch
---

Remove declaration maps referencing unpublished sources and references to
private TypeScript tooling from packed manifests. Make D1 declaration
dependencies explicit using the official Cloudflare types, including the ambient
types required by Drizzle's D1 declarations, without changing runtime behavior
or public exports.
