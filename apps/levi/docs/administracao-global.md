# Administração global — infraestrutura e painel

A Etapa 1 prepara persistência e operações internas; a Etapa 2 acrescenta o painel
`/admin` e a API administrativa no próprio Levi. Nenhuma delas cria contas reais
ou ativa módulos. O login Better Auth e as roles organizacionais continuam
inalterados. A disponibilidade de membros não depende das políticas do painel.

## Autoridade e concorrência

`global_administrators` associa uma concessão ao UUID de uma conta existente,
verificada e com senha. Revogação mantém a linha e incrementa sua versão. E-mail,
`tenant_memberships`, contexto ativo e dados enviados pelo navegador não concedem
privilégios globais. Administrador global não ganha acesso aos membros de tenants.

As funções de `src/administrators.ts` recebem identidade previamente resolvida pelo
Better Auth. Revalidam usuário, credencial, sessão e concessão atuais no banco.
Não aceitar IDs de request como substitutos dessa identidade. O guard público do
módulo interno (`requireGlobalAdministrator`) nega com `RequestError` 404 inclusive
quando não consegue consultar a autoridade. A camada HTTP aplica esse guard antes
de validação, CSRF e quotas administrativas.

Concessões e revogações exigem sessão criada há no máximo dez minutos, válida e
sem data futura; renovar `updated_at` não reautentica. Conta sem autoridade recebe
404, e administrador comprovado com sessão antiga recebe erro de reautenticação.
Esse limite representa idade da sessão, **não prova de magic link recente ou MFA**.

Bootstrap, concessões/revogações e mudanças de flags compartilham o advisory lock
transacional `(715463, 2)`. Após aguardar, a mutation relê e bloqueia identidade,
sessão e concessão do ator. Estado e auditoria usam o mesmo transaction handle.
Após as escritas e a auditoria, a autoridade e a validade/recência da sessão são
revalidadas antes do commit. Se vencerem durante outra espera, toda a operação é
desfeita, inclusive o recibo de bootstrap quando aplicável.
Não há retry automático. Autorrevogação e retirada do último administrador
elegível são recusadas. O contador começa em 1; criar concessão/flag exige versão
esperada 0. Conflito exige consultar o estado; no-op com versão atual não incrementa
versão nem cria evento falso. A consulta de administradores usa cursor por UUID,
com páginas de até 100 linhas.

Locks ordenam operações concorrentes; não desfazem operações concluídas antes de
uma revogação. Exclusão da conta referenciada pela concessão é impedida pela FK;
uma política de eliminação de contas privilegiadas requer decisão própria.

## Persistência e auditoria

- `0005_administracao-global`: quatro tabelas novas, constraints e `tenant` nullable
  exclusivamente nas ações globais conhecidas de `audit_events`.
- `0006_recibo-bootstrap-permanente`: trigger que recusa UPDATE, DELETE e TRUNCATE
  do recibo. O recibo singleton não tem cascade para conta de usuário.
- Nenhuma migration semeia administradores, flags ou UUIDs de ambiente. Nenhuma
  migration anterior foi alterada. O journal/snapshots são gerados pelo Drizzle.

Eventos globais admitidos: `admin.bootstrapped`, `admin.granted`, `admin.revoked`,
`feature_flag.all`, `feature_flag.selected` e `feature_flag.disabled`. Eventos
organizacionais continuam exigindo tenant real; os eventos de inclusão/retirada
em seleções são organizacionais. O UUID estável da flag é o alvo, e o ID de
operação agrupa a mudança de política e seus deltas. Metadata continua `{}`.

O helper `src/admin-audit.ts` adapta apenas o Levi ao caso global; o contrato
público Foundation continua exigindo tenant string e não foi modificado. Não usar
tenant fictício. Auditoria continua append-only; falha do append desfaz a mutation.
Após erro de commit/resposta, consultar estado em nova conexão antes de repetir.

## Bootstrap explícito e assistido

O runner `tools/bootstrap-admin.ts` não é importado pela aplicação, build, CI ou
deploy. Recebe `ADMIN_EMAIL` apenas nessa operação. Não cria usuário, não envia
login, não define senha, não marca identidade como verificada e não altera o
administrador inicial em reexecuções. A credencial do bootstrap nunca vai para
Worker/Hyperdrive.

Antes de uma execução **autorizada separadamente**, o operador deve:

1. Confirmar controle atual da caixa e identidade esperada em procedimento
   assistido pelo fluxo comum do Levi. Conferir UUID da conta e uma sessão válida
   criada nos últimos dez minutos. O schema não registra a origem dessa sessão;
   não presumir prova automática de e-mail recente a partir de `created_at`.
