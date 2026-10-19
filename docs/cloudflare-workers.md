# Cloudflare Workers

A aplicação tem composição Worker local, separada do executável Node. Não há
recursos remotos, DNS ou deploy comprovados por esta entrega. O escopo de produto
continua em [Decisões do MVP](decisoes-mvp.md); os contratos da API e da SPA estão em
[Onboarding](onboarding-provisionamento.md) e [Interface](interface-onboarding.md).

## Composição

`src/worker.ts` cria a API por invocação e usa os mesmos serviços e adapters do
Node. `src/worker-config.ts` compõe a origem HTTPS, secrets e transporte Resend.
`WorkerEnv` tipa `HYPERDRIVE`, `ASSETS` e as configurações exigidas. O Client
PostgreSQL continua sendo criado por request e encerrado depois do commit/rollback;
não há cliente/auth global compartilhando conexão.

Wrangler usa `src/worker.ts`, compatibilidade `2025-09-01` e `nodejs_compat`, conforme
o padrão examinado do Foundation. O grafo usa `pg-cloudflare` e scrypt nativo do
Better Auth. Não inclui servidor HTTP Node, `src/local.ts`, `src/web.ts` ou migrator.
Módulos Node compatíveis, como `node:crypto`, permanecem nos serviços compartilhados.

`ASSETS` serve `dist/web`, com `run_worker_first: true`: HTML e assets passam pelos
headers de segurança do Hono. As rotas SPA conhecidas usam o documento raiz;
rotas desconhecidas, inclusive `/api` e `/api/*`, mantêm 404, sem fallback de API
para HTML. Não é necessário habilitar o fallback SPA automático da Cloudflare.
`spaPaths` mantém a lista comum aos executáveis Node e Worker.

A política final é `Referrer-Policy: no-referrer`, inclusive após a aplicação dos
headers Foundation. Respostas privadas continuam sem cache. O frontend usa a mesma
origem da API, preservando cookies HttpOnly e os controles existentes de origem/CSRF.

## Configuração DEV

`wrangler.jsonc` é exclusivamente preparatório: nome `levi-dev`, origem pretendida
`https://levi.t00ls.dev`, sem rotas, workers.dev ou previews habilitados. O ID
Hyperdrive composto de zeros é um **placeholder**, não um recurso existente. Nenhum
comando de build publica recursos. `worker:build` sempre usa `--dry-run`.
O processo manual de publicação, com suas guardas e autenticação própria, está em
[Deploy DEV](deploy-dev.md); `deploy:dev` é o único comando npm de publicação.

| Binding/configuração       | Uso                                                                           |
| -------------------------- | ----------------------------------------------------------------------------- |
| `HYPERDRIVE`               | Conexão DEV PostgreSQL; configuração remota deve ter query cache desabilitado |
| `ASSETS`                   | Build estático da SPA                                                         |
| `LEVI_PUBLIC_ORIGIN`       | Origem HTTPS canônica, sem path, configurável no ambiente                     |
| `LEVI_AUTH_SECRET`         | Secret exclusivo DEV, estável, com pelo menos 32 caracteres                   |
| `RESEND_API_KEY`           | Secret exclusivo DEV, somente envio e com domínio restrito quando disponível  |
| `LEVI_EMAIL_FROM`          | Remetente de domínio/subdomínio verificado                                    |
| `LEVI_DEV_EMAIL_ALLOWLIST` | JSON privado com 1–50 e-mails exatos dos testadores                           |

A lista não admite domínio, curinga ou lista vazia. Destinatário externo à lista
recebe a mesma confirmação genérica de solicitação, mas o transporte não envia
mensagem. Isso limita envios e evita enumeração por essa resposta; não substitui
proteção de acesso. Não versionar endereços pessoais. `.dev.vars.example` contém
somente nomes vazios; arquivos locais com valores são ignorados. Configuração
incompleta resulta em 503 sanitizado antes de acessar banco/provider.

O contrato publicado `@t00ls-dev/email@0.1.2` fornece `createResendEmail`, usando
fetch HTTPS. Não há SDK adicional. Mantêm-se os dois e-mails, callbacks fixos e
validação de tokens no Better Auth. Não há envio na transação de provisionamento.
Um aceite HTTP do Resend não comprova entrega ao destinatário.

O arquivo Wrangler não configura cache de consultas: essa opção pertence ao
recurso Hyperdrive remoto. **É obrigatório desabilitá-lo e conferir a configuração
efetiva antes de publicar**, para que sessões e memberships revogados não sejam
lidos de cache. O runtime não consegue atestar essa opção a partir da connectionString.

Neon PostgreSQL 17 é o alvo preferencial, com endpoint direto e role de runtime
separada do migrator. Não habilitar auth gerenciado do provedor nem reutilizar
banco/secrets do Foundation. A identidade continua no schema do Levi.

## Desenvolvimento e validação local

O fluxo Node/Vite permanece em `npm run dev` e `npm start`, conforme o guia de
onboarding. Não foi alterado para aceitar URLs remotas. Para validar o Worker:

```sh
npm ci --ignore-scripts
npm run format:check
npm run typecheck
npm test
npm run build
npm run worker:build
npm run test:integration
npm run test:worker
npm run test:e2e
```

`worker:build` faz bundle e dry-run reais do Wrangler, grava `dist/worker` e
metafile em `.local/`. Não envia o Worker/Static Assets. `test:worker` exige Docker
e Linux para a medição de recursos: cria PostgreSQL descartável com a imagem fixada
do harness, prepara explicitamente o schema **somente sintético**, executa o bundle
Wrangler em Miniflare/workerd e remove o container ao terminar.

