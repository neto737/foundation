# Deploy DEV

O processo adapta o deploy real do exemplo Links do Foundation: GitHub Actions,
checkout do SHA exato da branch principal, instalação pelo lockfile, validação,
ambiente `dev`, publicação Wrangler identificada pelo SHA e verificação posterior.
Não utiliza credenciais, banco ou recursos do Foundation. A preparação deste
processo não comprova publicação: o ambiente só estará disponível após os recursos
e as validações remotas descritos abaixo.

## Diferenças necessárias

O repositório Foundation é público; o Links usa pnpm/Turborepo, o plugin Cloudflare
do Vite e D1. Seu workflow também coordena fases de migrations D1. O Levi permanece um projeto npm,
com Vite e Wrangler existentes, PostgreSQL Neon e Hyperdrive exclusivos. Não
adiciona plugin Vite, SDK de provedor, workspace ou runner compartilhado.

O workflow [Deploy DEV](../.github/workflows/deploy-dev.yml) é **somente manual**
nesta etapa: não executa em push/PR. Valida o SHA informado na própria execução;
não depende de um CI separado ainda inexistente. A publicação espera o job
`checks`, usa o ambiente GitHub `dev` e uma fila sem cancelamento de operação em
andamento. O script reconfirma HEAD limpo e main remota imediatamente antes do
upload, recusando execução obsoleta. Não há publicação de branches de PR.

