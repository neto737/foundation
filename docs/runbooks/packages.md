# Pacotes e Release do Foundation

O destino oficial dos nove packages é **npmjs.com público**, no scope do
**usuário npm `t00ls-dev`**, sem organização npm e sem publicação dupla. O
registry é `https://registry.npmjs.org`; os manifests e Changesets usam
`public`. Cada package mantém sua versão independente. Raiz, UI, examples, tests
e tooling, incluindo create-app/doctor, continuam privados para publicação.

**Estado operacional:** o fluxo está preparado localmente; isso não comprova
primeira publicação nem OIDC remoto. As versões históricas `0.1.0`/`0.1.1`
permanecem privadas no GitHub Packages. Não as exclua, altere ou publique
novamente como preparação. MIT/notices seguem [Licenças](licensing.md). O deploy
continua DEV-only e o gerador `basic-d1` não é alterado por esta preparação.

## Desenvolvimento e Version Packages

Mudanças publicáveis usam Changesets, nunca edição manual de versões. Após
merge, a CI push/master executa o gate completo; `version` depende de `checks`,
confirma que o SHA continua sendo master e cria/atualiza Version Packages pelo
bot. Não há publish-script, tags ou GitHub Releases automáticos. A serialização
compartilhada com Release não cancela publicação em andamento.

O record format 1 contém baseSha, CLI `3.0.3`, packages/versões/bumps, hashes
dos changesets consumidos e dependências derivadas. Ele é recalculado
independentemente pelas bibliotecas instaladas do Changesets a partir da base
imutável. O PR deve possuir um único commit bot assinado via API, parent igual à
base, head exato, arquivos relacionados, changelogs e changesets consumidos. Não
desenvolva na branch `changeset-release/master` nem faça commits manuais no PR
do bot.

PRs gerados com GITHUB_TOKEN não iniciam CI automaticamente. Valide o head pela
intervenção humana documentada, revise o plano e espere a CI do merge. O
checkout do job version preserva temporariamente a credencial para aprofundar o
histórico Changesets; Release mantém `persist-credentials: false`.

## Primeira distribuição: bootstrap do #30

O bootstrap admite **somente** PR #30, merge
`90a100377fa8c1e0e1b30174d4e611c545ed0ac4`, seus nove nomes e os alvos:

- auth/security `0.2.0`;
- access/audit/config/db/email/observability/tenant `0.1.2`.

`oldVersion: 0.1.1` no record permanece como história do GitHub Packages, não
como uma versão fictícia existente no npm. Não edite o record, não publique
versões intermediárias e não crie bumps artificiais para recuperar esse estado.

O audit bootstrap propõe um **snapshot novo**, mantendo a proveniência original.
As mudanças posteriores, inclusive manifests, dependências, lockfile, docs e
executor, são listadas em `reviewed-changes.json` por path/mode/type/blob OID.
`changes_digest` vincula a lista completa e os SHAs histórico/novo, incluindo as
seis exceções de infraestrutura. O owner deve revisar esses deltas e os bytes
dos tarballs antes de emitir a aprovação separada.

Ausência pública observada por 404/`Not found` é apenas um fato do inventário.
Ela não autoriza criação. Bootstrap publicável exige o plano exato, snapshot,
CI, aprovação do owner e artifacts. Package já existente com outras versões é
divergência, não onboarding automático. Após o bootstrap, releases normais
exigem predecessor e `latest` realmente existentes no npm.

## Contexto, conteúdo e CI

Release continua exclusivamente `workflow_dispatch` em master. Os inputs são:

- `mode`: `audit`, `approve`, `publish` ou `resume`;
- `release_pr` e `release_sha`: PR Version Packages e seu merge imutável;
- `execution_sha`: snapshot/executor exato, igual ao workflow, checkout e
  master;
- `distribution`: `release` por padrão ou `bootstrap` explícito;
- `audit_run`, `plan_digest`, `changes_digest`: obrigatórios fora do audit;
- `approval_run`: obrigatório em publish/resume;
- `confirmation`: confirmação específica de aprovação ou publicação.

