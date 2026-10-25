# Deploy DEV público

Este documento descreve o publicador manual preparado no Foundation para
`apps/levi`. **Não houve transferência operacional:** o repositório original
`t00ls-dev/levi`, branch main, continua como único publicador autorizado e mantém
seu deploy automático. A cópia histórica em `apps/levi/.github` não é executada
como workflow raiz.

O [workflow Deploy Levi DEV](../../../.github/workflows/deploy-levi-dev.yml) ainda
não possui Environment `levi-dev`, credenciais nem interruptor de repositório
provisionados. Não executar dispatch/rerun, criar configuração operacional ou
publicar para testar essa preparação. O estado atual de Cloudflare/Neon,
0004/ACLs e recuperação precisa ser confirmado em leitura autorizada antes do corte.

O alvo permanece Worker `levi-dev`, domínio `https://levi.t00ls.dev`, PostgreSQL/Neon,
Hyperdrive e e-mail próprios. Nenhum recurso é transferido ou recriado pelo código
de preparação. Não há deploy do Links, migrations, Release ou dependência de
publicação npm nesse workflow. Produção permanece fora deste procedimento.

## CI, identidade e publicação

A [CI raiz](../../../.github/workflows/ci.yml) valida PRs e pushes em master,
incluindo os gates do Foundation, quatro shards Links, duas distribuições públicas
e os jobs próprios Levi de PostgreSQL/ACLs/Worker/E2E. O agregador `checks` exige
sucesso de todos os jobs de validação; falha, cancelamento, omissão e skip indevido
bloqueiam o resultado. CI não recebe Environment ou secrets operacionais do Levi.

O novo publicador aceita **somente workflow_dispatch**, com `execution_sha`
obrigatório igual ao SHA selecionado de master. O job validate, sem Environment,
reutiliza o [validador raiz](../../../.github/scripts/ci-evidence.mjs): exige
`t00ls-dev/foundation`, ref master, CI canônica de push/master concluída com
success no SHA exato e `checks` aprovado na tentativa atual. A conclusão global
inclui Version Packages. Não aceita evidência de PR/fork, CI incompleta ou antiga,
nem baixa artifacts de PR. A instalação/build só ocorrem após essa validação.

O job deploy recebe o SHA validado, usa setup pnpm/Node da raiz, instalação
`pnpm install --frozen-lockfile` e `pnpm exec turbo run build --filter=levi`.
O grafo `^build` compila os sete pacotes workspace antes do aplicativo pelos
exports públicos. O operador executa com cwd `apps/levi`.

O [ci-evidence Levi](../tools/ci-evidence.ts) repete as guardas Foundation/master,
consulta run/tentativa/jobs e reconsulta run mais recente e master para recusar
mudanças durante a consulta. [deploy-dev](../tools/deploy-dev.ts) reconfirma
master remota, HEAD limpo e a mesma evidência imediatamente antes do upload.
As verificações de Hyperdrive/cache/TLS, domínio, versão ativa/tag e gate de membros
permanecem preservadas. Há uma única chamada de upload, sem retry automático.

As permissões GITHUB_TOKEN são apenas contents: read/actions: read. Secrets ficam
somente no step publish, após instalação e build, no Environment exclusivo
`levi-dev`, futuramente restrito à master. A fila `levi-dev` usa
cancel-in-progress: false e é distinta de `foundation-dev-d1`; não coordena
publicadores de repositórios diferentes.

**LEVI_DEV_DEPLOY_ENABLED ausente ou diferente de true bloqueia validate antes
mesmo de entrar no Environment.** O segundo job repete a guarda e exige sucesso/SHA
válido do primeiro. Sem configuração/credenciais completas, o operador também
falha antes de publicar. `LEVI_DEV_READY=true` é uma confirmação administrativa,
não prova automática de schema/ACLs nem autorização de transferência.

Referenciar um Environment ausente pode criá-lo implicitamente no GitHub quando
um job alcança essa etapa. Por isso não habilitar o interruptor nem fazer dispatch
antes de preparar o Environment em tarefa autorizada; ausência de Environment não
é proteção suficiente por si só. Não se criou nenhum Environment nesta preparação.

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
   porta 5432, **TLS `verify-full` e CA configurada**, com
   **`caching.disabled=true` conferido pela API**. Sem query cache para
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
Settings → Environments → levi-dev do GitHub Foundation, sem fornecer valores pelo chat ou
versioná-los. Em terminal privado, `gh secret set NOME --repo t00ls-dev/foundation --env levi-dev`
solicita o valor interativamente.