Migrations remotas continuam administrativas e independentes, no comando
`npm run db:migrate:dev` de [Cloudflare Workers](cloudflare-workers.md#migrations-dev-explícitas).
O workflow não recebe URL de banco, credenciais de migrator ou chave de gestão
Neon. Seus testes aplicam o histórico somente em containers sintéticos próprios.

O Links usa health público com SHA e leitura D1. Para este DEV privado, o smoke
automático confere o SHA da versão ativa pela API Cloudflare e o redirecionamento
anônimo de `/` e `/api/onboarding` para Access. **Isso não comprova saúde do banco,
autenticação ou entrega de e-mail.** Não há bypass ou service token do Access para
facilitar o smoke. Os testes funcionais remotos exigem um testador autorizado.

## Recursos antes de habilitar

1. Confirmar Workers Free e quotas, Neon Free, Resend Free e elegibilidade gratuita
   do Access. Confirmar também franquia/bloqueio de gasto do GitHub Actions no
   repositório privado antes de disparar o workflow. Não contratar upgrades.
2. Inventariar os recursos existentes antes de criar qualquer outro. Preparar
   projeto e banco exclusivamente Levi DEV, host direto Neon e roles
   `levi_dev_migrator` e `levi_dev_runtime`. Runtime sem DDL; migrator não vai para
   Worker, Hyperdrive ou GitHub Actions. Confirmar projeto, banco, roles,
   privilégios, TLS, estado vazio/esperado e SQL; aplicar explicitamente o histórico.
3. Preparar Hyperdrive de nome `levi-dev`, apontando ao host/banco DEV esperado e à
   role runtime. Desabilitar query cache e conferir `caching.disabled=true` na
   configuração efetiva. Confirmar TLS até o Neon; o padrão Hyperdrive exige TLS,
   e o comando de migration exige `sslmode=verify-full`. Não usar pooler Neon como
   alvo do migrator ou alterar suas guardas.
4. Preparar remetente Resend de domínio verificado, tracking de links desabilitado
   e chave exclusiva de envio restrita ao domínio. Manter os dois e-mails nativos.
   A lista privada do transporte deve conter somente testadores autorizados.
5. Antes da publicação, configurar uma aplicação self-hosted Access cobrindo o
   hostname inteiro `levi.t00ls.dev`, sem path ou destinos adicionais. Pode usar
   `domain` ou um único destino público com esse URI, sem overrides públicos.
   Usar somente políticas Allow com regras Email para os mesmos endereços exatos
   da lista de envio. Não usar domínio inteiro, Everyone, grupos, Bypass ou Service
   Auth. Este primeiro processo recusa formas de política diferentes, inclusive
   regras adicionais Require/Exclude, para manter a conferência objetiva.
6. Inventariar rotas de toda a conta: somente o custom domain Levi poderá apontar
   ao Worker `levi-dev`; nenhuma rota alternativa em outra zona. Manter workers.dev
   e previews desabilitados. A guarda consulta custom domains da conta e rotas da
   zona t00ls.dev; não certifica rotas em outras zonas às quais o token não dê acesso.

`LEVI_DEV_READY=true` é a confirmação operacional dessas condições, incluindo
plano gratuito, migrations, privilégios/TLS e e-mail; não é uma descoberta
automática dessas propriedades. Ausência de credenciais ou testadores impede
habilitação. A publicação não cria banco, Hyperdrive ou Access, nem muda plano.

## Autenticação segura e configuração

Contas existentes não significam sessão autenticada. No Links, os tokens de deploy
estão nos secrets do repositório Foundation. A API GitHub lista os nomes, mas não
retorna seus valores. Não é necessário nem apropriado extrair/reutilizar esses
tokens para o Levi.

Para administração local, um operador pode executar o Wrangler instalado:

```sh
npx --no-install wrangler login
npx --no-install wrangler whoami
```

O primeiro comando abre o consentimento Cloudflare no navegador. Em sessão sem
navegador/retorno OAuth, usar conexão autenticada ou token exclusivo por variável
de ambiente privada. Não enviar tokens pelo chat, argumentos de shell ou arquivos
versionados. Esse login local não configura GitHub Actions nem autentica Neon ou
Resend.

Para deploy não interativo, criar tokens exclusivos no painel Cloudflare, na
conta correta, com expiração e escopo mínimo disponível:

- `CLOUDFLARE_API_TOKEN`: permissão de publicar Worker e Static Assets e configurar
  seu custom domain na zona t00ls.dev. Após a criação inicial, restringir ao Worker
  levi-dev quando a conta permitir. Não conceder gestão de plano, D1 ou migrations.
- `CLOUDFLARE_READ_TOKEN`: somente leitura de Hyperdrive, aplicações/políticas
  Access, Worker/versões/subdomínio/custom domains, zona e rotas. A conferência
  consulta somente APIs GET. Falha de permissão bloqueia o deploy, sem fallback.

Na interface GitHub, abrir Settings → Environments → dev, limitar deployment
branches a `main` e configurar os secrets abaixo. Alternativamente, em terminal
privado autenticado, estes comandos solicitam o valor interativamente, sem valor
na linha de comando:

```sh
gh secret set CLOUDFLARE_ACCOUNT_ID --repo t00ls-dev/levi --env dev
gh secret set CLOUDFLARE_API_TOKEN --repo t00ls-dev/levi --env dev
gh secret set CLOUDFLARE_READ_TOKEN --repo t00ls-dev/levi --env dev
gh secret set LEVI_AUTH_SECRET --repo t00ls-dev/levi --env dev
gh secret set RESEND_API_KEY --repo t00ls-dev/levi --env dev
gh secret set LEVI_DEV_EMAIL_ALLOWLIST --repo t00ls-dev/levi --env dev
```

LEVI_AUTH_SECRET deve ser aleatório, exclusivo e estável, com ao menos 32
caracteres; não gerar um novo a cada deploy. LEVI_DEV_EMAIL_ALLOWLIST contém JSON
com 1–50 endereços exatos, sem versionar nomes/endereço de testadores. O secret
Resend é uma chave **Sending access**, restrita ao domínio verificado; não é a
chave administrativa do provedor.

Configurar estas **variables do ambiente dev**, com valores obtidos dos recursos
identificados (sem inventar IDs):

| Variable                 | Conteúdo                                                     |
| ------------------------ | ------------------------------------------------------------ |
| `CLOUDFLARE_ZONE_ID`     | ID da zona t00ls.dev na conta esperada                       |
| `LEVI_ACCESS_APP_ID`     | ID da aplicação Access exclusiva que protege todo o hostname |
| `LEVI_HYPERDRIVE_ID`     | ID real do recurso exclusivo levi-dev, sem cache             |
| `LEVI_DEV_DATABASE_HOST` | Host direto Neon, ep-...neon.tech, sem -pooler               |
| `LEVI_DEV_DATABASE_NAME` | levi_dev ou prefixo levi_dev_                                |
| `LEVI_EMAIL_FROM`        | Remetente de domínio verificado                              |
| `LEVI_DEV_READY`         | true somente após conferir os requisitos operacionais        |

Por último, configurar a **variable de repositório** `LEVI_DEV_DEPLOY_ENABLED=true`.
Ela é avaliada antes de o job entrar no ambiente; não colocá-la somente no ambiente
dev. Deixá-la ausente/desabilitada impede publicação mesmo em disparo manual.
Um workflow com checks aprovados e deploy ignorado por essa guarda não significa
que a aplicação foi publicada.

Para permitir provisionamento nesta sessão sem dar credenciais ao CI, o operador
pode disponibilizar conexão autenticada Neon ou API key em arquivo privado/ambiente
seguro. No console Neon, usar Settings → API keys; depois de identificar/criar o
projeto DEV, preferir chave limitada ao projeto. Uma chave limitada não cria outro
projeto. A URL de migrations permanece privada no terminal administrativo. No
Resend, usar API Keys para criar a chave exclusiva; administração do domínio exige
acesso administrativo próprio, separado da chave de envio. Não armazenar chaves
administrativas Neon/Resend no workflow de publicação.

## Disparo e verificações

O job checks executa instalação reproduzível, formatação, typecheck, unitários,
build Node/React, dry-run real Wrangler, PostgreSQL descartável, workerd e navegador.
Sem checks aprovados, não há deploy. Antes do upload, o script também consulta
Access (incluindo aplicações mais específicas no hostname), Hyperdrive/cache,
subdomínio/previews, custom domains e rotas da zona. Configuração inesperada falha
fechada; a guarda não cria políticas ou corrige recursos automaticamente.

O Wrangler raiz continua sem rotas e com Hyperdrive placeholder para builds/testes
locais. O comando de deploy gera configuração temporária a partir dela, substitui
somente o binding, o remetente e o custom domain canônico. Os três secrets de
runtime vão em arquivo temporário modo 0600 para `wrangler deploy --secrets-file`,
suportado pela versão instalada. O diretório é privado, ignorado e removido ao
final; não há artifact com secrets. A saída bruta do Wrangler não é impressa nem
salva. A gravação de logs do próprio Wrangler é desabilitada explicitamente, mantendo
a sanitização habilitada. Não habilitar request logs/traces com URLs de autenticação.

Quando todas as configurações estiverem completas, executar:

```sh
gh workflow run deploy-dev.yml --repo t00ls-dev/levi --ref main \
  -f execution_sha="$(gh api repos/t00ls-dev/levi/git/ref/heads/main --jq .object.sha)"
gh run list --repo t00ls-dev/levi --workflow deploy-dev.yml
```

O comando npm `deploy:dev` é usado dentro desse contexto; fora do GitHub Actions,
sem main/SHA/configuração válidos, ele recusa a publicação. Não substituir por um
`wrangler deploy` avulso para contornar as guardas. Não adicionar migrations a esse
comando ou workflow.

Depois de publicar, o script reconfirma as proteções, consulta o deployment ativo
com 100% da versão e sua tag SHA e exige redirecionamento anônimo para Access na
SPA e na API. Se qualquer verificação falhar, o job falha; isso pode ocorrer **após**
um upload efetivo. Não repetir automaticamente uma mutação ou presumir rollback.

Com testador autorizado, validar separadamente Access permitido/negado, dois
e-mails, links e callbacks HTTPS, definição de senha e login/logout, cookies e
headers, organizações/igrejas e isolamento, revogação, idempotência/concorrência e
rollback observado por outra conexão. Confirmar novamente ausência de cache SQL.
Medir CPU/limites e latência de operações de senha no Workers Free. As medidas
locais não são CPU faturada; o uso do Links não garante o mesmo orçamento de CPU.
Não reduzir scrypt nem contratar plano se Free falhar; registrar o limite real.

Para retirada, primeiro desabilitar `LEVI_DEV_DEPLOY_ENABLED`, retirar somente o
custom domain Levi e conservar Access/banco para diagnóstico. Reverter versão
Worker apenas se compatível com o schema; não desfazer migrations ou excluir
recursos/dados como rollback automático. A primeira publicação pode ser retirada
sem haver versão anterior segura. Não alterar outros Workers ou o Foundation.

## Referências

- [GitHub Actions no Workers](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/).
- [Cache do Hyperdrive](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/).
- [TLS do Hyperdrive](https://developers.cloudflare.com/hyperdrive/configuration/tls-ssl-certificates-for-hyperdrive/).
- [API keys Neon](https://neon.com/docs/manage/api-keys).
- [Permissões de API keys Resend](https://resend.com/changelog/new-api-key-permissions).
