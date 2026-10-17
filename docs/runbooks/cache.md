# Cache de rotas dinâmicas

Este runbook define a proteção de cache obrigatória para os domínios Cloudflare
do exemplo em DEV. O objetivo é impedir que autenticação, dados personalizados,
webhooks e sinais operacionais sejam servidos a partir de uma resposta obsoleta.

## PostgreSQL e query cache do Hyperdrive

Quando PostgreSQL for usado em Workers, a recomendação inicial é **um único
binding Hyperdrive com query caching desabilitado** para auth, sessões,
revogação/logout, permissões, memberships, convites e leituras após escrita.
Desabilitar query cache mantém o pooling de conexões de origem.

O cache do Hyperdrive é habilitado por padrão e escritas não invalidam SELECTs
anteriores. Headers HTTP `private, no-store`, bypass da CDN e desativação de
cookie cache no Better Auth **não desabilitam esse cache de consultas**. Quando
ORM/auth gera o SQL, entregue à biblioteca o Client do binding sem cache. Não
use comentários SQL, opções de prepared statements ou `NOW()` incidental como
controle de frescor. Filtros por tenant são necessários para isolamento, mas não
evitam permissões obsoletas.

Uma configuração adicional com cache só deve surgir para leitura comprovadamente
tolerante a dados antigos e com benefício medido. A configuração pertence ao
consumidor/ambiente e exige operação de infraestrutura autorizada; não existe
binding remoto PostgreSQL provisionado pelo Foundation. Consulte a
[documentação oficial de query caching](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/).
Miniflare com conexão local direta não valida o cache/pooling desse serviço.

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
(http.request.uri.path eq "/health")
```

Os pares `eq` e `starts_with` preservam o caminho raiz e seus descendentes sem
incluir nomes apenas parecidos, como `/apiary`.

## Responsabilidades da aplicação

- `/health` envia `Cache-Control: no-store` e verifica a conectividade D1.
- `/api/auth/**` envia `Cache-Control: private, no-store`.
- novos endpoints privados devem definir uma política de resposta equivalente.
- Links inclui `/api/bookmarks` e seus descendentes no bypass existente de
  `/api/*`; todas as respostas, inclusive `401`, `403` e `404`, são privadas.
- APIs públicas só podem habilitar cache por decisão explícita e com testes.

Os headers são uma defesa em profundidade. Eles não substituem o bypass na borda
quando o domínio possui regras amplas de cache.

## Validação

Depois de cada mudança de regra ou deploy, consulte os endpoints no domínio
real:

```bash
curl --fail --silent --show-error --dump-header - --output /dev/null \
  https://foundation.t00ls.dev/health
curl --fail --silent --show-error --dump-header - --output /dev/null \
  https://foundation.t00ls.dev/api/auth/get-session
```

Confirme `Cache-Control: no-store` nos endpoints operacionais e
`Cache-Control: private, no-store` na autenticação. Se a resposta apresentar
`CF-Cache-Status`, ela não pode indicar `HIT` nessas rotas.