| Secret do environment levi-dev | Uso                                                                |
| ------------------------------ | ------------------------------------------------------------------ |
| `CLOUDFLARE_ACCOUNT_ID`        | Conta correta                                                      |
| `CLOUDFLARE_API_TOKEN`         | Publicar Worker/Assets/custom domain, menor escopo disponível      |
| `CLOUDFLARE_READ_TOKEN`        | Leitura Hyperdrive, Worker/versões/subdomínio/domínios, zona/rotas |
| `LEVI_AUTH_SECRET`             | Aleatório, exclusivo, estável, ao menos 32 caracteres              |
| `RESEND_API_KEY`               | Somente envio, restrito ao domínio remetente                       |

Variables do environment `levi-dev`: `CLOUDFLARE_ZONE_ID`, `LEVI_HYPERDRIVE_ID`,
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
`@t00ls-dev/security`, com store PostgreSQL atômico do Levi. A política completa,
identificadores, limites efetivos e custo estão em
[Rate limiting contextual](rate-limiting.md). Leituras autenticadas usam quota por
usuário validado no servidor, separada de escritas e ações sensíveis. A guarda
ampla por IP executa antes da sessão. Login, pedidos de e-mail e quotas de envio
mantêm os tetos anteriores. A documentação do código não atesta publicação.

IP vem exclusivamente de `CF-Connecting-IP`, garantido pela entrada Cloudflare;
`X-Forwarded-For` do visitante não define autoridade. Header ausente usa bucket
compartilhado. A entrada Node local não habilita essa confiança em headers.
Os contadores usam HMAC-SHA-256 com segredo do servidor, sem IP/e-mail em claro,
expiração e limpeza limitada/indexada no mesmo statement do incremento. O schema
técnico consta na migration `0001_abuse-limits.sql`, sem aplicação remota automática.

Excesso de limite HTTP retorna 429 em português com `Retry-After`. Excesso por destinatário
ou orçamento global suprime envio mantendo a resposta genérica; envio não é
confirmação de entrega. Suprimir não depende da existência da conta. Falhas do banco
não liberam solicitações e falhas do provider não são declaradas como envio
confirmado; ambas não provocam retry automático. Tentativas de envio falhas também
consomem orçamento. Credenciais inválidas no login mantêm erro/status genéricos.
Os parâmetros criptográficos nativos permanecem intactos.

