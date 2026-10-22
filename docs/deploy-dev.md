# Deploy DEV público

O Levi prepara acesso público em `https://levi.t00ls.dev`, sem Cloudflare Access
ou lista de destinatários. Cadastro continua por e-mail verificado, primeira senha
e provisionamento de organização/primeira igreja. Dados privados exigem sessão,
prontidão e vínculo organizacional atual no servidor.

O processo reutiliza o padrão operacional comprovado do Links: CI automática,
GitHub Actions, SHA validado, ambiente `dev`, fila de publicação e Wrangler não
interativo. O Levi mantém npm e PostgreSQL/Hyperdrive; não copia o monorepo, D1
ou fases de migrations do Foundation. Preparação não comprova publicação remota.

## CI, identidade e publicação

[CI](../.github/workflows/ci.yml) executa em PR e push na `main`: instalação pelo
lockfile, formatação, typecheck, unitários/contratos, build, dry-run Wrangler,
PostgreSQL descartável, workerd e navegador. Recebe somente `contents: read`,
sem secrets de produto, provedor ou banco persistente. Não usa `pull_request_target`.

[Deploy DEV](../.github/workflows/deploy-dev.yml) aguarda `workflow_run` da CI
concluída com sucesso. Aceita somente CI de **push na main do próprio Levi**.
PRs, forks, outras branches e CI falha não publicam. Mantém `workflow_dispatch`
com SHA completo para recuperação controlada, também exigindo CI de push aprovada.

O validador [ci-evidence](../tools/ci-evidence.ts) consulta a API GitHub, confirma
workflow canônico `ci.yml`, repositório de origem, evento, branch, SHA, conclusão,
tentativa atual e job `checks` efetivamente aprovado. Não baixa artifacts de PR.
O checkout é do SHA confiável da main; o script reconfirma main remota e HEAD
limpo antes do upload. Execuções obsoletas falham fechadas. O Worker recebe tag
com o SHA validado, conferida na versão ativa após publicação.

A publicação usa `contents: read` e `actions: read`, runners padrão
`ubuntu-latest`, environment `dev` restrito à main e fila `levi-dev` sem cancelar
uma publicação em andamento. Secrets são encaminhados somente à etapa de deploy;
a instalação/build não os recebem.

**O deploy permanece bloqueado enquanto a variable de repositório
`LEVI_DEV_DEPLOY_ENABLED` estiver ausente ou diferente de `true`.** CI automática
pode executar sem essa habilitação. Não configurar a variable antes de validar
recursos, migrations, configuração e planos gratuitos. `LEVI_DEV_READY=true` é
uma confirmação operacional explícita desses pré-requisitos, não descoberta
ou prova automática deles.

## Recursos e pré-requisitos remotos

Inventariar antes de criar recursos. Confirmar elegibilidade e quotas Workers
Free, Neon Free e Resend Free. Não contratar upgrades. Recursos devem ser próprios
do Levi, sem usar credenciais ou modificar recursos do Foundation.

1. Projeto/banco Neon DEV identificado, host direto e TLS, roles separadas
   `levi_dev_migrator` e `levi_dev_runtime`; runtime sem DDL. Banco com histórico
   revisado e aplicado explicitamente por operação administrativa autorizada.
   A role runtime precisa de SELECT/INSERT/UPDATE/DELETE em `abuse_counters`
   (incluindo a limpeza), sem permissão para criar/alterar tabelas.
2. Hyperdrive exclusivo `levi-dev`, host/banco DEV esperados, role runtime,
   TLS e **`caching.disabled=true` conferido pela API**. Sem query cache para
   sessões, memberships, contadores ou dados organizacionais.
3. Resend com domínio remetente verificado e tracking de links desabilitado.
   Chave própria de envio restrita ao domínio. Não há allowlist de destinatários.
   Domínio/chave de teste que só envie ao proprietário não satisfaz cadastro público.
4. Worker `levi-dev`, Static Assets e API na mesma origem HTTPS. Somente custom
   domain `levi.t00ls.dev`; workers.dev/previews permanecem desabilitados.
   Inventariar rotas alternativas em todas as zonas acessíveis. O script confere
   custom domains da conta e rotas da zona t00ls.dev; não atesta zonas fora do token.
5. Nenhuma aplicação Access deve interceptar o hostname público. O processo não
   exige ID/permissões de Access nem remove políticas remotas automaticamente.
   O smoke exige HTML público e estado de onboarding, sem redirects para Access.
6. Validar e-mails, autenticação, persistência, isolamento, quotas e CPU remotamente.
   Métricas locais workerd não são CPU faturada Cloudflare. Não reduzir scrypt
   para caber no Free. Um limite real impeditivo exige parar antes de contratar.

A falta de acesso aos provedores não impede CI/testes locais, mas impede validar
provisionamento, planos, entrega de e-mails ou publicação.

## Secrets e configuração privada

Não depende de `wrangler login` no runner. Configurar tokens exclusivos em
Settings → Environments → dev do GitHub Levi, sem fornecer valores pelo chat ou
versioná-los. Em terminal privado, `gh secret set NOME --repo t00ls-dev/levi --env dev`
solicita o valor interativamente.

| Secret do environment dev | Uso                                                                |
| ------------------------- | ------------------------------------------------------------------ |
| `CLOUDFLARE_ACCOUNT_ID`   | Conta correta                                                      |
| `CLOUDFLARE_API_TOKEN`    | Publicar Worker/Assets/custom domain, menor escopo disponível      |
| `CLOUDFLARE_READ_TOKEN`   | Leitura Hyperdrive, Worker/versões/subdomínio/domínios, zona/rotas |
| `LEVI_AUTH_SECRET`        | Aleatório, exclusivo, estável, ao menos 32 caracteres              |
| `RESEND_API_KEY`          | Somente envio, restrito ao domínio remetente                       |