2. Conferir alvo, backup/recuperação, migrations completas, ACLs e autorização da
   operação. Provisionar separadamente o login `levi_dev_bootstrap`, sem ownership,
   superuser, memberships privilegiadas, grant option, CREATE ou BYPASSRLS.
3. Aplicar, em operação própria, os privilégios mínimos de
   [administracao-bootstrap-acls.sql](../ops/administracao-bootstrap-acls.sql).
   CONNECT deve ser concedido explicitamente no banco-alvo. Não copiar credencial
   migradora ou runtime para esse processo.
4. Fornecer, fora de arquivos versionados: `ADMIN_EMAIL`, `LEVI_ADMIN_USER_ID`,
   `LEVI_ADMIN_SESSION_ID`, `LEVI_ADMIN_OPERATION_ID` (UUID da operação),
   `LEVI_ADMIN_IDENTITY_CONFIRMATION=IDENTIDADE-CONFERIDA:<UUID-da-conta>`,
   `LEVI_ADMIN_DATABASE_URL`, `LEVI_ADMIN_DATABASE_HOST`,
   `LEVI_ADMIN_DATABASE_NAME` e
   `LEVI_ADMIN_TARGET_CONFIRMATION=BOOTSTRAP:<host>/<banco>`.
5. Executar explicitamente, a partir de `apps/levi`,
   `pnpm exec tsx tools/bootstrap-admin.ts`. O runner aceita Neon DEV direto, role
   `levi_dev_bootstrap`, TLS `verify-full`, alvo conferido e journal sem pendências.
   Pooler, parâmetros que sobrescrevam host/user e outras identidades são recusados.
   A única exceção local é o cluster `levi_test` em loopback com os dois indicadores
   sintéticos do harness; ela não permite destino remoto sem TLS.
6. Conferir resultado, recibo e auditoria; correlacionar o ID da operação à
   autorização e à identidade do operador. O ator do evento é a conta inicial que
   participou da confirmação. Não registrar cookies, tokens, hashes ou e-mail nos
   logs. Desabilitar/recolher o acesso operacional de bootstrap após a operação,
   em ação autorizada própria.

A comparação de e-mail normaliza caixa/espaços e recusa ambiguidades históricas;
não transforma aliases, pontos ou `+tag` em identidades equivalentes. O UUID é
explicitamente fixado e revalidado. Concessão, recibo e evento são um único commit.
Duas execuções têm apenas um vencedor. Recibo existente gera `already-completed`,
sem concessão, alteração ou restauração, mesmo com outro e-mail/UUID ou privilégio
revogado. Concessão existente sem recibo é inconsistência e bloqueia bootstrap.

Receber a string de confirmação é uma afirmação operacional assistida, não uma
prova criptográfica de posse da caixa. Credenciais operacionais são privilegiadas
e devem ser protegidas/recolhidas. Nenhum mecanismo de recuperação automática foi
criado. Apagar/restaurar o banco ou agir como owner está fora das garantias das
ACLs; não apagar recibo para recuperar administrador.

## Base de Feature Flags

`src/feature-contracts.ts` declara somente `members`. Políticas são `all`,
`selected` com 1–1000 UUIDs distintos de organizações existentes, ou `disabled`.
`all` inclui organizações futuras do mesmo banco/ambiente. Atualizar exige admin
global, versão esperada e ID de operação; política, seleção e auditoria mudam
atomicamente. `all/disabled` removem seleções residuais. IDs/chaves/campos
incompatíveis são recusados, sem descarte parcial de entrada inválida.

`featureAvailable` faz apenas a decisão de disponibilidade, com política e seleção
no mesmo snapshot. Funcionalidade desconhecida/ausente ou tenant inexistente
retorna false; falha de banco propaga erro, sem fallback permissivo ou cache.
O chamador continua responsável por sessão, membership, permissão e isolamento.

**Esta função não está ligada ao domínio de membros.** O módulo de membros está
disponível para todas as organizações, sob as verificações existentes de sessão,
vínculo, permissão e isolamento. Tabelas de flags vazias e alterações no painel
não interferem nessa disponibilidade. Uma etapa futura, com autorização própria,
tratará a integração do avaliador persistido; o painel não ativa esse avaliador.

## ACLs, operação e validação

O artefato [administracao-runtime-acls.sql](../ops/administracao-runtime-acls.sql)
acrescenta apenas leitura/inserção/atualização por coluna em concessões e flags,
e leitura/inserção mais DELETE no conjunto selecionado. Não concede acesso ao
recibo, exclusão de concessões/flags ou alteração de chaves/UUIDs. As ACLs legadas
de auth continuam necessárias; a runtime não se torna migradora. Locks PostgreSQL
exigem UPDATE em alguma coluna, contemplado pelos grants mínimos. O login de
bootstrap tem leitura limitada e UPDATE técnico para locks, INSERT inicial e
append de auditoria, sem UPDATE/revogação de concessões ou acesso a flags.

