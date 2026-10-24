---
"@t00ls-dev/auth": patch
---

Exige `success === true` e metadados válidos nas verificações Turnstile,
reutilizando o transporte público de `@t00ls-dev/security` em uma única chamada.
Preserva opções, endpoints, códigos HTTP, timeout, resolução de IP e logs
sanitizados, sem o provider CAPTCHA nativo permissivo.
