---
"@t00ls-dev/auth": patch
---

Upgrade Better Auth to 1.7.7 to fix GHSA-965c-763c-88jm, isolating OAuth state
from Magic Link verification. Upgrade servers sharing verification storage
together, request new Magic Links, and restart pending OAuth sign-ins; no
database migration is required.