As migrations e ACLs são operações persistentes independentes e autorizadas;
startup, CI e deploy não as executam. Não usar teste local como comprovação de
estado remoto. Os artefatos foram exercitados pelo mesmo harness PostgreSQL
sintético nos modos padrão e restrito, incluindo execução do runner apenas nesse
cluster, concorrência, falha de auditoria, revogação e negações de ACL. Os testes
anteriores de autenticação, organizações e membros continuam na suíte.

Para validar, seguir [o runbook de testes](../../../docs/runbooks/testing.md) e os
scripts Levi. Integração operacional das flags e qualquer ativação real
permanecem fora do painel e exigem autorização própria.

## Painel e contrato HTTP — Etapa 2

Acessar `/admin` diretamente após o login comum do Levi. Não existe login separado
nem link na navegação dos usuários comuns. O painel é resolvido antes do onboarding
e da seleção de organização; uma conta global elegível pode acessá-lo sem tenant.
Entradas e saídas usam navegação completa. Não há acesso implícito às igrejas ou
membros das organizações listadas.

Páginas e APIs administrativas exigem concessão global ativa antes de entregar HTML,
validar corpo, verificar CSRF ou consumir quotas. Visitantes, contas comuns, sessões
revogadas e autoridade indisponível recebem 404, inclusive métodos e subcaminhos
inexistentes. Variações de caixa, encoding e barras não são aliases de `/admin`.
Node e Worker protegem a entrega do HTML; `/admin` continua fora de `spaPaths`.
O proxy Vite encaminha `/admin` e os assets compilados ao Node, preservando o status
e os headers. Por isso, compilar o Levi antes de usar o painel pelo Vite; mudanças
da interface administrativa requerem novo build nesse modo.

Todas as respostas preservam headers de segurança e `private, no-store`. APIs
administrativas compartilham quota persistida de 60 requisições por minuto/usuário,
aplicada somente após autorização, também no Node. Escritas exigem origem confiável
e corpo JSON limitado a 16 KiB (64 KiB na atualização de `members`, para preservar
a seleção de até 1000 UUIDs). Não há retry automático de mutation ou bypass de
recência. O ID de operação da auditoria é gerado no servidor.

| Método e caminho                             | Contrato                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------ |
| `GET /api/admin/session`                     | UUID de usuário e da sessão atual, sem token                                         |
| `GET /api/admin/administrators?after=<UUID>` | Concessões, nome/e-mail, versão, revogação; até 100 por página                       |
| `POST /api/admin/accounts/find`              | E-mail exato no corpo; conta única, elegibilidade e versão; sem busca parcial        |
| `PATCH /api/admin/administrators/:id`        | `enabled`, `expectedVersion`; confirmações na interface e sessão recente no servidor |
| `GET /api/admin/organizations?after=<UUID>`  | Somente identificador/nome; até 100 por página                                       |
| `GET /api/admin/features`                    | Catálogo declarado no código; ausente aparece `disabled`, versão 0                   |
| `PUT /api/admin/features/:key`               | `policy`, `expectedVersion`; `confirmAll: true` obrigatório para `all`               |

As telas mostram administradores ativos/revogados e permitem localizar conta,
conceder e revogar com confirmação. A seleção de políticas suporta `all`, `selected`
e `disabled`, somente para `members`; todas as organizações exige confirmação
adicional. Conflito 409 recarrega o estado, sem repetir a mutation. Recência vencida
oferece sair e entrar novamente pelo fluxo comum; idade da sessão continua sem
comprovar método de autenticação.

Os dados existem somente em memória. Perda de foco, ocultação e saída da página
limpam dados/rascunhos e abortam requests; retorno/foco revalidam sessão e concessão.
Gerações invalidam respostas antigas. Leitura e ações da interface conferem novamente
a mesma identidade/sessão antes de publicar resultados. Falhas não restauram dados
anteriores. Esta revalidação complementa a autorização transacional do servidor.

Os testes de integração cobrem 404 antes de middleware, ACLs restritas, CSRF/quota,
concessões/revogações e auditoria, conflitos, seleções, revogação de sessão e isolamento.
Worker real com Assets e E2E desktop/mobile/Vite exercitam HTML, refresh, histórico,
logout, confirmações, acessibilidade e resposta atrasada após revogação. Tudo usa
PostgreSQL sintético descartável; não executa bootstrap ou migrations persistentes.