`expected_sha` antigo não é aceito. A API precisa comprovar ancestralidade e
identidades completas de commits/trees, sem truncamento, symlinks/gitlinks,
paths duplicados ou entradas incompletas.

`validateProtectedInputs` permanece integral: path/mode/type/blob OID de todo o
repositório, com **somente** as seis exceções nominais existentes:

- `.github/workflows/release.yml`;
- `.github/scripts/release-core.mjs`;
- `.github/scripts/release.mjs`;
- `.github/scripts/release-planning.mjs`;
- `.github/scripts/release.test.mjs`;
- `docs/runbooks/packages.md`.

Em release normal, conteúdo histórico e executor devem corresponder nessa
projeção. No bootstrap #30, o novo snapshot auditado é uma proposta até a
aprovação do owner. Depois dela, **o SHA inteiro** de
audit/approve/publish/resume deve permanecer igual; não se aceita trocar
executor nem mesmo alterando somente uma exceção. O head bot continua sendo
comparado ao merge histórico.

A CI aprovada precisa pertencer ao Foundation, workflow/path exatos, evento
push/master, SHA exato, run mais recente concluído com success e um único job
checks aprovado na mesma tentativa. Erros de API, reexecução pendente/falha,
skip/cancelamento e evidência incompleta bloqueiam; não há fallback para CI
antiga. Release não repete o gate nem baixa artifacts/caches de PR como código
confiável.

## Audit: não autoriza publicação

Execute somente mediante autorização operacional com `mode=audit`, os inputs
históricos/executor e a distribuição desejada. Audit compila e empacota no
runner autorizado; inspeciona nove manifests, allowlist, exports, dependências,
arquivos, LICENSE MIT e hashes SHA-256/SHA-512. Tarballs não admitem links,
protocolos locais, tooling privado ou overrides de publicação adicionais. Paths
derivam exatamente de nome/versão, sem traversal.

O inventário npm é público/anônimo: não envie GITHUB_TOKEN ao npm. Packuments
precisam ter nomes/versões/latest/integridade e URLs HTTPS npm coerentes.
Somente bootstrap admite ausência inicial observada; 401/403/5xx, falhas de
rede, JSON inválido, destino errado ou metadata incompleta falham fechados.

O envelope `authorization.json` **format 3** vincula registry/public,
`user:t00ls-dev`, distribuição, #30/record quando aplicável, snapshot/executor,
protectedInputsDigest, changesDigest, audit_run e os artifacts exatos. Envelopes
GitHub antigos, inclusive format 2, são rejeitados. Adicionar um campo solto a
um envelope antigo não concede autoridade nova.

Revise o artifact `foundation-release-<plan_digest>`, seu summary e a lista de
mudanças. Registre audit_run, plan_digest e changes_digest. O digest autoriza os
bytes, não apenas números de versão. Audit nunca chama publisher.

## Aprovação separada e autoridade verificável

O aprovador é **t00ls-dev, usuário GitHub ID 14156701**, com permissão admin
**atual** no Foundation, revalidada pela API. Não inferimos titularidade npm
desse ID; isso é um pré-requisito administrativo separado.

Após revisar a proposta, o owner faz um dispatch separado `mode=approve`, com os
mesmos SHAs/distribuição/audit_run e os dois digests exatos, usando
`confirmation=APPROVE_PUBLIC_FOUNDATION_SNAPSHOT`. O workflow verifica:

- actor e triggering_actor reais do run por API, login/ID imutável, tipo User;
- permissão admin atual e identidade do workflow/repo/origem/SHA;
- tentativa 1, CI/master atuais e todos os bytes/inputs do audit;
- correspondência do changes_digest revisado com a árvore histórica/novo
  snapshot.

Gera `approval.json`, artifact `foundation-approval-<plan_digest>`, vinculando
identidade, approval_run, destino, snapshot, proveniência, plano e digest de
artifacts. Não é input booleano, label ou texto autodeclarado. A API deve
comprovar que o job approve dessa execução concluiu com success. O certificado é
revalidado no preflight e no publisher, inclusive após obter jobs/permissões.
Re-runs não autorizam operação: use um dispatch novo. Não há exigência de um
segundo aprovador; o controle é a autorização explícita do owner existente.

