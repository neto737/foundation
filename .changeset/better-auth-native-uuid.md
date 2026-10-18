---
"@t00ls-dev/auth": minor
---

Expõe `generateId: "uuid"` como opção nativa do Better Auth, preservando a
geração atual quando omitida. Adapters PostgreSQL que delegam a geração ao banco
exigem defaults UUID no schema da aplicação; tokens e identificadores de
providers mantêm sua semântica original.
