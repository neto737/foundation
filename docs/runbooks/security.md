# Seguranca operacional

Os pacotes fornecem primitives; cada aplicacao continua responsavel por escolher
e configurar os controles adequados as suas rotas.

## Baseline obrigatoria

- use `foundationSecurityHeaders()` ou baseline equivalente;
- mantenha auth e respostas privadas com `private, no-store`;
- mantenha `/health` e `/ready` com `no-store`;
- configure o bypass Cloudflare descrito em [Cache](cache.md);
- valide toda entrada externa;
- nunca registre senha, token, cookie, secret ou dados pessoais desnecessarios;
- use `createAuditEvent` antes de persistir metadata de auditoria.

## Controles por risco

- CORS so deve ser habilitado para origins explicitamente aprovados;
- CSRF deve proteger mutacoes autenticadas por cookie fora dos handlers que ja
  oferecem protecao equivalente;
- rate limiting deve considerar rota, IP, usuario ou tenant conforme o risco;
- Turnstile e indicado para signup, recuperacao, formularios publicos e abuso;
- webhooks devem validar assinatura antes de processar payloads.

Nao habilite CORS amplo, nao use IP como identidade unica e nao use KV como
fonte da verdade para sessao, autorizacao, saldo ou pagamento.

## Incidentes

Em caso de exposicao ou suspeita, revogue o secret, preserve evidencias sem
copiar o valor comprometido, avalie dados afetados e documente a rotacao.
Secrets de DEV e PROD devem ser rotacionados separadamente.
