---
"@t00ls-dev/auth": patch
---

Atualiza Better Auth para ^1.7.10. A troca de senha revoga as sessões antes de
gravar a nova senha: falha na revogação preserva a senha anterior. Falhas
posteriores ainda podem produzir efeitos parciais em adapters sem transações.
