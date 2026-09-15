# ADR-003: Better Auth

- Status: aceito
- Escopo: v0.1

## Contexto

A fundação precisa de autenticação madura e self-hosted sem criar framework
próprio ou entregar os dados de identidade a uma infraestrutura obrigatória de
terceiros.

## Decisão

Better Auth OSS/self-hosted é o padrão. A aplicação controla usuários, contas,
sessões e memberships. A integração suporta D1 e PostgreSQL nos recursos
compatíveis e expõe a configuração do Better Auth em vez de escondê-lo sob uma
abstração completa.

Os fluxos básicos da v0.1 são cadastro, login, logout, sessão, verificação de
e-mail e recuperação/redefinição de senha. E-mails passam pela camada de e-mail
da fundação. Proteções como validação, cookies seguros, CSRF, rate limiting e
Turnstile são aplicadas conforme o risco do fluxo. Cloudflare Access pode
substituir auth da aplicação em ferramentas internas simples.

## Consequências

- Plugins e upgrades do Better Auth permanecem acessíveis ao app consumidor.
- Autenticação fica separada de tenancy e autorização.
- Magic link, social login, MFA e outros plugins só entram quando houver
  consumidor real.
- Não há dependência do Better Auth Infrastructure pago.
