# @t00ls-dev/security

## 0.1.1

### Patch Changes

- 8d448c4: Remove declaration maps referencing unpublished sources and
  references to private TypeScript tooling from packed manifests. Make D1
  declaration dependencies explicit using the official Cloudflare types,
  including the ambient types required by Drizzle's D1 declarations, without
  changing runtime behavior or public exports.
