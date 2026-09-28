# Segurança operacional

Os pacotes fornecem primitivas; cada aplicação continua responsável por escolher
e configurar os controles adequados às suas rotas.

## Baseline obrigatória

- use `foundationSecurityHeaders()` ou baseline equivalente;
- mantenha auth e respostas privadas com `private, no-store`;
- mantenha `/health` com `no-store`;
- configure o bypass Cloudflare descrito em [Cache](cache.md);
- valide toda entrada externa;
- nunca registre senha, token, cookie, secret ou dados pessoais desnecessários;
- use `createAuditEvent` antes de persistir metadados de auditoria.

## Controles por risco

- CORS só deve ser habilitado para origens explicitamente aprovadas;
- CSRF deve proteger mutações autenticadas por cookie fora dos handlers que já
  oferecem proteção equivalente;
- rate limiting deve considerar rota, IP, usuário ou tenant conforme o risco;
- Turnstile é indicado para cadastro, recuperação, formulários públicos e abuso;
- webhooks devem validar assinatura antes de processar payloads.

Não habilite CORS amplo, não use IP como identidade única e não use KV como
fonte da verdade para sessão, autorização, saldo ou pagamento.

## Incidentes

Em caso de exposição ou suspeita, revogue o secret, preserve evidências sem
copiar o valor comprometido, avalie os dados afetados e documente a rotação.
Secrets de DEV e PROD devem ser rotacionados separadamente.
