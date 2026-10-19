# Onboarding e provisionamento

Esta primeira fatia implementa uma API local, consumida pela
[interface React de onboarding](interface-onboarding.md). O escopo de produto
continua em [Decisões do MVP](decisoes-mvp.md). Cadastro de membros, convites,
administração adicional, deploy e infraestrutura de produção continuam pendentes.

## Execução local

Requisitos: Node `>=22.22.0`, npm (lockfile produzido com `10.9.8`) e PostgreSQL 17.
Docker só é necessário para a suíte descartável ou para iniciar o banco local.

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run test:integration
npm run build
npm run test:e2e
npm run format:check
```

A integração cria um container exclusivo, com imagem PostgreSQL fixada por digest,
porta aleatória somente em loopback e credenciais sintéticas. Aplica explicitamente
`migrations/` duas vezes para validar o journal, executa os testes e remove o
container em `finally`. Não utiliza `LEVI_DATABASE_URL` externo. Se Docker falhar,
a suíte falha; não há fallback para mocks ou banco persistente. Uma interrupção
forçada do processo pode exigir remover o container de testes identificado pelo
label `levi.integration=true`.

Para exercitar manualmente, crie um banco local separado, exclusivamente sintético:

```sh
docker run --rm --detach --name levi-local \
  --publish 127.0.0.1:54329:5432 \
  --env POSTGRES_DB=levi_local --env POSTGRES_USER=levi_local \
  --env POSTGRES_PASSWORD=synthetic-only postgres:17-alpine

export LEVI_DATABASE_URL='postgresql://levi_local:synthetic-only@127.0.0.1:54329/levi_local'
export LEVI_LOCAL_DATABASE=1
export LEVI_AUTH_SECRET="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
npm run db:migrate
npm run dev
```

`npm run dev` inicia Vite em `http://localhost:5173` e a API em
`127.0.0.1:3000`. O proxy preserva cookies e a origem de navegador.
`npm start` executa o build já produzido e serve SPA/API juntos em
`http://localhost:3000`, com o servidor ligado somente a `127.0.0.1`.
`LEVI_PORT` altera a porta da API; `LEVI_PUBLIC_ORIGIN` permite somente origem HTTP
local e é configurada pelo comando de desenvolvimento. Banco remoto é recusado
pelo executável local e pelo comando de migrations. Não há carregamento automático
de `.env`.

O transporte local grava e-mails em `.local/mail/`, com diretório privado e arquivos
`0600`, sem envio real nem endpoint de consulta da caixa. A API recebe um
`FoundationEmail` por composição; os testes capturam em memória. Os links são
credenciais temporárias e não aparecem nos logs. Remova os arquivos locais após
o exercício. Encerre o banco sintético com `docker stop levi-local`.

Migrations não são importadas pelo servidor. `npm run db:migrate` é uma ação
explícita e exige `LEVI_LOCAL_DATABASE=1`. `db:generate` apenas gera SQL/snapshot a
partir do schema; não altera banco. A aplicação não verifica/aplica automaticamente
migrations ao iniciar, fazer build ou atualizar dependências. Não há GitHub Actions.

## Fluxo e endpoints

Todos os corpos de escrita são JSON e rejeitam campos desconhecidos. Envie
`Origin` igual à origem pública configurada (5173 no desenvolvimento, 3000 no
build local) e preserve os cookies nativos, inclusive cada
`Set-Cookie`. Escritas autenticadas sem origem confiável são recusadas. Respostas
são privadas e não armazenáveis em cache; links não são enviados em `Referer`.

