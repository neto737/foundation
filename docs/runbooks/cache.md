# Cache de rotas dinamicas

Este runbook define a protecao de cache obrigatoria para os dominios Cloudflare
de DEV e PROD. O objetivo e impedir que autenticacao, dados personalizados,
webhooks e sinais operacionais sejam servidos a partir de uma resposta obsoleta.

## Regra Cloudflare

Crie uma Cache Rule no zoneamento de cada dominio com acao `Bypass cache`. A
regra deve ter prioridade sobre politicas amplas, como `Cache Everything`, e
usar a expressao:

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

## Responsabilidades da aplicacao

- `/health` e `/ready` enviam `Cache-Control: no-store`.
- `/api/auth/**` envia `Cache-Control: private, no-store`.
- novos endpoints privados devem definir uma politica de resposta equivalente.
- APIs publicas so podem habilitar cache por decisao explicita e com testes.

Os headers sao defesa em profundidade. Eles nao substituem o bypass na borda
quando o dominio possui regras amplas de cache.

## Validacao

Depois de cada mudanca de regra ou deploy, consulte os endpoints no dominio
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
`Cache-Control: private, no-store` na autenticacao. Se a resposta apresentar
`CF-Cache-Status`, ela nao pode indicar `HIT` nessas rotas.