Variables do environment `dev`: `CLOUDFLARE_ZONE_ID`, `LEVI_HYPERDRIVE_ID`,
`LEVI_DEV_DATABASE_HOST`, `LEVI_DEV_DATABASE_NAME`, `LEVI_EMAIL_FROM` e
`LEVI_DEV_READY`. A variable opcional `LEVI_MEMBERS_DEV_ORGANIZATIONS` controla
somente o recorte sintético de membros, conforme [Gestão de membros](gestao-membros.md#habilitação-e-limites);
ausente/vazia/inválida mantém o módulo desabilitado e não altera a chave de deploy.
Os IDs são obtidos de recursos reais; host direto Neon e banco
`levi_dev` ou prefixo permitido. A habilitação `LEVI_DEV_DEPLOY_ENABLED` é uma
variable **do repositório**, avaliada antes de entrar no environment.

`LEVI_ACCESS_APP_ID` e `LEVI_DEV_EMAIL_ALLOWLIST` deixaram de ser consumidos;
nenhum endereço pessoal deve ser colocado em variables públicas. Chaves de gestão
Neon/Resend e credenciais migrator não pertencem ao workflow. A configuração
Wrangler raiz continua sem rotas e com Hyperdrive placeholder para testes locais.

## Proteção contra abuso

A composição Worker habilita o limitador público `fixedWindowRateLimit` do
`@t00ls-dev/security`, com store PostgreSQL atômico do Levi. Limites de janela fixa:

| Escopo                                                                           | Limite       |
| -------------------------------------------------------------------------------- | ------------ |
| Pedidos Magic Link/definição de senha, por IP, compartilhado entre as duas rotas | 5/minuto     |
| Login por senha, por IP                                                          | 10/minuto    |
| Demais chamadas API, por IP, incluindo callbacks                                 | 60/minuto    |
| Envios ao mesmo destinatário, compartilhados entre os dois e-mails               | 3/15 minutos |
| Tentativas de envio globais do Levi                                              | 90/dia UTC   |

IP vem exclusivamente de `CF-Connecting-IP`, garantido pela entrada Cloudflare;
`X-Forwarded-For` do visitante não define autoridade. Header ausente usa bucket
compartilhado. A entrada Node local não habilita essa confiança em headers.
Os contadores usam HMAC-SHA-256 com segredo do servidor, sem IP/e-mail em claro,
expiração e limpeza limitada/indexada a cada incremento. O schema técnico consta
na migration `0001_abuse-limits.sql`, sem aplicação remota automática.

Excesso por IP retorna 429 em português com `Retry-After`. Excesso por destinatário
ou orçamento global suprime envio mantendo a resposta genérica; envio não é
confirmação de entrega. Suprimir não depende da existência da conta. Falhas do banco
não liberam solicitações e falhas do provider não são declaradas como envio
confirmado; ambas não provocam retry automático. Tentativas de envio falhas também
consomem orçamento. Credenciais inválidas no login mantêm erro/status genéricos.
Os parâmetros criptográficos nativos permanecem intactos.

O wrapper auth publicado também oferece rate limiting por banco e Turnstile; esses
contratos foram examinados. O limitador Hono existente foi escolhido para cobrir
as rotas compostas e reutilizar o mesmo store nas quotas de envio, sem segundo
schema de contadores ou CAPTCHA. Limites nativos do Better Auth não substituem a
proteção durável entre invocações.

São limites conservadores para DEV, não garantia contra bots distribuídos, DDoS
ou exaustão intencional da quota global. Endereços IP distintos continuam sujeitos
ao teto global de e-mails. Limites de janela têm rajada na fronteira; podem atrasar
uso legítimo e precisam de acompanhamento. As quotas reais da conta Resend podem
ser compartilhadas com outros usos; o teto do Levi não atesta saldo do provedor.

## Migrations, operação e recuperação

Migrations PostgreSQL permanecem separadas de build, CI, deploy e inicialização.
CI aplica o histórico somente nos próprios containers sintéticos. Aplicação remota
exige tarefa/autorização específica, identificação de host/banco/role/TLS/schema
esperado e comando `npm run db:migrate:dev`; ver
[Cloudflare Workers](cloudflare-workers.md#migrations-dev-explícitas).

Após os recursos validados e a habilitação deliberada, um push integrado com CI
aprovada publica automaticamente. Para retry manual de SHA atual já aprovado:

```sh
gh workflow run deploy-dev.yml --repo t00ls-dev/levi --ref main \
  -f execution_sha="$(gh api repos/t00ls-dev/levi/git/ref/heads/main --jq .object.sha)"
```

A publicação gera config/secrets temporários privados e os remove ao terminar.
A saída bruta Wrangler e seus logs em disco ficam desabilitados/sanitizados.
Não habilitar request logs ou traces com URLs de autenticação. Depois do upload,
confere Hyperdrive/rotas, versão ativa com 100% do SHA esperado, interface pública,
onboarding anônimo e 401 nos dados privados. Isso **não substitui** testar os dois
e-mails reais, conta, senha, organizações, isolamento e consumo remoto de CPU.

Para interromper publicação, desabilitar `LEVI_DEV_DEPLOY_ENABLED`. Para retirada
remota deliberada, retirar somente o custom domain Levi, preservando banco para
diagnóstico. Reverter Worker apenas para versão compatível com o schema; não
reverter migrations ou excluir dados automaticamente. Falha após upload pode
ter deixado versão ativa: conferir estado antes de repetir.