Esse mecanismo comprova **quem autorizou os hashes exatos**. A revisão humana
efetiva dos deltas/bytes permanece responsabilidade do owner; código não prova
que uma pessoa leu um diff. Quem pode aprovar/alterar executor continua parte da
base de confiança. Não tratar CI ou correspondência com HEAD como aprovação.

## Publicação e OIDC

Publicação requer autorização operacional separada. Use `mode=publish`, os
mesmos inputs e `approval_run` bem-sucedido, com
`confirmation=PUBLISH_PUBLIC_FOUNDATION_PACKAGES`. Preflight recupera artifacts
originais e certificado; publisher repete gates imediatamente antes da
tentativa. Não recompila/reempacota os bytes autorizados, nem faz retry
automático.

Somente publisher possui `id-token: write`; não há `packages: write`, token npm
persistente ou envio de GITHUB_TOKEN ao registry. npm **11.5.1**,
pin/integridade no lockfile, é tooling privado necessário ao OIDC. pnpm
**10.15.1** e Changesets **3.0.3** são preservados. O caminho é:

```text
Changesets --from-pack-dir → pnpm publish <tarball> → npm 11.5.1 <tarball>
```

`npm_config_npm_path` aponta explicitamente para o npm instalado pelo lockfile.
Publisher exige contexto OIDC e rejeita fallback por NODE_AUTH_TOKEN/NPM_TOKEN.
O teste local usa Changesets/pnpm reais e um npm recorder sem rede, verificando
path/bytes/public/latest e encaminhamento do contexto. **Não comprova OIDC
remoto.**

Antes de operar, confirmar a conta npm `t00ls-dev`, controle dos nomes e trusted
publisher de cada package para `t00ls-dev/foundation`, `release.yml` e operação
publish. Primeiro registro OIDC-only de nomes ausentes ainda depende de caminho
administrativo comprovado/autorizado; não presumir que configure publishers
antes da existência dos packages. Não criar organização, placeholders ou tokens
como parte desta preparação. `npm stage publish` registra placeholder em nome
novo e não é um teste inofensivo. Se o bootstrap remoto precisar de outro
método, interromper para desenho/autorização próprios, sem pipeline paralelo ou
fallback.

## Reconciliação e resume

Após tentativa, revisar `npm-release-result`, reconciliation.json e summary.
Published requer integridade e latest dos artifacts aprovados; absent é restante
observado; divergência de identidade/versões/bytes/latest impede nova tentativa.
Bootstrap parcial mantém o mesmo plano, mesmo que packages restantes ainda
retornem 404. Release normal nunca transforma um package ausente em bootstrap.

Resume exige autorização separada, `mode=resume` e os mesmos
PR/release_sha/execution_sha/distribuição/digests/audit_run/approval_run.
Publica somente o restante; se tudo chegou, só reconcilia. Não sobrescreve
versões, reempacota artifacts ou fabrica bumps.

Master fica congelada desde audit até publicação/resume completos. Avanço depois
do audit requer novo audit e nova aprovação antes da primeira tentativa. Após
falha parcial, avanço/exclusão/expiração de artifacts exige recuperação
explícita dos mesmos bytes, não regeneração. Retenção é 30 dias. Consultas de
master e registry não são transação atômica; avanço durante tentativa pode
resultar em publicação parcial e falha de verificação, nunca sucesso silencioso.

## Consumo

Após a primeira publicação efetivamente confirmada, os nove nomes são
instaláveis anonimamente no npm. Consumidores usam versões e lockfile próprios,
com atualizações revisadas/testadas; não recebem alterações de arquivos copiados
do template automaticamente. Remover mapping antigo de scope GitHub é decisão do
consumidor, sem alterar packages históricos.

Até lá, use workspace/tarballs para desenvolvimento/testes: não afirmar que as
versões preparadas já estão disponíveis no npm. Veja
[Distribuição](package-distribution.md) para os 18 exports/perfis TypeScript e
[Criação de apps](creating-an-app.md) para o gerador existente.