Miniflare está fixado na mesma versão transitiva usada pelo Wrangler instalado
(`5.20261006.1-alpha` com Wrangler `4.149.0`). A API pública de conversão de opções
mantém o harness explícito; o router de assets declara a presença do user Worker.
Nenhum código do Foundation é modificado ou copiado como infraestrutura do Levi.

Os testes usam bindings sintéticos e interceptam somente a saída Resend no host:
não existe endpoint de captura no app e nenhuma mensagem sai para a Internet.
O resto do fluxo usa auth/Drizzle/pg reais. São cobertos assets, navegação SPA/API,
headers, cookies Secure/HttpOnly/SameSite, callbacks, dois e-mails, conta sem senha,
login/logout, isolamento, roles, revogação, idempotência e concorrência. Falhas reais
de auditoria e recibo fazem rollback observado por outra conexão. Banco vazio
continua vazio depois de iniciar/consultar o Worker.

`worker:dev` executa somente Wrangler local, sem request logs. Exige configuração
local privada e conexão Hyperdrive local sintética, com origem HTTPS coerente se
exercitar cookies no navegador. O harness automatizado já injeta esses bindings;
não usa arquivos com secrets nem precisa de conta Cloudflare. Não usar modo remoto
como substituto desses testes. O Node/Vite continua sendo a superfície manual
local com captura em `.local/mail/`.

### Medições

`test/worker-resources.ts` consulta o inspector do user Worker apenas para totais
do heap V8, sem snapshots. Lê CPU de processo e RSS do processo filho workerd via
`/proc` no host Linux, e mede latência de requests reais de definição de senha e
login, incluindo duas autenticações concorrentes. Os parâmetros criptográficos
nativos permanecem N=16384, r=16, p=1, dkLen=64.

Os agregados ficam em `.local/worker-metrics.json`, sem tokens, contas ou hashes.
CPU de processo inclui overhead do runtime e tem resolução do relógio de ticks;
não é CPU faturada Cloudflare. RSS/alto-water mark inclui runtime e workers de
assets, e não equivale à memória de um isolate. Heap V8 não cobre toda memória
nativa de scrypt. As medições locais não certificam os limites remotos de CPU/memória.
O plano Free de 10 ms por request não deve ser presumido adequado ao login.

## Migrations DEV explícitas

`db:migrate` conserva o guard de banco local. O novo `npm run db:migrate:dev` é uma
ação administrativa independente, não usada pelo Worker, build, deploy ou CI.
**Não foi executada contra banco remoto nesta entrega.** As guardas são verificadas
como funções puras, sem conexão; os testes descartáveis usam o runner local existente.

Antes de uma execução futura autorizada, o operador deverá configurar privadamente:

- `LEVI_DEV_DATABASE_URL`: PostgreSQL direto Neon, TLS `sslmode=verify-full`;
- `LEVI_DEV_DATABASE_HOST`: hostname exato do endpoint esperado;
- `LEVI_DEV_DATABASE_NAME`: `levi_dev` ou nome começando por `levi_dev_`;
- `LEVI_DEV_MIGRATION_CONFIRMATION`: `APLICAR:<host>/<banco>` para esse alvo exato.

O comando exige role `levi_dev_migrator`, senha não vazia, porta padrão, endpoint
`ep-...neon.tech` sem `-pooler`, sem parâmetros extras de conexão. Reconfirma
current_database/current_user antes de DDL e usa lock administrativo não bloqueante
na conexão direta para serializar execuções. Em seguida consulta o status público
Foundation, aplica o histórico Drizzle e reconsulta o journal. O status compara
tags/timestamps; não comprova sozinho checksum ou integridade total do schema.

Falha resulta em erro sanitizado e não provoca retry automático. O script não
autentica contas de provedor nem prova que um endpoint foi classificado corretamente
como DEV pelo operador: conferir o projeto Neon e suas permissões continua obrigatório.
Não enviar credenciais de migrator ao Hyperdrive/runtime nem enfraquecer os guards
para usar um banco padrão ou de produção. Nenhuma migration nova foi necessária.

## Antes do primeiro deploy

Uma nova tarefa deve autorizar explicitamente os recursos/publicação. Preparar:

1. Banco e roles exclusivos DEV, histórico aplicado explicitamente, Hyperdrive
   dedicado sem cache e ID real no binding. Rever quotas/pool/conexão TLS.
2. Segredos, remetente verificado, tracking de links desabilitado e testadores
   definidos privadamente. Confirmar que somente eles recebem e-mails.
3. Cloudflare Access de todo tráfego no Worker, cobrindo URLs alternativas, antes
   de ativar rota para `levi.t00ls.dev`. A configuração atual não altera DNS ou
   protege um Worker remoto que ainda não existe.
4. Orçamento/plano, medição remota de CPU/memória, limites e retirada/rollback.
   Não reduzir scrypt para caber em plano gratuito.
5. Smoke real HTTPS/Access/Resend/Hyperdrive: links com Access expirado, renovação e
   logout, revogação sem cache, rollback por conexão observadora e repetição segura.

Logs de invocação e traces ficam desabilitados no Wrangler: URLs de auth contêm
credenciais temporárias. Não ligar request tracing, debug HTTP ou gravação de
snapshots em sessões autenticadas. Erros Foundation/Levi permanecem sanitizados.
Access não substitui a sessão/membership da aplicação; rate limit durável adicional
e outros controles de operação podem ser tratados conforme o público/risco.

Não há evidência de Hyperdrive, Access, DNS, Neon ou Resend remotos nesta validação.
Miniflare com Hyperdrive local conecta diretamente ao container e não reproduz o
cache/pooling distribuído. O dry-run tampouco prova esses recursos.
