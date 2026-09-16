# Cache de rotas dinâmicas

Este runbook define a proteção de cache obrigatória para os domínios Cloudflare
de DEV e PROD. O objetivo é impedir que autenticação, dados personalizados,
webhooks e sinais operacionais sejam servidos a partir de uma resposta obsoleta.

## Regra Cloudflare

Crie uma Cache Rule no zoneamento de cada domínio com ação `Bypass cache`. A
regra deve ter prioridade sobre políticas amplas, como `Cache Everything`, e
usar a expressão:

```text
(http.request.uri.path eq "/api") or
(starts_with(http.request.uri.path, "/api/")) or
(http.request.uri.path eq "/auth") or
(starts_with(http.request.uri.path, "/auth/")) or
(http.request.uri.path eq "/account") or
(starts_with(http.request.uri.path, "/account/")) or
(http.request.uri.path eq "/webhooks") or
(starts_with(http.request.uri.path, "/webhooks/")) or
(http.request.uri.path eq "/health") or
(http.request.uri.path eq "/ready")
```

Os pares `eq` e `starts_with` preservam o caminho raiz e seus descendentes sem
incluir nomes apenas parecidos, como `/apiary`.

## Responsabilidades da aplicação

- `/health` e `/ready` enviam `Cache-Control: no-store`.
- `/api/auth/**` envia `Cache-Control: private, no-store`.
- novos endpoints privados devem definir uma política de resposta equivalente.
- APIs públicas só podem habilitar cache por decisão explícita e com testes.

Os headers são uma defesa em profundidade. Eles não substituem o bypass na borda
quando o domínio possui regras amplas de cache.

## Validação

Depois de cada mudança de regra ou deploy, consulte os endpoints no domínio
real:

```bash
curl --fail --silent --show-error --dump-header - --output /dev/null \
  https://<host>/health
curl --fail --silent --show-error --dump-header - --output /dev/null \
  https://<host>/ready
curl --fail --silent --show-error --dump-header - --output /dev/null \
  https://<host>/api/auth/get-session
```

Confirme `Cache-Control: no-store` nos endpoints operacionais e
`Cache-Control: private, no-store` na autenticação. Se a resposta apresentar
`CF-Cache-Status`, ela não pode indicar `HIT` nessas rotas.