| Método e caminho                      | Entrada e comportamento                                                                                                                                                                                                                        |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/onboarding/email`          | `{ "email": "pessoa@example.test" }`. Solicita Magic Link pelo handler público do Foundation. Não exige nem aceita senha/nome/ID.                                                                                                              |
| `GET /api/auth/magic-link/verify`     | Link enviado pelo Better Auth; verifica posse do e-mail e cria sessão. Callback fixado pela composição: `/onboarding` na web local, `/api/onboarding` por padrão na API.                                                                       |
| `GET /api/onboarding`                 | Etapa autoritativa: `email`, `verificar-email`, `senha`, `organizacao` ou `concluido`. Link inválido/expirado/usado informa erro em português.                                                                                                 |
| `POST /api/onboarding/password-email` | `{}` e sessão verificada. Solicita ao Better Auth o link para primeira senha/recuperação, para o e-mail da própria sessão.                                                                                                                     |
| `GET /api/auth/reset-password/:token` | Callback público nativo do link; redireciona à etapa com token. Não define senha.                                                                                                                                                              |
| `POST /api/onboarding/password`       | `{ "token": "...", "newPassword": "..." }` e sessão verificada correspondente. O Better Auth valida e consome o token e cria/atualiza a credencial.                                                                                            |
| `POST /api/auth/sign-in/email`        | `{ "email": "...", "password": "..." }`. Login nativo de conta existente.                                                                                                                                                                      |
| `POST /api/auth/sign-out`             | `{}`. Logout nativo, com confirmação de revogação pelo Foundation.                                                                                                                                                                             |
| `POST /api/organizations`             | `{ "organizationName": "Organização", "churchName": "Primeira igreja" }`, sessão pronta e header `Idempotency-Key` de 16–128 caracteres alfanuméricos, `_` ou `-`. Retorna `201` com `organizationId` e `churchId`, também em replay idêntico. |
| `GET /api/organizations`              | Lista somente organizações com vínculo administrativo atual da conta pronta, para retomar em outra sessão.                                                                                                                                     |
| `POST /api/tenant`                    | `{ "organizationId": "UUID" }`. Valida vínculo administrativo antes de associar a organização à sessão.                                                                                                                                        |
| `GET /api/context`                    | Organização ativa e role `admin`, após resolver sessão pronta e vínculo atual.                                                                                                                                                                 |
| `GET /api/churches`                   | `{ organizationId, churches: [{ id, nome }] }`, com o contexto autorizado usado na própria consulta. A interface confere esse ID para evitar associação incorreta se outra aba trocar o tenant.                                                |
| `GET /api/churches/:id`               | Igreja consultada por ID **e** organização ativa autorizada. Outra organização retorna `404`.                                                                                                                                                  |

Rotas convencionais de signup, mudança de senha/e-mail, plugins e chamadas diretas
de emissão/aplicação de reset não são encaminhadas ao Better Auth. A allowlist é
por método/caminho; uma nova rota upstream não ganha exposição automaticamente.

O caminho público comprovado usa **dois e-mails**: Magic Link antes de existir
credencial e recuperação nativa para definir a primeira senha. Não chama
`setPassword`, que é server-only e não é exposto pelo wrapper. A implementação
consulta somente existência de credencial para prontidão, nunca seu hash. O token
de reset é associado à sessão do usuário no schema do consumidor; validade,
expiração e consumo continuam com o Better Auth.

Uma interrupção pode ser retomada consultando `/api/onboarding` ou solicitando novo
Magic Link. Conta existente não é duplicada. Em outro dispositivo é necessário
restabelecer sessão verificada antes de aplicar o link de senha. Não há senha
provisória. O primeiro provisionamento não cria ficha eclesiástica.

## Persistência e transação

Um projeto TypeScript estrito, sem workspaces. `src/app.ts` compõe Hono e os
contratos; `src/auth.ts` compõe identidade; `src/organizations.ts` contém as regras
de provisionamento/autorização; `src/data/schema.ts` define o schema do consumidor.
`tools/` contém ações explícitas fora da inicialização.

As quatro versões Foundation da entrega são fixas: auth `0.3.0`, db/tenant/audit
`1.0.0`. `access@0.1.2` fornece o mapa estático e `security@0.2.0` fornece CSRF e
headers. Não há provider de e-mail real nesta fase; o contrato de auth basta.
Better Auth `1.7.7`, Drizzle `0.45.4` e Hono são imports diretos, com lockfile próprio.
`@types/pg` é dependência de desenvolvimento para os tipos públicos do executor;
não há cliente/pool paralelo do Levi.

Cada request usa um Client conectado pela factory assíncrona pública. O Drizzle,
os adapters de tenant e a auditoria usam **essa mesma conexão**. Não se compartilha
um Client global entre requests concorrentes. Um erro propagado pelo callback
transacional causa rollback antes de encerrar a conexão/responder.

A transação de provisionamento bloqueia a linha do usuário, revalida prontidão e
grava organização, primeira igreja, membership `admin`, contexto de sessão,
auditoria mínima e recibo de idempotência. Uma falha tardia do recibo também desfaz
a auditoria. Nenhum e-mail ocorre nessa transação. A conta previamente criada pode
continuar existindo após falha do provisionamento, permitindo retomada.

O recibo é único por usuário para **o primeiro onboarding**, contém chave, hash do
payload normalizado e IDs resultantes. Repetição idêntica retorna os mesmos IDs,
sem duplicar auditoria. Outra chave/payload após conclusão retorna `409` e orienta
selecionar a organização existente. Isso não limita múltiplos vínculos ou igrejas
e não implementa um fluxo geral de criação de organizações adicionais. Replay
revalida o administrador e nunca recria vínculo revogado.

Os nomes físicos `tenants`, `tenant_memberships`, `tenant_sessions` e `audit_events`
mantêm os contratos SQL dos adapters. O schema do Levi compõe UUIDs nativos,
defaults de servidor, FKs para usuário/sessão e unicidades. A referência composta
do recibo para `(tenant_id, church_id)` impede associar igreja de outra organização.
`account_id`, providers, tokens e valores de verificação preservam tipos textuais.
O contexto de sessão não concede autoridade sozinho: o vínculo é lido novamente.

`audit_events` contém UUIDs técnicos, ação estática, timestamp, resultado,
`request_id` nulo e metadata `{}`. Não guarda nomes, e-mails, senhas ou diffs.
O ID do ator não tem FK para a conta de auth, para não tornar futura eliminação de
conta uma alteração de auditoria. A migration inclui trigger que rejeita UPDATE e
DELETE; a conta dona do banco ainda pode alterar DDL. Privilégios de produção e
retenção não são implementados por esse trigger.

## Validação e limites

A suíte real usa outra conexão para conferir commits/rollbacks, tokens expirados,
uso único concorrente, idempotência concorrente, UUIDs/FKs, isolamento, múltiplas
igrejas, revogação e roles desconhecidas, falhas de autenticação/banco e cookies.
Também inicia uma API HTTP sobre banco vazio para comprovar ausência de migrations
automáticas. Unitários verificam contratos públicos e entrada inválida.

TypeScript usa `strict`, `exactOptionalPropertyTypes` e `noUncheckedIndexedAccess`.
`skipLibCheck` acompanha a base do Foundation: typecheck não equivale a validar
integralmente declarações transitivas de terceiros. Testes reais cobrem os
contratos críticos consumidos.

Esta superfície é de desenvolvimento local, sem hardening operacional para rede
pública. A configuração de rate limiting durável, entrega real de e-mail,
topologia/pooling, backup/recuperação e governança de dados reais ficam para uma
etapa operacional própria. O rate limit em memória do upstream não é tratado como
garantia entre requests, pois auth é composto com a conexão de cada request.
Hyperdrive e Workers remotos não foram configurados nem comprovados.

Não há API de alterar/excluir igrejas, organizações ou memberships. As futuras
exclusões devem definir o tratamento do recibo que referencia a primeira igreja,
sem enfraquecer a integridade atual. Não há dados/migrations de legado, tabelas de
membros, permissões por igreja ou gestão de convites.