O wrapper auth compartilhado também oferece rate limiting por banco e Turnstile; esses
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
esperado e comando `pnpm --filter levi db:migrate:dev`; ver
[Cloudflare Workers](cloudflare-workers.md#migrations-dev-explícitas).

O primeiro deploy exige autorização específica, além da integração revisada do
publicador e da CI de push/master correspondente. Antes disso, reconciliar recursos,
schema/journal/0004/ACLs e o gate existente; preparar `levi-dev` e credenciais sob
custódia privada, preservando LEVI_AUTH_SECRET. Não incluir credencial migradora.
A publicação auth@0.3.2 e seu plano antigo continuam adiados e intactos.

No corte autorizado, fechar/suspender o publicador original e aguardar naturalmente
qualquer execução já iniciada. Conferir filas/CI capazes de gerar novos eventos;
não cancelar operação persistente como mecanismo de contenção. Tokens separados e
retirada segura da capacidade antiga, quando autorizada e comprovadamente exclusiva,
reforçam o controle de um único publicador. Não reabrir o original enquanto
Foundation puder publicar. Não se realizou nenhuma dessas operações nesta preparação.

Após preparação administrativa e autorização do primeiro dispatch, selecionar
somente a master atual com SHA completo e CI conjunta aprovada. Qualquer avanço
de master ou troca de tentativa/run invalida a seleção e exige nova verificação.
Não usar SHA histórico arbitrário para sobrescrever revisão mais nova.

Falha anterior ao upload preserva a versão existente; após upload, o job pode
falhar mesmo com versão nova ativa. Conferir APIs de deployments/versões antes de
repetir, sem retry automático. Correção de código via novo PR e CI verde é o
caminho normal. Reverter conteúdo usa commit revisável compatível com o schema,
sem reescrever Git ou desfazer migrations. Retirar domínio ou restaurar banco são
operações excepcionais, autorizadas separadamente; não são rollback automático.

A publicação gera config/secrets temporários privados e os remove ao terminar.
A saída bruta Wrangler e seus logs em disco ficam desabilitados/sanitizados.
Não habilitar request logs ou traces com URLs de autenticação. O resumo do job
registra SHA e conclusões em vocabulário fechado, em melhor esforço; o sucesso
depende das verificações do runner, não do resumo.

### Evidências pós-deploy e seus limites

1. **Configuração Hyperdrive:** GET da configuração antes/depois do upload exige
   ID esperado, nome Levi DEV, origem/porta/banco/role runtime, cache desabilitado,
   TLS `verify-full` e identificador da CA. Não comprova consulta SQL.
2. **Binding ativo:** consultar deployments do Worker, exigir versão única com
   100% do tráfego, consultar essa versão e conferir tag SHA, binding `HYPERDRIVE`,
   ID do recurso e allowlist efetiva. A configuração enviada não basta.
   O runner registra somente SHA, UUID da versão, tráfego e resultados sanitizados,
   sem expor outros bindings ou valores de secrets. As permissões de leitura
   existentes do workflow são necessárias; 403 bloqueia confirmação, sem contorno.
3. **Execução SQL:** os GETs anônimos de `/api/onboarding`,
   `/api/organizations`, `/api/churches` e `/api/members` atravessam
   `src/app.ts` → `src/abuse.ts`. O limitador incrementa com
   `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` e limpeza limitada
   (`DELETE` de até 100 contadores expirados por incremento) em `abuse_counters`.
   Erro SQL falha fechado, sem devolver os estados de sucesso esperados.
   Com binding ativo correto e cache desabilitado, smokes aprovados evidenciam
   execução SQL pelo Hyperdrive **por inferência desse fluxo real**.
   Não consultam identidade SQL do projeto/branch/servidor nem fazem homologação
   funcional autenticada. Conexão direta administrativa não substitui esse caminho.
4. **Rotas:** HTML público, onboarding anônimo `{ etapa: "email" }`,
   `401` em organizações/igrejas e `404` em membros sem recorte
   (`401` se houver recorte explicitamente autorizado no futuro), com headers
   de segurança e sem redirects. Nenhuma chamada de criação de negócio ou
   envio de e-mail é feita. O smoke de membros não habilita o módulo.

Os quatro GETs API não são estritamente sem efeitos: incrementam contadores
técnicos HMAC/expiração, sob a runtime e rate limiting normais; não modificam
dados de negócio nem exigem privilégios adicionais. O efeito por invocação é
limitado e conhecido, sem criação duplicada de negócio. Evitar loops e retries
para não consumir limites ou gerar ruído técnico. Os testes do runner usam I/O
simulado; apenas uma publicação real confirma essas evidências no ambiente.

Os smokes não substituem testar e-mails reais, autenticação, organização,
isolamento, CPU/quota remota ou recuperação. O gate de membros existente deve ser reconciliado e preservado, sem ampliar,
esvaziar ou interpretar seu conteúdo como autorização de dados reais. Privacidade, retenção, direitos dos
titulares e recuperação precisam ser resolvidos antes de uso real. A janela móvel
de histórico Neon e as limitações de restauração estão no [procedimento de
migrations](cloudflare-workers.md#migrations-dev-explícitas).

## Limites e rollback da futura transferência

Esta preparação é validada por contratos/harnesses com I/O simulado e dry-run
local, não por upload remoto. O original permanece inalterado. O estado conhecido
no GitHub tem gate de membros configurado, mas não comprova schema/ACLs nem binding
remoto atual. Não aplicar 0004 ou GRANTs para acomodar o corte sem investigação e
autorização próprias; nenhuma migration é executada pelo publicador.

Antes do primeiro upload, inventariar versão ativa e versão de rollback, identidade
dos recursos, escopos reais dos tokens e recuperação Neon disponível. Os smokes
HTTP do operador escrevem contadores técnicos; são parte da publicação autorizada,
não uma investigação de leitura. E-mail real e fluxo autenticado exigem validação
sintética adicional explicitamente autorizada.

Falha após upload pode deixar versão nova ativa. Conferir a API antes de repetir.
Rollback de Worker é uma nova operação autorizada e não reverte banco/recursos.
Se for necessário voltar ao controlador original, primeiro conter o Foundation,
aguardar operações iniciadas e só então restaurar uma capacidade de publicação do
original. Não manter dois controladores, reescrever Git ou desfazer dados/schema.
O publicador continua recusando SHA que não seja a master atual aprovada.
